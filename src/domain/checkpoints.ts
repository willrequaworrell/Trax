import type { Checkpoint } from "@/domain/planner";

export function computeCheckpointPercent(checkpoints: Array<Pick<Checkpoint, "percentComplete" | "weightPoints">>) {
  if (checkpoints.length === 0) {
    return 0;
  }

  const totalWeight = checkpoints.reduce((sum, checkpoint) => sum + Math.max(checkpoint.weightPoints, 1), 0);

  if (totalWeight === 0) {
    return 0;
  }

  return Math.round(
    checkpoints.reduce(
      (sum, checkpoint) => sum + checkpoint.percentComplete * Math.max(checkpoint.weightPoints, 1),
      0,
    ) / totalWeight,
  );
}
