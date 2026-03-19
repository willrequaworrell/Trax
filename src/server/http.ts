export async function readJson<T>(request: Request) {
  return (await request.json()) as T;
}

export function jsonOk(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
