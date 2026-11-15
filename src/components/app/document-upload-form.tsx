"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Alert } from "@/components/ui/alert";
import { useErrorSummary } from "@/components/ui/use-error-summary";
import { useAnnounce } from "@/components/a11y/announcer";
import { ApiError, api, errorMessage } from "@/lib/client/api";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/domain/schemas";

export const CATEGORY_LABEL: Record<string, string> = {
  prescription: "Prescription",
  lab_report: "Lab report",
  medical_certificate: "Medical certificate",
  discharge_summary: "Discharge summary",
  other: "Other document",
};
const FORM = "doc";
const LABEL: Record<string, string> = { file: "File", title: "Title", category: "Category" };

export function DocumentUploadForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const announce = useAnnounce();
  const { ref: summaryRef, serverMessage, setServerMessage, focusSummary } = useErrorSummary();
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function validate(fd: FormData, file: File | undefined): Record<string, string> {
    const e: Record<string, string> = {};
    if (!file || file.size === 0) e.file = "Choose a file to upload.";
    else if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type) && !/\.(pdf|jpe?g|png)$/i.test(file.name)) e.file = "Only PDF, JPG and PNG files can be uploaded.";
    else if (file.size > MAX_DOCUMENT_BYTES) e.file = "That file is too large. The limit is 4 MB.";
    if (!String(fd.get("title") ?? "").trim()) e.title = "Enter a title for the document.";
    return e;
  }

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setDone(null);
    setServerMessage(undefined);
    const fd = new FormData(ev.currentTarget);
    // Read the file from the input itself (the most direct source of truth).
    const file = (ev.currentTarget.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    if (file) fd.set("file", file);
    const found = validate(fd, file);
    setErrors(found);
    if (Object.keys(found).length) {
      announce(`There ${Object.keys(found).length === 1 ? "is 1 problem" : `are ${Object.keys(found).length} problems`} with the upload form.`, "assertive");
      focusSummary();
      return;
    }
    fd.set("sharedWithPatient", fd.get("sharedWithPatient") ? "true" : "false");
    setBusy(true);
    announce("Uploading…");
    try {
      await api(`/api/patients/${patientId}/documents`, { method: "POST", formData: fd });
      formRef.current?.reset();
      setDone("Document uploaded.");
      announce("Document uploaded");
      router.refresh();
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setServerMessage(errorMessage(e));
      focusSummary();
    } finally { setBusy(false); }
  }

  const list = Object.entries(errors).map(([k, message]) => ({ id: `${FORM}-${k}`, message, label: LABEL[k] }));

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} aria-label="Upload a document" className="space-y-5">
      <FormErrorSummary ref={summaryRef} errors={list} message={serverMessage} />
      {done && (
        <div ref={successRef} tabIndex={-1}><Alert variant="success" title={done} /></div>
      )}
      <Field id={`${FORM}-file`} label="File" required error={errors.file} hint="PDF, JPG or PNG, up to 4 MB.">
        {(a) => <Input {...a} type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="py-2.5" />}
      </Field>
      <Field id={`${FORM}-title`} label="Title" required error={errors.title}>
        {(a) => <Input {...a} name="title" autoComplete="off" />}
      </Field>
      <Field id={`${FORM}-category`} label="Category" required error={errors.category}>
        {(a) => <Select {...a} name="category" defaultValue="prescription">{Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
      </Field>
      <Field id={`${FORM}-description`} label="Description" error={errors.description}>
        {(a) => <Textarea {...a} name="description" rows={3} />}
      </Field>
      <Checkbox id={`${FORM}-sharedWithPatient`} name="sharedWithPatient" defaultChecked label="Share with the patient" description="The patient will be able to see this document." />
      <Button type="submit" size="lg" loading={busy}><Upload aria-hidden="true" /> {busy ? "Uploading…" : "Upload document"}</Button>
    </form>
  );
}
