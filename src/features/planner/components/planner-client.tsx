"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowBendDownRight,
  ArrowBendUpLeft,
  ArrowsInLineHorizontal,
  ArrowsOutLineVertical,
  CaretDown,
  CaretRight,
  Check,
  DownloadSimple,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";

import { computeCheckpointPercent } from "@/domain/checkpoints";
import type { Checkpoint, PlannedTask, Project, ProjectPlan, TaskType } from "@/domain/planner";
import { addDurationToStart, isoToday, shiftBusinessDays } from "@/domain/date-utils";
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
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuContent,
  DropdownMenuItem,
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
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  initialPlan: ProjectPlan;
  initialProjects: Project[];
};

type ViewMode = "list" | "gantt";
type StatusFilter = "all" | "open" | "done";
type EditableField = "progress" | "start" | "due" | "dependencies";
type CheckpointEditableField = "name" | "progress" | "weight";

class RequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const LIST_GRID_CLASS = "grid-cols-[minmax(240px,1.55fr)_152px_160px_150px_150px_minmax(140px,1fr)_56px]";
const GANTT_NAME_COLUMN_WIDTH = 320;
const GANTT_DEFAULT_COLUMN_WIDTH = 48;
const GANTT_MAX_COLUMN_WIDTH = 96;
const GANTT_ZOOM_STEP = 12;
const LIST_DEPTH_INDENT = 18;
const LIST_TREE_CONTROL_SIZE = 28;
const LIST_TREE_CONTROL_GAP = 8;
const EXPANDED_STATE_STORAGE_PREFIX = "traxly:planner:expanded";
const ROOT_DEPTH_STYLE = {
  rowTintClass: "bg-background",
  rowHoverTintClass: "hover:bg-muted/10",
};

const DEPTH_STYLE_CYCLE = [
  {
    rowTintClass: "bg-muted/34",
    rowHoverTintClass: "hover:bg-muted/40",
  },
  {
    rowTintClass: "bg-muted/58",
    rowHoverTintClass: "hover:bg-muted/66",
  },
  {
    rowTintClass: "bg-muted/78",
    rowHoverTintClass: "hover:bg-muted/86",
  },
  {
    rowTintClass: "bg-muted/92",
    rowHoverTintClass: "hover:bg-muted",
  },
] as const;

type CheckpointDraft = {
  name: string;
  percentComplete: string;
  weightPoints: string;
};

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

function statusVariant(status: PlannedTask["rolledUpStatus"]) {
  switch (status) {
    case "done":
      return "success" as const;
    case "in_progress":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

function statusLabel(status: PlannedTask["rolledUpStatus"]) {
  return status.replaceAll("_", " ");
}

function renderStatusBadge(status: PlannedTask["rolledUpStatus"]) {
  return (
    <Badge className="inline-flex w-[128px] justify-center" variant={statusVariant(status)}>
      {statusLabel(status)}
    </Badge>
  );
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return format(parseISO(value), "MMM d");
}

function formatCompactDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return format(parseISO(value), "M/d");
}

function expandedStateStorageKey(projectId: string) {
  return `${EXPANDED_STATE_STORAGE_PREFIX}:${projectId}`;
}

function buildExpandedMap(tasks: PlannedTask[], persisted?: Record<string, boolean> | null) {
  return Object.fromEntries(
    tasks.map((task) => {
      const defaultExpanded = task.hasChildren || task.checkpoints.length > 0 ? false : task.isExpanded;
      return [task.id, persisted?.[task.id] ?? defaultExpanded];
    }),
  );
}

function readExpandedMap(projectId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(expandedStateStorageKey(projectId));

    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

function dateVarianceLabel(forecastValue: string | null, actualValue: string | null) {
  if (!forecastValue || !actualValue) {
    return null;
  }

  const delta = signedBusinessDayGap(forecastValue, actualValue);

  if (delta === 0) {
    return "On forecast";
  }

  return delta > 0 ? `+${delta}d after forecast` : `${Math.abs(delta)}d before forecast`;
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
  return barStyleForRange(task.computedPlannedStart, task.computedPlannedEnd, timeline);
}

function barStyleForRange(start: string | null, end: string | null, timeline: string[]) {
  if (!start || !end || timeline.length === 0) {
    return { left: "0%", width: "0%", leftPercent: 0, widthPercent: 0 };
  }

  const startIndex = Math.max(0, timeline.indexOf(start));
  const endIndex = Math.max(startIndex, timeline.indexOf(end));
  const leftPercent = (startIndex / Math.max(timeline.length, 1)) * 100;
  const widthPercent = ((endIndex - startIndex + 1) / Math.max(timeline.length, 1)) * 100;

  return {
    left: `${leftPercent}%`,
    width: `${Math.max(widthPercent, 4)}%`,
    leftPercent,
    widthPercent: Math.max(widthPercent, 4),
  };
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

function progressPercent(task: PlannedTask) {
  return task.isSummary ? task.rolledUpPercentComplete : task.percentComplete;
}

function plannerDisplayStart(task: PlannedTask) {
  return task.computedPlannedStart ?? task.plannedStart;
}

function plannerDisplayEnd(task: PlannedTask) {
  return task.computedPlannedEnd ?? task.plannedEnd;
}

function storedForecastEnd(task: PlannedTask) {
  if (!task.plannedStart) {
    return task.plannedEnd;
  }

  if (task.type === "milestone") {
    return task.plannedStart;
  }

  if (task.plannedMode === "start_end" && task.plannedEnd) {
    return task.plannedEnd;
  }

  return addDurationToStart(task.plannedStart, Math.max(task.plannedDurationDays ?? task.computedPlannedDurationDays ?? 1, 1));
}

function actualDisplayStart(task: PlannedTask) {
  return task.actualStart ?? task.computedActualStart;
}

function actualDisplayEnd(task: PlannedTask) {
  return task.actualEnd ?? task.computedActualEnd;
}

function isActualComplete(task: PlannedTask) {
  return Boolean(actualDisplayEnd(task));
}

function isActualInProgress(task: PlannedTask) {
  return Boolean(actualDisplayStart(task)) && !isActualComplete(task);
}

function isExecutionActive(task: PlannedTask) {
  return Boolean(task.actualStart || task.actualEnd || task.percentComplete > 0);
}

function timelineSubtitle(task: PlannedTask) {
  if (isActualComplete(task)) {
    return `Actual ${formatShortDate(actualDisplayStart(task))} → ${formatShortDate(actualDisplayEnd(task))}`;
  }

  if (isActualInProgress(task)) {
    return `Actual ${formatShortDate(actualDisplayStart(task))} → — • Forecast due ${formatShortDate(plannerDisplayEnd(task))}`;
  }

  return `Forecast ${formatShortDate(plannerDisplayStart(task))} → ${formatShortDate(plannerDisplayEnd(task))}`;
}

function sortPlannerTasks(a: PlannedTask, b: PlannedTask) {
  const startA = plannerDisplayStart(a);
  const startB = plannerDisplayStart(b);

  if (startA && startB && startA !== startB) {
    return startA.localeCompare(startB);
  }

  if (startA && !startB) {
    return -1;
  }

  if (!startA && startB) {
    return 1;
  }

  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

function depthCycleIndex(depth: number) {
  return ((Math.max(depth, 1) - 1) % DEPTH_STYLE_CYCLE.length) as 0 | 1 | 2 | 3;
}

function depthTintClass(depth: number, variant: "task" | "checkpoint") {
  if (variant === "task" && depth === 0) {
    return cn(ROOT_DEPTH_STYLE.rowTintClass, ROOT_DEPTH_STYLE.rowHoverTintClass);
  }

  const style = DEPTH_STYLE_CYCLE[depthCycleIndex(depth)];

  return cn(style.rowTintClass, style.rowHoverTintClass);
}

function ganttBarTone(task: PlannedTask) {
  if (task.isSummary) {
    return {
      shellClass: "bg-black/14 border-black/16",
      fillClass: "bg-black/72",
      textClass: "text-black/82",
    };
  }

  if (task.type === "milestone") {
    return {
      shellClass: "bg-black/18 border-black/18",
      fillClass: "bg-black/88",
      textClass: "text-white",
    };
  }

  return {
    shellClass: "bg-black/10 border-black/14",
    fillClass: "bg-black/68",
    textClass: "text-black/78",
  };
}

function ganttProgressFillStyle(barStyle: ReturnType<typeof barStyleForRange>, percent: number) {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return {
    left: `${barStyle.leftPercent}%`,
    width: `${(barStyle.widthPercent * clampedPercent) / 100}%`,
  };
}

function ganttInnerFillWidth(percent: number) {
  return { width: `${Math.max(0, Math.min(100, percent))}%` };
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

function CheckpointProgressPill({ value }: { value: number }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-chart-1 transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{value}%</p>
    </div>
  );
}

function pendingUndoTitle(action: ProjectPlan["pendingUndoActions"][number]) {
  switch (action.subjectType) {
    case "section":
      return "Section deleted";
    case "milestone":
      return "Milestone deleted";
    case "checkpoint":
      return "Checkpoint deleted";
    case "dependency":
      return "Dependency removed";
    default:
      return "Task deleted";
  }
}

export function PlannerClient({ initialPlan, initialProjects }: Props) {
  const [plan, setPlan] = useState(initialPlan);
  const [projects, setProjects] = useState(initialProjects);
  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [rebaseStartDate, setRebaseStartDate] = useState<string | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => buildExpandedMap(initialPlan.tasks));
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
  const [activeCheckpointCell, setActiveCheckpointCell] = useState<{
    checkpointId: string;
    field: CheckpointEditableField;
  } | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const [checkpointDrafts, setCheckpointDrafts] = useState<Record<string, CheckpointDraft>>({});
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [pendingCheckpointIds, setPendingCheckpointIds] = useState<Record<string, boolean>>({});
  const [hoveredDependencyTaskId, setHoveredDependencyTaskId] = useState<string | null>(null);
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  const [ganttColumnWidth, setGanttColumnWidth] = useState(GANTT_DEFAULT_COLUMN_WIDTH);
  const [baselineGateOpen, setBaselineGateOpen] = useState(false);
  const [baselineGatePending, setBaselineGatePending] = useState(false);
  const [baselineGateContent, setBaselineGateContent] = useState({
    title: "Freeze baseline first",
    description: "Freeze the current forecast as the project baseline before recording execution progress.",
  });
  const [actualStartGateOpen, setActualStartGateOpen] = useState(false);
  const [actualStartGatePending, setActualStartGatePending] = useState(false);
  const [actualStartGateTaskId, setActualStartGateTaskId] = useState<string | null>(null);
  const [actualStartGateDate, setActualStartGateDate] = useState<string | null>(null);
  const [actualEndGateOpen, setActualEndGateOpen] = useState(false);
  const [actualEndGatePending, setActualEndGatePending] = useState(false);
  const [actualEndGateTaskId, setActualEndGateTaskId] = useState<string | null>(null);
  const [actualEndGateDate, setActualEndGateDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ganttViewportRef = useRef<HTMLDivElement | null>(null);
  const undoToastIdsRef = useRef<Set<string>>(new Set());
  const dependencyHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineGateActionRef = useRef<(() => Promise<void>) | null>(null);
  const actualStartGateActionRef = useRef<((actualStart: string) => Promise<void>) | null>(null);
  const actualEndGateActionRef = useRef<((actualEnd: string) => Promise<void>) | null>(null);

  const taskMap = useMemo(() => new Map(plan.tasks.map((task) => [task.id, task])), [plan.tasks]);
  const rootTasks = useMemo(
    () =>
      plan.tasks
        .filter((task) => task.parentId === null)
        .sort(sortPlannerTasks),
    [plan.tasks],
  );
  const leafTasks = useMemo(() => plan.tasks.filter((task) => !task.isSummary), [plan.tasks]);

  useEffect(() => {
    return () => {
      if (dependencyHoverTimeoutRef.current !== null) {
        clearTimeout(dependencyHoverTimeoutRef.current);
      }
    };
  }, []);
  const earliestForecastStart = useMemo(
    () =>
      leafTasks
        .map((task) => plannerDisplayStart(task))
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(0) ?? null,
    [leafTasks],
  );
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
    const persisted = readExpandedMap(plan.project.id);
    setExpandedMap(buildExpandedMap(plan.tasks, persisted));
  }, [plan.project.id, plan.tasks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(expandedStateStorageKey(plan.project.id), JSON.stringify(expandedMap));
    } catch {
      // Ignore storage failures and keep expansion state local to memory.
    }
  }, [expandedMap, plan.project.id]);

  useEffect(() => {
    setRebaseStartDate(earliestForecastStart);
  }, [earliestForecastStart, plan.project.id]);

  useEffect(() => {
    const nextToastIds = new Set<string>();

    for (const action of plan.pendingUndoActions) {
      const toastId = `undo-${action.id}`;
      const remainingMs = Date.parse(action.expiresAt) - Date.now();

      if (remainingMs <= 0) {
        continue;
      }

      nextToastIds.add(toastId);
      toast.success(pendingUndoTitle(action), {
        id: toastId,
        duration: remainingMs,
        description: action.subjectType === "dependency" ? undefined : action.subjectLabel,
        action: {
          label: "Undo",
          onClick: () => {
            void undoPendingDelete(action.id);
          },
        },
      });
    }

    for (const toastId of undoToastIdsRef.current) {
      if (!nextToastIds.has(toastId)) {
        toast.dismiss(toastId);
      }
    }

    undoToastIdsRef.current = nextToastIds;
  }, [plan.pendingUndoActions]);

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

  function markCheckpointPending(checkpointId: string, pending: boolean) {
    setPendingCheckpointIds((current) => {
      const next = { ...current };

      if (pending) {
        next[checkpointId] = true;
      } else {
        delete next[checkpointId];
      }

      return next;
    });
  }

  function checkpointDraft(checkpoint: Checkpoint) {
    const draft = checkpointDrafts[checkpoint.id];

    return {
      name: draft?.name ?? checkpoint.name,
      percentComplete: draft?.percentComplete ?? String(checkpoint.percentComplete),
      weightPoints: draft?.weightPoints ?? String(checkpoint.weightPoints),
    };
  }

  function setCheckpointDraft(checkpointId: string, patch: Partial<CheckpointDraft>) {
    setCheckpointDrafts((current) => ({
      ...current,
      [checkpointId]: {
        ...current[checkpointId],
        ...patch,
      },
    }));
  }

  function clearCheckpointDraft(checkpointId: string) {
    setCheckpointDrafts((current) => {
      const next = { ...current };
      delete next[checkpointId];
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
      throw new RequestError(payload?.error ?? "Request failed.", payload?.code, payload?.details);
    }

    return payload as ProjectPlan;
  }

  function openBaselineGate(content: { title: string; description: string }, action: () => Promise<void>) {
    baselineGateActionRef.current = action;
    setBaselineGateContent(content);
    setBaselineGateOpen(true);
  }

  function openActualStartGate(task: PlannedTask, action: (actualStart: string) => Promise<void>) {
    actualStartGateActionRef.current = action;
    setActualStartGateTaskId(task.id);
    setActualStartGateDate(task.actualStart ?? plannerDisplayStart(task) ?? isoToday());
    setActualStartGateOpen(true);
  }

  function openActualEndGate(task: PlannedTask, action: (actualEnd: string) => Promise<void>) {
    actualEndGateActionRef.current = action;
    setActualEndGateTaskId(task.id);
    setActualEndGateDate(actualDisplayEnd(task) ?? plannerDisplayEnd(task) ?? isoToday());
    setActualEndGateOpen(true);
  }

  function patchHasExecutionSignal(task: PlannedTask, patch: Record<string, unknown>) {
    const nextActualStart =
      patch.actualStart !== undefined
        ? (patch.actualStart as string | null)
        : task.actualStart;
    const nextActualEnd =
      patch.actualEnd !== undefined
        ? (patch.actualEnd as string | null)
        : task.actualEnd;
    const nextPercent =
      patch.percentComplete !== undefined
        ? Number(patch.percentComplete)
        : task.percentComplete;

    return Boolean(nextActualStart || nextActualEnd || nextPercent > 0);
  }

  function patchNeedsActualStart(task: PlannedTask, patch: Record<string, unknown>) {
    const nextPercent =
      patch.percentComplete !== undefined
        ? Number(patch.percentComplete)
        : task.percentComplete;
    const nextActualStart =
      patch.actualStart !== undefined
        ? (patch.actualStart as string | null)
        : task.actualStart;
    const nextActualEnd =
      patch.percentComplete !== undefined && Number(patch.percentComplete) < 100 && patch.actualEnd === undefined
        ? null
        : patch.actualEnd !== undefined
          ? (patch.actualEnd as string | null)
          : task.actualEnd;

    return (nextPercent > 0 || Boolean(nextActualEnd)) && !nextActualStart;
  }

  function patchNeedsActualEnd(task: PlannedTask, patch: Record<string, unknown>) {
    const nextPercent =
      patch.percentComplete !== undefined
        ? Number(patch.percentComplete)
        : task.percentComplete;
    const nextActualEnd =
      patch.percentComplete !== undefined && Number(patch.percentComplete) < 100 && patch.actualEnd === undefined
        ? null
        : patch.actualEnd !== undefined
          ? (patch.actualEnd as string | null)
          : task.actualEnd;

    return nextPercent >= 100 && !nextActualEnd;
  }

  const undoPendingDelete = useEffectEvent(async (actionId: string) => {
    try {
      const nextPlan = await requestPlan(`/api/undo/${actionId}`, {
        method: "POST",
      });

      if (nextPlan) {
        applyPlan(nextPlan);
        toast.success("Delete undone");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to undo delete.");
    }
  });

  function toggleTask(taskId: string) {
    setExpandedMap((current) => ({ ...current, [taskId]: !(current[taskId] ?? false) }));
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
      task.notes.toLowerCase().includes(query) ||
      task.checkpoints.some((checkpoint) => checkpoint.name.toLowerCase().includes(query));
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "open" && task.rolledUpStatus !== "done") ||
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

  function isCheckpointCellActive(checkpointId: string, field: CheckpointEditableField) {
    return activeCheckpointCell?.checkpointId === checkpointId && activeCheckpointCell.field === field;
  }

  function checkpointCellButtonClass(checkpointId: string, field: CheckpointEditableField) {
    return cn(
      "group w-full cursor-pointer rounded-2xl px-2 py-2 text-left transition",
      "hover:bg-muted/45 hover:ring-1 hover:ring-border/70",
      isCheckpointCellActive(checkpointId, field) && "bg-muted/55 ring-1 ring-border/70",
    );
  }

  async function freezeBaselineRequest(showToast = true) {
    const nextPlan = await requestPlan(`/api/projects/${plan.project.id}/freeze-baseline`, {
      method: "POST",
    });

    if (nextPlan) {
      applyPlan(nextPlan);

      if (showToast) {
        toast.success(plan.project.baselineCapturedAt ? "Baseline reset" : "Baseline frozen");
      }
    }

    return nextPlan;
  }

  async function patchTaskRequest(
    task: PlannedTask,
    patch: Record<string, unknown>,
    successMessage?: string,
    callbacks?: { onSuccess?: (nextPlan: ProjectPlan | null) => void; onError?: () => void },
  ) {
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

      callbacks?.onSuccess?.(nextPlan);

      if (successMessage) {
        toast.success(successMessage);
      }

      return nextPlan;
    } catch (error) {
      callbacks?.onError?.();
      toast.error(error instanceof Error ? error.message : "Failed to update task.");
      return null;
    } finally {
      markTaskPending(task.id, false);
    }
  }

  async function patchTask(
    task: PlannedTask,
    patch: Record<string, unknown>,
    successMessage?: string,
    callbacks?: { onSuccess?: (nextPlan: ProjectPlan | null) => void; onError?: () => void },
  ) {
    if (!plan.project.baselineCapturedAt && patchHasExecutionSignal(task, patch)) {
      openBaselineGate(
        {
          title: "Freeze baseline before recording progress",
          description: "Execution updates should compare against a frozen baseline. Freeze the current forecast first, then continue.",
        },
        async () => {
          await freezeBaselineRequest(false);
          await patchTask(task, patch, successMessage, callbacks);
        },
      );
      return;
    }

    if (patchNeedsActualStart(task, patch)) {
      openActualStartGate(task, async (actualStart) => {
        await patchTask(task, { ...patch, actualStart }, successMessage, callbacks);
      });
      return;
    }

    if (patchNeedsActualEnd(task, patch)) {
      openActualEndGate(task, async (actualEnd) => {
        await patchTask(task, { ...patch, actualEnd }, successMessage, callbacks);
      });
      return;
    }

    await patchTaskRequest(task, patch, successMessage, callbacks);
  }

  async function createCheckpointForTask(task: PlannedTask) {
    markTaskPending(task.id, true);

    try {
      const nextPlan = await requestPlan(`/api/tasks/${task.id}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New checkpoint",
          percentComplete: 0,
          weightPoints: 1,
        }),
      });

      if (nextPlan) {
        applyPlan(nextPlan);
        setExpandedMap((current) => ({ ...current, [task.id]: true }));
        toast.success("Checkpoint added");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add checkpoint.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  async function saveCheckpoint(taskId: string, checkpoint: Checkpoint) {
    const draft = checkpointDraft(checkpoint);
    const parentTask = taskMap.get(taskId);

    if (!parentTask) {
      toast.error("Parent task not found.");
      return;
    }

    const nextPercent = computeCheckpointPercent(
      parentTask.checkpoints.map((item) =>
        item.id === checkpoint.id
          ? {
              percentComplete: Number(draft.percentComplete),
              weightPoints: Number(draft.weightPoints),
            }
          : {
              percentComplete: item.percentComplete,
              weightPoints: item.weightPoints,
            },
      ),
    );

    if (!plan.project.baselineCapturedAt && nextPercent > 0) {
      openBaselineGate(
        {
          title: "Freeze baseline before recording checkpoint progress",
          description: "Checkpoint progress is part of actual execution. Freeze the current forecast first, then continue.",
        },
        async () => {
          await freezeBaselineRequest(false);
          await saveCheckpoint(taskId, checkpoint);
        },
      );
      return;
    }

    if (nextPercent > 0 && !parentTask.actualStart) {
      openActualStartGate(parentTask, async (actualStart) => {
        const updatedPlan = await patchTaskRequest(parentTask, { actualStart });

        if (updatedPlan) {
          await saveCheckpoint(taskId, checkpoint);
        }
      });
      return;
    }

    if (nextPercent >= 100 && !actualDisplayEnd(parentTask)) {
      openActualEndGate(parentTask, async (actualEnd) => {
        const updatedPlan = await patchTaskRequest(parentTask, { actualEnd });

        if (updatedPlan) {
          await saveCheckpointRequest(taskId, checkpoint, draft);
        }
      });
      return;
    }

    await saveCheckpointRequest(taskId, checkpoint, draft);
  }

  async function saveCheckpointRequest(taskId: string, checkpoint: Checkpoint, draft: CheckpointDraft) {

    markCheckpointPending(checkpoint.id, true);

    try {
      const nextPlan = await requestPlan(`/api/checkpoints/${checkpoint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          percentComplete: Number(draft.percentComplete),
          weightPoints: Number(draft.weightPoints),
        }),
      });

      if (nextPlan) {
        applyPlan(nextPlan);
        clearCheckpointDraft(checkpoint.id);
        setExpandedMap((current) => ({ ...current, [taskId]: true }));
        toast.success("Checkpoint updated");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update checkpoint.");
    } finally {
      markCheckpointPending(checkpoint.id, false);
    }
  }

  async function moveCheckpointRow(taskId: string, checkpointId: string, direction: "up" | "down") {
    markCheckpointPending(checkpointId, true);

    try {
      const nextPlan = await requestPlan(`/api/checkpoints/${checkpointId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });

      if (nextPlan) {
        applyPlan(nextPlan);
        setExpandedMap((current) => ({ ...current, [taskId]: true }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reorder checkpoint.");
    } finally {
      markCheckpointPending(checkpointId, false);
    }
  }

  async function removeCheckpointRow(taskId: string, checkpointId: string) {
    markCheckpointPending(checkpointId, true);

    try {
      const nextPlan = await requestPlan(`/api/checkpoints/${checkpointId}`, {
        method: "DELETE",
      });

      if (nextPlan) {
        applyPlan(nextPlan);
        clearCheckpointDraft(checkpointId);
        setExpandedMap((current) => ({ ...current, [taskId]: true }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove checkpoint.");
    } finally {
      markCheckpointPending(checkpointId, false);
    }
  }

  async function wrapTask(task: PlannedTask) {
    markTaskPending(task.id, true);

    try {
      const nextPlan = await requestPlan(`/api/tasks/${task.id}/wrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childName: "Execution" }),
      });

      if (nextPlan) {
        applyPlan(nextPlan);
        toast.success("Task wrapped in a section");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to wrap task.");
    } finally {
      markTaskPending(task.id, false);
    }
  }

  async function freezeBaseline() {
    startTransition(async () => {
      try {
        await freezeBaselineRequest();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to freeze baseline.");
      }
    });
  }

  async function rebaseSchedule() {
    if (!rebaseStartDate) {
      toast.error("Choose a new project start date.");
      return;
    }

    startTransition(async () => {
      try {
        const nextPlan = await requestPlan(`/api/projects/${plan.project.id}/rebase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: rebaseStartDate }),
        });

        if (nextPlan) {
          applyPlan(nextPlan);
          setRebaseOpen(false);
          toast.success("Project schedule rebased");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rebase project schedule.");
      }
    });
  }

  function buildSchedulePatch(task: PlannedTask, patch: { plannedStart?: string | null; plannedEnd?: string | null }) {
    if (patch.plannedEnd !== undefined || task.plannedMode === "start_end") {
      return {
        plannedMode: "start_end",
        plannedStart: patch.plannedStart ?? plannerDisplayStart(task),
        plannedEnd: patch.plannedEnd ?? plannerDisplayEnd(task),
      };
    }

    return {
      plannedMode: "start_duration",
      plannedStart: patch.plannedStart ?? plannerDisplayStart(task),
      plannedDurationDays: task.plannedDurationDays ?? task.computedPlannedDurationDays ?? (task.type === "milestone" ? 0 : 1),
    };
  }

  function buildProgressPatch(task: PlannedTask, percentComplete: number) {
    if (percentComplete < 100 && actualDisplayEnd(task)) {
      return { percentComplete, actualEnd: null };
    }

    return { percentComplete };
  }

  function buildProgressResetPatch() {
    return {
      actualStart: null,
      actualEnd: null,
      percentComplete: 0,
    };
  }

  function renderListDateValue(task: PlannedTask, field: "start" | "due") {
    const actualValue = field === "start" ? actualDisplayStart(task) : actualDisplayEnd(task);
    const forecastValue =
      field === "start"
        ? plannerDisplayStart(task)
        : actualValue
          ? storedForecastEnd(task)
          : plannerDisplayEnd(task);
    const baselineValue = field === "start" ? task.computedBaselinePlannedStart : task.computedBaselinePlannedEnd;
    const dateEditMode = task.isSummary
      ? "readonly"
      : field === "start"
        ? isExecutionActive(task)
          ? "actual_start"
          : "forecast_start"
        : isActualComplete(task)
          ? "actual_end"
          : "forecast_end";
    const isEditableDate = dateEditMode !== "readonly";
    const isFieldActive = isCellActive(task.id, field);
    const isTaskPending = Boolean(pendingTaskIds[task.id]);
    const displayValue = actualValue ?? forecastValue;
    const inputValue =
      dateEditMode === "actual_start" || dateEditMode === "actual_end"
        ? displayValue
        : forecastValue;
    const showsActual = Boolean(actualValue);
    const forecastDelta = dateVarianceLabel(forecastValue, actualValue);
    const forecastGap = forecastValue && actualValue ? signedBusinessDayGap(forecastValue, actualValue) : null;
    const valueClass = showsActual
      ? forecastGap !== null && forecastGap > 0
        ? "font-semibold text-rose-600"
        : "font-semibold text-emerald-700"
      : "text-foreground";
    const tooltipContent = (
      <div className="space-y-2 text-sm text-white">
        <p className="font-medium text-white">{field === "start" ? "Start" : "End"} comparison</p>
        <div className="space-y-1 text-white/75">
          <div className="flex items-center justify-between gap-4">
            <span>Baseline</span>
            <span className="text-white">{formatShortDate(baselineValue)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Forecast</span>
            <span className="text-white">{formatShortDate(forecastValue)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Actual</span>
            <span className="text-white">{formatShortDate(actualValue)}</span>
          </div>
        </div>
        {forecastDelta ? <p className="text-xs text-white/75">{forecastDelta}</p> : null}
      </div>
    );

    return (
      <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
        {isEditableDate && isFieldActive ? (
          <DatePickerField
            value={inputValue}
            open
            onOpenChange={(open) => {
              if (!open) {
                setActiveCell(null);
              }
            }}
            onChange={(value) => {
              setActiveCell(null);
              void patchTask(task, (() => {
                switch (dateEditMode) {
                  case "actual_start":
                    return { actualStart: value };
                  case "actual_end":
                    return { actualEnd: value };
                  case "forecast_end":
                    return buildSchedulePatch(task, { plannedEnd: value });
                  case "forecast_start":
                  default:
                    return buildSchedulePatch(task, { plannedStart: value });
                }
              })());
            }}
            disabled={isTaskPending}
            className="flex-nowrap"
            triggerClassName="w-full"
          />
        ) : (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    isEditableDate ? cellButtonClass(task.id, field) : "w-full rounded-2xl px-2 py-1 text-left",
                    "flex items-center gap-1.5 py-1 text-sm",
                  )}
                  onClick={isEditableDate ? () => setActiveCell({ taskId: task.id, field }) : undefined}
                  disabled={isTaskPending}
                >
                  <span className={cn("shrink-0 whitespace-nowrap", valueClass)}>{formatCompactDate(displayValue)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="border-neutral-800 bg-neutral-950 text-white">{tooltipContent}</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        )}
      </div>
    );
  }

  async function removeTask(taskId: string) {
    startTransition(async () => {
      try {
        const nextPlan = await requestPlan(`/api/tasks/${taskId}`, { method: "DELETE" });

      if (nextPlan) {
        applyPlan(nextPlan);
      }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove task.");
      }
    });
  }

  function exportFilename(formatMode: "markdown" | "json") {
    const slug = plan.project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";

    return `${slug}-export.${formatMode === "markdown" ? "md" : "json"}`;
  }

  async function downloadExport(formatMode: "markdown" | "json") {
    try {
      const response = await fetch(`/api/projects/${plan.project.id}/export?format=${formatMode}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to load export.");
      }

      const content = formatMode === "markdown" ? await response.text() : JSON.stringify(await response.json(), null, 2);
      const blob = new Blob([content], {
        type: formatMode === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(formatMode);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`${formatMode === "markdown" ? "Markdown" : "JSON"} export downloaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to download export.");
    }
  }

  function dependencyPills(task: PlannedTask) {
    const blockedByCount = task.blockedBy.length;
    const blockingCount = task.blocking.length;

    if (blockedByCount === 0 && blockingCount === 0) {
      return <span className="text-xs text-muted-foreground">None</span>;
    }

    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {blockedByCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <ArrowBendUpLeft className="size-3" />
            <span>{blockedByCount}</span>
          </span>
        ) : null}
        {blockedByCount > 0 && blockingCount > 0 ? <span className="h-3 w-px bg-border/70" /> : null}
        {blockingCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <ArrowBendDownRight className="size-3" />
            <span>{blockingCount}</span>
          </span>
        ) : null}
      </div>
    );
  }

  function openDependencyPopover(taskId: string) {
    if (dependencyHoverTimeoutRef.current !== null) {
      clearTimeout(dependencyHoverTimeoutRef.current);
      dependencyHoverTimeoutRef.current = null;
    }

    setHoveredDependencyTaskId(taskId);
  }

  function closeDependencyPopover(taskId: string) {
    if (dependencyHoverTimeoutRef.current !== null) {
      clearTimeout(dependencyHoverTimeoutRef.current);
    }

    dependencyHoverTimeoutRef.current = setTimeout(() => {
      setHoveredDependencyTaskId((current) => (current === taskId ? null : current));
      dependencyHoverTimeoutRef.current = null;
    }, 120);
  }

  function renderLeafControls(task: PlannedTask) {
    const currentProgress = Number(progressDrafts[task.id] ?? task.percentComplete);
    const isPending = Boolean(pendingTaskIds[task.id]);
    const canReset =
      currentProgress > 0 ||
      task.percentComplete > 0 ||
      Boolean(task.actualStart) ||
      Boolean(task.actualEnd);
    const progressChanged = currentProgress !== task.percentComplete;
    const progressActive = isCellActive(task.id, "progress");

    return (
      <>
        <div className="flex items-center">{renderStatusBadge(task.rolledUpStatus)}</div>

        <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
          {task.isProgressDerived ? (
            <button className={cn(cellButtonClass(task.id, "progress"), "cursor-default")} disabled>
              <ProgressPill value={task.percentComplete} compact />
            </button>
          ) : (
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
                  <ProgressPill value={currentProgress} compact />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 rounded-2xl p-4" onOpenAutoFocus={(event) => event.preventDefault()}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress</span>
                    <span className="text-sm font-medium">{currentProgress}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <SliderRoot
                      value={[currentProgress]}
                      min={0}
                      max={100}
                      step={5}
                      className="flex-1"
                      onValueChange={(value) =>
                        setProgressDrafts((current) => ({ ...current, [task.id]: String(value[0] ?? 0) }))
                      }
                      disabled={isPending}
                    >
                      <SliderTrack>
                        <SliderRange />
                      </SliderTrack>
                      <SliderThumb />
                    </SliderRoot>
                    <Button
                      size="icon-xs"
                      onClick={() => {
                        const nextValue = Number(progressDrafts[task.id] ?? task.percentComplete);
                        void patchTask(task, buildProgressPatch(task, nextValue), undefined, {
                          onSuccess: () => {
                            setActiveCell(null);
                            setProgressDrafts((current) => {
                              const next = { ...current };
                              delete next[task.id];
                              return next;
                            });
                          },
                        });
                      }}
                      disabled={isPending || !progressChanged}
                    >
                      <Check className="size-3.5" />
                      <span className="sr-only">Save progress</span>
                    </Button>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setProgressDrafts((current) => ({ ...current, [task.id]: "0" }));
                        void patchTask(task, buildProgressResetPatch(), undefined, {
                          onSuccess: () => {
                            setActiveCell(null);
                            setProgressDrafts((current) => {
                              const next = { ...current };
                              delete next[task.id];
                              return next;
                            });
                          },
                        });
                      }}
                      disabled={isPending || !canReset}
                    >
                      Reset
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => {
                        setProgressDrafts((current) => ({ ...current, [task.id]: "100" }));
                        void patchTask(task, buildProgressPatch(task, 100), undefined, {
                          onSuccess: () => {
                            setActiveCell(null);
                            setProgressDrafts((current) => {
                              const next = { ...current };
                              delete next[task.id];
                              return next;
                            });
                          },
                        });
                      }}
                      disabled={isPending || currentProgress >= 100}
                    >
                      Mark complete
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </PopoverRoot>
          )}
        </div>

        <div>{renderListDateValue(task, "start")}</div>

        <div>{renderListDateValue(task, "due")}</div>

        <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
          <PopoverRoot
            open={hoveredDependencyTaskId === task.id}
            onOpenChange={(open) => {
              if (!open) {
                setHoveredDependencyTaskId((current) => (current === task.id ? null : current));
              }
            }}
          >
            <PopoverTrigger asChild>
              <div
                className={cn(cellButtonClass(task.id, "dependencies"), "cursor-default")}
                onMouseEnter={() => openDependencyPopover(task.id)}
                onMouseLeave={() => closeDependencyPopover(task.id)}
              >
                <div className="min-w-0">{dependencyPills(task)}</div>
              </div>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-80 w-72 overflow-y-auto rounded-2xl p-0"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onMouseEnter={() => openDependencyPopover(task.id)}
              onMouseLeave={() => closeDependencyPopover(task.id)}
            >
              <div className="border-b border-border/70 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Dependencies
              </div>
              <div className="space-y-3 px-3 py-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Blocked by</p>
                  {task.blockedBy.length > 0 ? (
                    task.blockedBy.map((dependency) => {
                      const predecessor = taskMap.get(dependency.predecessorTaskId);

                      return (
                        <button
                          key={dependency.id}
                          className="block w-full cursor-pointer rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition hover:bg-muted/35"
                          onClick={() => {
                            if (predecessor) {
                              setHoveredDependencyTaskId(null);
                              openEditDialog(predecessor.id);
                            }
                          }}
                          disabled={!predecessor}
                        >
                          <p className="truncate text-sm font-medium text-foreground">
                            {predecessor?.name ?? dependency.predecessorTaskId}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {(predecessor?.computedPlannedStart ?? predecessor?.plannedStart ?? "No start").toString()} →{" "}
                            {(predecessor?.computedPlannedEnd ?? predecessor?.plannedEnd ?? "No end").toString()}
                          </p>
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-sm text-muted-foreground">No incoming dependencies.</div>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Blocking</p>
                  {task.blocking.length > 0 ? (
                    task.blocking.map((dependency) => {
                      const successor = taskMap.get(dependency.successorTaskId);

                      return (
                        <button
                          key={dependency.id}
                          className="block w-full cursor-pointer rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition hover:bg-muted/35"
                          onClick={() => {
                            if (successor) {
                              setHoveredDependencyTaskId(null);
                              openEditDialog(successor.id);
                            }
                          }}
                          disabled={!successor}
                        >
                          <p className="truncate text-sm font-medium text-foreground">
                            {successor?.name ?? dependency.successorTaskId}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {(successor?.computedPlannedStart ?? successor?.plannedStart ?? "No start").toString()} →{" "}
                            {(successor?.computedPlannedEnd ?? successor?.plannedEnd ?? "No end").toString()}
                          </p>
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-sm text-muted-foreground">Not blocking any other tasks.</div>
                  )}
                </div>
              </div>
              <div className="border-t border-border/70 p-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    setActiveCell(null);
                    openEditDialog(task.id);
                  }}
                >
                  Open full dependency editor
                </Button>
              </div>
            </PopoverContent>
          </PopoverRoot>
        </div>
      </>
    );
  }

  function renderSummaryCells(task: PlannedTask) {
    return (
      <>
        <div className="flex items-center">{renderStatusBadge(task.rolledUpStatus)}</div>
        <div>
          <ProgressPill value={task.rolledUpPercentComplete} />
        </div>
        <div>{renderListDateValue(task, "start")}</div>
        <div>{renderListDateValue(task, "due")}</div>
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
            <DropdownMenuItem onClick={() => openEditDialog(task.id)}>
              {task.isSummary ? "Edit section" : "Edit task"}
            </DropdownMenuItem>
            {task.isSummary ? (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    openCreateDialog("task", task.id, {
                      createParentLocked: true,
                      allowedCreateTypes: ["task", "summary", "milestone"],
                    })
                  }
                >
                  Add child item
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    openCreateDialog("summary", task.id, {
                      createParentLocked: true,
                      allowedCreateTypes: ["summary", "task", "milestone"],
                    })
                  }
                >
                  Add subsection
                </DropdownMenuItem>
              </>
            ) : (
              <>
                {task.type === "task" ? (
                  <DropdownMenuItem onClick={() => void createCheckpointForTask(task)}>Add checkpoint</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => void wrapTask(task)}>Wrap in section</DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void removeTask(task.id)}>
              {task.isSummary ? "Delete section" : "Delete task"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    );
  }

  function renderCheckpointRows(task: PlannedTask, depth: number) {
    if (task.checkpoints.length === 0) {
      return null;
    }

    const visibleCheckpoints = search.trim().length
      ? task.checkpoints.filter((checkpoint) => checkpoint.name.toLowerCase().includes(search.trim().toLowerCase()))
      : task.checkpoints;

    if (visibleCheckpoints.length === 0) {
      return null;
    }

    return (
      <CollapsibleContent>
        <div className="border-b border-border/60 bg-muted/5">
          {visibleCheckpoints.map((checkpoint, index) => {
            const draft = checkpointDraft(checkpoint);
            const isPending = Boolean(pendingCheckpointIds[checkpoint.id]);
            const isChanged =
              draft.name !== checkpoint.name ||
              Number(draft.percentComplete) !== checkpoint.percentComplete ||
              Number(draft.weightPoints) !== checkpoint.weightPoints;
            const percentComplete = Number(draft.percentComplete);
            const weightPoints = Number(draft.weightPoints);
            const nameActive = isCheckpointCellActive(checkpoint.id, "name");
            const progressActive = isCheckpointCellActive(checkpoint.id, "progress");
            const weightActive = isCheckpointCellActive(checkpoint.id, "weight");
            const canSave =
              isChanged &&
              Boolean(draft.name.trim()) &&
              Number.isFinite(weightPoints) &&
              weightPoints >= 1 &&
              weightPoints <= 8;

            return (
              <div
                key={checkpoint.id}
                className={cn(
                  "group relative grid items-center gap-3 overflow-hidden border-t border-border/40 px-4 py-2 transition-colors md:grid-cols-[minmax(220px,1.9fr)_144px_104px_auto]",
                  depthTintClass(depth, "checkpoint"),
                )}
              >
                <div className="relative min-w-0">
                  {nameActive ? (
                    <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * LIST_DEPTH_INDENT + 48}px` }}>
                      <InputGroup>
                        <InputGroupField
                          value={draft.name}
                          onChange={(event) => setCheckpointDraft(checkpoint.id, { name: event.target.value })}
                          disabled={isPending}
                          autoFocus
                        />
                      </InputGroup>
                      <Button
                        size="icon-xs"
                        disabled={isPending || !canSave}
                        onClick={() => {
                          setActiveCheckpointCell(null);
                          void saveCheckpoint(task.id, checkpoint);
                        }}
                      >
                        {isPending ? <Spinner /> : <Check className="size-3.5" />}
                      </Button>
                    </div>
                  ) : (
                    <button
                      className={cn(checkpointCellButtonClass(checkpoint.id, "name"), "py-1.5 text-sm")}
                      style={{ paddingLeft: `${depth * LIST_DEPTH_INDENT + 48}px` }}
                      onClick={() => setActiveCheckpointCell({ checkpointId: checkpoint.id, field: "name" })}
                      disabled={isPending}
                    >
                      <span className="block truncate font-medium">{draft.name}</span>
                    </button>
                  )}
                </div>
                <div>
                  {progressActive ? (
                    <PopoverRoot
                      open={progressActive}
                      onOpenChange={(open) => {
                        if (open) {
                          setActiveCheckpointCell({ checkpointId: checkpoint.id, field: "progress" });
                          return;
                        }

                        setActiveCheckpointCell((current) =>
                          current?.checkpointId === checkpoint.id && current.field === "progress" ? null : current,
                        );
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button className={cn(checkpointCellButtonClass(checkpoint.id, "progress"), "py-1")} disabled={isPending}>
                          <CheckpointProgressPill value={Number.isFinite(percentComplete) ? percentComplete : checkpoint.percentComplete} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 rounded-2xl p-4" onOpenAutoFocus={(event) => event.preventDefault()}>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{percentComplete}%</span>
                            <Button
                              size="icon-xs"
                              disabled={isPending || !canSave}
                              onClick={() => {
                                setActiveCheckpointCell(null);
                                void saveCheckpoint(task.id, checkpoint);
                              }}
                            >
                              {isPending ? <Spinner /> : <Check className="size-3.5" />}
                            </Button>
                          </div>
                          <SliderRoot
                            value={[Number.isFinite(percentComplete) ? percentComplete : checkpoint.percentComplete]}
                            min={0}
                            max={100}
                            step={5}
                            onValueChange={(value) => setCheckpointDraft(checkpoint.id, { percentComplete: String(value[0] ?? 0) })}
                            disabled={isPending}
                          >
                            <SliderTrack>
                              <SliderRange />
                            </SliderTrack>
                            <SliderThumb />
                          </SliderRoot>
                        </div>
                      </PopoverContent>
                    </PopoverRoot>
                  ) : (
                    <button
                      className={cn(checkpointCellButtonClass(checkpoint.id, "progress"), "py-1")}
                      onClick={() => setActiveCheckpointCell({ checkpointId: checkpoint.id, field: "progress" })}
                      disabled={isPending}
                    >
                      <CheckpointProgressPill value={Number.isFinite(percentComplete) ? percentComplete : checkpoint.percentComplete} />
                    </button>
                  )}
                </div>
                <div>
                  {weightActive ? (
                    <PopoverRoot
                      open={weightActive}
                      onOpenChange={(open) => {
                        if (open) {
                          setActiveCheckpointCell({ checkpointId: checkpoint.id, field: "weight" });
                          return;
                        }

                        setActiveCheckpointCell((current) =>
                          current?.checkpointId === checkpoint.id && current.field === "weight" ? null : current,
                        );
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className={cn(checkpointCellButtonClass(checkpoint.id, "weight"), "py-1 text-sm text-muted-foreground")}
                          disabled={isPending}
                        >
                          <span>{Number.isFinite(weightPoints) ? weightPoints : checkpoint.weightPoints} pts</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 rounded-2xl p-4" onOpenAutoFocus={(event) => event.preventDefault()}>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              {Number.isFinite(weightPoints) ? weightPoints : checkpoint.weightPoints} pts
                            </span>
                            <Button
                              size="icon-xs"
                              disabled={isPending || !canSave}
                              onClick={() => {
                                setActiveCheckpointCell(null);
                                void saveCheckpoint(task.id, checkpoint);
                              }}
                            >
                              {isPending ? <Spinner /> : <Check className="size-3.5" />}
                            </Button>
                          </div>
                          <SliderRoot
                            value={[Math.max(1, Math.min(8, Number.isFinite(weightPoints) ? weightPoints : checkpoint.weightPoints))]}
                            min={1}
                            max={8}
                            step={1}
                            onValueChange={(value) => setCheckpointDraft(checkpoint.id, { weightPoints: String(value[0] ?? 1) })}
                            disabled={isPending}
                          >
                            <SliderTrack>
                              <SliderRange />
                            </SliderTrack>
                            <SliderThumb />
                          </SliderRoot>
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span>1</span>
                            <span>8</span>
                          </div>
                        </div>
                      </PopoverContent>
                    </PopoverRoot>
                  ) : (
                    <button
                      className={cn(checkpointCellButtonClass(checkpoint.id, "weight"), "py-1 text-sm text-muted-foreground")}
                      onClick={() => setActiveCheckpointCell({ checkpointId: checkpoint.id, field: "weight" })}
                      disabled={isPending}
                    >
                      <span>{Number.isFinite(weightPoints) ? weightPoints : checkpoint.weightPoints} pts</span>
                    </button>
                  )}
                </div>
                <div className="flex items-end justify-end gap-2">
                  <DropdownMenuRoot>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" disabled={isPending}>
                        {isPending ? <Spinner /> : "•••"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!canSave}
                        onClick={() => {
                          setActiveCheckpointCell(null);
                          void saveCheckpoint(task.id, checkpoint);
                        }}
                      >
                        Save checkpoint
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === 0}
                        onClick={() => void moveCheckpointRow(task.id, checkpoint.id, "up")}
                      >
                        Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === visibleCheckpoints.length - 1}
                        onClick={() => void moveCheckpointRow(task.id, checkpoint.id, "down")}
                      >
                        Move down
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => void removeCheckpointRow(task.id, checkpoint.id)}
                      >
                        Delete checkpoint
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuRoot>
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    );
  }

  function renderListNode(taskId: string, depth = 0): React.ReactNode {
    const task = taskMap.get(taskId);

    if (!task || !shouldRender(task)) {
      return null;
    }

    const expanded = search.trim().length > 0 ? true : expandedMap[task.id] ?? false;
    const isSummaryRow = task.isSummary;
    const hasExpandableContent = task.hasChildren || task.checkpoints.length > 0;

        const row = (
      <div
        className={cn(
          "group relative grid items-center overflow-hidden border-b border-border/60 px-4 py-2 transition-colors",
          LIST_GRID_CLASS,
          depthTintClass(depth, "task"),
          hasExpandableContent ? "cursor-pointer" : "cursor-default",
        )}
        onClick={hasExpandableContent ? () => void toggleTask(task.id) : undefined}
      >
        <div
          className="relative min-w-0"
          style={{ paddingLeft: `${depth * LIST_DEPTH_INDENT + LIST_TREE_CONTROL_SIZE + LIST_TREE_CONTROL_GAP}px` }}
        >
          {hasExpandableContent ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${task.name}` : `Expand ${task.name}`}
              className="absolute left-0 top-1/2 inline-flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted"
              style={{ left: `${depth * LIST_DEPTH_INDENT}px` }}
              onClick={(event) => {
                event.stopPropagation();
                void toggleTask(task.id);
              }}
            >
              {expanded ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
            </button>
          ) : (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center"
              style={{ left: `${depth * LIST_DEPTH_INDENT}px` }}
            />
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
              <>
                <p className="truncate text-xs text-muted-foreground">{task.notes || `${task.rolledUpEffortDays} business day effort`}</p>
              </>
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
                    allowedCreateTypes: ["task", "summary", "milestone"],
                  })
                }
              >
                Add child item
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  openCreateDialog("summary", task.id, {
                    createParentLocked: true,
                    allowedCreateTypes: ["summary", "task", "milestone"],
                  })
                }
              >
                Add subsection
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
        {!task.isSummary && task.checkpoints.length > 0 ? renderCheckpointRows(task, depth + 1) : null}
      </CollapsibleRoot>
    );
  }

  function renderGanttNode(taskId: string, depth = 0): React.ReactNode {
    const task = taskMap.get(taskId);

    if (!task || !shouldRender(task)) {
      return null;
    }

    const expanded = search.trim().length > 0 ? true : expandedMap[task.id] ?? false;
    const hasExpandableContent = task.hasChildren || task.checkpoints.length > 0;
    const forecastStyle = taskBarStyle(task, timeline);
    const baselineStyle = barStyleForRange(
      task.computedBaselinePlannedStart,
      task.computedBaselinePlannedEnd,
      timeline,
    );
    const actualStart = actualDisplayStart(task);
    const actualEnd = actualDisplayEnd(task);
    const inProgressActualEnd = actualStart && !actualEnd ? isoToday() : null;
    const actualStyle = barStyleForRange(
      actualStart,
      actualEnd ?? inProgressActualEnd,
      timeline,
    );
    const percent = progressPercent(task);
    const forecastFillStyle = ganttInnerFillWidth(percent);
    const inProgressFillStyle = ganttProgressFillStyle(forecastStyle, percent);
    const barTone = ganttBarTone(task);
    const showCompletedActual = Boolean(actualStart && actualEnd);
    const showInProgressActual = Boolean(actualStart && !actualEnd);
    const showForecastBar = !showCompletedActual;

    return (
      <CollapsibleRoot key={task.id} open={expanded}>
        <div
          className={cn(
            "group flex min-w-max border-b border-border/60",
            hasExpandableContent ? "cursor-pointer bg-muted/10 hover:bg-muted/20" : "hover:bg-muted/10",
          )}
          onClick={hasExpandableContent ? () => void toggleTask(task.id) : undefined}
        >
          <div
            className={cn(
              "sticky left-0 z-20 flex shrink-0 items-center gap-2 overflow-hidden border-r border-border/60 px-4 py-3 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.35)]",
              task.isSummary ? "bg-card" : "bg-card",
            )}
            style={{ width: GANTT_NAME_COLUMN_WIDTH, paddingLeft: `${depth * 18 + 16}px` }}
          >
            {hasExpandableContent ? (
              <button
                type="button"
                aria-label={expanded ? `Collapse ${task.name}` : `Expand ${task.name}`}
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
                {timelineSubtitle(task)}
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
            {task.computedBaselinePlannedStart && task.computedBaselinePlannedEnd ? (
              <TooltipProvider>
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <div
                      className="absolute top-4 h-8 rounded-xl border border-dashed border-black/30 bg-transparent"
                      style={baselineStyle}
                    />
                  </TooltipTrigger>
                  <TooltipContent className="border-neutral-800 bg-neutral-950 text-white">
                    <div className="space-y-1 text-xs">
                      <p className="font-medium text-white">Baseline</p>
                      <p className="text-white/80">
                        {formatShortDate(task.computedBaselinePlannedStart)} → {formatShortDate(task.computedBaselinePlannedEnd)}
                      </p>
                    </div>
                  </TooltipContent>
                </TooltipRoot>
              </TooltipProvider>
            ) : null}
            {showForecastBar ? (
              <TooltipProvider>
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "absolute top-3 flex h-10 items-center overflow-hidden rounded-xl border px-3 text-sm font-medium shadow-sm",
                        barTone.shellClass,
                        barTone.textClass,
                      )}
                      style={forecastStyle}
                      >
                      <div
                        className={cn("absolute inset-y-0 left-0 rounded-xl", barTone.fillClass)}
                        style={forecastFillStyle}
                      />
                      <div className="relative z-10 flex w-full items-center justify-end">
                        <span className="text-xs font-semibold">{percent}%</span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="border-neutral-800 bg-neutral-950 text-white">
                    <div className="space-y-1 text-xs">
                      <p className="font-medium text-white">Forecast</p>
                      <p className="text-white/80">
                        {formatShortDate(task.computedPlannedStart)} → {formatShortDate(task.computedPlannedEnd)}
                      </p>
                    </div>
                  </TooltipContent>
                </TooltipRoot>
              </TooltipProvider>
            ) : null}
            {showInProgressActual ? (
              <TooltipProvider>
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "absolute top-3 h-10 rounded-xl shadow-sm",
                        barTone.fillClass,
                      )}
                      style={inProgressFillStyle}
                    />
                  </TooltipTrigger>
                  <TooltipContent className="border-neutral-800 bg-neutral-950 text-white">
                    <div className="space-y-1 text-xs">
                      <p className="font-medium text-white">Actual</p>
                      <p className="text-white/80">Started {formatShortDate(actualStart)}</p>
                      <p className="text-white/80">{percent}% complete</p>
                    </div>
                  </TooltipContent>
                </TooltipRoot>
              </TooltipProvider>
            ) : null}
            {showCompletedActual ? (
              <TooltipProvider>
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "absolute top-3 flex h-10 items-center overflow-hidden rounded-xl border px-3 text-sm font-medium shadow-sm",
                        barTone.shellClass,
                        barTone.textClass,
                      )}
                      style={actualStyle}
                    >
                      <div
                        className={cn(
                          "absolute inset-0 rounded-xl",
                          barTone.fillClass,
                        )}
                      />
                      <div className="relative z-10 flex w-full items-center justify-end">
                        <span className="text-xs font-semibold">{percent}%</span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="border-neutral-800 bg-neutral-950 text-white">
                    <div className="space-y-1 text-xs">
                      <p className="font-medium text-white">Actual</p>
                      <p className="text-white/80">
                        {formatShortDate(actualStart)} → {formatShortDate(actualEnd)}
                      </p>
                      <p className="text-white/80">{percent}% complete</p>
                    </div>
                  </TooltipContent>
                </TooltipRoot>
              </TooltipProvider>
            ) : null}
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
    <div className="flex h-screen overflow-hidden bg-background">
      <WorkspaceSidebar projects={projects} activeProjectId={plan.project.id} />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border/70 bg-background/95 px-8 pt-6 pb-4 backdrop-blur">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight">{plan.project.name}</h1>
                  <DropdownMenuRoot>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label="Project actions">
                        •••
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setRebaseOpen(true)}>Rebase schedule</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void freezeBaseline()}>
                        {plan.project.baselineCapturedAt ? "Reset baseline" : "Freeze baseline"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                        <PencilSimple />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => void downloadExport("markdown")}>
                        <DownloadSimple />
                        Download Markdown export
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void downloadExport("json")}>
                        <DownloadSimple />
                        Download JSON snapshot
                      </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenuRoot>
                  {plan.issues.length > 0 ? <Badge variant="warning">{plan.issues.length} issues</Badge> : null}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Badge variant="outline">{plan.projectPercentComplete}% complete</Badge>
                </div>
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
                  <Button variant={statusFilter === "done" ? "default" : "outline"} onClick={() => setStatusFilter("done")}>
                    Done
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {view === "list" ? (
            <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
              <div className={cn("sticky top-0 z-10 grid border-b border-border/70 bg-background/95 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur", LIST_GRID_CLASS)}>
                <span>Name</span>
                <span>Status</span>
                <span>Progress</span>
                <span>Start</span>
                <span>End</span>
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

      <DialogRoot open={rebaseOpen} onOpenChange={setRebaseOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Rebase schedule</DialogTitle>
            <DialogDescription>
              Shift the whole forecast so the earliest planned task starts on a new date. Baseline and actual progress stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                New project start date
              </label>
              <DatePickerField value={rebaseStartDate} onChange={setRebaseStartDate} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRebaseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void rebaseSchedule()} disabled={isPending || !rebaseStartDate}>
              {isPending ? <Spinner /> : null}
              Rebase forecast
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={baselineGateOpen}
        onOpenChange={(open) => {
          setBaselineGateOpen(open);

          if (!open) {
            baselineGateActionRef.current = null;
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{baselineGateContent.title}</DialogTitle>
            <DialogDescription>{baselineGateContent.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBaselineGateOpen(false);
                baselineGateActionRef.current = null;
              }}
              disabled={baselineGatePending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = baselineGateActionRef.current;

                if (!action) {
                  setBaselineGateOpen(false);
                  return;
                }

                startTransition(async () => {
                  setBaselineGatePending(true);

                  try {
                    await action();
                    setBaselineGateOpen(false);
                    baselineGateActionRef.current = null;
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to freeze baseline.");
                  } finally {
                    setBaselineGatePending(false);
                  }
                });
              }}
              disabled={baselineGatePending}
            >
              {baselineGatePending ? <Spinner /> : null}
              Freeze baseline
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={actualStartGateOpen}
        onOpenChange={(open) => {
          setActualStartGateOpen(open);

          if (!open) {
            actualStartGateActionRef.current = null;
            setActualStartGateTaskId(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Actual start required</DialogTitle>
            <DialogDescription>
              Active work needs an actual start date before progress can be recorded.
              {actualStartGateTaskId ? ` ${taskMap.get(actualStartGateTaskId)?.name ?? "This task"} will be updated once you confirm the date.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Actual start</label>
              <DatePickerField value={actualStartGateDate} onChange={setActualStartGateDate} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActualStartGateOpen(false);
                actualStartGateActionRef.current = null;
                setActualStartGateTaskId(null);
              }}
              disabled={actualStartGatePending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = actualStartGateActionRef.current;

                if (!action || !actualStartGateDate) {
                  toast.error("Choose an actual start date.");
                  return;
                }

                startTransition(async () => {
                  setActualStartGatePending(true);

                  try {
                    await action(actualStartGateDate);
                    setActualStartGateOpen(false);
                    actualStartGateActionRef.current = null;
                    setActualStartGateTaskId(null);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to update actual start.");
                  } finally {
                    setActualStartGatePending(false);
                  }
                });
              }}
              disabled={actualStartGatePending || !actualStartGateDate}
            >
              {actualStartGatePending ? <Spinner /> : null}
              Save actual start
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={actualEndGateOpen}
        onOpenChange={(open) => {
          setActualEndGateOpen(open);

          if (!open) {
            actualEndGateActionRef.current = null;
            setActualEndGateTaskId(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Actual end required</DialogTitle>
            <DialogDescription>
              Completed work needs an actual end date before it can count as done.
              {actualEndGateTaskId ? ` ${taskMap.get(actualEndGateTaskId)?.name ?? "This task"} will be marked complete once you confirm the date.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Actual end</label>
              <DatePickerField value={actualEndGateDate} onChange={setActualEndGateDate} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActualEndGateOpen(false);
                actualEndGateActionRef.current = null;
                setActualEndGateTaskId(null);
              }}
              disabled={actualEndGatePending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = actualEndGateActionRef.current;

                if (!action || !actualEndGateDate) {
                  toast.error("Choose an actual end date.");
                  return;
                }

                startTransition(async () => {
                  setActualEndGatePending(true);

                  try {
                    await action(actualEndGateDate);
                    setActualEndGateOpen(false);
                    actualEndGateActionRef.current = null;
                    setActualEndGateTaskId(null);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to update actual end.");
                  } finally {
                    setActualEndGatePending(false);
                  }
                });
              }}
              disabled={actualEndGatePending || !actualEndGateDate}
            >
              {actualEndGatePending ? <Spinner /> : null}
              Save actual end
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

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
        baselineCapturedAt={plan.project.baselineCapturedAt}
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
