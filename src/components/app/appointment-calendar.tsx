"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status";
import { useAnnounce } from "@/components/a11y/announcer";
import { cn } from "@/lib/utils";
import type { Appointment } from "@/lib/domain/types";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KEY = "yyyy-MM-dd";

/**
 * Month grid with roving tabindex (one Tab stop). Arrows move by day/week,
 * Home/End jump to the week's ends, PageUp/PageDown change month.
 * The Upcoming tab is the plain-list alternative.
 */
export function AppointmentCalendar({ appointments, timezone, basePath, canWrite = false, today }: {
  appointments: Appointment[];
  timezone: string;
  basePath?: string;
  canWrite?: boolean;
  /** ISO instant used for "today" so server and client agree. */
  today?: string;
}) {
  const announce = useAnnounce();
  const todayKey = DateTime.fromISO(today ?? new Date().toISOString(), { zone: timezone }).toFormat(KEY);
  const [focused, setFocused] = useState(todayKey);
  const [selected, setSelected] = useState(todayKey);
  const moveFocus = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const month = DateTime.fromFormat(focused, KEY, { zone: timezone }).startOf("month");
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      const k = DateTime.fromJSDate(a.startsAt, { zone: timezone }).toFormat(KEY);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    for (const list of m.values()) list.sort((x, y) => +x.startsAt - +y.startsAt);
    return m;
  }, [appointments, timezone]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`)?.focus();
  }, [focused]);

  const monthLabel = month.toFormat("LLLL yyyy");
  const leading = month.weekday - 1;
  const days = month.daysInMonth ?? 30;
  const cells: (string | null)[] = [...Array(leading).fill(null), ...Array.from({ length: days }, (_, i) => month.plus({ days: i }).toFormat(KEY))];
  while (cells.length % 7) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  function go(next: DateTime, focusCell: boolean) {
    const k = next.toFormat(KEY);
    const monthChanged = next.month !== month.month || next.year !== month.year;
    moveFocus.current = focusCell;
    setFocused(k);
    if (monthChanged) announce(next.toFormat("LLLL yyyy"));
  }
  function shiftMonth(delta: number, focusCell: boolean) {
    const cur = DateTime.fromFormat(focused, KEY, { zone: timezone });
    const target = cur.plus({ months: delta });
    go(target, focusCell);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const cur = DateTime.fromFormat(focused, KEY, { zone: timezone });
    let next: DateTime | null = null;
    switch (e.key) {
      case "ArrowLeft": next = cur.minus({ days: 1 }); break;
      case "ArrowRight": next = cur.plus({ days: 1 }); break;
      case "ArrowUp": next = cur.minus({ days: 7 }); break;
      case "ArrowDown": next = cur.plus({ days: 7 }); break;
      case "Home": next = cur.minus({ days: cur.weekday - 1 }); break;
      case "End": next = cur.plus({ days: 7 - cur.weekday }); break;
      case "PageUp": next = cur.minus({ months: 1 }); break;
      case "PageDown": next = cur.plus({ months: 1 }); break;
      default: return;
    }
    e.preventDefault();
    go(next, true);
  }

  function dayName(k: string) {
    const d = DateTime.fromFormat(k, KEY, { zone: timezone });
    const n = byDay.get(k)?.length ?? 0;
    return `${d.toFormat("cccc d LLLL yyyy")}${k === todayKey ? ", today" : ""}, ${n === 0 ? "no appointments" : n === 1 ? "1 appointment" : `${n} appointments`}`;
  }

  const selectedList = byDay.get(selected) ?? [];
  const selectedLabel = DateTime.fromFormat(selected, KEY, { zone: timezone }).toFormat("cccc d LLLL yyyy");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" aria-label="Previous month" onClick={() => shiftMonth(-1, false)}><ChevronLeft aria-hidden="true" /> <span>Previous</span></Button>
        <h3 id="cal-heading" className="text-xl font-bold">{monthLabel}</h3>
        <Button variant="outline" aria-label="Next month" onClick={() => shiftMonth(1, false)}><span>Next</span> <ChevronRight aria-hidden="true" /></Button>
      </div>
      <p className="text-[0.95rem] text-muted-foreground">Use the arrow keys to move between days, Page Up and Page Down to change month, and Enter to choose a day.</p>

      <div ref={gridRef} role="grid" aria-labelledby="cal-heading" onKeyDown={onKeyDown} className="overflow-x-auto">
        <div role="row" className="grid min-w-[34rem] grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" aria-label={w} className="py-2 text-center text-[0.9rem] font-bold">{w.slice(0, 3)}</div>
          ))}
        </div>
        {rows.map((row, ri) => (
          <div key={ri} role="row" className="mt-1 grid min-w-[34rem] grid-cols-7 gap-1">
            {row.map((k, ci) =>
              k === null ? (
                <div key={ci} role="gridcell" aria-label="Outside this month" className="min-h-14" />
              ) : (
                <div key={k} role="gridcell" aria-selected={k === selected}>
                  <button
                    type="button"
                    data-date={k}
                    tabIndex={k === focused ? 0 : -1}
                    aria-label={dayName(k)}
                    onFocus={() => setFocused(k)}
                    onClick={() => { setSelected(k); setFocused(k); announce(`${DateTime.fromFormat(k, KEY, { zone: timezone }).toFormat("cccc d LLLL")} selected, ${byDay.get(k)?.length ?? 0} appointments`); }}
                    className={cn(
                      "relative flex min-h-14 w-full flex-col items-center justify-center rounded-xl border-2 text-base font-semibold",
                      k === selected ? "border-primary bg-secondary" : "border-border bg-surface hover:bg-accent",
                      k === todayKey && "ring-2 ring-primary ring-offset-2",
                    )}
                  >
                    <span aria-hidden="true">{DateTime.fromFormat(k, KEY).day}</span>
                    {(byDay.get(k)?.length ?? 0) > 0 && (
                      <span aria-hidden="true" className="mt-0.5 rounded-full bg-primary px-2 text-[0.8rem] font-bold text-primary-foreground">{byDay.get(k)!.length}</span>
                    )}
                  </button>
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      <section aria-labelledby="cal-day-heading" className="rounded-2xl border border-border bg-surface p-5">
        <h3 id="cal-day-heading" className="text-lg font-bold">{selectedLabel}</h3>
        <div aria-live="polite" className="mt-3">
          {selectedList.length === 0 ? (
            <p className="text-base text-muted-foreground">No appointments on this day.</p>
          ) : (
            <ul className="space-y-3">
              {selectedList.map((a) => (
                <li key={a.id} className="rounded-xl border border-border p-3">
                  <p className="font-semibold"><time dateTime={a.startsAt.toISOString()}>{DateTime.fromJSDate(a.startsAt, { zone: timezone }).toFormat("h:mm a")}</time>, {a.doctorName}</p>
                  <p className="text-base text-muted-foreground">{a.appointmentType}{a.facility ? `, ${a.facility}` : ""}{a.location ? `, ${a.location}` : ""}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {a.status === "completed" && <StatusChip tone="success">Completed</StatusChip>}
                    {canWrite && basePath && <Link className="font-semibold text-primary underline" href={`${basePath}/${a.id}`}>Edit{" "}<span className="sr-only">appointment with {a.doctorName}</span></Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
