/**
 * Pure nutrition math — no Firebase, no React. Unit-tested in nutritionCalc.test.ts.
 * Keeping these pure means the dashboard, weekly review, and tests all share one
 * source of truth for totals/remaining/adherence.
 */
import {
  FoodLog,
  MealComponent,
  NutritionEntry,
  NutritionTarget,
  SavedMeal,
} from '../types';

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
}

export function emptyTotals(): MacroTotals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
}

/** Sum a list of logged foods into total macros. */
export function sumFoodLogs(items: FoodLog[]): MacroTotals {
  return items.reduce<MacroTotals>((acc, it) => ({
    calories: acc.calories + (it.calories || 0),
    protein: acc.protein + (it.protein || 0),
    carbs: acc.carbs + (it.carbs || 0),
    fat: acc.fat + (it.fat || 0),
    fibre: acc.fibre + (it.fibre || 0),
  }), emptyTotals());
}

/** Remaining vs target — clamped at 0, never negative (no "over budget" shame). */
export function remaining(target: number, consumed: number): number {
  return Math.max(0, round(target - consumed));
}

/** Percentage of target consumed, 0–100+ (caller decides whether to clamp the ring). */
export function pctOfTarget(target: number, consumed: number): number {
  if (target <= 0) return 0;
  return Math.round((consumed / target) * 100);
}

/** Round to one decimal to avoid floating-point fuzz in the UI. */
export function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Total macros for one saved-meal (sum of components × their quantities). */
export function mealComponentTotals(components: MealComponent[]): MacroTotals {
  return components.reduce<MacroTotals>((acc, c) => {
    const q = c.quantity || 1;
    return {
      calories: acc.calories + (c.calories || 0) * q,
      protein: acc.protein + (c.protein || 0) * q,
      carbs: acc.carbs + (c.carbs || 0) * q,
      fat: acc.fat + (c.fat || 0) * q,
      fibre: acc.fibre + (c.fibre || 0) * q,
    };
  }, emptyTotals());
}

export function savedMealTotals(meal: SavedMeal): MacroTotals {
  return mealComponentTotals(meal.components);
}

/**
 * Did this day hit its protein target?
 * Tolerance lets "close enough" count (default exact).
 */
export function hitProteinTarget(
  entry: NutritionEntry | null,
  target: NutritionTarget | null,
): boolean {
  if (!entry || !target || target.protein <= 0) return false;
  return sumFoodLogs(entry.items).protein >= target.protein;
}

/**
 * Did this day stay within the calorie target?
 * `tolerance` is an allowance above target before it counts as "over"
 * (defaults to 0). We treat "logged nothing" as NOT within range, since an
 * empty day usually means the user didn't track, not that they ate nothing.
 */
export function withinCalorieTarget(
  entry: NutritionEntry | null,
  target: NutritionTarget | null,
  tolerance = 0,
): boolean {
  if (!entry || entry.items.length === 0 || !target || target.calories <= 0) return false;
  return sumFoodLogs(entry.items).calories <= target.calories + tolerance;
}

/** Average macros per day across a set of day entries (only days that exist). */
export function averageTotals(entries: NutritionEntry[]): MacroTotals {
  const logged = entries.filter(e => e.items.length > 0);
  if (logged.length === 0) return emptyTotals();
  const sum = logged.reduce<MacroTotals>((acc, e) => {
    const t = sumFoodLogs(e.items);
    return {
      calories: acc.calories + t.calories,
      protein: acc.protein + t.protein,
      carbs: acc.carbs + t.carbs,
      fat: acc.fat + t.fat,
      fibre: acc.fibre + t.fibre,
    };
  }, emptyTotals());
  return {
    calories: Math.round(sum.calories / logged.length),
    protein: Math.round(sum.protein / logged.length),
    carbs: Math.round(sum.carbs / logged.length),
    fat: Math.round(sum.fat / logged.length),
    fibre: Math.round(sum.fibre / logged.length),
  };
}

/**
 * Scale a per-serving food into a logged total for a given quantity.
 * Used by both manual logging and the (future) barcode confirm flow.
 */
export function scaleServing(
  perServing: { calories: number; protein: number; carbs?: number; fat?: number; fibre?: number },
  quantity: number,
): Pick<FoodLog, 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre'> {
  const q = quantity || 1;
  const out: Pick<FoodLog, 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre'> = {
    calories: round((perServing.calories || 0) * q),
    protein: round((perServing.protein || 0) * q),
  };
  if (perServing.carbs != null) out.carbs = round(perServing.carbs * q);
  if (perServing.fat != null) out.fat = round(perServing.fat * q);
  if (perServing.fibre != null) out.fibre = round(perServing.fibre * q);
  return out;
}

/**
 * Calm, performance-focused weekly summary line. No shame language.
 */
export function weeklyRecommendation(args: {
  avgCalories: number;
  avgProtein: number;
  calorieTarget: number;
  proteinTarget: number;
  weightDeltaKg: number | null; // negative = lost weight
  daysLogged: number;
}): string {
  const { avgCalories, avgProtein, calorieTarget, proteinTarget, weightDeltaKg, daysLogged } = args;
  if (daysLogged === 0) return 'No meals logged this week. Log a few days to see your trend.';

  const parts: string[] = [];
  parts.push(`You averaged ${avgCalories.toLocaleString()} kcal and ${avgProtein}g protein.`);

  if (weightDeltaKg != null && Math.abs(weightDeltaKg) >= 0.1) {
    const dir = weightDeltaKg < 0 ? 'down' : 'up';
    parts.push(`Weight is ${dir} ${Math.abs(round(weightDeltaKg))}kg this week.`);
  }

  const proteinOk = proteinTarget > 0 && avgProtein >= proteinTarget * 0.95;
  const calOver = calorieTarget > 0 && avgCalories > calorieTarget + 150;

  if (proteinOk && !calOver) {
    parts.push('Protein is dialled and calories are on target. Stay the course.');
  } else if (proteinOk && calOver) {
    parts.push('Protein was strong; calories ran a little high. If progress stalls, tighten snacks or weekends.');
  } else if (!proteinOk && !calOver) {
    parts.push('Calories are in range — nudge protein up to protect muscle while leaning out.');
  } else {
    parts.push('Both protein and calories have room to tighten. Pick one to focus on this week.');
  }
  return parts.join(' ');
}
