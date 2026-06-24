export interface WorkoutSet {
  id: string;
  weight: number; // kg
  reps: number;
  createdAt: number;
  exerciseName?: string; // populated in All Exercises view
  supersetGroup?: string; // shared ID groups sets logged as a superset
}

export interface DayWorkout {
  date: string; // 'YYYY-MM-DD'
  sets: WorkoutSet[];
}

export interface FidgetRecord {
  date: string;
  am: boolean;
  pm: boolean;
  afterDinner: boolean;
}

export interface RunEntry {
  id: string;
  date: string;
  distanceKm: number;
  // Strava fields
  source?: 'manual' | 'strava';
  stravaId?: string;
  movingTimeSecs?: number;
  elevationGainM?: number;
  avgHeartRate?: number;
}

export interface StravaConnection {
  athleteId: number;
  athleteName?: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number; // unix ms
  connectedAt: number;
  lastSync?: number;
}

export interface GratitudeEntry {
  id: string;
  date: string;
  text: string;
  createdAt: number;
  photoUrl?: string;
}

export interface Exercise {
  id: string;
  name: string;
  createdAt: number;
  trackTarget?: boolean;
  target?: number; // per-exercise daily rep target
}

export type WeightUnit = 'kg' | 'lbs' | 'stone';

export interface WeightEntry {
  date: string; // 'YYYY-MM-DD'
  kg: number;   // always stored in kg
  createdAt: number;
}

export interface WeightGoal {
  targetKg: number;  // always stored in kg
  targetDate: string;
  startKg: number;   // always stored in kg
  startDate: string;
}

export type HabitType = 'boolean' | 'checkpoint' | 'numeric';

export interface HabitCheckpoint {
  id: string;
  label: string;
}

export type HabitFrequency = 'daily' | 'specific_days';

export interface Habit {
  id: string;

  // ── Core fields (new Atomic Habits format) ───────────────────────────────
  name?: string;                // e.g. "Run 10km"
  frequency?: HabitFrequency;  // 'daily' | 'specific_days'
  specificDays?: number[];      // 0=Sun … 6=Sat

  // ── Optional Atomic Habits sections ──────────────────────────────────────
  cue?: string;         // Make It Obvious:  "After I wake up"
  microHabit?: string;  // Two-Minute Rule:  "Put on running shoes"
  reward?: string;      // Make It Satisfying: "Protein cookie"
  identity?: string;    // Identity:         "I am a disciplined runner"
  isBadHabit?: boolean; // Track avoidance instead of completion
  isMeditation?: boolean; // Opens guided breathing overlay on tap

  // ── Ordering + time-of-day ────────────────────────────────────────────────
  order?: number;
  timeOfDay?: 'am' | 'pm'; // optional grouping

  // ── Cached streak (updated on save) ──────────────────────────────────────
  streakCount?: number;
  lastCompletedDate?: string;

  // ── Legacy: trigger/action format ────────────────────────────────────────
  trigger?: string;
  action?: string;

  // ── Legacy: type-based format (NF habit etc.) ────────────────────────────
  type?: HabitType;
  checkpoints?: HabitCheckpoint[];
  unit?: string;

  createdAt: number;
  archived: boolean;
  nextAction?: string;        // concrete prep step, e.g. "Put book on pillow"
  linkedTaskIds?: string[];   // IDs of tasks linked to this habit
}

export type HabitCompletion = 'full' | 'micro' | 'none';

export interface HabitEntry {
  id: string;              // `${habitId}_${date}`
  habitId: string;
  date: string;
  // New completion model
  completion?: HabitCompletion;
  // Legacy fields
  done?: boolean;
  checkpoints?: Record<string, boolean>;
  value?: number;
  createdAt: number;
}

export interface HabitRewardGoal {
  goalName: string;
  budget: number;
  earnPerCompletion: number;
  balance: number;
  currency: string; // e.g. '£'
  createdAt: number;
  updatedAt: number;
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  dueDate?: string;
  notes?: string;
  priority?: 'high' | 'medium' | 'low';
  myDay?: boolean;
  completedDate?: string; // 'YYYY-MM-DD' — set when task is completed
  createdAt: number;
  order: number;
  sourceHabitId?: string;     // set when created from a habit
  recurrence?: RecurrenceRule;
  recurringGroupId?: string;  // shared id across all instances of a recurring task
}

export interface RecurrenceRule {
  type: 'daily' | 'weekly' | 'monthly';
  daysOfWeek?: number[]; // 0=Sun…6=Sat, used when type='weekly'
  dayOfMonth?: number;   // 1–28, used when type='monthly'
}

export interface FutureMeMessage {
  id: string;
  content: string;
  createdAt: number;
  deliverAt: number;    // unix ms — local timezone
  delivered: boolean;
  deliveredAt?: number; // unix ms — set when delivered
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  habitIds: string[];    // recurring habits in this routine
  taskTitles: string[];  // one-off task templates
  createdAt: number;
}

export interface PlannedExercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight?: number;      // kg, optional target
  restSeconds?: number;
  notes?: string;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string;
  exercises: PlannedExercise[];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  date?: string;         // 'YYYY-MM-DD' optional scheduled date
  templateId?: string;
  exercises: PlannedExercise[];
  status: 'planned' | 'done';
  createdAt: number;
  completedAt?: number;
}

// ─── Nutrition ──────────────────────────────────────────────────────────────

export type MealCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_CATEGORIES: MealCategory[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Where a logged food came from. */
export type FoodSource =
  | 'manual'
  | 'quick_add'
  | 'saved_food'
  | 'saved_meal'
  | 'barcode_scan'
  | 'external_database';

/**
 * A single logged food. IMPORTANT: this is a SNAPSHOT — the nutrition numbers
 * are copied in at log time and never reference a live SavedFood/external
 * product, so editing a saved food later never rewrites historical logs.
 * All macro values are the totals for `quantity × servingSize` as logged.
 */
export interface FoodLog {
  id: string;
  name: string;
  brand?: string;
  meal: MealCategory;
  calories: number;       // total for the amount consumed
  protein: number;        // grams
  carbs?: number;         // grams
  fat?: number;           // grams
  fibre?: number;         // grams
  servingSize?: string;   // human label, e.g. "1 scoop (30g)"
  quantity: number;       // multiplier applied to the base serving
  loggedAt: number;       // unix ms
  source: FoodSource;
  savedFoodId?: string;   // provenance only — never read for nutrition values
  barcode?: string;
}

/** One day's nutrition, keyed by YYYY-MM-DD doc id (local date). */
export interface NutritionEntry {
  date: string;           // 'YYYY-MM-DD'
  items: FoodLog[];
  updatedAt: number;
}

/** A reusable food the user has saved. Per-serving values. */
export interface SavedFood {
  id: string;
  name: string;
  brand?: string;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing?: number;
  fatPerServing?: number;
  fibrePerServing?: number;
  servingSize?: string;   // human label for one serving
  barcode?: string;
  usageCount: number;
  lastUsedAt: number;
  createdAt: number;
}

/** A component of a saved meal — a snapshot of a food + quantity. */
export interface MealComponent {
  name: string;
  brand?: string;
  calories: number;       // per single serving of this component
  protein: number;
  carbs?: number;
  fat?: number;
  fibre?: number;
  servingSize?: string;
  quantity: number;       // how many servings in the meal
  savedFoodId?: string;
}

/** A saved meal = a named bundle of food components. */
export interface SavedMeal {
  id: string;
  name: string;
  components: MealComponent[];
  defaultMeal?: MealCategory; // suggested category when logging
  usageCount: number;
  lastUsedAt: number;
  createdAt: number;
}

export type NutritionMode = 'cutting' | 'maintenance' | 'bulking';

/** Daily nutrition targets (single config doc). */
export interface NutritionTarget {
  calories: number;
  protein: number;        // grams
  carbs?: number;
  fat?: number;
  fibre?: number;
  water?: number;         // ml or glasses — optional
  mode?: NutritionMode;
  showMacros?: boolean;   // reveal carbs/fat/fibre/water on the dashboard
  updatedAt: number;
}

/** Denormalised quick-access list: the last foods used, newest first. */
export interface RecentFood {
  name: string;
  brand?: string;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing?: number;
  fatPerServing?: number;
  fibrePerServing?: number;
  servingSize?: string;
  savedFoodId?: string;
  barcode?: string;
  lastUsedAt: number;
}
