// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

import { MedicationForm } from "@/components/app/medication-form";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "m1" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => cleanup());

const setup = () => render(<MedicationForm patientId="p1" mode="create" today="2026-11-15" />);
const submit = () => userEvent.click(screen.getByRole("button", { name: /save medication/i }));

describe("MedicationForm", () => {
  it("has no axe violations (daily and weekly layouts)", async () => {
    const { container } = setup();
    expect((await axe(container)).violations).toEqual([]);
    await userEvent.selectOptions(screen.getByLabelText(/how often/i), "weekly");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("shows required-field errors inline and moves focus to the error summary", async () => {
    setup();
    await submit();
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(summary).toHaveTextContent(/problems? with this form/i);
    expect(screen.getAllByText(/Enter the medication name\./).length).toBeGreaterThanOrEqual(2); // summary link + inline
    expect(screen.getByLabelText(/medicine name/i)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds and removes reminder times with descriptive remove buttons", async () => {
    setup();
    expect(screen.queryByRole("button", { name: /^remove/i })).toBeNull(); // last time cannot be removed
    await userEvent.click(screen.getByRole("button", { name: /add a time/i }));
    const t2 = screen.getByLabelText(/time 2/i);
    fireEvent.change(t2, { target: { value: "20:00" } });
    expect(await screen.findByRole("button", { name: "Remove 08:00" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Remove 20:00" })).toBeInTheDocument();
    expect(screen.getByTestId("schedule-summary")).toHaveTextContent("Every day at 8:00 AM and 8:00 PM");
    await userEvent.click(screen.getByRole("button", { name: "Remove 20:00" }));
    expect(screen.queryByLabelText(/time 2/i)).toBeNull();
    expect(screen.getByTestId("schedule-summary")).toHaveTextContent("Every day at 8:00 AM");
  });

  it("requires at least one day when the schedule is weekly", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/medicine name/i), "Metformin");
    await userEvent.type(screen.getByLabelText(/dose amount/i), "1");
    await userEvent.selectOptions(screen.getByLabelText(/how often/i), "weekly");
    await submit();
    expect((await screen.findAllByText("Choose at least one day of the week.")).length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("Monday"));
    await userEvent.click(screen.getByLabelText("Thursday"));
    expect(screen.getByTestId("schedule-summary")).toHaveTextContent("Every Monday and Thursday at 8:00 AM");
    await submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).schedule).toEqual({ frequency: "weekly", times: ["08:00"], daysOfWeek: [1, 4] });
  });

  it("submits the expected JSON body, announces success and returns to the list", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/medicine name/i), "Metformin");
    await userEvent.type(screen.getByLabelText(/strength/i), "500 mg");
    await userEvent.type(screen.getByLabelText(/dose amount/i), "1");
    await userEvent.type(screen.getByLabelText(/special instructions/i), "Take with food");
    await submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/patients/p1/medications");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Metformin", activeIngredient: null, strength: "500 mg", doseAmount: 1, doseUnit: "tablet", form: "Tablet", route: "Oral",
      schedule: { frequency: "daily", times: ["08:00"] }, startDate: "2026-11-15", endDate: null, prescriber: null,
      instructions: "Take with food", status: "active",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/patients/p1/medications"));
  });

  it("shows server-side errors in the summary and keeps the form", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "bad_request", message: "Please check the highlighted fields.", fields: { endDate: "The end date cannot be before the start date." } } }), { status: 400 }));
    setup();
    await userEvent.type(screen.getByLabelText(/medicine name/i), "Metformin");
    await userEvent.type(screen.getByLabelText(/dose amount/i), "1");
    await submit();
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(summary).toHaveTextContent("The end date cannot be before the start date.");
    expect(push).not.toHaveBeenCalled();
  });
});
