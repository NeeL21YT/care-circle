// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { AppointmentCalendar } from "@/components/app/appointment-calendar";
import type { Appointment } from "@/lib/domain/types";

expect.extend(matchers);
const noViolations = (r: unknown) => (expect(r) as unknown as { toHaveNoViolations(): void }).toHaveNoViolations();

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
afterEach(cleanup);

const mk = (id: string, iso: string, doctor: string, status: Appointment["status"] = "scheduled"): Appointment => ({
  id, patientId: "p1", doctorName: doctor, facility: "City Clinic", startsAt: new Date(iso), timezone: "UTC", location: null,
  appointmentType: "Check-up", notes: null, reminderOffsetsMinutes: [60], status, createdByUid: "u", createdAt: new Date(), updatedAt: new Date(),
});
const appts = [
  mk("a", "2026-11-17T09:00:00Z", "Dr. Rao"),
  mk("b", "2026-11-17T15:30:00Z", "Dr. Iyer"),
  mk("c", "2026-12-02T10:00:00Z", "Dr. Shah"),
  mk("d", "2026-11-18T10:00:00Z", "Dr. Cancelled", "cancelled"),
];
const setup = () => render(<AppointmentCalendar appointments={appts} timezone="UTC" today="2026-11-15T12:00:00Z" />);

describe("AppointmentCalendar", () => {
  it("has no axe violations", async () => {
    const { container } = setup();
    noViolations(await axe(container));
  });

  it("exposes counts and today in each day's accessible name; cancelled are not counted", () => {
    setup();
    expect(screen.getByRole("button", { name: "Tuesday 17 November 2026, 2 appointments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sunday 15 November 2026, today, no appointments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wednesday 18 November 2026, no appointments" })).toBeInTheDocument();
  });

  it("uses a single tab stop (roving tabindex) and a real grid", () => {
    setup();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    const tabbable = screen.getAllByRole("button").filter((b) => b.getAttribute("data-date") && b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("data-date", "2026-11-15");
  });

  it("arrow keys move focus between days; PageDown changes month", async () => {
    const user = userEvent.setup();
    setup();
    act(() => screen.getByRole("button", { name: /Sunday 15 November 2026/ }).focus());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-11-16");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-11-23");
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-11-22");
    await user.keyboard("{PageDown}");
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("data-date", "2026-12-22");
    await user.keyboard("{PageUp}");
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
  });

  it("Home/End jump to the ends of the week (Monday start)", async () => {
    const user = userEvent.setup();
    setup();
    act(() => screen.getByRole("button", { name: /Wednesday 18 November 2026/ }).focus());
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-11-16");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-11-22");
    void user;
  });

  it("selecting a day lists its appointments in a polite live region and marks aria-selected", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Tuesday 17 November 2026, 2 appointments" }));
    const region = screen.getByRole("heading", { name: "Tuesday 17 November 2026" }).parentElement!.querySelector("[aria-live=polite]") as HTMLElement;
    expect(within(region).getByText(/Dr\. Rao/)).toBeInTheDocument();
    expect(within(region).getByText(/Dr\. Iyer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tuesday 17 November 2026/ }).closest("[role=gridcell]")).toHaveAttribute("aria-selected", "true");
  });

  it("month buttons change the month", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
  });
});
