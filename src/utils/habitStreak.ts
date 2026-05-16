/**
 * Habit streak calculation — pure functions.
 *
 * Source of truth: HabitEntry documents (one per habit per date).
 *
 * Habit.streakCount + Habit.lastCompletedDate are CACHED views.
 * Always recompute from entries on read; persist back for cross-device
 * consistency, but never trust the cached value without recomputing.
 *
 * Design choices:
 *   • All dates are local YYYY-MM-DD strings, matching the user's wall clock.
 *   • "Today is in progress": if today is a scheduled day but not yet
 *     completed, we still count the streak going back from the previous
 *     scheduled day. The day only counts as "missed" once it has passed.
 *   • Schedule-aware: habits with frequency='specific_days' only break
 *     their streak on scheduled days. Skipping a non-scheduled day never
 *     resets the streak.
 */

import { Habit, HabitEntry } from '../types';

// ─── Local date helpers (DST-safe via noon anchor) ───────────────────────────

/** Today as YYYY-MM-DD in the user's local timezone. */
export function getLocalTodayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as a local Date at noon (avoids DST midnight issues). */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Shift a YYYY-MM-DD by `n` calendar days (negative ok), in local time. */
export function addDaysLocal(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return getLocalTodayString(d);
}

/** Weekday in local time, 0=Sun…6=Sat. */
export function weekdayOf(dateStr: string): number {
  return parseLocalDate(dateStr).getDay();
}

// ─── Habit / entry predicates ────────────────────────────────────────────────

/** Is this entry a positive completion (counts toward streak)? */
export function isEntryCompleted(habit: Habit, entry: HabitEntry | undefined): boolean {
  if (!entry) return false;

  // New three-state model
  if (entry.completion === 'full' || entry.completion === 'micro') return true;
  if (entry.completion === 'none') return false;

  // Legacy boolean habits
  if (entry.done === true) return true;
  if (entry.done === false) return false;

  // Checkpoint habits (e.g. NF/fidget): completed if any checkpoint true
  if (habit.type === 'checkpoint' && entry.checkpoints) {
    return Object.values(entry.checkpoints).some(v => v === true);
  }

  // Numeric habits: anything > 0 counts
  if (habit.type === 'numeric' && typeof entry.value === 'number') {
    return entry.value > 0;
  }

  return false;
}

/** Is `dateStr` a day this habit is scheduled for? */
export function isRequiredDay(habit: Habit, dateStr: string): boolean {
  if (!habit.frequency || habit.frequency === 'daily') return true;

  if (habit.frequency === 'specific_days') {
    const days = habit.specificDays ?? [];
    // No schedule specified — fall back to daily so a malformed habit
    // doesn't silently disable streak tracking.
    if (days.length === 0) return true;
    return days.includes(weekdayOf(dateStr));
  }

  return true;
}

// ─── Streak calculator ──────────────────────────────────────────────────────

/**
 * Current streak — count of consecutive scheduled days completed,
 * looking backward from `today`.
 *
 * @param habit          Habit configuration (frequency + specificDays).
 * @param completedDates Set of YYYY-MM-DD strings where the habit was
 *                       completed (any positive completion state).
 * @param today          Today's date in local YYYY-MM-DD.
 * @param maxLookback    Safety cap on how many days to walk back.
 */
export function calculateStreak(
  habit: Habit,
  completedDates: ReadonlySet<string>,
  today: string,
  maxLookback = 365,
): number {
  // 1. Find the anchor — the most recent scheduled day at or before today.
  let cursor = today;
  let safety = 0;
  while (!isRequiredDay(habit, cursor)) {
    cursor = addDaysLocal(cursor, -1);
    if (++safety > 14) return 0; // no scheduled day in the past 2 weeks
  }

  // 2. "Today is in progress": if the anchor IS today and today isn't done
  //    yet, shift back one scheduled day. An unfinished today shouldn't
  //    punish yesterday's streak — the day only counts as missed once it
  //    has passed.
  if (cursor === today && !completedDates.has(today)) {
    cursor = addDaysLocal(cursor, -1);
    safety = 0;
    while (!isRequiredDay(habit, cursor)) {
      cursor = addDaysLocal(cursor, -1);
      if (++safety > 14) return 0;
    }
  }

  // 3. Walk backward through scheduled days. Count until a miss breaks it.
  let streak = 0;
  for (let i = 0; i < maxLookback; i++) {
    if (!isRequiredDay(habit, cursor)) {
      cursor = addDaysLocal(cursor, -1);
      continue;
    }
    if (completedDates.has(cursor)) {
      streak++;
      cursor = addDaysLocal(cursor, -1);
    } else {
      break; // scheduled day missed → end of streak
    }
  }
  return streak;
}

/** Build the completed-dates set from an entry list. */
export function completedDatesFromEntries(
  habit: Habit,
  entries: HabitEntry[],
): Set<string> {
  const set = new Set<string>();
  for (const e of entries) {
    if (isEntryCompleted(habit, e)) set.add(e.date);
  }
  return set;
}

/**
 * Derive both streak count and most recent completion date.
 * The shape matches what we write back to the Habit document as a cache.
 */
export function deriveStreakState(
  habit: Habit,
  entries: HabitEntry[],
  today: string,
): { streakCount: number; lastCompletedDate?: string } {
  const completed = completedDatesFromEntries(habit, entries);
  const streakCount = calculateStreak(habit, completed, today);
  let lastCompletedDate: string | undefined;
  for (const date of completed) {
    if (!lastCompletedDate || date > lastCompletedDate) lastCompletedDate = date;
  }
  return { streakCount, lastCompletedDate };
}

/**
 * Returns true when the cached streak state on the habit document is
 * stale and should be re-written. Cheap to call.
 */
export function streakStateNeedsWrite(
  habit: Habit,
  derived: { streakCount: number; lastCompletedDate?: string },
): boolean {
  return (
    (habit.streakCount ?? 0) !== derived.streakCount ||
    habit.lastCompletedDate !== derived.lastCompletedDate
  );
}
