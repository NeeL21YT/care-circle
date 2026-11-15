"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { Avatar } from "./avatar";

export function PhotoUpload({ patientId, name, photo }: { patientId: string; name: string; photo: string | null }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setMsg({ kind: "error", text: "Choose a photo first." }); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { setMsg({ kind: "error", text: "The photo must be a JPG or PNG image." }); return; }
    if (file.size > 1024 * 1024) { setMsg({ kind: "error", text: "Choose a photo under 1 MB." }); return; }
    setBusy(true); setMsg(null); announce("Uploading photo.");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api(`/api/patients/${patientId}/photo`, { formData: fd });
      setMsg({ kind: "success", text: "Photo updated." }); announce("Photo updated."); setFile(null); router.refresh();
    } catch (err) { setMsg({ kind: "error", text: errorMessage(err) }); announce(errorMessage(err), "assertive"); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center gap-4"><Avatar name={name} src={photo} size="lg" /><p className="text-base text-muted-foreground">Used only on this app. It is decorative and is never read out.</p></div>
      {msg && <Alert variant={msg.kind} title={msg.text} />}
      <Field id="photo-file" label="Profile photograph" hint="JPG or PNG, up to 1 MB.">
        {(a) => <Input {...a} type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      </Field>
      <Button type="submit" variant="outline" loading={busy}>Upload photo</Button>
    </form>
  );
}
