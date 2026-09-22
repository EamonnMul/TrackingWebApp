/**
 * Nutrition data layer (Firestore). Mirrors the idioms in storage.ts:
 *   • user-scoped collections under users/{uid}/…
 *   • per-day docs keyed by local YYYY-MM-DD
 *   • read-append-write for arrays, single-write for multi-item ops
 *   • JSON.parse(JSON.stringify()) to strip undefined before setDoc
 *
 * Pure math lives in nutritionCalc.ts; this file is I/O only.
 */
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTodayString } from './storage';
import {
  NutritionEntry, FoodLog, SavedFood, SavedMeal, NutritionTarget, RecentFood,
} from '../types';

// ─── Scoped path helpers (local to keep storage.ts untouched) ────────────────

function uid(): string {
  return auth.currentUser!.uid;
}
function userDoc(col: string, id: string) {
  return doc(db, 'users', uid(), col, id);
}
function userCol(col: string) {
  return collection(db, 'users', uid(), col);
}
/** Strip undefined fields — Firestore rejects them. */
function clean<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function genId(): string {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

const ENTRIES = 'nutritionEntries';
const FOODS = 'nutritionFoods';
const MEALS = 'nutritionMeals';
const RECENTS_MAX = 30;

// ─── Daily entries ───────────────────────────────────────────────────────────

export async function getNutritionEntry(date: string): Promise<NutritionEntry | null> {
  const snap = await getDoc(userDoc(ENTRIES, date));
  return snap.exists() ? (snap.data() as NutritionEntry) : null;
}

export async function getAllNutritionEntries(): Promise<NutritionEntry[]> {
  const snap = await getDocs(userCol(ENTRIES));
  return snap.docs.map(d => d.data() as NutritionEntry);
}

/** Entries within [startDate, endDate] inclusive (client-side filter, like the rest of the app). */
export async function getNutritionEntriesInRange(startDate: string, endDate: string): Promise<NutritionEntry[]> {
  const all = await getAllNutritionEntries();
  return all
    .filter(e => e.date >= startDate && e.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Append one food to a day (read-append-write). Returns the saved log. */
export async function logFood(date: string, log: FoodLog): Promise<void> {
  const ref = userDoc(ENTRIES, date);
  const snap = await getDoc(ref);
  const now = Date.now();
  if (snap.exists()) {
    const data = snap.data() as NutritionEntry;
    await setDoc(ref, clean({ ...data, items: [...data.items, log], updatedAt: now }));
  } else {
    await setDoc(ref, clean({ date, items: [log], updatedAt: now }));
  }
  await pushRecentFromLog(log);
}

/** Append many foods in a SINGLE read+write (used by saved meals & copy-day). */
export async function logManyFoods(date: string, logs: FoodLog[]): Promise<void> {
  if (logs.length === 0) return;
  const ref = userDoc(ENTRIES, date);
  const snap = await getDoc(ref);
  const now = Date.now();
  if (snap.exists()) {
    const data = snap.data() as NutritionEntry;
    await setDoc(ref, clean({ ...data, items: [...data.items, ...logs], updatedAt: now }));
  } else {
    await setDoc(ref, clean({ date, items: [...logs], updatedAt: now }));
  }
  // Recents: push each unique food (most recent last so it ends up on top)
  for (const log of logs) await pushRecentFromLog(log);
}

export async function updateFoodLog(date: string, logId: string, patch: Partial<FoodLog>): Promise<void> {
  const ref = userDoc(ENTRIES, date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as NutritionEntry;
  const items = data.items.map(it => (it.id === logId ? { ...it, ...patch } : it));
  await setDoc(ref, clean({ ...data, items, updatedAt: Date.now() }));
}

export async function deleteFoodLog(date: string, logId: string): Promise<void> {
  const ref = userDoc(ENTRIES, date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as NutritionEntry;
  const items = data.items.filter(it => it.id !== logId);
  if (items.length === 0) {
    await deleteDoc(ref); // cleanup-on-empty, like deleteSet
  } else {
    await setDoc(ref, clean({ ...data, items, updatedAt: Date.now() }));
  }
}

/** Copy all of `fromDate`'s logs into `toDate` as fresh entries (new ids/timestamps). */
export async function copyDay(fromDate: string, toDate: string): Promise<number> {
  const source = await getNutritionEntry(fromDate);
  if (!source || source.items.length === 0) return 0;
  const now = Date.now();
  const copies: FoodLog[] = source.items.map(it => ({
    ...it,
    id: genId(),
    loggedAt: now,
  }));
  await logManyFoods(toDate, copies);
  return copies.length;
}

// ─── Targets ─────────────────────────────────────────────────────────────────

export async function getNutritionTarget(): Promise<NutritionTarget | null> {
  const snap = await getDoc(userDoc('config', 'nutritionTarget'));
  return snap.exists() ? (snap.data() as NutritionTarget) : null;
}

export async function saveNutritionTarget(target: NutritionTarget): Promise<void> {
  await setDoc(userDoc('config', 'nutritionTarget'), clean({ ...target, updatedAt: Date.now() }));
}

// ─── Saved foods ─────────────────────────────────────────────────────────────

export async function getSavedFoods(): Promise<SavedFood[]> {
  const snap = await getDocs(userCol(FOODS));
  return snap.docs
    .map(d => d.data() as SavedFood)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

export async function saveSavedFood(food: SavedFood): Promise<void> {
  await setDoc(userDoc(FOODS, food.id), clean(food));
}

export async function deleteSavedFood(id: string): Promise<void> {
  await deleteDoc(userDoc(FOODS, id));
}

/** Bump usage stats when a saved food is logged. Fire-and-forget friendly. */
export async function bumpSavedFoodUsage(id: string): Promise<void> {
  const ref = userDoc(FOODS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const food = snap.data() as SavedFood;
  await setDoc(ref, clean({
    ...food,
    usageCount: (food.usageCount ?? 0) + 1,
    lastUsedAt: Date.now(),
  }));
}

// ─── Saved meals ─────────────────────────────────────────────────────────────

export async function getSavedMeals(): Promise<SavedMeal[]> {
  const snap = await getDocs(userCol(MEALS));
  return snap.docs
    .map(d => d.data() as SavedMeal)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

export async function saveSavedMeal(meal: SavedMeal): Promise<void> {
  await setDoc(userDoc(MEALS, meal.id), clean(meal));
}

export async function deleteSavedMeal(id: string): Promise<void> {
  await deleteDoc(userDoc(MEALS, id));
}

export async function bumpSavedMealUsage(id: string): Promise<void> {
  const ref = userDoc(MEALS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const meal = snap.data() as SavedMeal;
  await setDoc(ref, clean({
    ...meal,
    usageCount: (meal.usageCount ?? 0) + 1,
    lastUsedAt: Date.now(),
  }));
}

// ─── Recents (denormalised single doc — avoids scanning all saved foods) ─────

export async function getRecents(): Promise<RecentFood[]> {
  const snap = await getDoc(userDoc('config', 'nutritionRecents'));
  if (!snap.exists()) return [];
  return (snap.data() as { foods: RecentFood[] }).foods ?? [];
}

async function saveRecents(foods: RecentFood[]): Promise<void> {
  await setDoc(userDoc('config', 'nutritionRecents'), clean({ foods }));
}

/** Push a just-logged food to the front of the recents list (deduped). */
async function pushRecentFromLog(log: FoodLog): Promise<void> {
  // Convert the snapshot back to per-serving values for re-use.
  const q = log.quantity || 1;
  const recent: RecentFood = {
    name: log.name,
    brand: log.brand,
    caloriesPerServing: q ? round(log.calories / q) : log.calories,
    proteinPerServing: q ? round(log.protein / q) : log.protein,
    carbsPerServing: log.carbs != null ? round(log.carbs / q) : undefined,
    fatPerServing: log.fat != null ? round(log.fat / q) : undefined,
    fibrePerServing: log.fibre != null ? round(log.fibre / q) : undefined,
    // When the log was made by weight its servingSize reads like "173g", which
    // describes that one meal, not the base serving the per-serving values above
    // refer to. Fall back to the base weight so label and numbers agree.
    servingSize: log.grams != null && log.servingGrams
      ? `${log.servingGrams}g`
      : log.servingSize,
    servingGrams: log.servingGrams,
    savedFoodId: log.savedFoodId,
    barcode: log.barcode,
    lastUsedAt: Date.now(),
  };
  const key = recentKey(recent);
  const existing = await getRecents();
  const deduped = existing.filter(r => recentKey(r) !== key);
  const next = [recent, ...deduped].slice(0, RECENTS_MAX);
  await saveRecents(next);
}

function recentKey(r: RecentFood): string {
  return r.savedFoodId ?? r.barcode ?? `${r.name}|${r.brand ?? ''}`.toLowerCase();
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// Re-export for convenience so screens can import date helpers from one place.
export { getTodayString };
