export type ServiceErrorCode = "validation_error" | "corrupted_project" | "unauthorized";

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
  constructor(message: string) {
    super(message, "validation_error", 422);
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
