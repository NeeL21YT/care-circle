// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { DocumentUploadForm } from "@/components/app/document-upload-form";

expect.extend(matchers);
const noViolations = (r: unknown) => (expect(r) as unknown as { toHaveNoViolations(): void }).toHaveNoViolations();

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const pdf = (name = "lab.pdf", bytes = 100) => new File(["a".repeat(bytes)], name, { type: "application/pdf" });

describe("DocumentUploadForm", () => {
  it("has no axe violations", async () => {
    const { container } = render(<DocumentUploadForm patientId="p1" />);
    noViolations(await axe(container));
  });

  it("rejects a wrong file type and focuses the error summary", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<DocumentUploadForm patientId="p1" />);
    await user.upload(screen.getByLabelText(/^File/), new File(["x"], "notes.txt", { type: "text/plain" }));
    await user.type(screen.getByLabelText(/^Title/), "Notes");
    await user.click(screen.getByRole("button", { name: /Upload document/ }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Only PDF, JPG and PNG files can be uploaded.");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(screen.getByLabelText(/^File/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects files over 4 MB", async () => {
    const user = userEvent.setup();
    render(<DocumentUploadForm patientId="p1" />);
    await user.upload(screen.getByLabelText(/^File/), pdf("big.pdf", 4 * 1024 * 1024 + 1));
    await user.type(screen.getByLabelText(/^Title/), "Big");
    await user.click(screen.getByRole("button", { name: /Upload document/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    const user = userEvent.setup();
    render(<DocumentUploadForm patientId="p1" />);
    await user.upload(screen.getByLabelText(/^File/), pdf());
    await user.click(screen.getByRole("button", { name: /Upload document/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a title");
  });

  it("posts FormData to the documents endpoint and announces success", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "d1" } }) });
    const user = userEvent.setup();
    render(<DocumentUploadForm patientId="p1" />);
    await user.upload(screen.getByLabelText(/^File/), pdf("lab.pdf"));
    await user.type(screen.getByLabelText(/^Title/), "Blood test");
    await user.selectOptions(screen.getByLabelText(/^Category/), "lab_report");
    await user.click(screen.getByRole("button", { name: /Upload document/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/patients/p1/documents");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect((body.get("file") as File).name).toBe("lab.pdf");
    expect(body.get("title")).toBe("Blood test");
    expect(body.get("category")).toBe("lab_report");
    expect(body.get("sharedWithPatient")).toBe("true");
    expect(await screen.findByText("Document uploaded.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("");
  });

  it("shows a server error in the summary", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: "bad_request", message: "Only PDF, JPG and PNG files can be uploaded." } }) });
    const user = userEvent.setup();
    render(<DocumentUploadForm patientId="p1" />);
    await user.upload(screen.getByLabelText(/^File/), pdf());
    await user.type(screen.getByLabelText(/^Title/), "X");
    await user.click(screen.getByRole("button", { name: /Upload document/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only PDF, JPG and PNG");
  });
});
