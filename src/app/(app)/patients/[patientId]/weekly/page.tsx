import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { isoWeekKey } from "@/lib/domain/weekly-report";
import { getWeeklyReport, listMyCheckins } from "@/lib/services/weekly-report";
import { PageHeader } from "@/components/ui/page-header";
import { WeeklyReport } from "@/components/app/weekly-report";
import { CheckinForm } from "@/components/app/checkin-form";

export const metadata: Metadata = { title: "Weekly report" };

export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "tasks:write");
  const [report, checkins] = await Promise.all([getWeeklyReport(user, patientId), listMyCheckins(user, patientId, 6)]);
  const week = isoWeekKey(new Date(), patient.timezone);
  const view = checkins.map((c) => ({ id: c.id, weekKey: c.weekKey, level: c.level, note: c.note }));
  return (
    <>
      <PageHeader title="Weekly report" description={`The last 7 days of care for ${patient.fullName}, in plain words.`} />
      <div className="space-y-10">
        <WeeklyReport patientId={patientId} report={JSON.parse(JSON.stringify(report))} />
        <section aria-labelledby="ck-h" className="space-y-3 border-t-2 pt-8">
          <h2 id="ck-h" className="text-2xl font-bold">Your own check-in</h2>
          <CheckinForm patientId={patientId} current={view.find((c) => c.weekKey === week) ?? null} history={view} />
        </section>
      </div>
    </>
  );
}
