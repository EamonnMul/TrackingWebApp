/**
 * Tests for nutritionCalc.ts — run with `npm run test:nutrition`.
 * Node's built-in test runner via tsx, no external framework (mirrors habitStreak.test.ts).
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  emptyTotals, sumFoodLogs, remaining, pctOfTarget, round,
  mealComponentTotals, savedMealTotals, hitProteinTarget, withinCalorieTarget,
  averageTotals, scaleServing, weeklyRecommendation,
  caloriesFromMacros, streakFromDates, calcLoggingStreak, calcProteinStreak,
} from './nutritionCalc';
import { FoodLog, NutritionEntry, NutritionTarget, SavedMeal, MealComponent } from '../types';

function log(p: Partial<FoodLog>): FoodLog {
  return {
    id: p.id ?? 'x', name: p.name ?? 'Food', meal: p.meal ?? 'breakfast',
    calories: p.calories ?? 0, protein: p.protein ?? 0,
    carbs: p.carbs, fat: p.fat, fibre: p.fibre,
    quantity: p.quantity ?? 1, loggedAt: p.loggedAt ?? 0, source: p.source ?? 'manual',
  };
}
function entry(date: string, items: FoodLog[]): NutritionEntry {
  return { date, items, updatedAt: 0 };
}
const target = (p: Partial<NutritionTarget>): NutritionTarget => ({
  calories: p.calories ?? 2000, protein: p.protein ?? 150,
  carbs: p.carbs, fat: p.fat, fibre: p.fibre, updatedAt: 0,
});

describe('sumFoodLogs', () => {
  test('empty → zeros', () => {
    assert.deepEqual(sumFoodLogs([]), emptyTotals());
  });
  test('sums calories and protein', () => {
    const t = sumFoodLogs([log({ calories: 300, protein: 30 }), log({ calories: 200, protein: 20 })]);
    assert.equal(t.calories, 500);
    assert.equal(t.protein, 50);
  });
  test('treats missing macros as 0', () => {
    const t = sumFoodLogs([log({ calories: 100, protein: 10 })]);
    assert.equal(t.carbs, 0);
    assert.equal(t.fat, 0);
    assert.equal(t.fibre, 0);
  });
});

describe('remaining / pctOfTarget', () => {
  test('remaining clamps at 0 (no negative / no shame)', () => {
    assert.equal(remaining(2000, 2300), 0);
    assert.equal(remaining(2000, 1500), 500);
  });
  test('pctOfTarget', () => {
    assert.equal(pctOfTarget(2000, 1000), 50);
    assert.equal(pctOfTarget(2000, 2500), 125);
    assert.equal(pctOfTarget(0, 100), 0);
  });
});

describe('round', () => {
  test('one decimal', () => {
    assert.equal(round(1.04), 1);
    assert.equal(round(1.05), 1.1);
    assert.equal(round(149.96), 150);
  });
});

describe('meal totals', () => {
  const comps: MealComponent[] = [
    { name: 'Oats', calories: 150, protein: 5, carbs: 27, quantity: 1 },
    { name: 'Whey', calories: 120, protein: 24, quantity: 2 },
  ];
  test('mealComponentTotals multiplies by quantity', () => {
    const t = mealComponentTotals(comps);
    assert.equal(t.calories, 150 + 240);
    assert.equal(t.protein, 5 + 48);
    assert.equal(t.carbs, 27);
  });
  test('savedMealTotals delegates', () => {
    const meal: SavedMeal = { id: 'm', name: 'Breakfast', components: comps, usageCount: 0, lastUsedAt: 0, createdAt: 0 };
    assert.deepEqual(savedMealTotals(meal), mealComponentTotals(comps));
  });
});

describe('adherence', () => {
  const tgt = target({ calories: 2000, protein: 150 });
  test('hitProteinTarget true when >= target', () => {
    assert.equal(hitProteinTarget(entry('d', [log({ protein: 150 })]), tgt), true);
    assert.equal(hitProteinTarget(entry('d', [log({ protein: 120 })]), tgt), false);
  });
  test('hitProteinTarget false on null/zero-target', () => {
    assert.equal(hitProteinTarget(null, tgt), false);
    assert.equal(hitProteinTarget(entry('d', [log({ protein: 200 })]), target({ protein: 0 })), false);
  });
  test('withinCalorieTarget respects tolerance and ignores empty days', () => {
    assert.equal(withinCalorieTarget(entry('d', [log({ calories: 1900 })]), tgt), true);
    assert.equal(withinCalorieTarget(entry('d', [log({ calories: 2100 })]), tgt), false);
    assert.equal(withinCalorieTarget(entry('d', [log({ calories: 2100 })]), tgt, 200), true);
    assert.equal(withinCalorieTarget(entry('d', []), tgt), false); // empty ≠ within
  });
});

describe('averageTotals', () => {
  test('averages only logged days', () => {
    const entries = [
      entry('a', [log({ calories: 2000, protein: 150 })]),
      entry('b', [log({ calories: 2400, protein: 190 })]),
      entry('c', []), // not logged — excluded
    ];
    const avg = averageTotals(entries);
    assert.equal(avg.calories, 2200);
    assert.equal(avg.protein, 170);
  });
  test('no logged days → zeros', () => {
    assert.deepEqual(averageTotals([entry('a', [])]), emptyTotals());
  });
});

describe('scaleServing', () => {
  test('scales per-serving by quantity, only includes provided macros', () => {
    const r = scaleServing({ calories: 120, protein: 24, carbs: 3 }, 2);
    assert.equal(r.calories, 240);
    assert.equal(r.protein, 48);
    assert.equal(r.carbs, 6);
    assert.equal(r.fat, undefined);
    assert.equal(r.fibre, undefined);
  });
  test('quantity 0 falls back to 1', () => {
    const r = scaleServing({ calories: 100, protein: 10 }, 0);
    assert.equal(r.calories, 100);
  });
});

describe('caloriesFromMacros (UK/EU label convention)', () => {
  test('applies 4/4/9 to protein/carbs/fat', () => {
    assert.equal(caloriesFromMacros({ protein: 30, carbs: 40, fat: 10 }), 30 * 4 + 40 * 4 + 10 * 9);
  });
  test('adds fibre at 2 kcal/g (EU 1169/2011 Annex XIV)', () => {
    assert.equal(caloriesFromMacros({ protein: 0, carbs: 0, fat: 0, fibre: 10 }), 20);
    assert.equal(
      caloriesFromMacros({ protein: 20, carbs: 30, fat: 5, fibre: 8 }),
      20 * 4 + 30 * 4 + 5 * 9 + 8 * 2,
    );
  });
  test('omitted fibre contributes nothing (back-compat)', () => {
    assert.equal(caloriesFromMacros({ protein: 30, carbs: 40, fat: 10 }),
                 caloriesFromMacros({ protein: 30, carbs: 40, fat: 10, fibre: 0 }));
  });
  test('empty-string inputs count as 0', () => {
    assert.equal(caloriesFromMacros({ protein: 25, carbs: '', fat: '', fibre: '' }), 100);
    assert.equal(caloriesFromMacros({ protein: '', carbs: '', fat: '' }), 0);
  });
  test('rounds to whole kcal', () => {
    assert.equal(caloriesFromMacros({ protein: 0.5, carbs: 0, fat: 0.1 }), Math.round(0.5 * 4 + 0.1 * 9));
  });
});

describe('streaks', () => {
  const T = '2024-01-10';
  const day = (n: number) => {
    // n days before T, hardcoded around a known date
    const map: Record<number, string> = {
      0: '2024-01-10', 1: '2024-01-09', 2: '2024-01-08', 3: '2024-01-07', 4: '2024-01-06',
    };
    return map[n];
  };
  const e = (date: string, protein: number, hasItems = true): NutritionEntry => ({
    date, updatedAt: 0,
    items: hasItems ? [log({ protein, calories: 100 })] : [],
  });

  test('streakFromDates counts consecutive days ending today', () => {
    assert.equal(streakFromDates(new Set([day(0), day(1), day(2)]), T), 3);
  });
  test('today-in-progress grace: today missing starts from yesterday', () => {
    assert.equal(streakFromDates(new Set([day(1), day(2)]), T), 2);
  });
  test('gap breaks the streak', () => {
    assert.equal(streakFromDates(new Set([day(0), day(2), day(3)]), T), 1);
  });
  test('empty set → 0', () => {
    assert.equal(streakFromDates(new Set<string>(), T), 0);
  });

  test('calcLoggingStreak ignores empty days', () => {
    const entries = [e(day(0), 10), e(day(1), 10), e(day(2), 0, false)]; // day-2 exists but empty
    assert.equal(calcLoggingStreak(entries, T), 2);
  });

  test('calcProteinStreak counts only days hitting target', () => {
    const tgt = target({ protein: 150 });
    const entries = [e(day(0), 160), e(day(1), 155), e(day(2), 120), e(day(3), 180)];
    assert.equal(calcProteinStreak(entries, tgt, T), 2); // day-2 missed → chain ends
  });
  test('calcProteinStreak grace: today below target does not break yesterday run', () => {
    const tgt = target({ protein: 150 });
    const entries = [e(day(0), 40), e(day(1), 155), e(day(2), 170)];
    assert.equal(calcProteinStreak(entries, tgt, T), 2);
  });
  test('calcProteinStreak zero/absent target → 0', () => {
    assert.equal(calcProteinStreak([e(day(0), 200)], null, T), 0);
    assert.equal(calcProteinStreak([e(day(0), 200)], target({ protein: 0 }), T), 0);
  });
});

describe('weeklyRecommendation', () => {
  test('no days logged', () => {
    assert.match(weeklyRecommendation({
      avgCalories: 0, avgProtein: 0, calorieTarget: 2000, proteinTarget: 150,
      weightDeltaKg: null, daysLogged: 0,
    }), /No meals logged/);
  });
  test('protein strong, calories high', () => {
    const msg = weeklyRecommendation({
      avgCalories: 2450, avgProtein: 190, calorieTarget: 2000, proteinTarget: 150,
      weightDeltaKg: -0.4, daysLogged: 7,
    });
    assert.match(msg, /2,450 kcal and 190g protein/);
    assert.match(msg, /down 0.4kg/);
    assert.match(msg, /Protein was strong/);
  });
  test('on target, no shame language', () => {
    const msg = weeklyRecommendation({
      avgCalories: 1980, avgProtein: 160, calorieTarget: 2000, proteinTarget: 150,
      weightDeltaKg: -0.3, daysLogged: 6,
    });
    assert.match(msg, /Stay the course/);
    assert.doesNotMatch(msg, /fail|bad|cheat|guilt/i);
  });
});
