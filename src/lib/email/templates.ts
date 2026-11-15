/**
 * Transactional email templates. Table-free, semantic, high-contrast HTML with
 * a plain-text alternative for screen readers and text-only clients. All
 * dynamic values are HTML-escaped. Wording never claims verified ingestion and
 * never labels a missed reminder as an emergency.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(opts: { title: string; preheader: string; bodyHtml: string; cta?: { label: string; url: string }; footer?: string }): string {
  const cta = opts.cta
    ? `<p style="margin:28px 0"><a href="${esc(opts.cta.url)}" style="background:#0b6b63;color:#ffffff;text-decoration:none;font-weight:700;font-size:18px;padding:14px 26px;border-radius:10px;display:inline-block">${esc(opts.cta.label)}</a></p>
       <p style="font-size:15px;color:#3b4d4c">If the button does not work, copy this link into your browser:<br><a href="${esc(opts.cta.url)}" style="color:#0b4f8a;word-break:break-all">${esc(opts.cta.url)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;background:#f5f8f7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#14282a">
<span style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</span>
<div role="article" aria-label="${esc(opts.title)}" style="max-width:560px;margin:0 auto;padding:24px 16px">
  <p style="font-size:15px;font-weight:700;color:#0b6b63;margin:0 0 12px">Care Circle</p>
  <div style="background:#ffffff;border:1px solid #c5d3d1;border-radius:16px;padding:28px">
    <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px">${esc(opts.title)}</h1>
    <div style="font-size:18px;line-height:1.6">${opts.bodyHtml}</div>
    ${cta}
  </div>
  <p style="font-size:14px;color:#3b4d4c;margin:16px 4px">${opts.footer ?? "You can change which emails you receive in Notification settings inside the app."}</p>
</div></body></html>`;
}

const row = (label: string, value: string) =>
  `<p style="margin:6px 0"><strong>${esc(label)}:</strong> ${esc(value)}</p>`;

export interface DoseEmailData {
  recipientName: string;
  patientName: string;
  medicationName: string;
  doseText: string;
  localTime: string;
  instructions?: string | null;
  appUrl: string;
}

export function medicationReminderEmail(d: DoseEmailData & { upcoming?: boolean }): RenderedEmail {
  const subject = d.upcoming
    ? `Coming up at ${d.localTime}: ${d.medicationName}`
    : `Time for ${d.medicationName} (${d.localTime})`;
  const title = d.upcoming ? "A medicine is coming up" : "It's time for a medicine";
  const body =
    `<p>Hello ${esc(d.recipientName)},</p>` +
    `<p>${d.upcoming ? "This is a heads-up that a dose is due soon" : "A dose is due now"} for <strong>${esc(d.patientName)}</strong>.</p>` +
    row("Medicine", d.medicationName) + row("Dose", d.doseText) + row("Time", d.localTime) +
    (d.instructions ? row("Instructions", d.instructions) : "") +
    `<p>Open the app to tell us if it was taken, skipped, or if you want a reminder later.</p>`;
  return {
    subject,
    html: layout({ title, preheader: `${d.medicationName} at ${d.localTime}`, bodyHtml: body, cta: { label: "Open my medicines", url: d.appUrl } }),
    text: `${title}\n\nHello ${d.recipientName},\n${d.upcoming ? "A dose is due soon" : "A dose is due now"} for ${d.patientName}.\nMedicine: ${d.medicationName}\nDose: ${d.doseText}\nTime: ${d.localTime}\n${d.instructions ? `Instructions: ${d.instructions}\n` : ""}\nOpen the app: ${d.appUrl}`,
  };
}

export function medicationFollowUpEmail(d: DoseEmailData): RenderedEmail {
  const title = "A gentle reminder";
  const body =
    `<p>Hello ${esc(d.recipientName)},</p>` +
    `<p>We have not heard back about a dose scheduled for <strong>${esc(d.localTime)}</strong>.</p>` +
    row("Medicine", d.medicationName) + row("Dose", d.doseText) +
    `<p>Please open the app and let us know what happened. You can choose <em>Taken</em>, <em>Skipped</em>, <em>Remind me later</em>, or <em>I am not sure</em>.</p>`;
  return {
    subject: `Reminder: ${d.medicationName} from ${d.localTime}`,
    html: layout({ title, preheader: `Please update ${d.medicationName}`, bodyHtml: body, cta: { label: "Update my medicine", url: d.appUrl } }),
    text: `${title}\n\nHello ${d.recipientName},\nWe have not heard back about the ${d.localTime} dose.\nMedicine: ${d.medicationName}\nDose: ${d.doseText}\n\nOpen the app: ${d.appUrl}`,
  };
}

export function missedDoseEmail(d: DoseEmailData): RenderedEmail {
  const title = "A dose has no response yet";
  const body =
    `<p>Hello ${esc(d.recipientName)},</p>` +
    `<p><strong>${esc(d.patientName)}</strong> has not responded to the reminder for a dose scheduled at <strong>${esc(d.localTime)}</strong>. ` +
    `Under your care team's reminder rules, this dose is now shown as <em>no response recorded</em>.</p>` +
    row("Medicine", d.medicationName) + row("Dose", d.doseText) +
    `<p>This does not mean the medicine was or was not taken. It only means no answer was recorded. You may want to check in with them.</p>`;
  return {
    subject: `No response yet: ${d.patientName}, ${d.medicationName} at ${d.localTime}`,
    html: layout({ title, preheader: `${d.patientName} has not responded to the ${d.localTime} reminder`, bodyHtml: body, cta: { label: "See today's activity", url: d.appUrl } }),
    text: `${title}\n\nHello ${d.recipientName},\n${d.patientName} has not responded to the reminder for the ${d.localTime} dose.\nMedicine: ${d.medicationName}\nDose: ${d.doseText}\nThis does not mean the medicine was or was not taken; no answer was recorded.\n\nSee today's activity: ${d.appUrl}`,
  };
}

export interface AppointmentEmailData {
  recipientName: string;
  patientName: string;
  doctorName: string;
  facility?: string | null;
  location?: string | null;
  localDateTime: string;
  appointmentType: string;
  whenText: string; // e.g. "tomorrow", "in 1 hour"
  appUrl: string;
}

export function appointmentEmail(d: AppointmentEmailData): RenderedEmail {
  const title = `Doctor appointment ${d.whenText}`;
  const body =
    `<p>Hello ${esc(d.recipientName)},</p>` +
    `<p><strong>${esc(d.patientName)}</strong> has an appointment ${esc(d.whenText)}.</p>` +
    row("Doctor", d.doctorName) + row("Type", d.appointmentType) + row("When", d.localDateTime) +
    (d.facility ? row("Clinic or hospital", d.facility) : "") +
    (d.location ? row("Location", d.location) : "");
  return {
    subject: `Appointment ${d.whenText}: ${d.doctorName}, ${d.localDateTime}`,
    html: layout({ title, preheader: `${d.doctorName}, ${d.localDateTime}`, bodyHtml: body, cta: { label: "View appointment", url: d.appUrl } }),
    text: `${title}\n\nHello ${d.recipientName},\n${d.patientName} has an appointment ${d.whenText}.\nDoctor: ${d.doctorName}\nType: ${d.appointmentType}\nWhen: ${d.localDateTime}\n${d.facility ? `Clinic: ${d.facility}\n` : ""}${d.location ? `Location: ${d.location}\n` : ""}\nView: ${d.appUrl}`,
  };
}

export interface InvitationEmailData {
  inviterName: string;
  patientName: string;
  roleLabel: string;
  expiresText: string;
  acceptUrl: string;
}

export function invitationEmail(d: InvitationEmailData): RenderedEmail {
  const title = `${d.inviterName} invited you to a care circle`;
  const body =
    `<p><strong>${esc(d.inviterName)}</strong> invited you to join the care circle for <strong>${esc(d.patientName)}</strong> as <strong>${esc(d.roleLabel)}</strong>.</p>` +
    `<p>To accept, sign in (or create an account) using <strong>this email address</strong>, then open the link below. The invitation expires ${esc(d.expiresText)}.</p>` +
    `<p>If you were not expecting this, you can ignore this email and no access will be granted.</p>`;
  return {
    subject: `${d.inviterName} invited you to help care for ${d.patientName}`,
    html: layout({ title, preheader: `Join ${d.patientName}'s care circle`, bodyHtml: body, cta: { label: "Review invitation", url: d.acceptUrl }, footer: "You received this because someone entered your email address. No access is granted unless you accept." }),
    text: `${title}\n\n${d.inviterName} invited you to join the care circle for ${d.patientName} as ${d.roleLabel}.\nSign in with this email address, then open: ${d.acceptUrl}\nThe invitation expires ${d.expiresText}. If you were not expecting this, ignore this email.`,
  };
}
