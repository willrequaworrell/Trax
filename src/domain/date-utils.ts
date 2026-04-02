const DAY_MS = 24 * 60 * 60 * 1000;

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

export function formatIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function isBusinessDay(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

export function clampToBusinessDay(iso: string, direction: 1 | -1 = 1) {
  let cursor = parseIsoDate(iso);

  while (!isBusinessDay(cursor)) {
    cursor = new Date(cursor.getTime() + direction * DAY_MS);
  }

  return formatIsoDate(cursor);
}

export function shiftBusinessDays(iso: string, offset: number) {
  let cursor = parseIsoDate(iso);
  const direction = offset >= 0 ? 1 : -1;
  let remaining = Math.abs(offset);

  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + direction * DAY_MS);

    if (isBusinessDay(cursor)) {
      remaining -= 1;
    }
  }

  return formatIsoDate(cursor);
}

export function finishToStartSuccessorDate(finish: string, lagDays: number) {
  return shiftBusinessDays(finish, lagDays + 1);
}

export function addDurationToStart(start: string, durationDays: number) {
  if (durationDays <= 1) {
    return start;
  }

  return shiftBusinessDays(start, durationDays - 1);
}

export function businessDaysInclusive(start: string, end: string) {
  let cursor = parseIsoDate(start);
  const finish = parseIsoDate(end);
  let count = 0;

  while (cursor <= finish) {
    if (isBusinessDay(cursor)) {
      count += 1;
    }

    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return Math.max(count, 1);
}

export function compareIsoDates(a: string, b: string) {
  return a.localeCompare(b);
}

export function maxIsoDate(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

export function minIsoDate(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(0) ?? null;
}

export function businessDayShiftGap(from: string, to: string) {
  if (compareIsoDates(to, from) <= 0) {
    return 0;
  }

  let cursor = from;
  let gap = 0;

  while (compareIsoDates(cursor, to) < 0) {
    cursor = shiftBusinessDays(cursor, 1);
    gap += 1;
  }

  return gap;
}
