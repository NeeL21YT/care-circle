"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { flattenErrors, useErrorSummary } from "@/components/ui/use-error-summary";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { isValidTimezone } from "@/lib/domain/scheduling";

const phone = z.string().trim().regex(/^$|^[+]?[0-9\s().-]{7,20}$/, "Enter a valid phone number.");
const schema = z.object({
  fullName: z.string().trim().min(1, "Enter the patient's full name.").max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth.").refine((d) => d <= new Date().toISOString().slice(0, 10), "Date of birth cannot be in the future."),
  gender: z.string().trim().max(40),
  phone,
  email: z.string().trim().refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address."),
  preferredLanguage: z.string().trim().min(1, "Enter a language.").max(40),
  timezone: z.string().refine(isValidTimezone, "Choose a timezone."),
  emergencyContactName: z.string().trim().max(120),
  emergencyContactPhone: phone,
  medicalNotes: z.string().trim().max(2000),
});
type Values = z.infer<typeof schema>;

export interface PatientFormInitial extends Partial<Values> { id?: string }

const LANGUAGES = ["English", "Hindi", "Bengali", "Tamil", "Telugu", "Marathi", "Gujarati", "Kannada", "Malayalam", "Punjabi", "Urdu", "Other"];

const empty = (v: string) => (v.trim() === "" ? null : v.trim());

/**
 * Create (no id) or edit (id) a patient profile. `limited` is the patient's own
 * view: they may change contact details and language, nothing else.
 */
export function PatientForm({ initial, limited = false }: { initial?: PatientFormInitial; limited?: boolean }) {
  const router = useRouter();
  const announce = useAnnounce();
  const { ref: summaryRef, ...summary } = useErrorSummary();
  const editing = Boolean(initial?.id);
  const formId = "patient";
  const [saved, setSaved] = useState(false);
  const zones = useMemo<string[]>(() => {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn("timeZone") : ["Asia/Kolkata", "UTC"];
  }, []);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Kolkata";

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: "", dateOfBirth: "", gender: "", phone: "", email: "", preferredLanguage: "English",
      timezone: browserTz, emergencyContactName: "", emergencyContactPhone: "", medicalNotes: "",
      ...Object.fromEntries(Object.entries(initial ?? {}).filter(([k, v]) => k !== "id" && v != null)),
    },
  });
  const labels = { fullName: "Full name", dateOfBirth: "Date of birth", phone: "Phone", email: "Email", preferredLanguage: "Language", timezone: "Timezone", emergencyContactPhone: "Emergency contact phone" };
  const list = [...flattenErrors(errors, formId, labels), ...Object.entries(summary.serverFields).map(([k, m]) => ({ id: `${formId}-${k}`, message: m, label: labels[k as keyof typeof labels] }))];

  async function onSubmit(v: Values) {
    summary.setServerMessage(undefined);
    summary.setServerFields({});
    setSaved(false);
    const body = limited
      ? { phone: empty(v.phone), email: empty(v.email), preferredLanguage: v.preferredLanguage }
      : {
          fullName: v.fullName, dateOfBirth: v.dateOfBirth, gender: empty(v.gender), phone: empty(v.phone), email: empty(v.email),
          preferredLanguage: v.preferredLanguage, timezone: v.timezone, emergencyContactName: empty(v.emergencyContactName),
          emergencyContactPhone: empty(v.emergencyContactPhone), medicalNotes: empty(v.medicalNotes),
        };
    try {
      if (editing) {
        await api(`/api/patients/${initial!.id}`, { method: "PATCH", body });
        setSaved(true);
        announce("Profile saved.");
        router.refresh();
      } else {
        const p = await api<{ id: string }>("/api/patients", { method: "POST", body });
        announce("Patient profile created.");
        router.push(`/patients/${p.id}`);
        router.refresh();
      }
    } catch (e) {
      if (e instanceof ApiError && e.fields) summary.setServerFields(e.fields);
      summary.setServerMessage(errorMessage(e));
      summary.focusSummary();
    }
  }

  const ro = limited;
  return (
    <form noValidate className="space-y-6" onSubmit={handleSubmit(onSubmit, summary.focusSummary)}>
      <FormErrorSummary ref={summaryRef} errors={list} message={summary.serverMessage} />
      {saved && <p role="status" className="rounded-xl border-2 border-success bg-success-bg p-4 font-semibold">Saved.</p>}

      <fieldset className="space-y-5" disabled={false}>
        <legend className="mb-2 text-2xl font-bold">About the patient</legend>
        <Field id={`${formId}-fullName`} label="Full name" required error={errors.fullName?.message ?? summary.serverFields.fullName}>
          {(a) => <Input {...a} autoComplete="off" readOnly={ro} {...register("fullName")} />}
        </Field>
        <Field id={`${formId}-dateOfBirth`} label="Date of birth" required error={errors.dateOfBirth?.message ?? summary.serverFields.dateOfBirth}>
          {(a) => <Input {...a} type="date" readOnly={ro} max={new Date().toISOString().slice(0, 10)} {...register("dateOfBirth")} />}
        </Field>
        <Field id={`${formId}-gender`} label="Gender" error={errors.gender?.message}>
          {(a) => <Input {...a} readOnly={ro} {...register("gender")} />}
        </Field>
        <Field id={`${formId}-phone`} label="Phone number" error={errors.phone?.message ?? summary.serverFields.phone}>
          {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="off" {...register("phone")} />}
        </Field>
        <Field id={`${formId}-email`} label="Email address" hint="Optional. Reminders go to each person's own account email, not this one." error={errors.email?.message ?? summary.serverFields.email}>
          {(a) => <Input {...a} type="email" inputMode="email" autoComplete="off" {...register("email")} />}
        </Field>
        <Field id={`${formId}-preferredLanguage`} label="Preferred language" required error={errors.preferredLanguage?.message}>
          {(a) => (
            <Select {...a} {...register("preferredLanguage")}>
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </Select>
          )}
        </Field>
        <Field id={`${formId}-timezone`} label="Timezone" required hint="Medicine reminders follow this timezone, including daylight saving changes." error={errors.timezone?.message ?? summary.serverFields.timezone}>
          {(a) => (
            <Select {...a} disabled={ro} {...register("timezone")}>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </Select>
          )}
        </Field>
      </fieldset>

      {!ro && (
        <fieldset className="space-y-5">
          <legend className="mb-2 text-2xl font-bold">Emergency contact and notes</legend>
          <Field id={`${formId}-emergencyContactName`} label="Emergency contact name" error={errors.emergencyContactName?.message}>
            {(a) => <Input {...a} autoComplete="off" {...register("emergencyContactName")} />}
          </Field>
          <Field id={`${formId}-emergencyContactPhone`} label="Emergency contact phone" error={errors.emergencyContactPhone?.message ?? summary.serverFields.emergencyContactPhone}>
            {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="off" {...register("emergencyContactPhone")} />}
          </Field>
          <Field id={`${formId}-medicalNotes`} label="Relevant medical notes" hint="Shown only to the primary caregiver. This app does not give medical advice." error={errors.medicalNotes?.message}>
            {(a) => <Textarea {...a} rows={5} {...register("medicalNotes")} />}
          </Field>
        </fieldset>
      )}

      <Button type="submit" size="lg" loading={isSubmitting}>{isSubmitting ? "Saving…" : editing ? "Save profile" : "Create patient profile"}</Button>
    </form>
  );
}
