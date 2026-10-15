// Copied from just-every/run-dial src/core/features/availability/windows.ts @ 66d22da8d5c4d7fe2c368ae8d21a2615875abfe4 (MIT).
import { weekdayForDate } from "./timezone";
import type { AvailabilityWindow, DateOverride } from "./engine";

/** A date override replaces recurrence, including a deliberately closed date. */
export function windowsForDate(recurring: AvailabilityWindow[], overrides: DateOverride[], hostDate: string) {
  const override = overrides.find((entry) => entry.hostDate === hostDate);
  if (override) return override.mode === "closed" ? [] : override.windows;
  return recurring.filter((window) => window.weekday === weekdayForDate(hostDate));
}
