"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { flattenErrors, useErrorSummary } from "@/components/ui/use-error-summary";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { describeSchedule, WEEKDAYS } from "@/lib/domain/schedule-text";
import { TIME_RE, validateSchedule } from "@/lib/domain/scheduling";
import { FREQUENCIES } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const FORM_ID = "med";
const DOSE_UNITS = ["tablet", "capsule", "ml", "mg", "drop", "puff", "patch", "unit", "other"];
const FORMS = ["Tablet", "Capsule", "Liquid", "Injection", "Drops", "Inhaler", "Patch", "Cream or ointment", "Other"];
const ROUTES = ["Oral", "Topical", "Inhaled", "Injection", "Eye", "Ear", "Other"];
const FREQUENCY_LABEL = { daily: "Every day", weekly: "On certain days of the week", every_n_days: "Every few days" } as const;

const optionalNumber = (v: unknown) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

const formSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the medication name.").max(120),
    activeIngredient: z.string().trim().max(120),
    strength: z.string().trim().max(60),
    doseAmount: z.number({ error: "Enter the dose amount." }).positive("Dose amount must be more than zero.").max(10000),
    doseUnit: z.string().min(1, "Choose a dose unit."),
    form: z.string().min(1, "Choose a dosage form."),
    route: z.string().min(1, "Choose a route."),
    frequency: z.enum(FREQUENCIES),
    times: z.array(z.object({ value: z.string().regex(TIME_RE, "Enter a valid time.") })),
    daysOfWeek: z.array(z.number()),
    intervalDays: z.number().optional(),
    startDate: z.string().min(1, "Enter a start date."),
    endDate: z.string(),
    prescriber: z.string().trim().max(120),
    instructions: z.string().trim().max(1000),
    status: z.enum(["active", "draft"]),
  })
  .superRefine((v, ctx) => {
    const issues = validateSchedule(
      { frequency: v.frequency, times: v.times.map((t) => t.value), daysOfWeek: v.daysOfWeek, intervalDays: v.intervalDays },
      v.startDate,
      v.endDate || null,
    );
    for (const i of issues) {
      if (i.field === "startDate" && !v.startDate) continue;
      ctx.addIssue({ code: "custom", message: i.message, path: [i.field] });
    }
  });
type FormValues = z.infer<typeof formSchema>;

export interface MedicationFormInitial {
  name: string; activeIngredient: string | null; strength: string | null; doseAmount: number; doseUnit: string;
  form: string; route: string; schedule: { frequency: FormValues["frequency"]; times: string[]; daysOfWeek?: number[]; intervalDays?: number };
  startDate: string; endDate: string | null; prescriber: string | null; instructions: string | null;
}

const LABELS: Record<string, string> = {
  name: "Medicine name", doseAmount: "Dose amount", doseUnit: "Dose unit", form: "Dosage form", route: "How it is taken",
  times: "Reminder times", daysOfWeek: "Days of the week", intervalDays: "Number of days", startDate: "Start date", endDate: "End date",
};

export function MedicationForm({ patientId, mode, medicationId, initial, today }: {
  patientId: string; mode: "create" | "edit"; medicationId?: string; initial?: MedicationFormInitial; today: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const summary = useErrorSummary();
  const { ref: summaryRef } = summary;
  const [submitting, setSubmitting] = useState(false);

  const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    shouldFocusError: false, // the error summary takes focus instead and links to each field
    defaultValues: {
      name: initial?.name ?? "", activeIngredient: initial?.activeIngredient ?? "", strength: initial?.strength ?? "",
      doseAmount: initial?.doseAmount, doseUnit: initial?.doseUnit ?? "tablet", form: initial?.form ?? "Tablet", route: initial?.route ?? "Oral",
      frequency: initial?.schedule.frequency ?? "daily",
      times: (initial?.schedule.times ?? ["08:00"]).map((value) => ({ value })),
      daysOfWeek: initial?.schedule.daysOfWeek ?? [], intervalDays: initial?.schedule.intervalDays,
      startDate: initial?.startDate ?? today, endDate: initial?.endDate ?? "", prescriber: initial?.prescriber ?? "",
      instructions: initial?.instructions ?? "", status: "active",
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "times" });
  const watched = useWatchedSchedule(control);

  const unitOptions = withCurrent(DOSE_UNITS, initial?.doseUnit);
  const formOptions = withCurrent(FORMS, initial?.form);
  const routeOptions = withCurrent(ROUTES, initial?.route);

  const rootMessage = (e: unknown): string | undefined => {
    const x = e as { root?: { message?: string }; message?: string } | undefined;
    return x?.root?.message ?? x?.message;
  };
  const srv = summary.serverFields;
  const timesError = rootMessage(errors.times) ?? srv.times ?? srv.schedule;
  const daysError = rootMessage(errors.daysOfWeek) ?? srv.daysOfWeek;

  const list = [
    ...flattenErrors(errors, FORM_ID, LABELS).map((e) => ({ ...e, id: e.id.replace(/-(times|daysOfWeek)-root$/, "-$1") })),
    ...Object.entries(srv).map(([k, message]) => ({ id: `${FORM_ID}-${k === "schedule" ? "times" : k}`, message, label: LABELS[k] })),
  ].filter((e, i, a) => a.findIndex((x) => x.id === e.id && x.message === e.message) === i);

  async function onSubmit(v: FormValues) {
    summary.setServerMessage(undefined);
    summary.setServerFields({});
    setSubmitting(true);
    const schedule = {
      frequency: v.frequency,
      times: v.times.map((t) => t.value),
      ...(v.frequency === "weekly" ? { daysOfWeek: [...v.daysOfWeek].sort() } : {}),
      ...(v.frequency === "every_n_days" ? { intervalDays: v.intervalDays } : {}),
    };
    const body = {
      name: v.name, activeIngredient: v.activeIngredient || null, strength: v.strength || null,
      doseAmount: v.doseAmount, doseUnit: v.doseUnit, form: v.form, route: v.route, schedule,
      startDate: v.startDate, endDate: v.endDate || null, prescriber: v.prescriber || null, instructions: v.instructions || null,
      ...(mode === "create" ? { status: v.status } : {}),
    };
    try {
      if (mode === "create") await api(`/api/patients/${patientId}/medications`, { method: "POST", body });
      else await api(`/api/patients/${patientId}/medications/${medicationId}`, { method: "PATCH", body });
      announce("Medication saved");
      router.push(`/patients/${patientId}/medications`);
      router.refresh();
    } catch (e) {
      summary.setServerMessage(errorMessage(e));
      if (e instanceof ApiError && e.fields) summary.setServerFields(e.fields);
      summary.focusSummary();
      setSubmitting(false);
    }
  }

  const id = (n: string) => `${FORM_ID}-${n}`;
  const err = (n: keyof FormValues & string) => (errors[n] as { message?: string } | undefined)?.message ?? srv[n];

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit, summary.focusSummary)} className="max-w-2xl space-y-6" aria-label={mode === "create" ? "Add a medication" : "Edit medication"}>
      <p className="rounded-xl border border-border bg-surface-tint p-4 text-base">
        Enter exactly what the prescription or doctor says. This app does not give medical advice and never suggests or changes doses.
      </p>
      <FormErrorSummary ref={summaryRef} errors={list} message={summary.serverMessage} />

      <fieldset className="space-y-5">
        <legend className="mb-2 text-xl font-bold">The medicine</legend>
        <Field id={id("name")} label="Medicine name" required error={err("name")}>
          {(a) => <Input {...a} autoComplete="off" {...register("name")} />}
        </Field>
        <Field id={id("activeIngredient")} label="Active ingredient" hint="For example, metformin hydrochloride." error={err("activeIngredient")}>
          {(a) => <Input {...a} autoComplete="off" {...register("activeIngredient")} />}
        </Field>
        <Field id={id("strength")} label="Strength" hint="As printed on the label, for example 500 mg." error={err("strength")}>
          {(a) => <Input {...a} autoComplete="off" {...register("strength")} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={id("doseAmount")} label="Dose amount" required hint="How many to take each time." error={err("doseAmount")}>
            {(a) => <Input {...a} type="number" inputMode="decimal" step="any" min="0" {...register("doseAmount", { setValueAs: optionalNumber })} />}
          </Field>
          <Field id={id("doseUnit")} label="Dose unit" required error={err("doseUnit")}>
            {(a) => <Select {...a} {...register("doseUnit")}>{unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}</Select>}
          </Field>
          <Field id={id("form")} label="Dosage form" required error={err("form")}>
            {(a) => <Select {...a} {...register("form")}>{formOptions.map((u) => <option key={u} value={u}>{u}</option>)}</Select>}
          </Field>
          <Field id={id("route")} label="How it is taken" required error={err("route")}>
            {(a) => <Select {...a} {...register("route")}>{routeOptions.map((u) => <option key={u} value={u}>{u}</option>)}</Select>}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-2 text-xl font-bold">When to take it</legend>
        <Field id={id("frequency")} label="How often" required error={err("frequency")}>
          {(a) => <Select {...a} {...register("frequency")}>{FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}</Select>}
        </Field>

        {watched.frequency === "weekly" && (
          <fieldset id={id("daysOfWeek")} tabIndex={-1} aria-describedby={daysError ? id("daysOfWeek-error") : undefined} className="space-y-2">
            <legend className="text-base font-semibold">Days of the week <span className="font-normal text-muted-foreground">(required, choose at least one)</span></legend>
            <Controller control={control} name="daysOfWeek" render={({ field }) => (
              <div className="grid gap-2 sm:grid-cols-2">
                {WEEKDAYS.map((d, i) => (
                  <Checkbox key={d} id={id(`day-${i + 1}`)} label={d} checked={field.value.includes(i + 1)}
                    onChange={(e) => field.onChange(e.target.checked ? [...field.value, i + 1] : field.value.filter((x) => x !== i + 1))} />
                ))}
              </div>
            )} />
            {daysError && <p id={id("daysOfWeek-error")} className="font-medium text-destructive"><span aria-hidden="true">⚠ </span><span className="sr-only">Error:</span>{" "}{daysError}</p>}
          </fieldset>
        )}

        {watched.frequency === "every_n_days" && (
          <Field id={id("intervalDays")} label="Repeat every how many days" required hint="Between 2 and 90. Counted from the start date." error={err("intervalDays")}>
            {(a) => <Input {...a} type="number" inputMode="numeric" min={2} max={90} step={1} {...register("intervalDays", { setValueAs: optionalNumber })} />}
          </Field>
        )}

        <fieldset id={id("times")} tabIndex={-1} aria-describedby={timesError ? id("times-error") : undefined} className="space-y-3">
          <legend className="text-base font-semibold">Reminder times <span className="font-normal text-muted-foreground">(required, local time for the patient)</span></legend>
          <ul className="space-y-3">
            {fields.map((f, i) => {
              const cur = watched.times[i]?.value;
              return (
                <li key={f.id} className="flex items-end gap-3">
                  <Field id={id(`times-${i}-value`)} label={`Time ${i + 1}`} required className="flex-1" error={errors.times?.[i]?.value?.message}>
                    {(a) => <Input {...a} type="time" step={60} {...register(`times.${i}.value`)} />}
                  </Field>
                  {fields.length > 1 && (
                    <Button variant="outline" onClick={() => { remove(i); announce(`Removed ${cur || `time ${i + 1}`}. ${fields.length - 1} reminder time${fields.length - 1 === 1 ? "" : "s"} left.`); }}>
                      <Trash2 aria-hidden="true" />Remove{" "}<span className="sr-only">{cur || `time ${i + 1}`}</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {timesError && <p id={id("times-error")} className="font-medium text-destructive"><span aria-hidden="true">⚠ </span><span className="sr-only">Error:</span>{" "}{timesError}</p>}
          <Button variant="secondary" onClick={() => { append({ value: "" }); announce(`Added reminder time ${fields.length + 1}.`); }}>
            <Plus aria-hidden="true" />Add a time
          </Button>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={id("startDate")} label="Start date" required error={err("startDate")}>
            {(a) => <Input {...a} type="date" {...register("startDate")} />}
          </Field>
          <Field id={id("endDate")} label="End date" hint="Leave blank if there is no end date." error={err("endDate")}>
            {(a) => <Input {...a} type="date" {...register("endDate")} />}
          </Field>
        </div>

        <div aria-live="polite" className="rounded-xl border-2 border-primary bg-secondary p-4 text-base">
          <strong>Reminders will be set for: </strong>
          <span data-testid="schedule-summary">{describeSchedule({ frequency: watched.frequency, times: watched.times.map((t) => t.value), daysOfWeek: watched.daysOfWeek, intervalDays: watched.intervalDays }) || "Finish the schedule above to see a summary."}</span>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-2 text-xl font-bold">More details</legend>
        <Field id={id("prescriber")} label="Prescribing doctor" error={err("prescriber")}>
          {(a) => <Input {...a} autoComplete="off" {...register("prescriber")} />}
        </Field>
        <Field id={id("instructions")} label="Special instructions" hint="Shown to the patient exactly as you type it, for example “Take with food”." error={err("instructions")}>
          {(a) => <Textarea {...a} {...register("instructions")} />}
        </Field>
        {mode === "create" && (
          <Field id={id("status")} label="Start as" hint="Drafts do not send reminders until you make them active." error={err("status")}>
            {(a) => (
              <Select {...a} {...register("status")}>
                <option value="active">Active (start reminders)</option>
                <option value="draft">Draft (save for later)</option>
              </Select>
            )}
          </Field>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" loading={submitting}>{submitting ? "Saving…" : "Save medication"}</Button>
        <Link href={`/patients/${patientId}/medications`} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>Cancel</Link>
      </div>
    </form>
  );
}

function withCurrent(list: string[], current?: string) {
  return current && !list.includes(current) ? [...list, current] : list;
}

function useWatchedSchedule(control: ReturnType<typeof useForm<FormValues>>["control"]) {
  const frequency = useWatch({ control, name: "frequency" });
  const times = useWatch({ control, name: "times" });
  const daysOfWeek = useWatch({ control, name: "daysOfWeek" });
  const intervalDays = useWatch({ control, name: "intervalDays" });
  return useMemo(() => ({ frequency, times: times ?? [], daysOfWeek: daysOfWeek ?? [], intervalDays }), [frequency, times, daysOfWeek, intervalDays]);
}
