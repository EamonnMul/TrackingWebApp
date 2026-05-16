/**
 * Tests for habitStreak.ts — run with `npm run test:streak`.
 *
 * Uses Node's built-in `node:test` runner via tsx, no external test framework.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  addDaysLocal,
  calculateStreak,
  completedDatesFromEntries,
  deriveStreakState,
  getLocalTodayString,
  isEntryCompleted,
  isRequiredDay,
  parseLocalDate,
  weekdayOf,
} from './habitStreak';
import { Habit, HabitEntry } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const dailyHabit: Habit = {
  id: 'h-daily',
  name: 'Read',
  frequency: 'daily',
  createdAt: 0,
  archived: false,
};

// Mon, Wed, Fri (1, 3, 5)
const mwfHabit: Habit = {
  id: 'h-mwf',
  name: 'Gym',
  frequency: 'specific_days',
  specificDays: [1, 3, 5],
  createdAt: 0,
  archived: false,
};

// Known calendar references — verified manually.
const WED = '2024-01-03'; // Wednesday
const THU = '2024-01-04'; // Thursday
const FRI = '2024-01-05'; // Friday
const SAT = '2024-01-06'; // Saturday
const MON = '2024-01-01'; // Monday

function entry(habitId: string, date: string, completion: 'full' | 'micro' | 'none' = 'full'): HabitEntry {
  return { id: `${habitId}_${date}`, habitId, date, completion, createdAt: 0 };
}

// ─── Date helpers ────────────────────────────────────────────────────────────

describe('local date helpers', () => {
  test('weekdayOf identifies weekdays in local time', () => {
    assert.equal(weekdayOf(MON), 1);
    assert.equal(weekdayOf(WED), 3);
    assert.equal(weekdayOf(SAT), 6);
  });

  test('addDaysLocal walks days forward and backward', () => {
    assert.equal(addDaysLocal(WED, 1), THU);
    assert.equal(addDaysLocal(WED, -1), '2024-01-02');
    assert.equal(addDaysLocal(WED, 7), '2024-01-10');
    assert.equal(addDaysLocal(WED, -7), '2023-12-27');
  });

  test('addDaysLocal is DST-safe (US spring-forward)', () => {
    assert.equal(addDaysLocal('2024-03-09', 1), '2024-03-10');
    assert.equal(addDaysLocal('2024-03-10', 1), '2024-03-11');
    assert.equal(addDaysLocal('2024-03-09', 2), '2024-03-11');
  });

  test('addDaysLocal is DST-safe (US fall-back)', () => {
    assert.equal(addDaysLocal('2024-11-02', 1), '2024-11-03');
    assert.equal(addDaysLocal('2024-11-03', 1), '2024-11-04');
  });

  test('getLocalTodayString uses local components, not UTC', () => {
    // Late-evening case: shouldn't roll over to tomorrow.
    assert.equal(getLocalTodayString(new Date(2024, 5, 15, 23, 45)), '2024-06-15');
    // Early-morning case: shouldn't fall back to yesterday.
    assert.equal(getLocalTodayString(new Date(2024, 5, 15, 0, 15)), '2024-06-15');
  });

  test('parseLocalDate anchors at noon (DST-safe)', () => {
    const d = parseLocalDate(WED);
    assert.equal(d.getFullYear(), 2024);
    assert.equal(d.getMonth(), 0);
    assert.equal(d.getDate(), 3);
    assert.equal(d.getHours(), 12);
  });
});

// ─── Required-day predicate ─────────────────────────────────────────────────

describe('isRequiredDay', () => {
  test('daily is always required', () => {
    assert.equal(isRequiredDay(dailyHabit, MON), true);
    assert.equal(isRequiredDay(dailyHabit, THU), true);
    assert.equal(isRequiredDay(dailyHabit, SAT), true);
  });

  test('specific_days respects schedule', () => {
    assert.equal(isRequiredDay(mwfHabit, MON), true);   // Mon
    assert.equal(isRequiredDay(mwfHabit, '2024-01-02'), false); // Tue
    assert.equal(isRequiredDay(mwfHabit, WED), true);   // Wed
    assert.equal(isRequiredDay(mwfHabit, THU), false);  // Thu
    assert.equal(isRequiredDay(mwfHabit, FRI), true);   // Fri
    assert.equal(isRequiredDay(mwfHabit, SAT), false);  // Sat
  });

  test('specific_days with no days falls back to daily', () => {
    const h: Habit = { ...mwfHabit, specificDays: [] };
    assert.equal(isRequiredDay(h, MON), true);
    assert.equal(isRequiredDay(h, THU), true);
  });

  test('legacy habit without frequency defaults to daily', () => {
    const h: Habit = { id: 'x', createdAt: 0, archived: false };
    assert.equal(isRequiredDay(h, MON), true);
  });
});

// ─── Entry completion ───────────────────────────────────────────────────────

describe('isEntryCompleted', () => {
  test('completion=full → true', () => {
    assert.equal(isEntryCompleted(dailyHabit, entry('h', WED, 'full')), true);
  });
  test('completion=micro → true', () => {
    assert.equal(isEntryCompleted(dailyHabit, entry('h', WED, 'micro')), true);
  });
  test('completion=none → false', () => {
    assert.equal(isEntryCompleted(dailyHabit, entry('h', WED, 'none')), false);
  });

  test('undefined entry → false', () => {
    assert.equal(isEntryCompleted(dailyHabit, undefined), false);
  });

  test('legacy done=true → true', () => {
    const e: HabitEntry = { id: 'x', habitId: 'h', date: WED, done: true, createdAt: 0 };
    assert.equal(isEntryCompleted(dailyHabit, e), true);
  });
  test('legacy done=false → false', () => {
    const e: HabitEntry = { id: 'x', habitId: 'h', date: WED, done: false, createdAt: 0 };
    assert.equal(isEntryCompleted(dailyHabit, e), false);
  });

  test('checkpoint habit: any checkpoint true → true', () => {
    const h: Habit = { ...dailyHabit, type: 'checkpoint' };
    const e: HabitEntry = {
      id: 'x', habitId: 'h', date: WED, createdAt: 0,
      checkpoints: { am: true, pm: false, eve: false },
    };
    assert.equal(isEntryCompleted(h, e), true);
  });
  test('checkpoint habit: all false → false', () => {
    const h: Habit = { ...dailyHabit, type: 'checkpoint' };
    const e: HabitEntry = {
      id: 'x', habitId: 'h', date: WED, createdAt: 0,
      checkpoints: { am: false, pm: false, eve: false },
    };
    assert.equal(isEntryCompleted(h, e), false);
  });

  test('numeric habit: value > 0 → true', () => {
    const h: Habit = { ...dailyHabit, type: 'numeric' };
    const e: HabitEntry = { id: 'x', habitId: 'h', date: WED, value: 3, createdAt: 0 };
    assert.equal(isEntryCompleted(h, e), true);
  });
  test('numeric habit: value = 0 → false', () => {
    const h: Habit = { ...dailyHabit, type: 'numeric' };
    const e: HabitEntry = { id: 'x', habitId: 'h', date: WED, value: 0, createdAt: 0 };
    assert.equal(isEntryCompleted(h, e), false);
  });
});

// ─── calculateStreak: daily habits ──────────────────────────────────────────

describe('calculateStreak — daily habits', () => {
  test('completed yesterday + today = streak 2', () => {
    const today = WED;
    const set = new Set([addDaysLocal(today, -1), today]);
    assert.equal(calculateStreak(dailyHabit, set, today), 2);
  });

  test('completed two days ago but missed yesterday = streak resets', () => {
    const today = WED;
    const set = new Set([addDaysLocal(today, -2)]);
    assert.equal(calculateStreak(dailyHabit, set, today), 0);
  });

  test('missed several days, today not done = streak 0', () => {
    assert.equal(calculateStreak(dailyHabit, new Set<string>(), WED), 0);
  });

  test('completed today after a missed day = streak 1', () => {
    const today = WED;
    const set = new Set([today]); // yesterday and earlier all missed
    assert.equal(calculateStreak(dailyHabit, set, today), 1);
  });

  test('today not yet done — previous streak still visible', () => {
    const today = WED;
    const set = new Set([
      addDaysLocal(today, -1),
      addDaysLocal(today, -2),
      addDaysLocal(today, -3),
    ]);
    // Today is "in progress" — anchor shifts to yesterday → counts 3.
    assert.equal(calculateStreak(dailyHabit, set, today), 3);
  });

  test('today not yet done + yesterday missed = streak 0', () => {
    const today = WED;
    const set = new Set([addDaysLocal(today, -2)]); // only 2 days ago
    assert.equal(calculateStreak(dailyHabit, set, today), 0);
  });

  test('long streak ending today = full length', () => {
    const today = WED;
    const set = new Set([0, 1, 2, 3, 4, 5, 6].map(i => addDaysLocal(today, -i)));
    assert.equal(calculateStreak(dailyHabit, set, today), 7);
  });

  test('gap inside history breaks streak at the gap', () => {
    const today = WED;
    // Today, yesterday done; 3 days ago done; 2 days ago missed.
    const set = new Set([today, addDaysLocal(today, -1), addDaysLocal(today, -3)]);
    assert.equal(calculateStreak(dailyHabit, set, today), 2);
  });
});

// ─── calculateStreak: specific_days habits ──────────────────────────────────

describe('calculateStreak — specific_days (M/W/F)', () => {
  test('today=Wed, done last Mon + this Wed = streak 2', () => {
    const today = WED; // Wed
    const set = new Set([MON, WED]); // Mon, Wed
    assert.equal(calculateStreak(mwfHabit, set, today), 2);
  });

  test('non-scheduled day skipped does not break streak', () => {
    // today=Thu (not scheduled). Last Mon + Wed done.
    const today = THU;
    const set = new Set([MON, WED]);
    assert.equal(calculateStreak(mwfHabit, set, today), 2);
  });

  test('today=Wed, last Mon done but Wed not done yet (in progress)', () => {
    // Anchor shifts to last Mon → streak 1 (Mon counts; previous Fri not done).
    const today = WED;
    const set = new Set([MON]);
    assert.equal(calculateStreak(mwfHabit, set, today), 1);
  });

  test('today=Thu, missed yesterday Wed = streak 0', () => {
    // Wed scheduled and missed (now past) → resets.
    const today = THU;
    const set = new Set([MON]); // only Mon was done, Wed missed
    assert.equal(calculateStreak(mwfHabit, set, today), 0);
  });

  test('today=Fri, all of Mon+Wed+Fri done = streak 3', () => {
    const today = FRI;
    const set = new Set([MON, WED, FRI]);
    assert.equal(calculateStreak(mwfHabit, set, today), 3);
  });

  test('today=Sat (non-scheduled), all scheduled this week done = streak 3', () => {
    const today = SAT;
    const set = new Set([MON, WED, FRI]);
    assert.equal(calculateStreak(mwfHabit, set, today), 3);
  });

  test('streak spans across weeks', () => {
    const today = '2024-01-10'; // Wed
    // Previous Mon (1/8), previous Fri (1/5), previous Wed (1/3),
    // previous Mon (1/1) — 4 consecutive scheduled days
    const set = new Set(['2024-01-10', '2024-01-08', '2024-01-05', '2024-01-03', '2024-01-01']);
    assert.equal(calculateStreak(mwfHabit, set, today), 5);
  });
});

// ─── Multi-day-away — the user's primary bug ────────────────────────────────

describe('multi-day-away scenarios (the reported bug)', () => {
  test('Mon+Tue done, app reopened on Sat = streak 0 (Wed/Thu/Fri missed)', () => {
    const today = '2024-01-06'; // Sat
    const entries: HabitEntry[] = [
      entry('h', '2024-01-01'), // Mon
      entry('h', '2024-01-02'), // Tue
    ];
    const r = deriveStreakState(dailyHabit, entries, today);
    assert.equal(r.streakCount, 0);
    assert.equal(r.lastCompletedDate, '2024-01-02');
  });

  test('Long streak then big gap then today done = streak 1', () => {
    const today = '2024-01-20';
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
    const entries = dates.map(d => entry('h', d)).concat(entry('h', today));
    const r = deriveStreakState(dailyHabit, entries, today);
    assert.equal(r.streakCount, 1);
    assert.equal(r.lastCompletedDate, today);
  });

  test('today already done after a miss yesterday = streak 1', () => {
    const today = WED;
    const entries: HabitEntry[] = [
      entry('h', addDaysLocal(today, -3)),
      entry('h', today),
    ];
    const r = deriveStreakState(dailyHabit, entries, today);
    assert.equal(r.streakCount, 1);
  });
});

// ─── deriveStreakState ─────────────────────────────────────────────────────

describe('deriveStreakState', () => {
  test('picks the most recent completed date regardless of streak', () => {
    const today = '2024-01-10';
    const entries: HabitEntry[] = [
      entry('h', '2024-01-08'),
      entry('h', '2024-01-10'),
      entry('h', '2024-01-09'),
    ];
    const r = deriveStreakState(dailyHabit, entries, today);
    assert.equal(r.streakCount, 3);
    assert.equal(r.lastCompletedDate, '2024-01-10');
  });

  test('ignores "none" / undone entries', () => {
    const today = WED;
    const entries: HabitEntry[] = [
      entry('h', WED, 'full'),
      entry('h', addDaysLocal(WED, -1), 'none'), // not counted
      entry('h', addDaysLocal(WED, -2), 'full'),
    ];
    const r = deriveStreakState(dailyHabit, entries, today);
    assert.equal(r.streakCount, 1); // yesterday "none" breaks streak
  });

  test('empty entries → streak 0, no lastCompletedDate', () => {
    const r = deriveStreakState(dailyHabit, [], WED);
    assert.equal(r.streakCount, 0);
    assert.equal(r.lastCompletedDate, undefined);
  });
});

// ─── completedDatesFromEntries ──────────────────────────────────────────────

describe('completedDatesFromEntries', () => {
  test('returns only dates with positive completion', () => {
    const entries: HabitEntry[] = [
      entry('h', MON, 'full'),
      entry('h', '2024-01-02', 'none'), // not counted
      entry('h', WED, 'micro'),          // counted
    ];
    const set = completedDatesFromEntries(dailyHabit, entries);
    assert.equal(set.has(MON), true);
    assert.equal(set.has(WED), true);
    assert.equal(set.has('2024-01-02'), false);
    assert.equal(set.size, 2);
  });
});
