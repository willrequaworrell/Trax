"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowsInLineHorizontal,
  ArrowsOutLineVertical,
  CaretDown,
  CaretRight,
  Check,
  DownloadSimple,
  GitBranch,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";

import { computeCheckpointPercent } from "@/domain/checkpoints";
import type { Checkpoint, PlannedTask, Project, ProjectPlan, TaskType } from "@/domain/planner";
import { isoToday, shiftBusinessDays } from "@/domain/date-utils";
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

const LIST_GRID_CLASS = "grid-cols-[minmax(240px,1.7fr)_140px_170px_120px_120px_minmax(160px,1fr)_56px]";
const GANTT_NAME_COLUMN_WIDTH = 320;
const GANTT_DEFAULT_COLUMN_WIDTH = 48;
const GANTT_MAX_COLUMN_WIDTH = 96;
const GANTT_ZOOM_STEP = 12;
const LIST_DEPTH_INDENT = 18;
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
  return barStyleForRange(task.computedPlannedStart, task.computedPlannedEnd, timeline);
}

function barStyleForRange(start: string | null, end: string | null, timeline: string[]) {
  if (!start || !end || timeline.length === 0) {
    return { left: "0%", width: "0%" };
  }

  const startIndex = Math.max(0, timeline.indexOf(start));
  const endIndex = Math.max(startIndex, timeline.indexOf(end));
  const left = (startIndex / Math.max(timeline.length, 1)) * 100;
  const width = ((endIndex - startIndex + 1) / Math.max(timeline.length, 1)) * 100;

  return { left: `${left}%`, width: `${Math.max(width, 4)}%` };
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
      shellClass: "bg-black/18 border-black/12",
      fillClass: "bg-black/72",
      textClass: "text-black/82",
    };
  }

  if (task.type === "milestone") {
    return {
      shellClass: "bg-black/24 border-black/14",
      fillClass: "bg-black/88",
      textClass: "text-white",
    };
  }

  return {
    shellClass: "bg-black/14 border-black/10",
    fillClass: "bg-black/68",
    textClass: "text-black/78",
  };
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
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      initialPlan.tasks.map((task) => [task.id, task.hasChildren || task.checkpoints.length > 0 ? false : task.isExpanded]),
    ),
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
  const [activeCheckpointCell, setActiveCheckpointCell] = useState<{
    checkpointId: string;
    field: CheckpointEditableField;
  } | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const [checkpointDrafts, setCheckpointDrafts] = useState<Record<string, CheckpointDraft>>({});
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [pendingCheckpointIds, setPendingCheckpointIds] = useState<Record<string, boolean>>({});
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  const [ganttColumnWidth, setGanttColumnWidth] = useState(GANTT_DEFAULT_COLUMN_WIDTH);
  const [baselineGateOpen, setBaselineGateOpen] = useState(false);
  const [baselineGatePending, setBaselineGatePending] = useState(false);
  const [baselineGateContent, setBaselineGateContent] = useState({
    title: "Freeze baseline first",
    description: "Freeze the current forecast as the project baseline before recording execution progress.",
  });
  const [actualEndGateOpen, setActualEndGateOpen] = useState(false);
  const [actualEndGatePending, setActualEndGatePending] = useState(false);
  const [actualEndGateTaskId, setActualEndGateTaskId] = useState<string | null>(null);
  const [actualEndGateDate, setActualEndGateDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ganttViewportRef = useRef<HTMLDivElement | null>(null);
  const undoToastIdsRef = useRef<Set<string>>(new Set());
  const baselineGateActionRef = useRef<(() => Promise<void>) | null>(null);
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
    setExpandedMap((current) => {
      const next = { ...current };

      for (const task of plan.tasks) {
        if (!(task.id in next)) {
          next[task.id] = task.hasChildren || task.checkpoints.length > 0 ? false : task.isExpanded;
        }
      }

      return next;
    });
  }, [plan.tasks]);

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
        : actualDisplayStart(task);
    const nextActualEnd =
      patch.actualEnd !== undefined
        ? (patch.actualEnd as string | null)
        : actualDisplayEnd(task);
    const nextPercent =
      patch.percentComplete !== undefined
        ? Number(patch.percentComplete)
        : task.percentComplete;

    return Boolean(nextActualStart || nextActualEnd || nextPercent > 0);
  }

  function patchNeedsActualEnd(task: PlannedTask, patch: Record<string, unknown>) {
    const nextPercent =
      patch.percentComplete !== undefined
        ? Number(patch.percentComplete)
        : task.percentComplete;
    const nextActualEnd =
      patch.actualEnd !== undefined
        ? (patch.actualEnd as string | null)
        : actualDisplayEnd(task);

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

  async function patchTaskRequest(task: PlannedTask, patch: Record<string, unknown>, successMessage?: string) {
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

      return nextPlan;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task.");
      return null;
    } finally {
      markTaskPending(task.id, false);
    }
  }

  function patchTask(task: PlannedTask, patch: Record<string, unknown>, successMessage?: string) {
    if (patchNeedsActualEnd(task, patch)) {
      openActualEndGate(task, async (actualEnd) => {
        const nextPatch = { ...patch, actualEnd };

        if (!plan.project.baselineCapturedAt && patchHasExecutionSignal(task, nextPatch)) {
          openBaselineGate(
            {
              title: "Freeze baseline before completing work",
              description: "Actual dates and progress need a committed baseline first. Freeze the current forecast, then finish the task.",
            },
            async () => {
              await freezeBaselineRequest(false);
              await patchTaskRequest(task, nextPatch, successMessage);
            },
          );
          return;
        }

        await patchTaskRequest(task, nextPatch, successMessage);
      });
      return;
    }

    if (!plan.project.baselineCapturedAt && patchHasExecutionSignal(task, patch)) {
      openBaselineGate(
        {
          title: "Freeze baseline before recording progress",
          description: "Execution updates should compare against a frozen baseline. Freeze the current forecast first, then continue.",
        },
        async () => {
          await freezeBaselineRequest(false);
          await patchTaskRequest(task, patch, successMessage);
        },
      );
      return;
    }

    void patchTaskRequest(task, patch, successMessage);
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

    if (nextPercent >= 100 && !actualDisplayEnd(parentTask)) {
      openActualEndGate(parentTask, async (actualEnd) => {
        if (!plan.project.baselineCapturedAt) {
          openBaselineGate(
            {
              title: "Freeze baseline before finishing work",
              description: "Checkpoint-driven completion still needs a committed baseline first. Freeze the current forecast, then continue.",
            },
            async () => {
              await freezeBaselineRequest(false);
              await patchTaskRequest(parentTask, { actualEnd });
              await saveCheckpointRequest(taskId, checkpoint, draft);
            },
          );
          return;
        }

        const updatedPlan = await patchTaskRequest(parentTask, { actualEnd });

        if (updatedPlan) {
          await saveCheckpointRequest(taskId, checkpoint, draft);
        }
      });
      return;
    }

    if (!plan.project.baselineCapturedAt && nextPercent > 0) {
      openBaselineGate(
        {
          title: "Freeze baseline before recording checkpoint progress",
          description: "Checkpoint progress is part of actual execution. Freeze the current forecast first, then continue.",
        },
        async () => {
          await freezeBaselineRequest(false);
          await saveCheckpointRequest(taskId, checkpoint, draft);
        },
      );
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

  function forecastVarianceLabel(task: PlannedTask) {
    if (!task.computedBaselinePlannedEnd || !task.computedPlannedEnd) {
      return null;
    }

    const delta = signedBusinessDayGap(task.computedBaselinePlannedEnd, task.computedPlannedEnd);

    if (delta === 0) {
      return "On baseline";
    }

    return delta > 0 ? `+${delta}d late` : `${Math.abs(delta)}d early`;
  }

  function taskComparisonItems(task: PlannedTask) {
    const items: string[] = [];

    if (task.computedBaselinePlannedStart || task.computedBaselinePlannedEnd) {
      items.push(
        `Baseline: ${formatShortDate(task.computedBaselinePlannedStart)} → ${formatShortDate(task.computedBaselinePlannedEnd)}`,
      );
    }

    const variance = forecastVarianceLabel(task);
    if (variance) {
      items.push(variance);
    }

    return items;
  }

  function renderListDateValue(task: PlannedTask, field: "start" | "due") {
    const actualValue = field === "start" ? actualDisplayStart(task) : actualDisplayEnd(task);
    const forecastValue = field === "start" ? plannerDisplayStart(task) : plannerDisplayEnd(task);
    const isEditableForecast = !task.isSummary;
    const isFieldActive = isCellActive(task.id, field);
    const isTaskPending = Boolean(pendingTaskIds[task.id]);

    return (
      <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
        {isEditableForecast && isFieldActive ? (
          <DatePickerField
            value={forecastValue}
            open
            onOpenChange={(open) => {
              if (!open) {
                setActiveCell(null);
              }
            }}
            onChange={(value) => {
              setActiveCell(null);
              void patchTask(
                task,
                field === "start"
                  ? buildSchedulePatch(task, { plannedStart: value })
                  : buildSchedulePatch(task, { plannedEnd: value }),
              );
            }}
            disabled={isTaskPending}
            className="flex-nowrap"
            triggerClassName="w-full"
          />
        ) : (
          <button
            className={cn(
              isEditableForecast ? cellButtonClass(task.id, field) : "w-full rounded-2xl px-2 py-1 text-left",
              "flex items-center gap-2 py-1 text-sm",
            )}
            onClick={isEditableForecast ? () => setActiveCell({ taskId: task.id, field }) : undefined}
            disabled={isTaskPending}
          >
            <span className="truncate text-foreground">{formatShortDate(actualValue)}</span>
            <span className="shrink-0 text-muted-foreground/70">/</span>
            <span className="truncate text-muted-foreground">{formatShortDate(forecastValue)}</span>
          </button>
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
    const progressChanged = currentProgress !== task.percentComplete;
    const progressActive = isCellActive(task.id, "progress");
    const dependenciesActive = isCellActive(task.id, "dependencies");

    return (
      <>
        <div>
          <button className={cn(cellButtonClass(task.id, "progress"), "cursor-default")} disabled>
            <Badge variant={statusVariant(task.rolledUpStatus)}>{statusLabel(task.rolledUpStatus)}</Badge>
          </button>
        </div>

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
                    disabled={isPending}
                  >
                    <SliderTrack>
                      <SliderRange />
                    </SliderTrack>
                    <SliderThumb />
                  </SliderRoot>
                  <div className="flex justify-end">
                    <Button
                      size="icon-xs"
                      onClick={() => {
                        const nextValue = Number(progressDrafts[task.id] ?? task.percentComplete);
                        setActiveCell(null);
                        setProgressDrafts((current) => {
                          const next = { ...current };
                          delete next[task.id];
                          return next;
                        });
                        void patchTask(task, { percentComplete: nextValue });
                      }}
                      disabled={isPending || !progressChanged}
                    >
                      <Check className="size-3.5" />
                      <span className="sr-only">Save progress</span>
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
    const comparisonItems = taskComparisonItems(task);

        const row = (
      <div
        className={cn(
          "group relative grid items-center overflow-hidden border-b border-border/60 px-4 py-2 transition-colors",
          LIST_GRID_CLASS,
          depthTintClass(depth, "task"),
          isSummaryRow ? "cursor-pointer" : "cursor-default",
        )}
        onClick={isSummaryRow ? () => void toggleTask(task.id) : undefined}
      >
        <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * LIST_DEPTH_INDENT}px` }}>
          {hasExpandableContent ? (
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
            <span aria-hidden className="inline-flex size-7 items-center justify-center" />
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
                {comparisonItems.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {comparisonItems.map((item) => (
                      <span
                        key={`${task.id}-${item}`}
                        className="inline-flex max-w-full truncate rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
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
    const barTone = ganttBarTone(task);
    const showCompletedActual = Boolean(actualStart && actualEnd);
    const showInProgressActual = Boolean(actualStart && !actualEnd);
    const showForecastBar = !showCompletedActual;

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
              <div
                className="absolute top-4 h-8 rounded-2xl border border-black/10 bg-black/8"
                style={baselineStyle}
              />
            ) : null}
            {showForecastBar ? (
              <div
                className={cn(
                  "absolute top-3 flex h-10 items-center overflow-hidden rounded-2xl border px-3 text-sm font-medium shadow-sm",
                  barTone.shellClass,
                  barTone.textClass,
                )}
                style={forecastStyle}
              >
                <div className="relative z-10 flex w-full items-center justify-end">
                  <span className="text-xs font-semibold">{percent}%</span>
                </div>
              </div>
            ) : null}
            {showInProgressActual ? (
              <div
                className={cn(
                  "absolute top-3 h-10 rounded-2xl shadow-sm",
                  barTone.fillClass,
                )}
                style={actualStyle}
              />
            ) : null}
            {showCompletedActual ? (
              <div
                className={cn(
                  "absolute top-3 flex h-10 items-center overflow-hidden rounded-2xl border px-3 text-sm font-medium shadow-sm",
                  barTone.shellClass,
                  barTone.textClass,
                )}
                style={actualStyle}
              >
                <div
                  className={cn(
                    "absolute inset-0 rounded-2xl",
                    barTone.fillClass,
                  )}
                />
                <div className="relative z-10 flex w-full items-center justify-end">
                  <span className="text-xs font-semibold">{percent}%</span>
                </div>
              </div>
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
                  {plan.project.baselineCapturedAt ? (
                    <Badge variant="secondary">Baseline frozen {new Date(plan.project.baselineCapturedAt).toLocaleDateString()}</Badge>
                  ) : null}
                  {plan.issues.length > 0 ? <Badge variant="warning">{plan.issues.length} issues</Badge> : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setRebaseOpen(true)}>
                  Rebase schedule
                </Button>
                <Button variant="outline" onClick={() => void freezeBaseline()}>
                  {plan.project.baselineCapturedAt ? "Reset baseline" : "Freeze baseline"}
                </Button>
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
                <span className="space-y-1">
                  <span className="block">Start</span>
                  <span className="block text-[10px] font-medium normal-case tracking-normal text-muted-foreground/80">Actual / Forecast</span>
                </span>
                <span className="space-y-1">
                  <span className="block">Due</span>
                  <span className="block text-[10px] font-medium normal-case tracking-normal text-muted-foreground/80">Actual / Forecast</span>
                </span>
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
