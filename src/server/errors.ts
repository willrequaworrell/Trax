export type ServiceErrorCode =
  | "validation_error"
  | "corrupted_project"
  | "unauthorized"
  | "baseline_required"
  | "actual_start_required"
  | "actual_end_required";

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: ServiceErrorCode,
    public readonly status: number,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, details?: string[]) {
    super(message, "validation_error", 422, details);
  }
}

export class BaselineRequiredError extends ServiceError {
  constructor(message = "Freeze a baseline before recording execution progress.") {
    super(message, "baseline_required", 422);
  }
}

export class ActualStartRequiredError extends ServiceError {
  constructor(message = "Active tasks must include an actual start date.") {
    super(message, "actual_start_required", 422);
  }
}

export class ActualEndRequiredError extends ServiceError {
  constructor(message = "Completed tasks must include an actual end date.") {
    super(message, "actual_end_required", 422);
  }
}

export class CorruptedProjectError extends ServiceError {
  constructor(projectId: string, issues: string[]) {
    super(
      `Project ${projectId} is corrupted and cannot be opened until its task hierarchy is repaired.`,
      "corrupted_project",
      409,
      issues,
    );
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = "You must sign in to continue.") {
    super(message, "unauthorized", 401);
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
