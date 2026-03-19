import { isServiceError } from "@/server/errors";

export async function readJson<T>(request: Request) {
  return (await request.json()) as T;
}

export function jsonOk(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function jsonError(message: string, status = 400, code?: string, details?: string[]) {
  return Response.json({ error: message, code, details }, { status });
}

export function jsonServiceError(error: unknown, fallbackMessage: string) {
  if (isServiceError(error)) {
    return jsonError(error.message, error.status, error.code, error.details);
  }

  return jsonError(error instanceof Error ? error.message : fallbackMessage);
}
