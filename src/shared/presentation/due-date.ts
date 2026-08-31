import { DomainError, type DueValue } from "../domain/model";
import { addCalendarDays, calendarDateAt, startOfCalendarDate } from "../domain/queries";

export type DueDatePreset = "none" | "today" | "tomorrow" | "endOfWeek" | "custom";

export type DueDateFormValue = {
  dueKind: "none" | "allDay";
  dueAtMs: number | null;
};

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getUTCDay();
}

function presetDates(referenceInstantMs: number, viewerTimeZone: string) {
  const today = calendarDateAt(referenceInstantMs, viewerTimeZone);
  const tomorrow = addCalendarDays(today, 1);
  const daysUntilSunday = (7 - dayOfWeek(today)) % 7;
  return { today, tomorrow, endOfWeek: addCalendarDays(today, daysUntilSunday) };
}

export function dueDatePresetForDue(due: DueValue, referenceInstantMs: number, viewerTimeZone: string): DueDatePreset {
  if (due.kind === "none") {
    return "none";
  }
  if (due.kind === "timed") {
    return "custom";
  }

  const dates = presetDates(referenceInstantMs, viewerTimeZone);
  if (due.date === dates.today) {
    return "today";
  }
  if (due.date === dates.tomorrow) {
    return "tomorrow";
  }
  if (due.date === dates.endOfWeek) {
    return "endOfWeek";
  }
  return "custom";
}

export function dueDateFormValueForPreset(
  preset: DueDatePreset,
  customDueAtMs: number | null,
  referenceInstantMs: number,
  viewerTimeZone: string,
): DueDateFormValue {
  if (preset === "none") {
    return { dueKind: "none", dueAtMs: null };
  }

  if (preset === "custom") {
    if (customDueAtMs === null || !Number.isSafeInteger(customDueAtMs)) {
      throw new DomainError("INVALID_DUE_VALUE", "Choose a custom due date");
    }
    return { dueKind: "allDay", dueAtMs: customDueAtMs };
  }

  const date = presetDates(referenceInstantMs, viewerTimeZone)[preset];
  return { dueKind: "allDay", dueAtMs: startOfCalendarDate(date, viewerTimeZone) };
}
