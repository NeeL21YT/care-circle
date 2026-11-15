// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import type { ReactNode } from "react";

expect.extend(matchers);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/patients/p1/medications",
}));

import { AnnouncerProvider } from "@/components/a11y/announcer";
import { DisplaySettingsProvider } from "@/components/a11y/display-settings";
import { DoseCard, type DoseView } from "@/components/app/dose-card";
import { PatientNav } from "@/components/app/patient-nav";
import { AdherenceChart } from "@/components/app/adherence-chart";
import { PinGate } from "@/components/app/pin-gate";
import { DisplaySettingsPanel } from "@/components/app/display-settings-panel";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Field, Input } from "@/components/ui/field";
import { DoseStatusChip } from "@/components/ui/status";
import { Alert } from "@/components/ui/alert";
import { setPin } from "@/lib/client/pin";
import { DOSE_STATUSES } from "@/lib/domain/types";

const wrap = (ui: ReactNode) => render(<DisplaySettingsProvider><AnnouncerProvider>{ui}</AnnouncerProvider></DisplaySettingsProvider>);

const dose: DoseView = {
  id: "d1", medicationName: "Metformin", doseText: "1 tablet (500 mg)", instructions: "Take with food",
  scheduledAt: "2026-11-15T14:30:00.000Z", status: "notified",
};

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 201, headers: { "content-type": "application/json" } })));
  // crypto.subtle + storage exist in jsdom/node 24
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

describe("DoseCard (screen reader experience)", () => {
  it("has no axe violations", async () => {
    const { container } = wrap(<ol><li><DoseCard patientId="p1" dose={dose} timezone="Asia/Kolkata" canRespond /></li></ol>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("every action's accessible name includes the medicine and time (so a list of cards is not five identical 'I took it')", () => {
    wrap(<DoseCard patientId="p1" dose={dose} timezone="Asia/Kolkata" canRespond />);
    expect(screen.getByRole("button", { name: /^I took it, Metformin, 8:00 PM$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remind me later, Metformin, 8:00 PM/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip this dose, Metformin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /I am not sure if I took it, Metformin/ })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Metformin, 8:00 PM" })).toBeInTheDocument();
  });

  it("family (read-only) gets no action buttons, only the status", () => {
    wrap(<DoseCard patientId="p1" dose={dose} timezone="Asia/Kolkata" canRespond={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Reminder sent/)).toBeInTheDocument();
  });

  it("'I took it' posts an idempotent event, announces it politely, and moves focus to the status", async () => {
    const user = userEvent.setup();
    wrap(<DoseCard patientId="p1" dose={dose} timezone="Asia/Kolkata" canRespond />);
    await user.click(screen.getByRole("button", { name: /^I took it, / }));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/patients/p1/doses/d1/events");
    const body = JSON.parse(init.body);
    expect(body.eventType).toBe("reported_taken");
    expect(body.clientEventId).toMatch(/^[0-9a-f]{24}$/);
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Thank you. Metformin, 8:00 PM is noted as taken."));
    expect(screen.getByText(/Reported taken/)).toBeInTheDocument();
    // Self-report wording: never claims it was verified.
    expect(screen.getByText(/self-report and is not verified/)).toBeInTheDocument();
    // Buttons are replaced by a labelled "Change answer"; focus did not fall to <body>.
    expect(screen.getByRole("button", { name: /Change answer for Metformin/ })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it("announces failures assertively and shows an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "forbidden", message: "Nope." } }), { status: 403, headers: { "content-type": "application/json" } })));
    const user = userEvent.setup();
    wrap(<DoseCard patientId="p1" dose={dose} timezone="Asia/Kolkata" canRespond />);
    await user.click(screen.getByRole("button", { name: /^I took it, / }));
    await waitFor(() => expect(screen.getByTestId("live-assertive")).toHaveTextContent("That did not save. Nope."));
    expect(screen.getAllByRole("alert").some((n) => n.textContent?.includes("Nope."))).toBe(true);
  });

  it("snooze opens a labelled dialog and sends the chosen minutes", async () => {
    const user = userEvent.setup();
    wrap(<DoseCard patientId="p1" dose={dose} timezone="Asia/Kolkata" canRespond />);
    await user.click(screen.getByRole("button", { name: /Remind me later/ }));
    const dialog = await screen.findByRole("dialog", { name: "Remind me later" });
    await user.selectOptions(within(dialog).getByLabelText(/Remind me again in/), "30");
    await user.click(within(dialog).getByRole("button", { name: "Set reminder" }));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/patients/p1/doses/d1/snooze");
    expect(JSON.parse(init.body).minutes).toBe(30);
  });

  it("an answered dose can be changed (history is kept server-side)", async () => {
    const user = userEvent.setup();
    wrap(<DoseCard patientId="p1" dose={{ ...dose, status: "reported_taken" }} timezone="Asia/Kolkata" canRespond />);
    expect(screen.queryByRole("button", { name: /^I took it, / })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Change answer/ }));
    expect(screen.getByRole("button", { name: /^I took it, / })).toBeInTheDocument();
  });
});

describe("status never relies on colour alone", () => {
  it("every dose status renders text and an explanation for screen readers", () => {
    for (const s of DOSE_STATUSES) {
      const { container, unmount } = render(<DoseStatusChip status={s} />);
      expect(container.textContent?.trim().length).toBeGreaterThan(5);
      expect(container.querySelector("[aria-hidden='true']")).not.toBeNull(); // decorative icon only
      unmount();
    }
  });
  it("'reported taken' wording says self-report; 'no response' says it is not a medical conclusion", () => {
    const { container: a } = render(<DoseStatusChip status="reported_taken" />);
    expect(a.textContent).toMatch(/self-report/i);
    const { container: b } = render(<DoseStatusChip status="missed_by_policy" />);
    expect(b.textContent).toMatch(/not a medical conclusion/i);
  });
});

describe("navigation", () => {
  it("marks the current page, labels the landmark and has no axe violations", async () => {
    const items = [
      { href: "/patients/p1", label: "Overview", icon: <span /> },
      { href: "/patients/p1/medications", label: "Medications", icon: <span /> },
    ];
    const { container } = wrap(<PatientNav items={items} patientName="Asha Verma" />);
    expect(screen.getByRole("navigation", { name: "Asha Verma sections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Medications" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("mobile menu button exposes expanded state and what it controls", async () => {
    const user = userEvent.setup();
    wrap(<PatientNav items={[{ href: "/x", label: "X", icon: <span /> }]} patientName="Asha" />);
    const btn = screen.getByRole("button", { name: /Menu: Asha/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls", "patient-sections");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });
});

describe("forms", () => {
  it("error summary is an alert that links to the invalid field", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <FormErrorSummary errors={[{ id: "f-name", message: "Enter the name.", label: "Name" }]} />
        <Field id="f-name" label="Name" required error="Enter the name.">{(a) => <Input {...a} />}</Field>
      </form>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("There is 1 problem with this form");
    await user.click(screen.getByRole("link", { name: "Name: Enter the name." }));
    expect(screen.getByLabelText(/Name/)).toHaveFocus();
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Error: Enter the name.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Alert uses role=alert for errors and role=status otherwise", () => {
    render(<><Alert variant="error" title="Bad" /><Alert variant="success" title="Good" /></>);
    expect(screen.getByRole("alert")).toHaveTextContent("Error: Bad");
    expect(screen.getByRole("status")).toHaveTextContent("Success: Good");
  });
});

describe("adherence chart", () => {
  it("exposes a text summary and a real data table instead of relying on the SVG", async () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      date: `2026-11-${9 + i}`, label: `Mon ${9 + i} Nov`, due: 2, taken: i % 2, skipped: 0, unknown: 0, unresolved: 2 - (i % 2), upcoming: 0, cancelled: 0, percentage: 50,
    }));
    const { container } = render(<AdherenceChart days={days} summaryText="50% of doses due in the last 7 days were reported as taken (3 of 14)." />);
    expect(screen.getByText(/50% of doses due/)).toBeInTheDocument();
    const table = screen.getByRole("table", { hidden: true });
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(8);
    expect(within(table).getAllByRole("columnheader", { hidden: true }).map((c) => c.textContent)).toContain("Reported taken");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("display settings and PIN", () => {
  it("text size radios apply to <html> and are announced", async () => {
    const user = userEvent.setup();
    wrap(<DisplaySettingsPanel showPin />);
    await user.click(screen.getByRole("radio", { name: /Extra large/ }));
    expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Text size set to Extra large."));
    await user.click(screen.getByRole("radio", { name: /High contrast/ }));
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(JSON.parse(localStorage.getItem("cc.display")!)).toMatchObject({ textSize: "xlarge", contrast: "high" });
    document.documentElement.removeAttribute("data-text-size");
    document.documentElement.removeAttribute("data-contrast");
  });

  it("settings panel has no axe violations", async () => {
    const { container } = wrap(<DisplaySettingsPanel showPin />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("PIN gate hides content from everyone (inert + aria-hidden) until the right PIN is entered", async () => {
    await setPin("2468");
    sessionStorage.clear(); // simulate a new session
    const user = userEvent.setup();
    wrap(<PinGate><p>Secret medicines</p></PinGate>);
    const dialog = await screen.findByRole("dialog", { name: "Enter your PIN" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Secret medicines").parentElement).toHaveAttribute("aria-hidden", "true");
    const input = screen.getByLabelText(/PIN \(4 to 6 digits\)/);
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "1111{enter}");
    expect(await screen.findByText(/That PIN is not right/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/PIN \(4 to 6 digits\)/), "2468{enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Secret medicines").parentElement).not.toHaveAttribute("aria-hidden");
  });

  it("PIN is stored only as a salted hash, never in plain text", async () => {
    await setPin("2468");
    const raw = localStorage.getItem("cc.pin")!;
    expect(raw).not.toContain("2468");
    expect(JSON.parse(raw)).toHaveProperty("salt");
  });
});
