import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { DayWorkout, WorkoutSet, FidgetRecord, RunEntry, GratitudeEntry, Exercise, Habit, HabitEntry, HabitRewardGoal, WeightEntry, WeightGoal, WeightUnit, StravaConnection, Todo, FutureMeMessage, WorkoutPlan, WorkoutTemplate, PlannedExercise, Routine } from '../types';

export const DEFAULT_EXERCISE_ID = 'default';
export const DEFAULT_EXERCISE_NAME = 'Incline Dumbbell Press';

export const MEDITATION_HABIT_ID = 'meditation';
export const DEFAULT_MEDITATION_HABIT: Habit = {
  id: MEDITATION_HABIT_ID,
  name: 'Meditation',
  isMeditation: true,
  frequency: 'daily',
  order: -1,      // always sorts first
  createdAt: 0,
  archived: false,
};

export const NF_HABIT_ID = 'nf';
export const DEFAULT_NF_HABIT: Habit = {
  id: NF_HABIT_ID,
  name: 'No Fidgeting',
  type: 'checkpoint',
  checkpoints: [
    { id: 'am', label: 'AM' },
    { id: 'pm', label: 'PM' },
    { id: 'afterDinner', label: 'After Dinner' },
    { id: 'basic', label: 'Basic' },
  ],
  createdAt: 0,
  archived: false,
};

function uid(): string {
  return auth.currentUser!.uid;
}

function userDoc(col: string, id: string) {
  return doc(db, 'users', uid(), col, id);
}

function userCol(col: string) {
  return collection(db, 'users', uid(), col);
}

// ─── Exercise-scoped routing ──────────────────────────────────────────────────

function exerciseWorkoutCol(exerciseId: string) {
  if (exerciseId === DEFAULT_EXERCISE_ID) return userCol('workouts');
  return collection(db, 'users', uid(), 'exercises', exerciseId, 'workouts');
}

function exerciseWorkoutDoc(exerciseId: string, date: string) {
  if (exerciseId === DEFAULT_EXERCISE_ID) return userDoc('workouts', date);
  return doc(db, 'users', uid(), 'exercises', exerciseId, 'workouts', date);
}

// ─── Exercises ────────────────────────────────────────────────────────────────

export async function getAllExercises(): Promise<Exercise[]> {
  const snap = await getDocs(userCol('exercises'));
  return snap.docs.map(d => d.data() as Exercise);
}

export async function saveExercise(exercise: Exercise): Promise<void> {
  await setDoc(userDoc('exercises', exercise.id), exercise);
}

export async function deleteExercise(id: string): Promise<void> {
  await deleteDoc(userDoc('exercises', id));
}

// ─── Workouts ────────────────────────────────────────────────────────────────

export async function getAllWorkouts(): Promise<DayWorkout[]> {
  const snap = await getDocs(userCol('workouts'));
  return snap.docs.map(d => d.data() as DayWorkout);
}

export async function getAllWorkoutsForExercise(exerciseId: string): Promise<DayWorkout[]> {
  const snap = await getDocs(exerciseWorkoutCol(exerciseId));
  return snap.docs.map(d => d.data() as DayWorkout);
}

export async function getWorkoutByDate(date: string): Promise<DayWorkout | null> {
  const snap = await getDoc(userDoc('workouts', date));
  return snap.exists() ? (snap.data() as DayWorkout) : null;
}

export async function getWorkoutByDateForExercise(exerciseId: string, date: string): Promise<DayWorkout | null> {
  const snap = await getDoc(exerciseWorkoutDoc(exerciseId, date));
  return snap.exists() ? (snap.data() as DayWorkout) : null;
}

export async function saveSet(date: string, set: WorkoutSet): Promise<void> {
  const ref = userDoc('workouts', date);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as DayWorkout;
    await setDoc(ref, { ...data, sets: [...data.sets, set] });
  } else {
    await setDoc(ref, { date, sets: [set] });
  }
}

export async function saveSetForExercise(exerciseId: string, date: string, set: WorkoutSet): Promise<void> {
  const ref = exerciseWorkoutDoc(exerciseId, date);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as DayWorkout;
    await setDoc(ref, { ...data, sets: [...data.sets, set] });
  } else {
    await setDoc(ref, { date, sets: [set] });
  }
}

export async function deleteSet(date: string, setId: string): Promise<void> {
  const ref = userDoc('workouts', date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as DayWorkout;
  const sets = data.sets.filter(s => s.id !== setId);
  if (sets.length === 0) {
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { ...data, sets });
  }
}

export async function deleteSetForExercise(exerciseId: string, date: string, setId: string): Promise<void> {
  const ref = exerciseWorkoutDoc(exerciseId, date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as DayWorkout;
  const sets = data.sets.filter(s => s.id !== setId);
  if (sets.length === 0) {
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { ...data, sets });
  }
}

// ─── Daily Target ─────────────────────────────────────────────────────────────

export async function getDailyTarget(): Promise<number> {
  const snap = await getDoc(userDoc('config', 'target'));
  return snap.exists() ? (snap.data().value as number) : 40;
}

export async function saveDailyTarget(target: number): Promise<void> {
  await setDoc(userDoc('config', 'target'), { value: target });
}

// ─── Daily Target History (per-date) ──────────────────────────────────────────

export async function getDailyTargetHistory(): Promise<Record<string, number>> {
  const snap = await getDoc(userDoc('config', 'targetHistory'));
  return snap.exists() ? (snap.data() as Record<string, number>) : {};
}

export async function saveDailyTargetForDate(date: string, value: number): Promise<void> {
  const ref = userDoc('config', 'targetHistory');
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as Record<string, number>) : {};
  await setDoc(ref, { ...existing, [date]: value });
}

// ─── Fidget ───────────────────────────────────────────────────────────────────

export async function getFidgetRecord(date: string): Promise<FidgetRecord> {
  const snap = await getDoc(userDoc('fidget', date));
  return snap.exists()
    ? (snap.data() as FidgetRecord)
    : { date, am: false, pm: false, afterDinner: false };
}

export async function saveFidgetRecord(record: FidgetRecord): Promise<void> {
  await setDoc(userDoc('fidget', record.date), record);
}

export async function getAllFidgetRecords(): Promise<FidgetRecord[]> {
  const snap = await getDocs(userCol('fidget'));
  return snap.docs.map(d => d.data() as FidgetRecord);
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export async function getAllRuns(): Promise<RunEntry[]> {
  const snap = await getDocs(userCol('runs'));
  return snap.docs.map(d => d.data() as RunEntry);
}

export async function saveRun(run: RunEntry): Promise<void> {
  await setDoc(userDoc('runs', run.id), run);
}

export async function deleteRun(id: string): Promise<void> {
  await deleteDoc(userDoc('runs', id));
}

// ─── Gratitude ────────────────────────────────────────────────────────────────

export async function getAllGratitudeEntries(): Promise<GratitudeEntry[]> {
  const snap = await getDocs(userCol('gratitude'));
  return snap.docs.map(d => {
    const data = d.data() as any;
    const entry: GratitudeEntry = {
      id: d.id,
      date: data.date,
      text: data.text,
      createdAt: data.createdAt ?? data.updatedAt ?? 0,
    };
    if (data.photoUrl) entry.photoUrl = data.photoUrl;
    return entry;
  });
}

export async function getGratitudeEntriesForDate(date: string): Promise<GratitudeEntry[]> {
  const all = await getAllGratitudeEntries();
  return all.filter(e => e.date === date).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveGratitudeEntry(entry: GratitudeEntry): Promise<void> {
  await setDoc(userDoc('gratitude', entry.id), entry);
}

export async function uploadGratitudePhoto(entryId: string, blob: Blob): Promise<string> {
  const path = `users/${uid()}/gratitude/${entryId}.jpg`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(ref);
}

export async function deleteGratitudeEntry(id: string): Promise<void> {
  await deleteDoc(userDoc('gratitude', id));
  // Delete associated photo if present (ignore if none)
  try {
    const path = `users/${uid()}/gratitude/${id}.jpg`;
    await deleteObject(storageRef(storage, path));
  } catch {
    // No photo or already deleted — safe to ignore
  }
}

// ─── Habits ───────────────────────────────────────────────────────────────────

function habitEntryCol(habitId: string) {
  return collection(db, 'users', uid(), 'habits', habitId, 'entries');
}

function habitEntryDoc(habitId: string, date: string) {
  return doc(db, 'users', uid(), 'habits', habitId, 'entries', date);
}

export async function getAllHabits(): Promise<Habit[]> {
  const snap = await getDocs(userCol('habits'));
  return snap.docs
    .map(d => d.data() as Habit)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveHabit(habit: Habit): Promise<void> {
  // Firestore rejects undefined values — strip them before saving
  const clean = JSON.parse(JSON.stringify(habit));
  await setDoc(userDoc('habits', habit.id), clean);
}

export async function deleteHabit(habitId: string): Promise<void> {
  await deleteDoc(userDoc('habits', habitId));
}

export async function getHabitEntryForDate(habitId: string, date: string): Promise<HabitEntry | null> {
  const snap = await getDoc(habitEntryDoc(habitId, date));
  if (snap.exists()) return snap.data() as HabitEntry;

  // Legacy fallback for NF habit — read old fidget docs
  if (habitId === NF_HABIT_ID) {
    const legacySnap = await getDoc(userDoc('fidget', date));
    if (legacySnap.exists()) {
      const f = legacySnap.data() as FidgetRecord;
      return {
        id: `${NF_HABIT_ID}_${date}`,
        habitId: NF_HABIT_ID,
        date,
        checkpoints: { am: f.am, pm: f.pm, afterDinner: f.afterDinner },
        createdAt: 0,
      };
    }
  }
  return null;
}

export async function saveHabitEntry(entry: HabitEntry): Promise<void> {
  await setDoc(habitEntryDoc(entry.habitId, entry.date), entry);
}

export async function getHabitRewardGoal(): Promise<HabitRewardGoal | null> {
  const snap = await getDoc(doc(db, 'users', uid(), 'meta', 'habitReward'));
  if (!snap.exists()) return null;
  return snap.data() as HabitRewardGoal;
}

export async function saveHabitRewardGoal(goal: HabitRewardGoal): Promise<void> {
  await setDoc(doc(db, 'users', uid(), 'meta', 'habitReward'), goal);
}

export async function getAllHabitEntriesForHabit(habitId: string): Promise<HabitEntry[]> {
  const snap = await getDocs(habitEntryCol(habitId));
  const entries: HabitEntry[] = snap.docs.map(d => d.data() as HabitEntry);

  if (habitId === NF_HABIT_ID) {
    // Merge with legacy fidget records, new entries take precedence
    const legacySnap = await getDocs(userCol('fidget'));
    const newDates = new Set(entries.map(e => e.date));
    const legacy: HabitEntry[] = legacySnap.docs
      .filter(d => !newDates.has(d.id))
      .map(d => {
        const f = d.data() as FidgetRecord;
        return {
          id: `${NF_HABIT_ID}_${f.date}`,
          habitId: NF_HABIT_ID,
          date: f.date,
          checkpoints: { am: f.am, pm: f.pm, afterDinner: f.afterDinner },
          createdAt: 0,
        };
      });
    return [...entries, ...legacy];
  }
  return entries;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function getMaxWeight(workout: DayWorkout): number {
  return workout.sets.reduce((max, s) => Math.max(max, s.weight), 0);
}

// ─── Weight Tracking ──────────────────────────────────────────────────────────

export async function getWeightGoal(): Promise<WeightGoal | null> {
  const snap = await getDoc(userDoc('config', 'weightGoal'));
  return snap.exists() ? (snap.data() as WeightGoal) : null;
}

export async function saveWeightGoal(goal: WeightGoal): Promise<void> {
  await setDoc(userDoc('config', 'weightGoal'), goal);
}

export async function getAllWeightEntries(): Promise<WeightEntry[]> {
  const snap = await getDocs(userCol('weightEntries'));
  return snap.docs.map(d => d.data() as WeightEntry);
}

export async function logWeightEntry(entry: WeightEntry): Promise<void> {
  await setDoc(userDoc('weightEntries', entry.date), entry);
}

export async function deleteWeightEntry(date: string): Promise<void> {
  await deleteDoc(userDoc('weightEntries', date));
}

export async function getWeightUnit(): Promise<WeightUnit> {
  const snap = await getDoc(userDoc('config', 'weightUnit'));
  return snap.exists() ? (snap.data().value as WeightUnit) : 'kg';
}

export async function saveWeightUnit(unit: WeightUnit): Promise<void> {
  await setDoc(userDoc('config', 'weightUnit'), { value: unit });
}

// ─── Weight Unit Helpers ──────────────────────────────────────────────────────

export function kgToUnit(kg: number, unit: WeightUnit): number {
  if (unit === 'lbs') return +(kg * 2.20462).toFixed(1);
  if (unit === 'stone') return +(kg / 6.35029).toFixed(2);
  return +kg.toFixed(1);
}

export function unitToKg(val: number, unit: WeightUnit): number {
  if (unit === 'lbs') return +(val / 2.20462).toFixed(2);
  if (unit === 'stone') return +(val * 6.35029).toFixed(2);
  return +val.toFixed(2);
}

// ─── Todos ────────────────────────────────────────────────────────────────────

export async function getAllTodos(): Promise<Todo[]> {
  const snap = await getDocs(userCol('todos'));
  return snap.docs.map(d => d.data() as Todo);
}

export async function saveTodo(todo: Todo): Promise<void> {
  await setDoc(userDoc('todos', todo.id), todo);
}

export async function deleteTodo(id: string): Promise<void> {
  await deleteDoc(userDoc('todos', id));
}

// ─── Future Me ────────────────────────────────────────────────────────────────

export async function getAllFutureMeMessages(): Promise<FutureMeMessage[]> {
  const snap = await getDocs(userCol('futureMe'));
  return snap.docs.map(d => d.data() as FutureMeMessage);
}

export async function saveFutureMeMessage(msg: FutureMeMessage): Promise<void> {
  await setDoc(userDoc('futureMe', msg.id), msg);
}

export async function deleteFutureMeMessage(id: string): Promise<void> {
  await deleteDoc(userDoc('futureMe', id));
}

// ─── Workout Planner ──────────────────────────────────────────────────────────

function pe(id: string, name: string, sets: number, reps: number, weight?: number, restSeconds = 90): PlannedExercise {
  return { id, name, sets, reps, ...(weight !== undefined ? { weight } : {}), restSeconds };
}

export const BUILT_IN_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'tpl_pull',
    name: 'Pull',
    description: 'Back, biceps & rear delts',
    exercises: [
      pe('e1', 'Pull-ups', 4, 8),
      pe('e2', 'Barbell Row', 4, 8, 60),
      pe('e3', 'Lat Pulldown', 3, 10, 50),
      pe('e4', 'Cable Row', 3, 12, 45),
      pe('e5', 'Face Pulls', 3, 15, 20),
      pe('e6', 'Barbell Curl', 3, 10, 30),
      pe('e7', 'Hammer Curl', 3, 12, 14),
    ],
  },
  {
    id: 'tpl_push',
    name: 'Push',
    description: 'Chest, shoulders & triceps',
    exercises: [
      pe('e1', 'Bench Press', 4, 8, 80),
      pe('e2', 'Overhead Press', 4, 6, 50),
      pe('e3', 'Incline Dumbbell Press', 3, 10, 30),
      pe('e4', 'Lateral Raises', 4, 15, 10),
      pe('e5', 'Tricep Pushdown', 3, 12, 30),
      pe('e6', 'Overhead Tricep Extension', 3, 12, 25),
    ],
  },
  {
    id: 'tpl_legs',
    name: 'Legs',
    description: 'Quads, hamstrings, glutes & calves',
    exercises: [
      pe('e1', 'Squat', 4, 6, 100),
      pe('e2', 'Romanian Deadlift', 3, 10, 80),
      pe('e3', 'Leg Press', 3, 12, 120),
      pe('e4', 'Walking Lunges', 3, 12),
      pe('e5', 'Leg Curl', 3, 12, 40),
      pe('e6', 'Calf Raises', 4, 20, 50),
    ],
  },
  {
    id: 'tpl_upper',
    name: 'Upper',
    description: 'Full upper body',
    exercises: [
      pe('e1', 'Bench Press', 4, 8, 80),
      pe('e2', 'Barbell Row', 4, 8, 70),
      pe('e3', 'Overhead Press', 3, 8, 50),
      pe('e4', 'Pull-ups', 3, 8),
      pe('e5', 'Incline Dumbbell Press', 3, 10, 28),
      pe('e6', 'Face Pulls', 3, 15, 20),
      pe('e7', 'Barbell Curl', 2, 12, 28),
      pe('e8', 'Tricep Pushdown', 2, 12, 28),
    ],
  },
  {
    id: 'tpl_lower',
    name: 'Lower',
    description: 'Legs & core',
    exercises: [
      pe('e1', 'Squat', 4, 6, 100),
      pe('e2', 'Deadlift', 3, 5, 120),
      pe('e3', 'Leg Press', 3, 12, 120),
      pe('e4', 'Leg Curl', 3, 12, 40),
      pe('e5', 'Calf Raises', 4, 20, 50),
    ],
  },
  {
    id: 'tpl_fullbody',
    name: 'Full Body',
    description: 'Compound movements across everything',
    exercises: [
      pe('e1', 'Squat', 3, 5, 100),
      pe('e2', 'Bench Press', 3, 5, 80),
      pe('e3', 'Deadlift', 3, 5, 120),
      pe('e4', 'Overhead Press', 3, 8, 50),
      pe('e5', 'Pull-ups', 3, 8),
      pe('e6', 'Barbell Row', 3, 8, 70),
    ],
  },
];

export async function getAllWorkoutPlans(): Promise<WorkoutPlan[]> {
  const snap = await getDocs(userCol('workoutPlans'));
  return snap.docs.map(d => d.data() as WorkoutPlan);
}

export async function saveWorkoutPlan(plan: WorkoutPlan): Promise<void> {
  await setDoc(userDoc('workoutPlans', plan.id), plan);
}

export async function deleteWorkoutPlan(id: string): Promise<void> {
  await deleteDoc(userDoc('workoutPlans', id));
}

// ─── Routines (scaffold) ──────────────────────────────────────────────────────

export async function getAllRoutines(): Promise<Routine[]> {
  const snap = await getDocs(userCol('routines'));
  return snap.docs.map(d => d.data() as Routine);
}

export async function saveRoutine(routine: Routine): Promise<void> {
  await setDoc(userDoc('routines', routine.id), routine);
}

export async function deleteRoutine(id: string): Promise<void> {
  await deleteDoc(userDoc('routines', id));
}
