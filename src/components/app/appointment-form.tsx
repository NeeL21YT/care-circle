"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { flattenErrors, useErrorSummary } from "@/components/ui/use-error-summary";
import { useAnnounce } from "@/components/a11y/announcer";
import { ApiError, api, errorMessage } from "@/lib/client/api";

const TYPES = ["Check-up", "Follow-up", "Specialist", "Lab test", "Scan or imaging", "Vaccination", "Dental", "Eye", "Other"];
const REMINDERS = [
  { v: 1440, label: "1 day before" },
  { v: 120, label: "2 hours before" },
  { v: 60, label: "1 hour before" },
  { v: 30, label: "30 minutes before" },
];

const schema = z.object({
  doctorName: z.string().trim().min(1, "Enter the doctor's name.").max(120),
  facility: z.string().trim().max(160),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the appointment date."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose the appointment time."),
  location: z.string().trim().max(240),
  appointmentType: z.string().min(1, "Choose an appointment type."),
  notes: z.string().trim().max(2000),
});
type Values = z.infer<typeof schema>;
const LABELS = { doctorName: "Doctor", date: "Date", time: "Time", appointmentType: "Type" };
const FORM = "appt";

export interface AppointmentInitial extends Values { id: string; reminderOffsetsMinutes: number[] }

export function AppointmentForm({ patientId, initial }: { patientId: string; initial?: AppointmentInitial }) {
  const router = useRouter();
  const announce = useAnnounce();
  const { ref: summaryRef, serverMessage, setServerMessage, focusSummary } = useErrorSummary();
  const [offsets, setOffsets] = useState<number[]>(initial?.reminderOffsetsMinutes ?? [1440, 60]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { doctorName: "", facility: "", date: "", time: "", location: "", appointmentType: "Check-up", notes: "" },
  });
  const list = flattenErrors(errors, FORM, LABELS);

  async function onSubmit(v: Values) {
    setServerMessage(undefined);
    const body = { ...v, reminderOffsetsMinutes: offsets };
    try {
      await api(initial ? `/api/patients/${patientId}/appointments/${initial.id}` : `/api/patients/${patientId}/appointments`, { method: initial ? "PATCH" : "POST", body });
      announce(initial ? "Appointment updated." : "Appointment added.");
      router.push(`/patients/${patientId}/appointments`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        let general = false;
        for (const [k, msg] of Object.entries(e.fields)) {
          if (k in v) setError(k as keyof Values, { message: msg }); else general = true;
        }
        setServerMessage(general ? e.message : undefined);
      } else setServerMessage(errorMessage(e));
      focusSummary();
    }
  }

  return (
    <form noValidate className="max-w-2xl space-y-6" onSubmit={handleSubmit(onSubmit, focusSummary)}>
      <FormErrorSummary ref={summaryRef} errors={list} message={serverMessage} />
      <Field id={`${FORM}-doctorName`} label="Doctor's name" required error={errors.doctorName?.message}>
        {(a) => <Input {...a} autoComplete="off" {...register("doctorName")} />}
      </Field>
      <Field id={`${FORM}-facility`} label="Clinic or hospital" error={errors.facility?.message}>
        {(a) => <Input {...a} autoComplete="off" {...register("facility")} />}
      </Field>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field id={`${FORM}-date`} label="Date" required error={errors.date?.message}>
          {(a) => <Input {...a} type="date" {...register("date")} />}
        </Field>
        <Field id={`${FORM}-time`} label="Time" required error={errors.time?.message} hint="In the patient's local time.">
          {(a) => <Input {...a} type="time" {...register("time")} />}
        </Field>
      </div>
      <Field id={`${FORM}-appointmentType`} label="Appointment type" required error={errors.appointmentType?.message}>
        {(a) => <Select {...a} {...register("appointmentType")}>{(initial && !TYPES.includes(initial.appointmentType) ? [...TYPES, initial.appointmentType] : TYPES).map((t) => <option key={t}>{t}</option>)}</Select>}
      </Field>
      <Field id={`${FORM}-location`} label="Location" error={errors.location?.message} hint="Address, floor or room.">
        {(a) => <Input {...a} autoComplete="off" {...register("location")} />}
      </Field>
      <Field id={`${FORM}-notes`} label="Notes" error={errors.notes?.message} hint="Questions to ask, things to bring, how to get there.">
        {(a) => <Textarea {...a} {...register("notes")} />}
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Send reminders</legend>
        <p className="text-[0.95rem] text-muted-foreground">Reminders are sent by email according to each person&apos;s notification settings.</p>
        {REMINDERS.map((r) => (
          <Checkbox
            key={r.v}
            id={`${FORM}-reminder-${r.v}`}
            label={r.label}
            checked={offsets.includes(r.v)}
            onChange={(e) => setOffsets((cur) => (e.target.checked ? [...cur, r.v] : cur.filter((x) => x !== r.v)))}
          />
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" loading={isSubmitting}>{isSubmitting ? "Saving…" : initial ? "Save changes" : "Add appointment"}</Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.push(`/patients/${patientId}/appointments`)}>Cancel</Button>
      </div>
    </form>
  );
}
