import { DomainError, type Priority, type Task } from "./model";
import { canonicalizeTimeZone, validateCalendarDate, validateNonNegativeInteger } from "./validation";

const PRIORITY_RANK: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export type TodayTask = {
  task: Task;
  status: "overdue" | "dueToday";
  effectiveDueAtMs: number;
};

export type TodayResult = {
  tasks: TodayTask[];
  count: number;
  localDate: string;
  startOfDayMs: number;
  startOfNextDayMs: number;
};

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareOrdinaryTasks(left: Task, right: Task): number {
  return (
    PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority] ||
    left.position - right.position ||
    left.createdAtMs - right.createdAtMs ||
    compareId(left.id, right.id)
  );
}

export function queryInbox(tasks: readonly Task[]): Task[] {
  return tasks
    .filter(
      (task) =>
        task.projectId === null && task.sectionId === null && task.completedAtMs === null && task.trashedAtMs === null,
    )
    .sort(compareOrdinaryTasks);
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timeZone);
  if (existing) {
    return existing;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function calendarDateAtUnchecked(instantMs: number, timeZone: string): string {
  const parts = dateFormatter(timeZone).formatToParts(new Date(instantMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year?.padStart(4, "0")}-${values.month}-${values.day}`;
}

export function calendarDateAt(instantMs: number, timeZone: string): string {
  if (!Number.isSafeInteger(instantMs) || Number.isNaN(new Date(instantMs).getTime())) {
    throw new DomainError("INVALID_ARGUMENT", "Calendar instant must be a valid safe integer");
  }
  const canonicalTimeZone = canonicalizeTimeZone(timeZone);
  return calendarDateAtUnchecked(instantMs, canonicalTimeZone);
}

function utcDateStart(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime();
}

function startOfMinimumCalendarDate(estimate: number, timeZone: string): number {
  let previous = estimate - 2 * MILLISECONDS_PER_DAY;
  const end = estimate + 2 * MILLISECONDS_PER_DAY;
  for (let current = previous + MILLISECONDS_PER_HOUR; current <= end; current += MILLISECONDS_PER_HOUR) {
    if (calendarDateAtUnchecked(current, timeZone) === "0001-01-01") {
      let low = previous + 1;
      let high = current;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (calendarDateAtUnchecked(middle, timeZone) === "0001-01-01") {
          high = middle;
        } else {
          low = middle + 1;
        }
      }
      return low;
    }
    previous = current;
  }
  throw new DomainError("INVALID_DUE_VALUE", "Unable to resolve the minimum calendar date in this timezone");
}

export function addCalendarDays(date: string, days: number): string {
  const validDate = validateCalendarDate(date);
  if (!Number.isSafeInteger(days)) {
    throw new DomainError("INVALID_ARGUMENT", "Calendar day offset must be an integer");
  }
  const value = new Date(utcDateStart(validDate));
  value.setUTCDate(value.getUTCDate() + days);
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function startOfCalendarDate(date: string, timeZone: string): number {
  const validDate = validateCalendarDate(date);
  const canonicalTimeZone = canonicalizeTimeZone(timeZone);
  const estimate = utcDateStart(validDate);
  if (validDate === "0001-01-01") {
    return startOfMinimumCalendarDate(estimate, canonicalTimeZone);
  }
  let low = estimate - 2 * MILLISECONDS_PER_DAY;
  let high = estimate + 2 * MILLISECONDS_PER_DAY;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDateAtUnchecked(middle, canonicalTimeZone) < validDate) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function todayWindow(evaluationInstantMs: number, viewerTimeZone: string) {
  const validInstant = validateNonNegativeInteger(evaluationInstantMs, "Evaluation instant");
  const canonicalTimeZone = canonicalizeTimeZone(viewerTimeZone);
  const localDate = calendarDateAtUnchecked(validInstant, canonicalTimeZone);
  return {
    localDate,
    startOfDayMs: startOfCalendarDate(localDate, canonicalTimeZone),
    startOfNextDayMs: startOfCalendarDate(addCalendarDays(localDate, 1), canonicalTimeZone),
  };
}

export function queryToday(tasks: readonly Task[], evaluationInstantMs: number, viewerTimeZone: string): TodayResult {
  const window = todayWindow(evaluationInstantMs, viewerTimeZone);
  const canonicalTimeZone = canonicalizeTimeZone(viewerTimeZone);
  const included: TodayTask[] = [];

  for (const task of tasks) {
    if (task.completedAtMs !== null || task.trashedAtMs !== null || task.due.kind === "none") {
      continue;
    }
    if (task.due.kind === "allDay") {
      if (task.due.date <= window.localDate) {
        included.push({
          task,
          status: task.due.date < window.localDate ? "overdue" : "dueToday",
          effectiveDueAtMs: startOfCalendarDate(task.due.date, canonicalTimeZone),
        });
      }
      continue;
    }
    if (task.due.instantMs < window.startOfNextDayMs) {
      included.push({
        task,
        status: task.due.instantMs < window.startOfDayMs ? "overdue" : "dueToday",
        effectiveDueAtMs: task.due.instantMs,
      });
    }
  }

  included.sort(
    (left, right) =>
      Number(left.status === "dueToday") - Number(right.status === "dueToday") ||
      left.effectiveDueAtMs - right.effectiveDueAtMs ||
      compareOrdinaryTasks(left.task, right.task),
  );

  return { tasks: included, count: included.length, ...window };
}
