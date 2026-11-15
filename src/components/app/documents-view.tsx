"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { ExternalLink, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { CATEGORY_LABEL, DocumentUploadForm } from "./document-upload-form";
import type { HealthDocument } from "@/lib/domain/types";

export type PublicDocument = Omit<HealthDocument, "storagePath">;

function size(b: number) {
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsView({ documents, patientId, timezone, canUpload, canDelete }: {
  documents: PublicDocument[]; patientId: string; timezone: string; canUpload: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [filter, setFilter] = useState("all");
  const [toDelete, setToDelete] = useState<PublicDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<{ url: string; title: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const shown = filter === "all" ? documents : documents.filter((d) => d.category === filter);
  const nameOf = (d: PublicDocument) => `${CATEGORY_LABEL[d.category] ?? "Document"} from ${DateTime.fromJSDate(d.createdAt, { zone: timezone }).toFormat("d LLL")}, ${d.title}`;

  async function view(d: PublicDocument) {
    setBusy(`view-${d.id}`); setError(null); setFallback(null);
    try {
      const r = await api<{ url: string }>(`/api/patients/${patientId}/documents/${d.id}/url`);
      const w = window.open(r.url, "_blank", "noopener,noreferrer");
      if (!w) setFallback({ url: r.url, title: d.title });
      announce(`Opening ${d.title} in a new tab.`);
    } catch (e) {
      setError(errorMessage(e));
      announce(errorMessage(e), "assertive");
    } finally { setBusy(null); }
  }

  async function remove() {
    if (!toDelete) return;
    const d = toDelete;
    setBusy(`del-${d.id}`); setError(null);
    try {
      await api(`/api/patients/${patientId}/documents/${d.id}`, { method: "DELETE" });
      setToDelete(null);
      announce(`${d.title} deleted.`);
      router.refresh();
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError(errorMessage(e));
      announce(errorMessage(e), "assertive");
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-8">
      {canUpload && (
        <Card>
          <h2 className="mb-4 text-xl font-bold">Upload a document</h2>
          <DocumentUploadForm patientId={patientId} />
        </Card>
      )}

      <section aria-labelledby="doc-library-heading">
        <h2 id="doc-library-heading" ref={heading} tabIndex={-1} className="text-2xl font-bold">Document library</h2>
        <div className="mt-4 max-w-sm">
          <Field id="doc-filter" label="Show category" hint="Filter the list below.">
            {(a) => (
              <Select {...a} value={filter} onChange={(e) => { setFilter(e.target.value); announce(`Filter changed.`); }}>
                <option value="all">All documents</option>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <p role="status" className="mt-3 text-base text-muted-foreground">{shown.length === 1 ? "1 document" : `${shown.length} documents`} shown.</p>

        {error && <div className="mt-4"><Alert variant="error" title={error} /></div>}
        {fallback && (
          <div className="mt-4"><Alert variant="info" title="Your browser blocked the new tab.">
            <a className="font-semibold underline" href={fallback.url} target="_blank" rel="noopener noreferrer">Open {fallback.title} (opens in a new tab)</a>
          </Alert></div>
        )}

        {shown.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={<FileText />} title={documents.length ? "No documents in this category" : "No documents yet"}>
              {documents.length ? "Choose a different category to see other documents." : canUpload ? "Upload prescriptions, lab reports and other papers using the form above." : "When a caregiver shares a document it will appear here."}
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {shown.map((d) => (
              <li key={d.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold break-words">{d.title}</h3>
                      <p className="text-base text-muted-foreground">
                        {CATEGORY_LABEL[d.category]} · Uploaded <time dateTime={d.createdAt.toISOString()}>{DateTime.fromJSDate(d.createdAt, { zone: timezone }).toFormat("d LLL yyyy")}</time> by {d.uploadedByName} · {size(d.sizeBytes)}
                      </p>
                      {d.description && <p className="mt-2 text-base">{d.description}</p>}
                    </div>
                    {canUpload && <StatusChip tone={d.sharedWithPatient ? "success" : "neutral"}>{d.sharedWithPatient ? "Shared with patient" : "Not shared with patient"}</StatusChip>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" loading={busy === `view-${d.id}`} onClick={() => view(d)}>
                      <ExternalLink aria-hidden="true" /> View{" "}<span className="sr-only">{nameOf(d)} (opens in a new tab)</span>
                    </Button>
                    {canDelete && (
                      <Button size="sm" variant="destructive" onClick={() => setToDelete(d)}>
                        <Trash2 aria-hidden="true" /> Delete{" "}<span className="sr-only">{nameOf(d)}</span>
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }} title="Delete this document?" description={toDelete ? `“${toDelete.title}” will be permanently deleted. This cannot be undone.` : undefined}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setToDelete(null)}>Keep document</Button>
          <Button variant="destructive" loading={!!toDelete && busy === `del-${toDelete.id}`} onClick={remove}>Yes, delete it</Button>
        </div>
      </Dialog>
    </div>
  );
}
