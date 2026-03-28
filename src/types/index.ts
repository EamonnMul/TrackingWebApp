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
