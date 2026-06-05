import { notFound } from "next/navigation";

import { shiftBusinessDays } from "@/domain/date-utils";
import type { PlannedTask } from "@/domain/planner";
import { getSharedProjectPlan } from "@/server/services/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
};

function formatDate(value: string | null) {
  if (!value) {
    return "TBD";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: PlannedTask["rolledUpStatus"]) {
  if (status === "in_progress") {
    return "In progress";
  }

  if (status === "done") {
    return "Done";
  }

  return "Not started";
}

function signedBusinessDayGap(from: string, to: string) {
  if (from === to) {
    return 0;
  }

  if (to > from) {
    let cursor = from;
    let offset = 0;

    while (cursor < to) {
      cursor = shiftBusinessDays(cursor, 1);
      offset += 1;
    }

    return offset;
  }

  let cursor = from;
  let offset = 0;

  while (cursor > to) {
    cursor = shiftBusinessDays(cursor, -1);
    offset -= 1;
  }

  return offset;
}

function varianceLabel(baselineEnd: string | null, forecastEnd: string | null) {
  if (!baselineEnd || !forecastEnd) {
    return "TBD";
  }

  const delta = signedBusinessDayGap(baselineEnd, forecastEnd);

  if (delta === 0) {
    return "0 business days";
  }

  return delta > 0 ? `+${delta} business days` : `${delta} business days`;
}

function leafTasks(tasks: PlannedTask[]) {
  return tasks.filter((task) => !task.isSummary);
}

function projectBaselineEnd(tasks: PlannedTask[]) {
  const baselineEnds = leafTasks(tasks)
    .map((task) => task.computedBaselinePlannedEnd)
    .filter((value): value is string => Boolean(value));

  if (baselineEnds.length === 0) {
    return null;
  }

  return baselineEnds.sort().at(-1) ?? null;
}

function targetDate(task: PlannedTask | null, fallbackEnd: string | null) {
  if (!task) {
    return fallbackEnd;
  }

  return task.computedActualEnd ?? task.computedPlannedEnd;
}

function dateRangePercent(value: string | null, start: string | null, end: string | null) {
  if (!value || !start || !end) {
    return 0;
  }

  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const valueMs = Date.parse(`${value}T00:00:00Z`);

  if (endMs <= startMs) {
    return 0;
  }

  return Math.min(100, Math.max(0, ((valueMs - startMs) / (endMs - startMs)) * 100));
}

function chartRange(rows: PlannedTask[], reportingTargetDate: string | null) {
  const dates = rows
    .flatMap((task) => [task.computedPlannedStart, task.computedPlannedEnd])
    .concat(reportingTargetDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    start: dates[0] ?? null,
    end: dates.at(-1) ?? null,
  };
}

function SectionTimeline({
  rows,
  target,
}: {
  rows: PlannedTask[];
  target: { name: string; date: string | null } | null;
}) {
  const range = chartRange(rows, target?.date ?? null);
  const markerLeft = target?.date ? dateRangePercent(target.date, range.start, range.end) : null;

  return (
    <section className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex flex-col gap-2 border-b border-border/70 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-semibold">Section timeline</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Forecast range {formatDate(range.start)} - {formatDate(range.end)}
          </p>
        </div>
        {target ? (
          <p className="text-xs text-muted-foreground">
            Target marker: {target.name}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No top-level sections yet.</p>
      ) : (
        <div className="relative mt-4 space-y-4">
          {markerLeft !== null ? (
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary/45"
              style={{ left: `${markerLeft}%` }}
              aria-hidden="true"
            />
          ) : null}
          {rows.map((task) => {
            const left = dateRangePercent(task.computedPlannedStart, range.start, range.end);
            const right = dateRangePercent(task.computedPlannedEnd, range.start, range.end);
            const width = Math.max(2, right - left);

            return (
              <div key={task.id} className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_64px] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(task.computedPlannedStart)} - {formatDate(task.computedPlannedEnd)}
                  </p>
                </div>
                <div className="relative h-5 rounded bg-muted">
                  <div
                    className="absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded bg-primary/20"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <div
                      className="h-full bg-primary/70"
                      style={{ width: `${Math.min(100, Math.max(0, task.rolledUpPercentComplete))}%` }}
                    />
                  </div>
                </div>
                <p className="text-right text-xs font-medium text-muted-foreground">{task.rolledUpPercentComplete}%</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TaskTable({
  emptyLabel,
  rows,
  showBaselineVariance,
  showIssues = false,
  variant = "standard",
}: {
  emptyLabel: string;
  rows: PlannedTask[];
  showBaselineVariance: boolean;
  showIssues?: boolean;
  variant?: "standard" | "upcoming";
}) {
  if (rows.length === 0) {
    return <p className="border-t border-border/70 px-4 py-6 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto border-t border-border/70">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-muted/35 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Task</th>
            {variant === "standard" ? <th className="px-4 py-3">Status</th> : null}
            {variant === "standard" ? <th className="px-4 py-3">Progress</th> : null}
            <th className="px-4 py-3">Forecast</th>
            {variant === "standard" ? <th className="px-4 py-3">Actual</th> : null}
            {showBaselineVariance ? <th className="px-4 py-3">Baseline Delta</th> : null}
            {showIssues ? <th className="px-4 py-3">Issue</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((task) => (
            <tr key={task.id}>
              <td className="max-w-[280px] px-4 py-3 font-medium">{task.name}</td>
              {variant === "standard" ? (
                <td className="px-4 py-3 text-muted-foreground">{statusLabel(task.rolledUpStatus)}</td>
              ) : null}
              {variant === "standard" ? <td className="px-4 py-3 text-muted-foreground">{task.percentComplete}%</td> : null}
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(task.computedPlannedStart)} - {formatDate(task.computedPlannedEnd)}
              </td>
              {variant === "standard" ? (
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(task.computedActualStart)} - {formatDate(task.computedActualEnd)}
                </td>
              ) : null}
              {showBaselineVariance ? (
                <td className="px-4 py-3 text-muted-foreground">
                  {varianceLabel(task.computedBaselinePlannedEnd, task.computedPlannedEnd)}
                </td>
              ) : null}
              {showIssues ? (
                <td className="max-w-[320px] px-4 py-3 text-muted-foreground">
                  {task.issues.map((issue) => issue.message).join("; ")}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SharedProjectPage({ params }: Props) {
  const { token } = await params;
  const shared = await getSharedProjectPlan(token);

  if (!shared) {
    notFound();
  }

  const { plan, shareLink } = shared;
  const leaves = leafTasks(plan.tasks);
  const activeTasks = leaves.filter((task) => task.rolledUpStatus === "in_progress");
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  const upcomingTasks = plan.upcomingTaskIds
    .map((id) => taskById.get(id))
    .filter(
      (task): task is PlannedTask =>
        task !== undefined &&
        !task.isSummary &&
        task.rolledUpStatus === "not_started" &&
        !activeTaskIds.has(task.id),
    )
    .slice(0, 5);
  const baselineEnd = projectBaselineEnd(plan.tasks);
  const reportingTargetTask = shareLink.reportingTargetTaskId ? taskById.get(shareLink.reportingTargetTaskId) ?? null : null;
  const reportingTarget = {
    name: reportingTargetTask?.name ?? "Whole tracker",
    date: targetDate(reportingTargetTask, plan.timelineEnd),
  };
  const sectionRows = plan.tasks.filter((task) => task.isSummary && task.depth === 0);

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground md:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="border-b border-border/70 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project status</p>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{plan.project.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">Last updated {formatDateTime(plan.project.updatedAt)}</p>
            </div>
            <div className="text-sm text-muted-foreground">Generated {formatDateTime(new Date().toISOString())}</div>
          </div>
        </header>

        <section className={shareLink.showBaselineVariance ? "grid gap-3 md:grid-cols-3" : "grid gap-3 md:grid-cols-2"}>
          <div className="rounded-lg border border-border/70 bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Progress</p>
            <p className="mt-3 text-4xl font-semibold">{plan.projectPercentComplete}%</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Target date</p>
            <p className="mt-3 text-2xl font-semibold">{formatDate(reportingTarget.date)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{reportingTarget.name}</p>
          </div>
          {shareLink.showBaselineVariance ? (
            <div className="rounded-lg border border-border/70 bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Baseline Delta</p>
              <p className="mt-3 text-lg font-medium">{varianceLabel(baselineEnd, plan.timelineEnd)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Baseline end {formatDate(baselineEnd)}</p>
            </div>
          ) : null}
        </section>

        <SectionTimeline rows={sectionRows} target={reportingTargetTask ? reportingTarget : null} />

        <section className="overflow-hidden rounded-lg border border-border/70 bg-card/75">
          <div className="px-4 py-4">
            <h2 className="font-semibold">Active work</h2>
          </div>
          <TaskTable emptyLabel="No active work." rows={activeTasks} showBaselineVariance={shareLink.showBaselineVariance} />
        </section>

        <section className="overflow-hidden rounded-lg border border-border/70 bg-card/75">
          <div className="px-4 py-4">
            <h2 className="font-semibold">Upcoming work</h2>
          </div>
          <TaskTable
            emptyLabel="No upcoming work."
            rows={upcomingTasks}
            showBaselineVariance={shareLink.showBaselineVariance}
            variant="upcoming"
          />
        </section>

      </div>
    </main>
  );
}
