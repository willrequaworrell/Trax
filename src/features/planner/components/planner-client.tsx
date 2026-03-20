"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowsInLineHorizontal,
  ArrowsOutLineVertical,
  CaretDown,
  CaretRight,
  DownloadSimple,
  FunnelSimple,
  GitBranch,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";

import type { PlannedTask, Project, ProjectPlan, TaskStatus, TaskType } from "@/domain/planner";
import { shiftBusinessDays } from "@/domain/date-utils";
import { DatePickerField } from "@/features/planner/components/date-picker-field";
import { ProjectRenameDialog } from "@/features/planner/components/project-rename-dialog";
import { TaskDialog } from "@/features/planner/components/task-dialog";
import { WorkspaceSidebar } from "@/features/planner/components/workspace-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleContent, CollapsibleRoot } from "@/components/ui/collapsible";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupField } from "@/components/ui/input-group";
import {
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuRoot,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "@/components/ui/popover";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
} from "@/components/ui/select";
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  initialPlan: ProjectPlan;
  initialProjects: Project[];
};

type ViewMode = "list" | "gantt";
type StatusFilter = "all" | "open" | "blocked" | "done";
type EditableField = "status" | "progress" | "start" | "due" | "dependencies";

const LIST_GRID_CLASS = "grid-cols-[minmax(240px,1.7fr)_140px_170px_120px_120px_minmax(160px,1fr)_56px]";
const GANTT_NAME_COLUMN_WIDTH = 320;
const GANTT_DEFAULT_COLUMN_WIDTH = 48;
const GANTT_MAX_COLUMN_WIDTH = 96;
const GANTT_ZOOM_STEP = 12;

type DialogState =
  | {
      open: false;
      mode: "create" | "edit";
      taskId: null;
      parentId: string | null;
      type: TaskType;
      createParentLocked: boolean;
      allowedCreateTypes: TaskType[];
    }
  | {
      open: true;
      mode: "create" | "edit";
      taskId: string | null;
      parentId: string | null;
      type: TaskType;
      createParentLocked: boolean;
      allowedCreateTypes: TaskType[];
    };

const statusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

function statusVariant(status: PlannedTask["rolledUpStatus"]) {
  switch (status) {
    case "done":
      return "success" as const;
    case "blocked":
      return "destructive" as const;
    case "in_progress":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

function statusLabel(status: PlannedTask["rolledUpStatus"]) {
  return status.replaceAll("_", " ");
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return format(parseISO(value), "MMM d");
}

function buildTimeline(start: string | null, end: string | null) {
  if (!start || !end) {
    return [];
  }

  const dates: string[] = [];
  let cursor = parseISO(shiftBusinessDays(start, -1));
  const finish = parseISO(shiftBusinessDays(end, 1));

  while (cursor <= finish) {
    const day = cursor.getDay();

    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }

    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return dates;
}

function buildMonthSegments(timeline: string[]) {
  const segments: Array<{ label: string; span: number }> = [];

  for (const date of timeline) {
    const label = format(parseISO(date), "MMM yyyy");
    const current = segments.at(-1);

    if (current?.label === label) {
      current.span += 1;
    } else {
      segments.push({ label, span: 1 });
    }
  }

  return segments;
}

function shouldShowTimelineDayLabel(columnWidth: number, index: number) {
  return columnWidth >= 28 || index === 0 || index % 5 === 0;
}

function shouldShowTimelineWeekday(columnWidth: number) {
  return columnWidth >= 48;
}

function taskBarStyle(task: PlannedTask, timeline: string[]) {
  if (!task.computedPlannedStart || !task.computedPlannedEnd || timeline.length === 0) {
    return { left: "0%", width: "0%" };
  }

  const startIndex = Math.max(0, timeline.indexOf(task.computedPlannedStart));
  const endIndex = Math.max(startIndex, timeline.indexOf(task.computedPlannedEnd));
  const left = (startIndex / Math.max(timeline.length, 1)) * 100;
  const width = ((endIndex - startIndex + 1) / Math.max(timeline.length, 1)) * 100;

  return { left: `${left}%`, width: `${Math.max(width, 4)}%` };
}

function progressPercent(task: PlannedTask) {
  return task.isSummary ? task.rolledUpPercentComplete : task.percentComplete;
}

function ProgressPill({ value, compact = false }: { value: number; compact?: boolean }) {
  return (
    <div className={cn("min-w-0 space-y-1", compact && "space-y-1.5")}>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-chart-1 transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{value}% complete</p>
    </div>
  );
}

export function PlannerClient({ initialPlan, initialProjects }: Props) {
  const [plan, setPlan] = useState(initialPlan);
  const [projects, setProjects] = useState(initialProjects);
  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialPlan.tasks.map((task) => [task.id, task.hasChildren ? false : task.isExpanded])),
  );
  const [dialogState, setDialogState] = useState<DialogState>({
    open: false,
    mode: "edit",
    taskId: null,
    parentId: null,
    type: "task",
    createParentLocked: false,
    allowedCreateTypes: ["task", "summary", "milestone"],
  });
  const [activeCell, setActiveCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  const [ganttColumnWidth, setGanttColumnWidth] = useState(GANTT_DEFAULT_COLUMN_WIDTH);
  const [isPending, startTransition] = useTransition();
  const ganttViewportRef = useRef<HTMLDivElement | null>(null);

  const taskMap = useMemo(() => new Map(plan.tasks.map((task) => [task.id, task])), [plan.tasks]);
  const rootTasks = useMemo(
    () =>
      plan.tasks
        .filter((task) => task.parentId === null)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [plan.tasks],
  );
  const leafTasks = useMemo(() => plan.tasks.filter((task) => !task.isSummary), [plan.tasks]);
  const timeline = useMemo(() => buildTimeline(plan.timelineStart, plan.timelineEnd), [plan.timelineEnd, plan.timelineStart]);
  const monthSegments = useMemo(() => buildMonthSegments(timeline), [timeline]);
  const ganttTimelineViewportWidth = Math.max(ganttViewportWidth - GANTT_NAME_COLUMN_WIDTH, 0);
  const minGanttColumnWidth =
    timeline.length > 0 && ganttTimelineViewportWidth > 0
      ? ganttTimelineViewportWidth / timeline.length
      : GANTT_DEFAULT_COLUMN_WIDTH;
  const ganttTimelineWidth =
    timeline.length > 0 ? timeline.length * ganttColumnWidth : Math.max(ganttTimelineViewportWidth, 720);

  useEffect(() => {
    setExpandedMap((current) => {
      const next = { ...current };

      for (const task of plan.tasks) {
        if (!(task.id in next)) {
          next[task.id] = task.hasChildren ? false : task.isExpanded;
        }
      }

      return next;
    });
  }, [plan.tasks]);

  useEffect(() => {
    const viewport = ganttViewportRef.current;

    if (!viewport) {
      return;
    }

    const updateWidth = () => {
      setGanttViewportWidth(viewport.clientWidth);
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateWidth();
    });
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, [view]);

  useEffect(() => {
    setGanttColumnWidth((current) => {
      const clamped = Math.min(GANTT_MAX_COLUMN_WIDTH, Math.max(minGanttColumnWidth, current));
      return Math.abs(clamped - current) < 0.1 ? current : clamped;
    });
  }, [minGanttColumnWidth]);

  function markTaskPending(taskId: string, pending: boolean) {
    setPendingTaskIds((current) => {
      const next = { ...current };

      if (pending) {
        next[taskId] = true;
      } else {
        delete next[taskId];
      }

      return next;
    });
  }

  function applyPlan(nextPlan: ProjectPlan) {
    setPlan(nextPlan);
    setProjects((current) => {
      const existing = current.find((project) => project.id === nextPlan.project.id);

      if (!existing) {
        return [...current, nextPlan.project];
      }

      return current.map((project) =>
        project.id === nextPlan.project.id
          ? { ...project, name: nextPlan.project.name, description: nextPlan.project.description, updatedAt: nextPlan.project.updatedAt }
          : project,
      );
    });
  }

  async function requestPlan(input: RequestInfo, init?: RequestInit) {
    const response = await fetch(input, init);

    if (response.status === 204) {
      return null;
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error ?? "Request failed.");
    }

    return payload as ProjectPlan;
  }

  async function toggleTask(taskId: string) {
    const nextExpanded = !expandedMap[taskId];
    setExpandedMap((current) => ({ ...current, [taskId]: nextExpanded }));

    try {
      const nextPlan = await requestPlan(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isExpanded: nextExpanded }),
      });

      if (nextPlan) {
        applyPlan(nextPlan);
      }
    } catch (error) {
      setExpandedMap((current) => ({ ...current, [taskId]: !nextExpanded }));
      toast.error(error instanceof Error ? error.message : "Failed to update row state.");
    }
  }

  async function renameProject(nextName: string) {
    startTransition(async () => {
      try {
        const nextPlan = await requestPlan(`/api/projects/${plan.project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        });

        if (nextPlan) {
          applyPlan(nextPlan);
          setRenameOpen(false);
          toast.success("Project renamed");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rename project.");
      }
    });
  }

  function matchesTask(task: PlannedTask) {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      task.name.toLowerCase().includes(query) ||
      task.notes.toLowerCase().includes(query);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "open" && task.rolledUpStatus !== "done") ||
      (statusFilter === "blocked" && task.rolledUpStatus === "blocked") ||
      (statusFilter === "done" && task.rolledUpStatus === "done");

    return matchesSearch && matchesStatus;
  }

  function hasVisibleDescendant(task: PlannedTask): boolean {
    return task.childIds.some((childId) => {
      const child = taskMap.get(childId);
      return child ? matchesTask(child) || hasVisibleDescendant(child) : false;
    });
  }

  function shouldRender(task: PlannedTask) {
    return matchesTask(task) || hasVisibleDescendant(task);
  }

  function openCreateDialog(
    type: TaskType,
    parentId: string | null = null,
    options?: { createParentLocked?: boolean; allowedCreateTypes?: TaskType[] },
  ) {
    setDialogState({
      open: true,
      mode: "create",
      taskId: null,
      parentId,
      type,
      createParentLocked: options?.createParentLocked ?? false,
      allowedCreateTypes: options?.allowedCreateTypes ?? ["task", "summary", "milestone"],
    });
  }

  function openEditDialog(taskId: string) {
    setDialogState({
      open: true,
      mode: "edit",
      taskId,
      parentId: null,
      type: taskMap.get(taskId)?.type ?? "task",
      createParentLocked: false,
      allowedCreateTypes: ["task", "summary", "milestone"],
    });
  }

  function isCellActive(taskId: string, field: EditableField) {
    return activeCell?.taskId === taskId && activeCell.field === field;
  }

  function cellButtonClass(taskId: string, field: EditableField) {
    return cn(
      "group w-full cursor-pointer rounded-2xl px-2 py-2 text-left transition",
      "hover:bg-muted/45 hover:ring-1 hover:ring-border/70",
      isCellActive(taskId, field) && "bg-muted/55 ring-1 ring-border/70",
    );
  }

  async function patchTask(task: PlannedTask, patch: Record<string, unknown>, successMessage?: string) {
    markTaskPending(task.id, true);

    try {
      const nextPlan = await requestPlan(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (nextPlan) {
        applyPlan(nextPlan);
      }

      if (successMessage) {
        toast.success(successMessage);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  function buildSchedulePatch(task: PlannedTask, patch: { plannedStart?: string | null; plannedEnd?: string | null }) {
    if (patch.plannedEnd !== undefined || task.plannedMode === "start_end") {
      return {
        plannedMode: "start_end",
        plannedStart: patch.plannedStart ?? task.plannedStart ?? task.computedPlannedStart,
        plannedEnd: patch.plannedEnd ?? task.plannedEnd ?? task.computedPlannedEnd,
      };
    }

    return {
      plannedMode: "start_duration",
      plannedStart: patch.plannedStart ?? task.plannedStart ?? task.computedPlannedStart,
      plannedDurationDays: task.plannedDurationDays ?? task.computedPlannedDurationDays ?? (task.type === "milestone" ? 0 : 1),
    };
  }

  async function removeTask(taskId: string) {
    startTransition(async () => {
      try {
        const nextPlan = await requestPlan(`/api/tasks/${taskId}`, { method: "DELETE" });

        if (nextPlan) {
          applyPlan(nextPlan);
          toast.success("Task removed");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove task.");
      }
    });
  }

  async function copyExport(formatMode: "markdown" | "json") {
    try {
      const response = await fetch(`/api/projects/${plan.project.id}/export?format=${formatMode}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to load export.");
      }

      const content =
        formatMode === "markdown" ? await response.text() : JSON.stringify(await response.json(), null, 2);
      await navigator.clipboard.writeText(content);
      toast.success(`${formatMode === "markdown" ? "Markdown" : "JSON"} export copied`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to copy export.");
    }
  }

  async function toggleDependency(task: PlannedTask, predecessorTaskId: string, checked: boolean) {
    markTaskPending(task.id, true);

    try {
      const existing = task.blockedBy.find((dependency) => dependency.predecessorTaskId === predecessorTaskId);
      const nextPlan = checked
        ? await requestPlan(`/api/projects/${plan.project.id}/dependencies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              predecessorTaskId,
              successorTaskId: task.id,
              type: existing?.type ?? "FS",
              lagDays: existing?.lagDays ?? 0,
            }),
          })
        : existing
          ? await requestPlan(`/api/dependencies/${existing.id}`, { method: "DELETE" })
          : null;

      if (nextPlan) {
        applyPlan(nextPlan);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update dependencies.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  function dependencyPills(task: PlannedTask) {
    if (task.blockedBy.length === 0) {
      return <span className="text-xs text-muted-foreground">None</span>;
    }

    const displayed = task.blockedBy.slice(0, 2);
    const overflow = task.blockedBy.length - displayed.length;

    return (
      <div className="flex flex-wrap gap-1.5">
        {displayed.map((dependency) => {
          const predecessor = taskMap.get(dependency.predecessorTaskId);

          return (
            <TooltipProvider key={dependency.id}>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <span className="inline-flex max-w-32 items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-1 text-xs text-muted-foreground">
                    <GitBranch className="size-3" />
                    <span className="truncate">{predecessor?.name ?? dependency.predecessorTaskId}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {dependency.type} from {predecessor?.name ?? dependency.predecessorTaskId} with lag {dependency.lagDays}
                </TooltipContent>
              </TooltipRoot>
            </TooltipProvider>
          );
        })}
        {overflow > 0 ? <Badge variant="outline">+{overflow}</Badge> : null}
      </div>
    );
  }

  function renderLeafControls(task: PlannedTask) {
    const currentProgress = Number(progressDrafts[task.id] ?? task.percentComplete);
    const isPending = Boolean(pendingTaskIds[task.id]);
    const statusActive = isCellActive(task.id, "status");
    const progressActive = isCellActive(task.id, "progress");
    const startActive = isCellActive(task.id, "start");
    const dueActive = isCellActive(task.id, "due");
    const dependenciesActive = isCellActive(task.id, "dependencies");

    return (
      <>
        <div onClick={(event) => event.stopPropagation()}>
          <SelectRoot
            open={statusActive}
            value={task.rolledUpStatus}
            onOpenChange={(open) => setActiveCell(open ? { taskId: task.id, field: "status" } : null)}
            onValueChange={(value) => {
              setActiveCell(null);
              void patchTask(task, { status: value });
            }}
            disabled={isPending}
          >
            <SelectTrigger className={cn(cellButtonClass(task.id, "status"), "h-auto justify-between border-0 bg-transparent shadow-none")}>
              <Badge variant={statusVariant(task.rolledUpStatus)}>{statusLabel(task.rolledUpStatus)}</Badge>
            </SelectTrigger>
            <SelectContent align="start">
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>

        <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
          <PopoverRoot
            open={progressActive}
            onOpenChange={(open) => {
              if (open) {
                setProgressDrafts((current) => ({ ...current, [task.id]: String(task.percentComplete) }));
                setActiveCell({ taskId: task.id, field: "progress" });
                return;
              }

              setActiveCell((current) => (current?.taskId === task.id && current.field === "progress" ? null : current));
              setProgressDrafts((current) => {
                const next = { ...current };
                delete next[task.id];
                return next;
              });
            }}
          >
            <PopoverTrigger asChild>
              <button className={cellButtonClass(task.id, "progress")} disabled={isPending}>
                <ProgressPill value={task.percentComplete} compact />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 rounded-2xl p-4" onOpenAutoFocus={(event) => event.preventDefault()}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress</span>
                  <span className="text-sm font-medium">{currentProgress}%</span>
                </div>
                <SliderRoot
                  value={[currentProgress]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(value) => setProgressDrafts((current) => ({ ...current, [task.id]: String(value[0] ?? 0) }))}
                  onValueCommit={(value) => {
                    const nextValue = value[0] ?? 0;
                    setActiveCell(null);
                    setProgressDrafts((current) => {
                      const next = { ...current };
                      delete next[task.id];
                      return next;
                    });
                    void patchTask(task, { percentComplete: nextValue });
                  }}
                  disabled={isPending}
                >
                  <SliderTrack>
                    <SliderRange />
                  </SliderTrack>
                  <SliderThumb />
                </SliderRoot>
                <p className="text-xs text-muted-foreground">Use 5% steps to keep updates consistent.</p>
              </div>
            </PopoverContent>
          </PopoverRoot>
        </div>

        <div onClick={(event) => event.stopPropagation()}>
          {startActive ? (
            <DatePickerField
              value={task.plannedStart ?? task.computedPlannedStart}
              open
              onOpenChange={(open) => {
                if (!open) {
                  setActiveCell(null);
                }
              }}
              onChange={(value) => {
                setActiveCell(null);
                void patchTask(task, buildSchedulePatch(task, { plannedStart: value }));
              }}
              disabled={isPending}
              className="flex-nowrap"
              triggerClassName="w-full"
            />
          ) : (
            <button
              className={cn(cellButtonClass(task.id, "start"), "text-sm text-muted-foreground")}
              onClick={() => setActiveCell({ taskId: task.id, field: "start" })}
              disabled={isPending}
            >
              {formatShortDate(task.plannedStart ?? task.computedPlannedStart)}
            </button>
          )}
        </div>

        <div onClick={(event) => event.stopPropagation()}>
          {dueActive ? (
            <DatePickerField
              value={task.plannedEnd ?? task.computedPlannedEnd}
              open
              onOpenChange={(open) => {
                if (!open) {
                  setActiveCell(null);
                }
              }}
              onChange={(value) => {
                setActiveCell(null);
                void patchTask(task, buildSchedulePatch(task, { plannedEnd: value }));
              }}
              disabled={isPending}
              className="flex-nowrap"
              triggerClassName="w-full"
            />
          ) : (
            <button
              className={cn(cellButtonClass(task.id, "due"), "text-sm text-muted-foreground")}
              onClick={() => setActiveCell({ taskId: task.id, field: "due" })}
              disabled={isPending}
            >
              {formatShortDate(task.plannedEnd ?? task.computedPlannedEnd)}
            </button>
          )}
        </div>

        <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuRoot
            open={dependenciesActive}
            onOpenChange={(open) => setActiveCell(open ? { taskId: task.id, field: "dependencies" } : null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                className={cellButtonClass(task.id, "dependencies")}
                onClick={() => setActiveCell({ taskId: task.id, field: "dependencies" })}
                disabled={isPending}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">{dependencyPills(task)}</div>
                  <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100">
                    {isPending ? "Saving…" : "Edit"}
                  </span>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
              <DropdownMenuLabel>Blocked by</DropdownMenuLabel>
              {leafTasks
                .filter((candidate) => candidate.id !== task.id)
                .map((candidate) => {
                  const checked = task.blockedBy.some((dependency) => dependency.predecessorTaskId === candidate.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={candidate.id}
                      checked={checked}
                      onCheckedChange={(nextChecked) => void toggleDependency(task, candidate.id, Boolean(nextChecked))}
                    >
                      <div className="min-w-0">
                        <p className="truncate">{candidate.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {candidate.computedPlannedStart ?? "No start"} → {candidate.computedPlannedEnd ?? "No due"}
                        </p>
                      </div>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openEditDialog(task.id)}>Open full dependency editor</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </div>
      </>
    );
  }

  function renderSummaryCells(task: PlannedTask) {
    return (
      <>
        <div>
          <Badge variant={statusVariant(task.rolledUpStatus)}>{statusLabel(task.rolledUpStatus)}</Badge>
        </div>
        <div>
          <ProgressPill value={task.rolledUpPercentComplete} />
        </div>
        <div className="text-sm text-muted-foreground">{formatShortDate(task.computedPlannedStart)}</div>
        <div className="text-sm text-muted-foreground">{formatShortDate(task.computedPlannedEnd)}</div>
        <div>{dependencyPills(task)}</div>
      </>
    );
  }

  function renderActions(task: PlannedTask) {
    const isPending = Boolean(pendingTaskIds[task.id]);

    return (
      <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuRoot>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" disabled={isPending}>
              {isPending ? <Spinner /> : "•••"}
            </Button>
          </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEditDialog(task.id)}>Edit task</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openCreateDialog("task", task.id)}>Add subtask</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void removeTask(task.id)}>
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    );
  }

  function renderListNode(taskId: string, depth = 0): React.ReactNode {
    const task = taskMap.get(taskId);

    if (!task || !shouldRender(task)) {
      return null;
    }

    const expanded = search.trim().length > 0 ? true : expandedMap[task.id] ?? false;
    const isSummaryRow = task.isSummary;

        const row = (
      <div
        className={cn(
          "grid items-center border-b border-border/60 px-4 py-3 transition hover:bg-muted/20",
          LIST_GRID_CLASS,
          isSummaryRow ? "cursor-pointer bg-muted/35 hover:bg-muted/45" : "cursor-default",
        )}
        onClick={isSummaryRow ? () => void toggleTask(task.id) : undefined}
      >
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 18}px` }}>
          {task.hasChildren ? (
              <button
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted"
              onClick={(event) => {
                event.stopPropagation();
                void toggleTask(task.id);
              }}
            >
              {expanded ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
            </button>
          ) : (
            <span className="inline-flex size-7 items-center justify-center text-muted-foreground/50">•</span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button
                className={cn(
                  "cursor-pointer truncate text-left font-medium transition hover:text-primary",
                  isSummaryRow && "uppercase tracking-wide",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  openEditDialog(task.id);
                }}
              >
                {task.name}
              </button>
              {task.issues.length > 0 ? (
                <TooltipProvider>
                  <TooltipRoot>
                    <TooltipTrigger asChild>
                      <span className="inline-flex size-6 items-center justify-center rounded-full text-amber-500">
                        <WarningCircle className="size-4" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {task.issues.map((issue) => issue.message).join(" • ")}
                    </TooltipContent>
                  </TooltipRoot>
                </TooltipProvider>
              ) : null}
            </div>
            {task.type === "summary" ? (
              task.notes ? <p className="truncate text-xs text-muted-foreground">{task.notes}</p> : null
            ) : (
              <p className="truncate text-xs text-muted-foreground">{task.notes || `${task.rolledUpEffortDays} business day effort`}</p>
            )}
          </div>
        </div>

        {isSummaryRow ? renderSummaryCells(task) : renderLeafControls(task)}
        {renderActions(task)}
      </div>
    );

    return (
      <CollapsibleRoot key={task.id} open={expanded}>
        {isSummaryRow ? (
            <ContextMenuRoot>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() =>
                  openCreateDialog("task", task.id, {
                    createParentLocked: true,
                    allowedCreateTypes: ["task", "milestone"],
                  })
                }
              >
                Add subtask
              </ContextMenuItem>
              <ContextMenuItem onClick={() => openEditDialog(task.id)}>Edit section</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuRoot>
        ) : (
          row
        )}

        {task.childIds.length > 0 ? (
          <CollapsibleContent>
            {task.childIds.map((childId) => renderListNode(childId, depth + 1))}
          </CollapsibleContent>
        ) : null}
      </CollapsibleRoot>
    );
  }

  function renderGanttNode(taskId: string, depth = 0): React.ReactNode {
    const task = taskMap.get(taskId);

    if (!task || !shouldRender(task)) {
      return null;
    }

    const expanded = search.trim().length > 0 ? true : expandedMap[task.id] ?? false;
    const style = taskBarStyle(task, timeline);
    const percent = progressPercent(task);

    return (
      <CollapsibleRoot key={task.id} open={expanded}>
        <div
          className={cn(
            "group flex min-w-max border-b border-border/60",
            task.isSummary ? "cursor-pointer bg-muted/10 hover:bg-muted/20" : "hover:bg-muted/10",
          )}
          onClick={task.isSummary ? () => void toggleTask(task.id) : undefined}
        >
          <div
            className={cn(
              "sticky left-0 z-20 flex shrink-0 items-center gap-2 overflow-hidden border-r border-border/60 px-4 py-3 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.35)]",
              task.isSummary ? "bg-card" : "bg-card",
            )}
            style={{ width: GANTT_NAME_COLUMN_WIDTH, paddingLeft: `${depth * 18 + 16}px` }}
          >
            {task.hasChildren ? (
              <button
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted"
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleTask(task.id);
                }}
              >
                {expanded ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
              </button>
            ) : (
              <span className="inline-flex size-7 items-center justify-center text-muted-foreground/50">•</span>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <button
                className={cn(
                  "block w-full cursor-pointer truncate text-left font-medium transition hover:text-primary",
                  task.isSummary && "uppercase tracking-wide",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  openEditDialog(task.id);
                }}
              >
                {task.name}
              </button>
              <p className="truncate text-xs text-muted-foreground">
                {formatShortDate(task.computedPlannedStart)} → {formatShortDate(task.computedPlannedEnd)}
              </p>
            </div>
          </div>

          <div className="relative h-16 shrink-0 overflow-hidden" style={{ width: ganttTimelineWidth }}>
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${Math.max(timeline.length, 1)}, ${ganttColumnWidth}px)` }}
            >
              {(timeline.length > 0 ? timeline : ["timeline"]).map((date) => (
                <div key={date} className="border-r border-dashed border-border/60" />
              ))}
            </div>
            <div
              className={cn(
                "absolute top-3 flex h-10 items-center overflow-hidden rounded-2xl border border-white/30 px-3 text-sm font-medium text-white shadow-sm",
                task.isSummary ? "bg-chart-2/35" : task.type === "milestone" ? "bg-chart-4/35" : "bg-chart-1/35",
              )}
              style={style}
            >
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-2xl",
                  task.isSummary ? "bg-chart-2" : task.type === "milestone" ? "bg-chart-4" : "bg-chart-1",
                )}
                style={{ width: `${Math.max(percent, task.type === "milestone" ? 100 : 8)}%` }}
              />
              <div className="relative z-10 flex w-full items-center justify-end">
                <span className="text-xs font-semibold">{percent}%</span>
              </div>
            </div>
          </div>
        </div>
        {task.childIds.length > 0 ? (
          <CollapsibleContent>
            {task.childIds.map((childId) => renderGanttNode(childId, depth + 1))}
          </CollapsibleContent>
        ) : null}
      </CollapsibleRoot>
    );
  }

  const selectedTask = dialogState.taskId ? taskMap.get(dialogState.taskId) ?? null : null;
  const hasTasks = rootTasks.length > 0;
  const canZoomOut = ganttColumnWidth - GANTT_ZOOM_STEP >= minGanttColumnWidth - 0.1;
  const canZoomIn = ganttColumnWidth + GANTT_ZOOM_STEP <= GANTT_MAX_COLUMN_WIDTH + 0.1;
  const expandableTaskIds = useMemo(
    () => plan.tasks.filter((task) => task.hasChildren).map((task) => task.id),
    [plan.tasks],
  );

  function setAllExpanded(nextExpanded: boolean) {
    setExpandedMap((current) => {
      const next = { ...current };

      for (const taskId of expandableTaskIds) {
        next[taskId] = nextExpanded;
      }

      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <WorkspaceSidebar projects={projects} activeProjectId={plan.project.id} />

      <main className="flex min-h-screen flex-1 flex-col overflow-hidden">
        <header className="border-b border-border/70 bg-background/95 px-8 pt-6 pb-4 backdrop-blur">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight">{plan.project.name}</h1>
                  <Badge variant="outline">{plan.projectPercentComplete}% complete</Badge>
                  {plan.issues.length > 0 ? <Badge variant="warning">{plan.issues.length} issues</Badge> : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setRenameOpen(true)}>
                  <PencilSimple />
                  Rename
                </Button>
                <DropdownMenuRoot>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <DownloadSimple />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void copyExport("markdown")}>Copy Markdown export</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void copyExport("json")}>Copy JSON snapshot</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <NavigationMenuRoot>
                <NavigationMenuList className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 p-1">
                  <NavigationMenuItem>
                    <NavigationMenuTrigger active={view === "list"} onClick={() => setView("list")}>
                      List
                    </NavigationMenuTrigger>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger active={view === "gantt"} onClick={() => setView("gantt")}>
                      Gantt
                    </NavigationMenuTrigger>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenuRoot>

              <div className="flex flex-col gap-3 xl:flex-row">
                {view === "gantt" ? (
                  <div className="flex items-center gap-1 rounded-2xl border border-border/70 bg-background p-1 shadow-sm">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setGanttColumnWidth((current) => Math.max(minGanttColumnWidth, current - GANTT_ZOOM_STEP))}
                      disabled={!canZoomOut}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="px-2 text-xs font-medium text-muted-foreground">Zoom</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setGanttColumnWidth((current) => Math.min(GANTT_MAX_COLUMN_WIDTH, current + GANTT_ZOOM_STEP))}
                      disabled={!canZoomIn}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
                <InputGroup className="w-full xl:w-[320px]">
                  <InputGroupAddon>
                    <MagnifyingGlass className="size-4" />
                  </InputGroupAddon>
                  <InputGroupField
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search tasks"
                  />
                </InputGroup>
                <div className="flex items-center gap-2">
                  {hasTasks ? (
                    <>
                      <Button variant="outline" onClick={() => setAllExpanded(true)}>
                        <ArrowsOutLineVertical />
                        Expand all
                      </Button>
                      <Button variant="outline" onClick={() => setAllExpanded(false)}>
                        <ArrowsInLineHorizontal />
                        Collapse all
                      </Button>
                    </>
                  ) : null}
                  <Button variant={statusFilter === "all" ? "default" : "outline"} onClick={() => setStatusFilter("all")}>
                    All
                  </Button>
                  <Button variant={statusFilter === "open" ? "default" : "outline"} onClick={() => setStatusFilter("open")}>
                    Open
                  </Button>
                  <Button variant={statusFilter === "blocked" ? "default" : "outline"} onClick={() => setStatusFilter("blocked")}>
                    <FunnelSimple />
                    Blocked
                  </Button>
                  <Button variant={statusFilter === "done" ? "default" : "outline"} onClick={() => setStatusFilter("done")}>
                    Done
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="flex-1 overflow-auto px-8 py-6">
          {view === "list" ? (
            <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
              <div className={cn("sticky top-0 z-10 grid border-b border-border/70 bg-background/95 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur", LIST_GRID_CLASS)}>
                <span>Name</span>
                <span>Status</span>
                <span>Progress</span>
                <span>Start</span>
                <span>Due</span>
                <span>Dependencies</span>
                <span className="text-right">⋯</span>
              </div>
              {hasTasks ? (
                rootTasks.map((task) => renderListNode(task.id))
              ) : (
                <div className="px-6 py-16 text-center">
                  <p className="text-lg font-medium">This project is empty</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Start with a task or section below. Once the structure works, duplicate the project from the projects page for reuse.
                  </p>
                </div>
              )}
              <div className={cn("grid items-center px-4 py-3", LIST_GRID_CLASS)}>
                <div className="col-span-full flex items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-3">
                  <span className="text-sm text-muted-foreground">Add to this plan</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openCreateDialog("task", null, { allowedCreateTypes: ["task", "summary"] })}
                  >
                    <Plus />
                    Add
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
              <div ref={ganttViewportRef} className="max-h-[calc(100vh-250px)] overflow-auto">
                <div className="min-w-max">
                  <div className="sticky top-0 z-30 flex border-b border-border/70 bg-background/95 backdrop-blur">
                    <div
                      className="sticky left-0 z-40 shrink-0 border-r border-border/70 bg-background/95 px-4 py-4 text-sm font-semibold"
                      style={{ width: GANTT_NAME_COLUMN_WIDTH }}
                    >
                      Name
                    </div>
                    <div className="shrink-0" style={{ width: ganttTimelineWidth }}>
                      <div
                        className="grid border-b border-border/60 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                        style={{ gridTemplateColumns: `repeat(${Math.max(timeline.length, 1)}, ${ganttColumnWidth}px)` }}
                      >
                        {(monthSegments.length > 0 ? monthSegments : [{ label: "Timeline", span: 1 }]).map((segment) => (
                          <div
                            key={segment.label}
                            className="border-r border-border/60 px-3 py-3 truncate"
                            style={{ gridColumn: `span ${segment.span}` }}
                          >
                            {segment.label}
                          </div>
                        ))}
                      </div>
                      <div
                        className="grid text-xs text-muted-foreground"
                        style={{ gridTemplateColumns: `repeat(${Math.max(timeline.length, 1)}, ${ganttColumnWidth}px)` }}
                      >
                        {(timeline.length > 0 ? timeline : ["empty"]).map((date, index) => {
                          const showDay = shouldShowTimelineDayLabel(ganttColumnWidth, index);
                          const showWeekday = showDay && shouldShowTimelineWeekday(ganttColumnWidth);

                          return (
                            <div key={date} className="border-r border-border/60 px-2 py-2 text-center">
                              {timeline.length > 0 ? (
                                <>
                                  <p className="font-semibold text-foreground">{showDay ? format(parseISO(date), "d") : ""}</p>
                                  <p>{showWeekday ? format(parseISO(date), "EEEEE") : ""}</p>
                                </>
                              ) : (
                                <p>No dates</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {rootTasks.length > 0 ? (
                    rootTasks.map((task) => renderGanttNode(task.id))
                  ) : (
                    <div className="px-6 py-16 text-center">
                      <p className="text-lg font-medium">No tasks to chart yet</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        The Gantt view will appear once the project has planned tasks with dates.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <ProjectRenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initialName={plan.project.name}
        onSubmit={renameProject}
        isPending={isPending}
      />

      <TaskDialog
        open={dialogState.open}
        mode={dialogState.mode}
        projectId={plan.project.id}
        task={selectedTask}
        parentId={dialogState.parentId}
        type={dialogState.type}
        tasks={plan.tasks}
        createParentLocked={dialogState.createParentLocked}
        allowedCreateTypes={dialogState.allowedCreateTypes}
        onOpenChange={(open) =>
          setDialogState((current) =>
            open
              ? {
                  open: true,
                  mode: current.mode,
                  taskId: current.taskId,
                  parentId: current.parentId,
                  type: current.type,
                  createParentLocked: current.createParentLocked,
                  allowedCreateTypes: current.allowedCreateTypes,
                }
              : {
                  open: false,
                  mode: current.mode,
                  taskId: null,
                  parentId: current.parentId,
                  type: current.type,
                  createParentLocked: current.createParentLocked,
                  allowedCreateTypes: current.allowedCreateTypes,
                },
          )
        }
        onPlanChange={applyPlan}
      />
    </div>
  );
}
