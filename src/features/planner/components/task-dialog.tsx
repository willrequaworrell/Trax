"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FlowArrow, Link as LinkIcon, Trash } from "@phosphor-icons/react";

import type { Dependency, PlannedMode, PlannedTask, ProjectPlan, TaskCreateResult, TaskType } from "@/domain/planner";
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
  status: PlannedTask["status"];
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
  parentId: string | null;
  type: TaskType;
  tasks: PlannedTask[];
  onOpenChange: (open: boolean) => void;
  onPlanChange: (plan: ProjectPlan) => void;
  createParentLocked?: boolean;
  allowedCreateTypes?: TaskType[];
};

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
      status: "not_started",
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
    status: task.status,
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
  const summaryTasks = useMemo(
    () => tasks.filter((item) => item.isSummary && item.parentId === null && item.id !== task?.id),
    [task?.id, tasks],
  );
  const leafTasks = useMemo(
    () => tasks.filter((item) => !item.isSummary && item.id !== task?.id),
    [task?.id, tasks],
  );
  const incomingDependencies = task?.blockedBy ?? [];
  const outgoingDependencies = task?.blocking ?? [];
  const taskMap = useMemo(() => new Map(tasks.map((item) => [item.id, item])), [tasks]);
  const isSummaryTask = draft.type === "summary";
  const isSubtaskCreate = mode === "create" && createParentLocked;
  const showCreateTypeTabs = mode === "create" && !isSubtaskCreate;
  const showActualProgress = mode === "edit";
  const showPlannedSchedule = !(mode === "create" && isSummaryTask);
  const availableCreateTypes = useMemo(
    () => (isSubtaskCreate ? allowedCreateTypes.filter((item) => item !== "summary") : allowedCreateTypes),
    [allowedCreateTypes, isSubtaskCreate],
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
  }, [mode, parentId, task, type, createParentLocked]);

  async function handleSave() {
    setSubmitting(true);

    try {
      const payload = {
        parentId: draft.parentId,
        name: draft.name.trim(),
        notes: draft.notes,
        type: draft.type,
        plannedMode: isSummaryTask ? null : draft.plannedMode,
        plannedStart: isSummaryTask ? null : draft.plannedStart,
        plannedEnd: isSummaryTask || draft.plannedMode !== "start_end" ? null : draft.plannedEnd,
        plannedDurationDays:
          isSummaryTask ? null : draft.type === "milestone" ? 0 : draft.plannedDurationDays,
        actualStart: isSummaryTask ? null : draft.actualStart,
        actualEnd: isSummaryTask ? null : draft.actualEnd,
        status: draft.status,
        percentComplete: draft.percentComplete,
      };

      if (mode === "edit" && task) {
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const nextPlan = await response.json();

        if (!response.ok) {
          throw new Error(nextPlan.error ?? "Failed to save task.");
        }

        onPlanChange(nextPlan);
        toast.success("Task updated");
        onOpenChange(false);
        return;
      }

      const response = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const created = (await response.json()) as TaskCreateResult & { error?: string };

      if (!response.ok) {
        throw new Error(created.error ?? "Failed to save task.");
      }

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
        const dependencyResponse = await fetch(`/api/projects/${projectId}/dependencies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dependencyPayload),
        });
        const dependencyPlan = await dependencyResponse.json();

        if (!dependencyResponse.ok) {
          onPlanChange(finalPlan);
          throw new Error(dependencyPlan.error ?? "Task created, but a dependency could not be saved.");
        }

        finalPlan = dependencyPlan;
      }

      onPlanChange(finalPlan);
      toast.success(draft.type === "milestone" ? "Milestone created" : "Task created");
      onOpenChange(false);
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
      toast.success("Task removed");
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
      toast.success("Dependency removed");
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
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? `Edit ${task?.name ?? "Task"}`
              : isSubtaskCreate
                ? "Add Subtask"
                : "Add to Plan"}
          </DialogTitle>
          <DialogDescription>
            {isSubtaskCreate
              ? "Create a subtask or milestone inside the selected section. Dependencies can be drafted before the task is saved."
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
                    parentId: value === "summary" ? null : current.parentId,
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
                        parentId: value === "summary" ? null : current.parentId,
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
                {draft.type === "summary" ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                    Sections are always top-level.
                  </div>
                ) : createParentLocked ? (
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

            {showPlannedSchedule ? (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Planned schedule</h3>
                    <p className="text-sm text-muted-foreground">Choose between start + duration or start + end date planning.</p>
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
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</label>
                      <SelectRoot
                        value={draft.status}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, status: value as Draft["status"] }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_started">Not started</SelectItem>
                          <SelectItem value="in_progress">In progress</SelectItem>
                          <SelectItem value="blocked">Blocked</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                        </SelectContent>
                      </SelectRoot>
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
                        onValueChange={(value) => setDraft((current) => ({ ...current, percentComplete: value[0] ?? 0 }))}
                      >
                        <SliderTrack>
                          <SliderRange />
                        </SliderTrack>
                        <SliderThumb />
                      </SliderRoot>
                      <p className="text-xs text-muted-foreground">Use 5% increments to keep progress updates consistent.</p>
                    </div>
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
  );
}
