"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded", queued: "Waiting", processing: "Reading", review_required: "Needs your review",
  approved: "Approved", rejected: "Rejected", failed: "Did not work",
};

export interface ScanRow { id: string; documentId: string; documentTitle: string; status: string; createdAt: string }

export function PrescriptionScanner({ patientId, scans, aiReady }: { patientId: string; scans: ScanRow[]; aiReady: boolean }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("Prescription");
  const [busy, setBusy] = useState<"upload" | "scan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errRef = useRef<HTMLDivElement>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Choose a prescription photo or PDF first."); return; }
    setError(null);
    try {
      setBusy("upload");
      announce("Uploading the prescription", "polite");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("title", title.trim() || "Prescription");
      fd.set("category", "prescription");
      fd.set("sharedWithPatient", "false");
      const doc = await api<{ id: string }>(`/api/patients/${patientId}/documents`, { formData: fd });
      setBusy("scan");
      announce("Reading the prescription. This can take up to a minute.", "polite");
      const r = await api<{ id: string }>(`/api/patients/${patientId}/prescriptions`, { body: { documentId: doc.id } });
      router.push(`/patients/${patientId}/scanner/${r.id}?doc=${doc.id}`);
    } catch (err) {
      setError(errorMessage(err));
      announce(errorMessage(err), "assertive");
      setBusy(null);
      requestAnimationFrame(() => errRef.current?.focus());
    }
  }

  return (
    <div className="space-y-8">
      {!aiReady && <Alert variant="warning" title="AI scanning is not set up yet">An administrator needs to add the Gemini API key. You can still add medicines by hand.</Alert>}
      <form onSubmit={run} className="space-y-4 rounded-xl border-2 p-4" aria-labelledby="scan-h">
        <h2 id="scan-h" className="text-xl font-bold">Scan a new prescription</h2>
        <div ref={errRef} tabIndex={-1}>{error && <Alert variant="error" title={error} />}</div>
        <Field id="scan-title" label="Name for this document" required>{(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field id="scan-file" label="Prescription photo or PDF" hint="JPG, PNG or PDF, up to 4 MB. Make sure the whole page is in focus and well lit." required>
          {(p) => <Input {...p} type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        {file && <p>Selected: <strong>{file.name}</strong> <Button type="button" variant="outline" onClick={() => setFile(null)}>Remove</Button></p>}
        <Button type="submit" disabled={busy !== null || !aiReady}>
          {busy === "upload" ? "Uploading…" : busy === "scan" ? "Reading the prescription…" : "Upload and read it"}
        </Button>
        <p className="text-sm text-muted-foreground">The AI only suggests details. You check every one, and nothing is added to the medicine list until you approve it.</p>
      </form>
      <section aria-labelledby="hist-h" className="space-y-3">
        <h2 id="hist-h" className="text-xl font-bold">Earlier scans</h2>
        {scans.length === 0 ? <p>No scans yet.</p> : (
          <ul className="space-y-2">
            {scans.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 p-3">
                <span><strong>{s.documentTitle}</strong>, {new Date(s.createdAt).toLocaleString()}</span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">Status: {STATUS_LABEL[s.status] ?? s.status}</span>
                  <Link href={`/patients/${patientId}/scanner/${s.id}?doc=${s.documentId}`} className="font-semibold underline">Open<span className="sr-only"> scan of {s.documentTitle}</span></Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
