"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ShieldOff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { StatusChip } from "@/components/ui/status";
import { useErrorSummary } from "@/components/ui/use-error-summary";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { SHARE_CATEGORIES, type Role, type SharePermissions } from "@/lib/domain/types";

export interface MemberView { uid: string; displayName: string; role: Role; email?: string; permissions?: SharePermissions }
export interface InviteView { inviteId: string; email: string; role: Role; permissions: SharePermissions; expiresAt: string }

const ROLE_LABEL: Record<Role, string> = { patient: "Patient", primary_caregiver: "Primary caregiver", family: "Family member" };
const SHARE_LABEL: Record<(typeof SHARE_CATEGORIES)[number], { label: string; hint: string }> = {
  medications: { label: "Medicines and today's schedule", hint: "What is prescribed and when it is due." },
  adherence: { label: "Reported adherence and activity", hint: "What the patient reported: taken, skipped, not sure." },
  appointments: { label: "Doctor appointments", hint: "Upcoming and past visits." },
  documents: { label: "Health documents", hint: "Prescriptions, reports and certificates." },
  tasks: { label: "Care tasks and handovers", hint: "See shared tasks and handovers, and update tasks given to them." },
  manageCare: { label: "Assign tasks and prepare handovers", hint: "For a secondary caregiver. Needs 'Care tasks and handovers' too." },
};

function SharingFields({ idPrefix, value, onChange }: { idPrefix: string; value: SharePermissions; onChange: (v: SharePermissions) => void }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">What can this person see?</legend>
      <p className="text-[0.95rem] text-muted-foreground">Family members can never edit medicines, appointments or documents. Choose only what they need. A read-only viewer needs none of the last two.</p>
      {SHARE_CATEGORIES.map((c) => (
        <Checkbox key={c} id={`${idPrefix}-${c}`} label={SHARE_LABEL[c].label} description={SHARE_LABEL[c].hint} checked={value[c] ?? false} onChange={(e) => onChange({ ...value, [c]: e.target.checked })} />
      ))}
    </fieldset>
  );
}

export function CareCircleManager({ patientId, patientName, members, invites, canManage, currentUid }: {
  patientId: string; patientName: string; members: MemberView[]; invites: InviteView[]; canManage: boolean; currentUid: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const { ref: summaryRef, ...summary } = useErrorSummary();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("family");
  const [perms, setPerms] = useState<SharePermissions>({ medications: false, adherence: false, appointments: true, documents: false, tasks: true, manageCare: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; devUrl?: string } | null>(null);
  const [revoke, setRevoke] = useState<MemberView | null>(null);
  const [edit, setEdit] = useState<MemberView | null>(null);
  const [editPerms, setEditPerms] = useState<SharePermissions | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setResult(null); summary.setServerMessage(undefined); summary.setServerFields({});
    try {
      const r = await api<{ emailSent: boolean; devAcceptUrl?: string }>(`/api/patients/${patientId}/invitations`, { method: "POST", body: { email, role, permissions: role === "family" ? perms : undefined } });
      const text = r.emailSent ? `Invitation sent to ${email}. It expires in 7 days.` : `Invitation created for ${email}, but no email could be sent from this server.`;
      setResult({ text, devUrl: r.devAcceptUrl });
      announce(text);
      setEmail("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields) summary.setServerFields(err.fields);
      summary.setServerMessage(errorMessage(err));
      announce(errorMessage(err), "assertive");
      summary.focusSummary();
    } finally { setBusy(false); }
  }

  async function doRevoke() {
    if (!revoke) return;
    setBusy(true);
    try {
      await api(`/api/patients/${patientId}/memberships/${revoke.uid}`, { method: "DELETE" });
      announce(`${revoke.displayName} no longer has access.`);
      setRevoke(null);
      router.refresh();
    } catch (err) { announce(errorMessage(err), "assertive"); summary.setServerMessage(errorMessage(err)); setRevoke(null); }
    finally { setBusy(false); }
  }
  async function revokeInvite(i: InviteView) {
    try {
      await api(`/api/patients/${patientId}/invitations/${i.inviteId}`, { method: "DELETE" });
      announce(`Invitation for ${i.email} cancelled.`);
      router.refresh();
    } catch (err) { announce(errorMessage(err), "assertive"); }
  }
  async function savePerms() {
    if (!edit || !editPerms) return;
    setBusy(true);
    try {
      await api(`/api/patients/${patientId}/memberships/${edit.uid}`, { method: "PATCH", body: { permissions: editPerms } });
      announce(`Sharing updated for ${edit.displayName}.`);
      setEdit(null);
      router.refresh();
    } catch (err) { announce(errorMessage(err), "assertive"); }
    finally { setBusy(false); }
  }

  const list = Object.entries(summary.serverFields).map(([k, m]) => ({ id: `invite-${k}`, message: m }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="members-heading" className="space-y-4">
        <h2 id="members-heading" className="text-2xl font-bold">People with access</h2>
        {!canManage && <p className="text-base text-muted-foreground">These are the people who help look after {patientName}.</p>}
        {summary.serverMessage && !busy && !result && <Alert variant="error" title={summary.serverMessage} />}
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.uid}>
              <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="text-xl font-bold">{m.displayName}{m.uid === currentUid && <span className="font-normal text-muted-foreground"> (you)</span>}</p>
                  <p className="text-base text-muted-foreground">{ROLE_LABEL[m.role]}{m.email ? ` · ${m.email}` : ""}</p>
                  {m.role === "family" && m.permissions && (
                    <p className="mt-1 text-base">
                      Can see: {SHARE_CATEGORIES.filter((c) => m.permissions![c]).map((c) => SHARE_LABEL[c].label).join("; ") || "nothing yet"}
                    </p>
                  )}
                </div>
                {canManage && m.uid !== currentUid && (
                  <div className="flex flex-wrap gap-2">
                    {m.role === "family" && <Button variant="outline" onClick={() => { setEdit(m); setEditPerms(m.permissions ?? { medications: false, adherence: false, appointments: false, documents: false }); }}>Change sharing{" "}<span className="sr-only">for {m.displayName}</span></Button>}
                    <Button variant="destructive" onClick={() => setRevoke(m)}><ShieldOff aria-hidden="true" /> Remove access{" "}<span className="sr-only">for {m.displayName}</span></Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <>
          <section aria-labelledby="pending-heading" className="space-y-4">
            <h2 id="pending-heading" className="text-2xl font-bold">Pending invitations</h2>
            {invites.length === 0 ? <p className="rounded-xl bg-muted p-4 text-base">No invitations are waiting.</p> : (
              <ul className="space-y-3">
                {invites.map((i) => (
                  <li key={i.inviteId}>
                    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
                      <div>
                        <p className="flex flex-wrap items-center gap-2 text-lg font-bold"><Mail aria-hidden="true" className="size-5" />{i.email} <StatusChip tone="info">Waiting</StatusChip></p>
                        <p className="text-base text-muted-foreground">{ROLE_LABEL[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString()}</p>
                      </div>
                      <Button variant="outline" onClick={() => revokeInvite(i)}>Cancel invitation{" "}<span className="sr-only">for {i.email}</span></Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="invite-heading">
            <Card>
              <CardTitle id="invite-heading">Invite someone</CardTitle>
              <p className="mt-1 text-base text-muted-foreground">They must sign in with this exact email address and verify it. Knowing {patientName}&apos;s email gives nobody access.</p>
              <form className="mt-5 space-y-5" onSubmit={invite} noValidate>
                <FormErrorSummary ref={summaryRef} errors={list} message={summary.serverMessage} />
                {result && (
                  <Alert variant="success" title={result.text}>
                    {result.devUrl && <>Development only: no email provider is configured. Open this link while signed in as the invited person: <a className="break-all underline" href={result.devUrl}>{result.devUrl}</a></>}
                  </Alert>
                )}
                <Field id="invite-email" label="Their email address" required error={summary.serverFields.email}>
                  {(a) => <Input {...a} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />}
                </Field>
                <Field id="invite-role" label="Their role" required>
                  {(a) => (
                    <Select {...a} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                      <option value="family">Family member (view only)</option>
                      <option value="patient">The patient (sees their own day and answers reminders)</option>
                      <option value="primary_caregiver">Another primary caregiver (full access)</option>
                    </Select>
                  )}
                </Field>
                {role === "family" && <SharingFields idPrefix="invite-share" value={perms} onChange={setPerms} />}
                <Button type="submit" size="lg" loading={busy}><UserPlus aria-hidden="true" /> Send invitation</Button>
              </form>
            </Card>
          </section>
        </>
      )}

      <Dialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} title="Remove access?" description={revoke ? `${revoke.displayName} will immediately lose access to ${patientName}'s information. You can invite them again later.` : undefined}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setRevoke(null)}>Keep access</Button>
          <Button variant="destructive" onClick={doRevoke} loading={busy}>Remove access</Button>
        </div>
      </Dialog>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit ? `What can ${edit.displayName} see?` : "Sharing"}>
        {editPerms && <SharingFields idPrefix="edit-share" value={editPerms} onChange={setEditPerms} />}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
          <Button onClick={savePerms} loading={busy}>Save sharing</Button>
        </div>
      </Dialog>
    </div>
  );
}
