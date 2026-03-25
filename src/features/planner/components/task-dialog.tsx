"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FlowArrow, Link as LinkIcon, Trash } from "@phosphor-icons/react";

import type { Dependency, PlannedMode, PlannedTask, ProjectPlan, TaskCreateResult, TaskType } from "@/domain/planner";
import { isoToday } from "@/domain/date-utils";
import { DatePickerField } from "@/features/planner/components/date-picker-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { TabsList, TabsRoot, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Draft = {
  name: string;
  notes: string;
  parentId: string | null;
  type: TaskType;
  plannedMode: PlannedMode | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedDurationDays: number | null;
  actualStart: string | null;
  actualEnd: string | null;
  percentComplete: number;
};

type DependencyMode = "blockedBy" | "blocks";

type DependencyDraft = {
  mode: DependencyMode;
  taskId: string;
  type: Dependency["type"];
  lagDays: number;
};

type PendingDependency = {
  id: string;
  mode: DependencyMode;
  taskId: string;
  type: Dependency["type"];
  lagDays: number;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  projectId: string;
  task: PlannedTask | null;
  baselineCapturedAt: string | null;
  parentId: string | null;
  type: TaskType;
  tasks: PlannedTask[];
  onOpenChange: (open: boolean) => void;
  onPlanChange: (plan: ProjectPlan) => void;
  createParentLocked?: boolean;
  allowedCreateTypes?: TaskType[];
};

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

function toDraft(task: PlannedTask | null, parentId: string | null, type: TaskType): Draft {
  if (!task) {
    return {
      name: "",
      notes: "",
      parentId,
      type,
      plannedMode: type === "summary" ? null : "start_duration",
      plannedStart: null,
      plannedEnd: null,
      plannedDurationDays: type === "summary" ? null : type === "milestone" ? 0 : 1,
      actualStart: null,
      actualEnd: null,
      percentComplete: 0,
    };
  }

  return {
    name: task.name,
    notes: task.notes,
    parentId: task.parentId,
    type: task.type,
    plannedMode: task.plannedMode,
    plannedStart: task.plannedStart ?? task.computedPlannedStart,
    plannedEnd: task.plannedEnd ?? task.computedPlannedEnd,
    plannedDurationDays: task.plannedDurationDays ?? task.computedPlannedDurationDays,
    actualStart: task.actualStart,
    actualEnd: task.actualEnd,
    percentComplete: task.percentComplete,
  };
}

function createPendingDependencyId() {
  return `draft-dep-${crypto.randomUUID()}`;
}

const TOP_LEVEL_PARENT_VALUE = "__top_level__";

export function TaskDialog({
  open,
  mode,
  projectId,
  task,
  baselineCapturedAt,
  parentId,
  type,
  tasks,
  onOpenChange,
  onPlanChange,
  createParentLocked = false,
  allowedCreateTypes = ["task", "summary", "milestone"],
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(task, parentId, type));
  const [dependencyDraft, setDependencyDraft] = useState<DependencyDraft>({
    mode: "blockedBy",
    taskId: "",
    type: "FS",
    lagDays: 0,
  });
  const [pendingDependencies, setPendingDependencies] = useState<PendingDependency[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [baselineGateOpen, setBaselineGateOpen] = useState(false);
  const [baselineGatePending, setBaselineGatePending] = useState(false);
  const [actualEndGateOpen, setActualEndGateOpen] = useState(false);
  const [actualEndGatePending, setActualEndGatePending] = useState(false);
  const [actualEndDraft, setActualEndDraft] = useState<string | null>(null);
  const baselineGateActionRef = useRef<(() => Promise<void>) | null>(null);
  const actualEndGateActionRef = useRef<((actualEnd: string) => Promise<void>) | null>(null);
  const taskMap = useMemo(() => new Map(tasks.map((item) => [item.id, item])), [tasks]);
  const disallowedParentIds = useMemo(() => {
    if (!task) {
      return new Set<string>();
    }

    const blocked = new Set<string>([task.id]);
    const stack = [...task.childIds];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current || blocked.has(current)) {
        continue;
      }

      blocked.add(current);
      const child = taskMap.get(current);

      if (child) {
        stack.push(...child.childIds);
      }
    }

    return blocked;
  }, [task, taskMap]);
  const summaryTasks = useMemo(
    () => tasks.filter((item) => item.isSummary && !disallowedParentIds.has(item.id)),
    [disallowedParentIds, tasks],
  );
  const leafTasks = useMemo(
    () => tasks.filter((item) => !item.isSummary && item.id !== task?.id),
    [task?.id, tasks],
  );
  const incomingDependencies = task?.blockedBy ?? [];
  const outgoingDependencies = task?.blocking ?? [];
  const isSummaryTask = draft.type === "summary";
  const hasCheckpoints = (task?.checkpoints.length ?? 0) > 0;
  const isSubtaskCreate = mode === "create" && createParentLocked;
  const showCreateTypeTabs = mode === "create" && !isSubtaskCreate;
  const showActualProgress = mode === "edit";
  const showForecastSchedule = !(mode === "create" && isSummaryTask);
  const availableCreateTypes = useMemo(
    () => allowedCreateTypes,
    [allowedCreateTypes],
  );
  const lockedParentName = useMemo(
    () => (parentId ? tasks.find((item) => item.id === parentId)?.name ?? "Selected section" : "Selected section"),
    [parentId, tasks],
  );

  useEffect(() => {
    setDraft(toDraft(task, parentId, type));
    setDependencyDraft({
      mode: "blockedBy",
      taskId: "",
      type: "FS",
      lagDays: 0,
    });
    setPendingDependencies([]);
    setActualEndDraft(task?.actualEnd ?? task?.computedPlannedEnd ?? isoToday());
  }, [mode, parentId, task, type, createParentLocked]);

  function openBaselineGate(action: () => Promise<void>) {
    baselineGateActionRef.current = action;
    setBaselineGateOpen(true);
  }

  function openActualEndGate(action: (actualEnd: string) => Promise<void>) {
    actualEndGateActionRef.current = action;
    setActualEndDraft(draft.actualEnd ?? task?.actualEnd ?? task?.computedPlannedEnd ?? isoToday());
    setActualEndGateOpen(true);
  }

  function draftHasExecutionSignal() {
    return Boolean(draft.actualStart || draft.actualEnd || draft.percentComplete > 0);
  }

  async function requestJson(input: RequestInfo, init?: RequestInit) {
    const response = await fetch(input, init);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new RequestError(payload?.error ?? "Request failed.", payload?.code, payload?.details);
    }

    return payload;
  }

  async function freezeBaselineRequest() {
    const nextPlan = (await requestJson(`/api/projects/${projectId}/freeze-baseline`, {
      method: "POST",
    })) as ProjectPlan;
    onPlanChange(nextPlan);
    return nextPlan;
  }

  async function performSave(override?: Partial<Draft>) {
    const nextDraft = { ...draft, ...override };
    const payload = {
      parentId: nextDraft.parentId,
      name: nextDraft.name.trim(),
      notes: nextDraft.notes,
      type: nextDraft.type,
      plannedMode: isSummaryTask ? null : nextDraft.plannedMode,
      plannedStart: isSummaryTask ? null : nextDraft.plannedStart,
      plannedEnd: isSummaryTask || nextDraft.plannedMode !== "start_end" ? null : nextDraft.plannedEnd,
      plannedDurationDays:
        isSummaryTask ? null : nextDraft.type === "milestone" ? 0 : nextDraft.plannedDurationDays,
      actualStart: isSummaryTask ? null : nextDraft.actualStart,
      actualEnd: isSummaryTask ? null : nextDraft.actualEnd,
      percentComplete: nextDraft.percentComplete,
    };

    if (mode === "edit" && task) {
      const nextPlan = (await requestJson(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as ProjectPlan;

      onPlanChange(nextPlan);
      toast.success("Task updated");
      onOpenChange(false);
      return;
    }

    const created = (await requestJson(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })) as TaskCreateResult;

    let finalPlan = created.plan;
    onPlanChange(finalPlan);

    for (const dependency of pendingDependencies) {
      const dependencyPayload =
        dependency.mode === "blockedBy"
          ? {
              predecessorTaskId: dependency.taskId,
              successorTaskId: created.taskId,
              type: dependency.type,
              lagDays: dependency.lagDays,
            }
          : {
              predecessorTaskId: created.taskId,
              successorTaskId: dependency.taskId,
              type: dependency.type,
              lagDays: dependency.lagDays,
            };
      const dependencyPlan = (await requestJson(`/api/projects/${projectId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dependencyPayload),
      })) as ProjectPlan;
      finalPlan = dependencyPlan;
    }

      onPlanChange(finalPlan);
    toast.success(nextDraft.type === "milestone" ? "Milestone created" : "Task created");
    onOpenChange(false);
  }

  async function handleSave() {
    if (!isSummaryTask && draft.percentComplete >= 100 && !draft.actualEnd) {
      openActualEndGate(async (actualEnd) => {
        setDraft((current) => ({ ...current, actualEnd }));

        if (!baselineCapturedAt && draftHasExecutionSignal()) {
          openBaselineGate(async () => {
            await freezeBaselineRequest();
            setDraft((current) => ({ ...current, actualEnd }));
            setSubmitting(true);

            try {
              await performSave({ actualEnd });
            } finally {
              setSubmitting(false);
            }
          });
          return;
        }

        setSubmitting(true);

        try {
          await performSave({ actualEnd });
        } finally {
          setSubmitting(false);
        }
      });
      return;
    }

    if (mode === "edit" && !isSummaryTask && !baselineCapturedAt && draftHasExecutionSignal()) {
      openBaselineGate(async () => {
        await freezeBaselineRequest();
        setSubmitting(true);

        try {
          await performSave();
        } finally {
          setSubmitting(false);
        }
      });
      return;
    }

    setSubmitting(true);

    try {
      await performSave();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!task) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      const nextPlan = await response.json();

      if (!response.ok) {
        throw new Error(nextPlan.error ?? "Failed to delete task.");
      }

      onPlanChange(nextPlan);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddDependency() {
    if (!dependencyDraft.taskId) {
      return;
    }

    if (!task) {
      setPendingDependencies((current) => [
        ...current,
        {
          id: createPendingDependencyId(),
          mode: dependencyDraft.mode,
          taskId: dependencyDraft.taskId,
          type: dependencyDraft.type,
          lagDays: dependencyDraft.lagDays,
        },
      ]);
      setDependencyDraft({
        mode: "blockedBy",
        taskId: "",
        type: "FS",
        lagDays: 0,
      });
      toast.success("Dependency queued for task creation");
      return;
    }

    try {
      const payload =
        dependencyDraft.mode === "blockedBy"
          ? {
              predecessorTaskId: dependencyDraft.taskId,
              successorTaskId: task.id,
              type: dependencyDraft.type,
              lagDays: dependencyDraft.lagDays,
            }
          : {
              predecessorTaskId: task.id,
              successorTaskId: dependencyDraft.taskId,
              type: dependencyDraft.type,
              lagDays: dependencyDraft.lagDays,
            };
      const response = await fetch(`/api/projects/${projectId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const nextPlan = await response.json();

      if (!response.ok) {
        throw new Error(nextPlan.error ?? "Failed to add dependency.");
      }

      onPlanChange(nextPlan);
      setDependencyDraft({
        mode: "blockedBy",
        taskId: "",
        type: "FS",
        lagDays: 0,
      });
      toast.success("Dependency added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add dependency.");
    }
  }

  async function handleRemoveDependency(dependencyId: string) {
    if (!task) {
      setPendingDependencies((current) => current.filter((dependency) => dependency.id !== dependencyId));
      return;
    }

    try {
      const response = await fetch(`/api/dependencies/${dependencyId}`, { method: "DELETE" });
      const nextPlan = await response.json();

      if (!response.ok) {
        throw new Error(nextPlan.error ?? "Failed to remove dependency.");
      }

      onPlanChange(nextPlan);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove dependency.");
    }
  }

  const visibleIncomingDependencies = task
    ? incomingDependencies.map((dependency) => ({
        id: dependency.id,
        name: taskMap.get(dependency.predecessorTaskId)?.name ?? dependency.predecessorTaskId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      }))
    : pendingDependencies
        .filter((dependency) => dependency.mode === "blockedBy")
        .map((dependency) => ({
          id: dependency.id,
          name: taskMap.get(dependency.taskId)?.name ?? dependency.taskId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }));

  const visibleOutgoingDependencies = task
    ? outgoingDependencies.map((dependency) => ({
        id: dependency.id,
        name: taskMap.get(dependency.successorTaskId)?.name ?? dependency.successorTaskId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      }))
    : pendingDependencies
        .filter((dependency) => dependency.mode === "blocks")
        .map((dependency) => ({
          id: dependency.id,
          name: taskMap.get(dependency.taskId)?.name ?? dependency.taskId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }));

  return (
    <>
      <DialogRoot open={open} onOpenChange={onOpenChange}>
        <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? `Edit ${task?.name ?? "Task"}`
              : isSubtaskCreate
                ? "Add Child Item"
                : "Add to Plan"}
          </DialogTitle>
          <DialogDescription>
            {isSubtaskCreate
              ? "Create a child task, subsection, or milestone inside the selected section. Dependencies can be drafted before the task is saved."
              : "Choose whether to add a task or a summary section, then fill in the relevant planning details."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            {showCreateTypeTabs ? (
              <TabsRoot
                value={draft.type === "summary" ? "summary" : "task"}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    type: value as TaskType,
                    plannedMode: value === "summary" ? null : current.plannedMode ?? "start_duration",
                    plannedDurationDays:
                      value === "summary" ? null : current.type === "milestone" ? 0 : current.plannedDurationDays ?? 1,
                  }))
                }
              >
                <TabsList>
                  <TabsTrigger value="task">Task</TabsTrigger>
                  <TabsTrigger value="summary">Section</TabsTrigger>
                </TabsList>
              </TabsRoot>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task name</label>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Create planning brief"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</label>
                {showCreateTypeTabs ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                    {draft.type === "summary" ? "Summary section" : "Task"}
                  </div>
                ) : (
                  <SelectRoot
                    value={draft.type}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        type: value as TaskType,
                        plannedMode: value === "summary" ? null : current.plannedMode ?? "start_duration",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCreateTypes.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item === "task" ? "Task" : item === "summary" ? "Summary section" : "Milestone"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent section</label>
                {createParentLocked ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-2.5 text-sm text-foreground">
                    {lockedParentName}
                  </div>
                ) : (
                  <SelectRoot
                    value={draft.parentId ?? TOP_LEVEL_PARENT_VALUE}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        parentId: value === TOP_LEVEL_PARENT_VALUE ? null : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select parent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TOP_LEVEL_PARENT_VALUE}>Top level</SelectItem>
                      {summaryTasks.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                )}
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
                <Textarea
                  value={draft.notes}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Meeting notes, acceptance criteria, owner context, or handoff instructions."
                  className="min-h-28"
                />
              </div>
            </div>

            {mode === "edit" ? (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div>
                  <h3 className="font-medium">Baseline schedule</h3>
                  <p className="text-sm text-muted-foreground">
                    {baselineCapturedAt
                      ? `Frozen on ${new Date(baselineCapturedAt).toLocaleDateString()}.`
                      : "No baseline has been frozen for this project yet."}
                  </p>
                </div>
                {isSummaryTask ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline start</p>
                      <p className="mt-2 font-medium">{task?.computedBaselinePlannedStart ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline end</p>
                      <p className="mt-2 font-medium">{task?.computedBaselinePlannedEnd ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline effort</p>
                      <p className="mt-2 font-medium">{task?.computedBaselinePlannedDurationDays ?? 0} business days</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline start</p>
                      <p className="mt-2 font-medium">{task?.baselinePlannedStart ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline end</p>
                      <p className="mt-2 font-medium">{task?.baselinePlannedEnd ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Baseline duration</p>
                      <p className="mt-2 font-medium">
                        {task?.baselinePlannedDurationDays ?? (task?.type === "milestone" ? 0 : "Not set")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {showForecastSchedule ? (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Forecast schedule</h3>
                    <p className="text-sm text-muted-foreground">Update the working schedule. Downstream dependent forecast tasks will replan from these changes.</p>
                  </div>
                  {!isSummaryTask ? (
                    <SelectRoot
                      value={draft.plannedMode ?? "start_duration"}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, plannedMode: value as PlannedMode }))
                      }
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Planning mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="start_duration">Start + duration</SelectItem>
                        <SelectItem value="start_end">Start + due date</SelectItem>
                      </SelectContent>
                    </SelectRoot>
                  ) : null}
                </div>

                {isSummaryTask ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Computed start</p>
                      <p className="mt-2 font-medium">{task?.computedPlannedStart ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Computed end</p>
                      <p className="mt-2 font-medium">{task?.computedPlannedEnd ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rolled-up effort</p>
                      <p className="mt-2 font-medium">{task?.rolledUpEffortDays ?? 0} business days</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planned start</label>
                      <DatePickerField
                        value={draft.plannedStart}
                        onChange={(value) => setDraft((current) => ({ ...current, plannedStart: value }))}
                      />
                    </div>
                    {draft.plannedMode === "start_end" ? (
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planned due / end</label>
                        <DatePickerField
                          value={draft.plannedEnd}
                          onChange={(value) => setDraft((current) => ({ ...current, plannedEnd: value }))}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planned duration</label>
                        <Input
                          type="number"
                          min={draft.type === "milestone" ? 0 : 1}
                          value={draft.plannedDurationDays ?? 0}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              plannedDurationDays: Number(event.target.value),
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {showActualProgress ? (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div>
                  <h3 className="font-medium">Actual progress</h3>
                  <p className="text-sm text-muted-foreground">Track real execution separately from the planned schedule.</p>
                </div>
                {isSummaryTask ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rolled-up progress</p>
                      <p className="mt-2 font-medium">{task?.rolledUpPercentComplete ?? 0}%</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rolled-up status</p>
                      <p className="mt-2 font-medium">{task?.rolledUpStatus.replaceAll("_", " ") ?? "not started"}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual span</p>
                      <p className="mt-2 font-medium">
                        {task?.computedActualStart ?? "Not set"}{task?.computedActualEnd ? ` → ${task.computedActualEnd}` : ""}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual start</label>
                      <DatePickerField
                        value={draft.actualStart}
                        onChange={(value) => setDraft((current) => ({ ...current, actualStart: value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual end</label>
                      <DatePickerField
                        value={draft.actualEnd}
                        onChange={(value) => setDraft((current) => ({ ...current, actualEnd: value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Percent complete</label>
                        <span className="text-sm font-medium">{draft.percentComplete}%</span>
                      </div>
                      <SliderRoot
                        value={[draft.percentComplete]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(value) => {
                          const nextPercent = value[0] ?? 0;
                          setDraft((current) => ({ ...current, percentComplete: nextPercent }));

                          if (nextPercent >= 100 && !draft.actualEnd) {
                            openActualEndGate(async (actualEnd) => {
                              setDraft((current) => ({ ...current, actualEnd }));
                            });
                          }
                        }}
                        disabled={hasCheckpoints}
                      >
                        <SliderTrack>
                          <SliderRange />
                        </SliderTrack>
                        <SliderThumb />
                      </SliderRoot>
                      <p className="text-xs text-muted-foreground">
                        {hasCheckpoints
                          ? "This task's percent complete is derived from its checkpoints in the planner list."
                          : "Use 5% increments to keep progress updates consistent."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {mode === "edit" && task && !isSummaryTask ? (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div>
                  <h3 className="font-medium">Checkpoints</h3>
                  <p className="text-sm text-muted-foreground">
                    Tasks keep their own dates and dependencies. Checkpoints track execution detail and can drive task progress from the planner list.
                  </p>
                </div>
                {task.checkpoints.length > 0 ? (
                  <div className="space-y-2">
                    {task.checkpoints.map((checkpoint) => (
                      <div
                        key={checkpoint.id}
                        className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-medium">{checkpoint.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {checkpoint.percentComplete}% complete • {checkpoint.weightPoints} pts
                          </p>
                        </div>
                        <Badge variant="secondary">{checkpoint.percentComplete >= 100 ? "Done" : "Checkpoint"}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                    No checkpoints yet. Add them from the task menu in the planner list.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-5">
            <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div>
                <h3 className="font-medium">Dependencies</h3>
                <p className="text-sm text-muted-foreground">
                  Manage what blocks this task and what it blocks. In create mode, dependencies are queued and saved once the task exists.
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Blocked by</p>
                {visibleIncomingDependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No predecessor dependencies.</p>
                ) : (
                  visibleIncomingDependencies.map((dependency) => (
                    <div key={dependency.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{dependency.type}</Badge>
                          <span className="text-sm font-medium">{dependency.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Lag: {dependency.lagDays} business days</p>
                      </div>
                      <Button type="button" variant="outline" size="xs" onClick={() => void handleRemoveDependency(dependency.id)}>
                        <Trash />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Blocks</p>
                {visibleOutgoingDependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No successor dependencies.</p>
                ) : (
                  visibleOutgoingDependencies.map((dependency) => (
                    <div key={dependency.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{dependency.type}</Badge>
                          <span className="text-sm font-medium">{dependency.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Lag: {dependency.lagDays} business days</p>
                      </div>
                      <Button type="button" variant="outline" size="xs" onClick={() => void handleRemoveDependency(dependency.id)}>
                        <Trash />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {!isSummaryTask ? (
                <div className="space-y-3 rounded-xl border border-dashed border-border/70 bg-background/70 p-3">
                  <div className="flex items-center gap-2">
                    <FlowArrow className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Add dependency</p>
                  </div>
                  <div className="grid gap-3">
                    <SelectRoot
                      value={dependencyDraft.mode}
                      onValueChange={(value) =>
                        setDependencyDraft((current) => ({
                          ...current,
                          mode: value as DependencyMode,
                          taskId: "",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Dependency direction" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blockedBy">Blocked by</SelectItem>
                        <SelectItem value="blocks">Blocks</SelectItem>
                      </SelectContent>
                    </SelectRoot>
                    <SelectRoot
                      value={dependencyDraft.taskId || undefined}
                      onValueChange={(value) =>
                        setDependencyDraft((current) => ({
                          ...current,
                          taskId: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select task" />
                      </SelectTrigger>
                      <SelectContent>
                        {leafTasks.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectRoot>
                    <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                      <SelectRoot
                        value={dependencyDraft.type}
                        onValueChange={(value) =>
                          setDependencyDraft((current) => ({
                            ...current,
                            type: value as Dependency["type"],
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Dependency type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FS">Finish → Start</SelectItem>
                          <SelectItem value="SS">Start → Start</SelectItem>
                          <SelectItem value="FF">Finish → Finish</SelectItem>
                          <SelectItem value="SF">Start → Finish</SelectItem>
                        </SelectContent>
                      </SelectRoot>
                      <Input
                        type="number"
                        value={dependencyDraft.lagDays}
                        onChange={(event) =>
                          setDependencyDraft((current) => ({
                            ...current,
                            lagDays: Number(event.target.value),
                          }))
                        }
                        placeholder="Lag"
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={() => void handleAddDependency()}>
                      <LinkIcon className="size-4" />
                      Add dependency
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  Summary sections can only inherit dependency effects through their descendant tasks.
                </div>
              )}
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          {mode === "edit" && task ? (
            <Button type="button" variant="outline" onClick={() => void handleDelete()} disabled={submitting}>
              {submitting ? <Spinner /> : <Trash className="size-4" />}
              Delete
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={submitting || !draft.name.trim()}>
            {submitting ? <Spinner /> : null}
            Save
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
            <DialogTitle>Freeze baseline first</DialogTitle>
            <DialogDescription>
              Execution updates need a committed baseline to compare against. Freeze the current forecast, then continue with the save.
            </DialogDescription>
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

                void (async () => {
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
                })();
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
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Actual end required</DialogTitle>
            <DialogDescription>
              Completed work needs an actual end date before it can count as done.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual end</label>
              <DatePickerField value={actualEndDraft} onChange={setActualEndDraft} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActualEndGateOpen(false);
                actualEndGateActionRef.current = null;
              }}
              disabled={actualEndGatePending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = actualEndGateActionRef.current;

                if (!action || !actualEndDraft) {
                  toast.error("Choose an actual end date.");
                  return;
                }

                void (async () => {
                  setActualEndGatePending(true);

                  try {
                    await action(actualEndDraft);
                    setActualEndGateOpen(false);
                    actualEndGateActionRef.current = null;
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to save the actual end date.");
                  } finally {
                    setActualEndGatePending(false);
                  }
                })();
              }}
              disabled={actualEndGatePending || !actualEndDraft}
            >
              {actualEndGatePending ? <Spinner /> : null}
              Save actual end
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
