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
