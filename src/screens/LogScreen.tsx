import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchStravaActivities, importStravaActivity, getStravaStatus,
  StravaActivity, StravaStatus,
} from '../utils/strava';
import { Flame, Trash2, SlidersHorizontal, Plus, ChevronDown, X, Pencil, Calendar, ImagePlus, Link2, ChevronRight, GripVertical } from 'lucide-react';
import { SortableTabBar, TabDef } from '../components/SortableTabBar';
import FutureMeSection from '../components/FutureMeSection';
import PlannerTab from '../components/PlannerTab';
import {
  getTodayString,
  formatDate,
  getMaxWeight,
  getAllWorkoutsForExercise,
  getWorkoutByDateForExercise,
  saveSetForExercise,
  deleteSetForExercise,
  getDailyTarget,
  saveDailyTarget,
  getAllRuns,
  saveRun,
  deleteRun as persistDeleteRun,
  getGratitudeEntriesForDate,
  saveGratitudeEntry,
  deleteGratitudeEntry,
  uploadGratitudePhoto,
  getAllExercises,
  saveExercise,
  deleteExercise as persistDeleteExercise,
  DEFAULT_EXERCISE_ID,
  DEFAULT_EXERCISE_NAME,
  getAllHabits,
  saveHabit,
  deleteHabit as persistDeleteHabit,
  getHabitEntryForDate,
  saveHabitEntry,
  getAllHabitEntriesForHabit,
  getHabitRewardGoal,
  saveHabitRewardGoal,
  saveTodo,
  NF_HABIT_ID,
  DEFAULT_NF_HABIT,
  MEDITATION_HABIT_ID,
  DEFAULT_MEDITATION_HABIT,
  getWeightUnit,
  saveWeightUnit,
  logWeightEntry,
  getAllWeightEntries,
  kgToUnit,
  unitToKg,
} from '../utils/storage';
import {
  DayWorkout, WorkoutSet, RunEntry, Exercise, GratitudeEntry,
  Habit, HabitEntry, HabitRewardGoal, HabitType, HabitCheckpoint, HabitCompletion, HabitFrequency, WeightUnit, WeightEntry, Todo, RecurrenceRule,
} from '../types';
import { deriveStreakState, streakStateNeedsWrite } from '../utils/habitStreak';

const today = getTodayString();

type LogTab = 'lifting' | 'habits' | 'running' | 'gratitude' | 'weight' | 'planner';

const LOG_TAB_IDS: LogTab[] = ['lifting', 'habits', 'running', 'gratitude', 'weight', 'planner'];
const LOG_TABS_BASE: TabDef[] = [
  { id: 'lifting', label: 'Lifting' },
  { id: 'habits', label: 'Habits' },
  { id: 'running', label: 'Running' },
  { id: 'gratitude', label: 'Gratitude' },
  { id: 'weight', label: 'Weight' },
  { id: 'planner', label: 'Planner' },
];

function loadLogTabOrder(): TabDef[] {
  try {
    const stored = localStorage.getItem('logTabOrder');
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      if (ids.length === LOG_TAB_IDS.length && LOG_TAB_IDS.every(id => ids.includes(id))) {
        return ids.map(id => LOG_TABS_BASE.find(t => t.id === id)!);
      }
    }
  } catch { /* ignore */ }
  return LOG_TABS_BASE;
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

const DEFAULT_EXERCISE: Exercise = {
  id: DEFAULT_EXERCISE_ID,
  name: DEFAULT_EXERCISE_NAME,
  createdAt: 0,
  trackTarget: true,
};

// ─── Image compression helper ─────────────────────────────────────────────────

function compressImage(file: File, maxPx = 1200, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('compression failed')), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function habitCompletion(habit: Habit, entry: HabitEntry | null): number {
  if (!entry) return 0;
  if (habit.type === 'boolean') return entry.done ? 1 : 0;
  if (habit.type === 'checkpoint') {
    const cps = habit.checkpoints ?? [];
    if (!cps.length) return 0;
    return cps.filter(cp => entry.checkpoints?.[cp.id]).length / cps.length;
  }
  if (habit.type === 'numeric') return (entry.value ?? 0) > 0 ? 1 : 0;
  return 0;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LogScreen() {
  const [searchParams] = useSearchParams();
  const [logDate, setLogDate] = useState(() => {
    const d = searchParams.get('date');
    return (d && d <= today) ? d : today;
  });

  const [todayWorkout, setTodayWorkout] = useState<DayWorkout | null>(null);
  const [weight, setWeight] = useState(20);
  const [reps, setReps] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(40);
  const [todayRuns, setTodayRuns] = useState<RunEntry[]>([]);
  const [runDist, setRunDist] = useState(5.0);
  const [showTargetEdit, setShowTargetEdit] = useState(false);
  const [supersetGroupId, setSupersetGroupId] = useState<string | null>(null);
  const [gratitudeEntries, setGratitudeEntries] = useState<GratitudeEntry[]>([]);
  const [newGratitude, setNewGratitude] = useState('');
  const [gratitudeSaved, setGratitudeSaved] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [logTab, setLogTab] = useState<LogTab>('lifting');
  const [logTabOrder, setLogTabOrder] = useState<TabDef[]>(loadLogTabOrder);
  const [showSets, setShowSets] = useState(false);
  const [allRuns, setAllRuns] = useState<RunEntry[]>([]);

  // Exercises
  const [exercises, setExercises] = useState<Exercise[]>([DEFAULT_EXERCISE]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(DEFAULT_EXERCISE_ID);
  const [showExerciseDropdown, setShowExerciseDropdown] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const addExerciseInputRef = useRef<HTMLInputElement>(null);

  // Habits
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayHabitEntries, setTodayHabitEntries] = useState<Record<string, HabitEntry>>({});
  const [showAddHabit, setShowAddHabit] = useState(false);
  const [showManageHabits, setShowManageHabits] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const dragHabitId = useRef<string | null>(null);
  const dragOverHabitId = useRef<string | null>(null);
  const [habitReward, setHabitReward] = useState<HabitRewardGoal | null>(null);
  const [meditatingHabitId, setMeditatingHabitId] = useState<string | null>(null);
  const [createTaskHabit, setCreateTaskHabit] = useState<Habit | null>(null);

  // Weight
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [weightDisplayValue, setWeightDisplayValue] = useState(80);
  const [allWeightEntries, setAllWeightEntries] = useState<WeightEntry[]>([]);
  const [todayWeightEntry, setTodayWeightEntry] = useState<WeightEntry | null>(null);

  // ── Animation state ─────────────────────────────────────────────────────────
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const [btnFlash, setBtnFlash] = useState<string | null>(null);
  const [bumpedHabitId, setBumpedHabitId] = useState<string | null>(null);

  function markNew(id: string) {
    setNewItemId(id);
    setTimeout(() => setNewItemId(n => n === id ? null : n), 700);
  }
  function flashBtn(key: string) {
    setBtnFlash(key);
    setTimeout(() => setBtnFlash(b => b === key ? null : b), 550);
  }
  function bumpHabit(id: string) {
    setBumpedHabitId(id);
    setTimeout(() => setBumpedHabitId(b => b === id ? null : b), 400);
  }

  // Strava import
  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [showStravaPanel, setShowStravaPanel] = useState(false);
  const [stravaActivities, setStravaActivities] = useState<StravaActivity[]>([]);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [importedIds, setImportedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    Promise.all([
      getDailyTarget(),
      getAllRuns(),
      getGratitudeEntriesForDate(logDate),
      getAllExercises(),
      getWorkoutByDateForExercise(DEFAULT_EXERCISE_ID, logDate),
      getAllHabits(),
      getWeightUnit(),
      getAllWeightEntries(),
    ]).then(async ([target, allRuns, gratitude, customExercises, workout, customHabits, unit, wEntries]) => {
      setDailyTarget(target);
      setAllRuns(allRuns);
      setTodayRuns(allRuns.filter(r => r.date === logDate));
      setGratitudeEntries(gratitude);

      const exList = [DEFAULT_EXERCISE, ...customExercises.sort((a, b) => a.createdAt - b.createdAt)];
      setExercises(exList);

      setTodayWorkout(workout);
      if (workout?.sets.length) {
        const last = workout.sets[workout.sets.length - 1];
        setWeight(last.weight);
        setReps(last.reps);
      } else {
        const history = await getAllWorkoutsForExercise(DEFAULT_EXERCISE_ID);
        const lastSet = [...history].sort((a, b) => b.date.localeCompare(a.date))
          .flatMap(w => w.sets).slice(-1)[0];
        if (lastSet) { setWeight(lastSet.weight); setReps(lastSet.reps); }
      }

      const activeHabits = customHabits.filter(h => !h.archived);

      // Ensure the default meditation habit is always present at the top
      const hasMeditation = activeHabits.some(h => h.id === MEDITATION_HABIT_ID);
      if (!hasMeditation) saveHabit(DEFAULT_MEDITATION_HABIT).catch(() => {});
      const habitsList = hasMeditation ? activeHabits : [DEFAULT_MEDITATION_HABIT, ...activeHabits];
      setHabits(habitsList);

      // Load entries for all active habits for logDate
      const entries = await Promise.all(habitsList.map(h => getHabitEntryForDate(h.id, logDate)));
      const entryMap: Record<string, HabitEntry> = {};
      habitsList.forEach((h, i) => { if (entries[i]) entryMap[h.id] = entries[i]!; });
      setTodayHabitEntries(entryMap);

      setWeightUnit(unit);
      setAllWeightEntries(wEntries);
      const todayEntry = wEntries.find(e => e.date === logDate) ?? null;
      setTodayWeightEntry(todayEntry);
      const lastKg = todayEntry?.kg ?? ([...wEntries].sort((a, b) => a.date.localeCompare(b.date)).pop()?.kg ?? 80);
      setWeightDisplayValue(kgToUnit(lastKg, unit));

      setLoading(false);
    });
    getStravaStatus().then(setStravaStatus).catch(() => setStravaStatus({ connected: false }));
    getHabitRewardGoal().then(g => setHabitReward(g)).catch(() => {});
  }, []);

  // Reload date-specific data when logDate changes (skip initial mount)
  const logDateInitialized = useRef(false);
  useEffect(() => {
    if (!logDateInitialized.current) { logDateInitialized.current = true; return; }
    if (loading) return;
    setTodayRuns(allRuns.filter(r => r.date === logDate));
    setTodayWeightEntry(allWeightEntries.find(e => e.date === logDate) ?? null);
    Promise.all([
      getWorkoutByDateForExercise(selectedExerciseId, logDate),
      getGratitudeEntriesForDate(logDate),
      ...habits.map(h => getHabitEntryForDate(h.id, logDate)),
    ]).then(async ([workout, gratitude, ...habitEntryList]) => {
      setTodayWorkout(workout as DayWorkout | null);
      if ((workout as DayWorkout | null)?.sets.length) {
        const last = (workout as DayWorkout).sets[(workout as DayWorkout).sets.length - 1];
        setWeight(last.weight);
        setReps(last.reps);
      } else {
        const history = await getAllWorkoutsForExercise(selectedExerciseId);
        const lastSet = [...history].sort((a, b) => b.date.localeCompare(a.date))
          .flatMap(w => w.sets).slice(-1)[0];
        if (lastSet) { setWeight(lastSet.weight); setReps(lastSet.reps); }
        else { setWeight(20); setReps(10); }
      }
      setGratitudeEntries(gratitude as GratitudeEntry[]);
      const entryMap: Record<string, HabitEntry> = {};
      habits.forEach((h, i) => { if (habitEntryList[i]) entryMap[h.id] = habitEntryList[i] as HabitEntry; });
      setTodayHabitEntries(entryMap);
    });
  }, [logDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload workout when exercise changes
  useEffect(() => {
    if (loading) return;
    getWorkoutByDateForExercise(selectedExerciseId, logDate).then(async workout => {
      setTodayWorkout(workout);
      if (workout?.sets.length) {
        const last = workout.sets[workout.sets.length - 1];
        setWeight(last.weight);
        setReps(last.reps);
      } else {
        // Fall back to the most recent historical set for this exercise
        const history = await getAllWorkoutsForExercise(selectedExerciseId);
        const lastSet = [...history].sort((a, b) => b.date.localeCompare(a.date))
          .flatMap(w => w.sets).slice(-1)[0];
        if (lastSet) { setWeight(lastSet.weight); setReps(lastSet.reps); }
        else { setWeight(20); setReps(10); }
      }
    });
  }, [selectedExerciseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedExercise = exercises.find(e => e.id === selectedExerciseId) ?? DEFAULT_EXERCISE;
  // Default exercise uses global dailyTarget; custom exercises use their own target field
  const effectiveTarget: number | undefined = selectedExercise.id === DEFAULT_EXERCISE_ID
    ? dailyTarget
    : selectedExercise.target;
  const tracksTarget = (selectedExercise.id === DEFAULT_EXERCISE_ID || !!selectedExercise.trackTarget)
    && effectiveTarget !== undefined;

  const weekStart = getWeekStart();
  const weeklyKm = allRuns
    .filter(r => r.date >= weekStart && r.date <= today)
    .reduce((sum, r) => +(sum + r.distanceKm).toFixed(1), 0);

  const sets = todayWorkout?.sets ?? [];
  const totalReps = sets.reduce((sum, s) => sum + s.reps, 0);
  const pct = effectiveTarget !== undefined ? Math.min(100, Math.round((totalReps / effectiveTarget) * 100)) : 0;
  const targetMet = effectiveTarget !== undefined && totalReps >= effectiveTarget;
  const lastSet = sets[sets.length - 1] ?? null;

  // ── Lifting handlers ────────────────────────────────────────────────────────

  async function handleLogSet(w = weight, r = reps) {
    const set: WorkoutSet = { id: Date.now().toString(), weight: w, reps: r, createdAt: Date.now(), ...(supersetGroupId ? { supersetGroup: supersetGroupId } : {}) };
    setTodayWorkout(prev => ({ date: logDate, sets: [...(prev?.sets ?? []), set] }));
    markNew(set.id);
    flashBtn('logSet');
    await saveSetForExercise(selectedExerciseId, logDate, set);
  }

  async function handleDeleteSet(setId: string) {
    setTodayWorkout(prev => {
      if (!prev) return null;
      const sets = prev.sets.filter(s => s.id !== setId);
      return sets.length === 0 ? null : { ...prev, sets };
    });
    await deleteSetForExercise(selectedExerciseId, logDate, setId);
  }

  async function adjustTarget(delta: number) {
    if (selectedExercise.id === DEFAULT_EXERCISE_ID) {
      const next = Math.max(5, dailyTarget + delta);
      setDailyTarget(next);
      await saveDailyTarget(next);
    } else {
      const current = effectiveTarget ?? 40;
      const next = Math.max(5, current + delta);
      const updated = { ...selectedExercise, target: next };
      setExercises(prev => prev.map(e => e.id === updated.id ? updated : e));
      await saveExercise(updated);
    }
  }

  // ── Exercise handlers ───────────────────────────────────────────────────────

  async function handleAddExercise() {
    const name = newExerciseName.trim();
    if (!name) return;
    const exercise: Exercise = { id: Date.now().toString(), name, createdAt: Date.now(), trackTarget: false };
    setExercises(prev => [...prev, exercise]);
    setSelectedExerciseId(exercise.id);
    setNewExerciseName('');
    setShowAddExercise(false);
    setShowExerciseDropdown(false);
    await saveExercise(exercise);
  }

  async function handleDeleteExercise(id: string) {
    setExercises(prev => prev.filter(e => e.id !== id));
    if (selectedExerciseId === id) setSelectedExerciseId(DEFAULT_EXERCISE_ID);
    await persistDeleteExercise(id);
  }

  async function handleToggleTarget() {
    const updated = { ...selectedExercise, trackTarget: !selectedExercise.trackTarget };
    setExercises(prev => prev.map(e => e.id === updated.id ? updated : e));
    await saveExercise(updated);
  }

  function handleSelectExercise(id: string) {
    setSelectedExerciseId(id);
    setShowExerciseDropdown(false);
    setShowAddExercise(false);
    setNewExerciseName('');
  }

  useEffect(() => {
    if (showAddExercise) setTimeout(() => addExerciseInputRef.current?.focus(), 50);
  }, [showAddExercise]);

  // ── Habit handlers ──────────────────────────────────────────────────────────

  async function handleHabitUpdate(habitId: string, updates: Partial<HabitEntry>) {
    const current = todayHabitEntries[habitId];
    const newEntry: HabitEntry = {
      ...current,
      ...updates,
      id: `${habitId}_${logDate}`,
      habitId,
      date: logDate,
      createdAt: current?.createdAt ?? Date.now(),
    };
    setTodayHabitEntries(prev => ({ ...prev, [habitId]: newEntry }));
    await saveHabitEntry(newEntry);
  }

  async function handleToggleCheckpoint(habitId: string, checkpointId: string) {
    bumpHabit(habitId);
    const entry = todayHabitEntries[habitId];
    const current = entry?.checkpoints ?? {};
    const isNowChecked = !current[checkpointId];
    const updates: Partial<HabitEntry> = { checkpoints: { ...current, [checkpointId]: isNowChecked } };

    // If checkpoint label is numeric, accumulate into value
    const habit = habits.find(h => h.id === habitId);
    const cp = habit?.checkpoints?.find(c => c.id === checkpointId);
    const numVal = cp ? parseFloat(cp.label) : NaN;
    if (!isNaN(numVal)) {
      const currentValue = entry?.value ?? 0;
      updates.value = Math.max(0, currentValue + (isNowChecked ? numVal : -numVal));
    }

    await handleHabitUpdate(habitId, updates);
  }

  async function handleToggleBoolean(habitId: string) {
    const entry = todayHabitEntries[habitId];
    const willBeDone = !entry?.done;
    bumpHabit(habitId);
    await handleHabitUpdate(habitId, { done: willBeDone });
    if (logDate === today && habitReward) {
      const delta = willBeDone ? habitReward.earnPerCompletion : -habitReward.earnPerCompletion;
      const updated = { ...habitReward, balance: Math.max(0, Math.min(habitReward.budget, habitReward.balance + delta)), updatedAt: Date.now() };
      setHabitReward(updated);
      saveHabitRewardGoal(updated).catch(() => {});
    }
  }

  async function handleSetNumeric(habitId: string, value: number) {
    await handleHabitUpdate(habitId, { value });
  }

  async function handleSetCompletion(habitId: string, completion: HabitCompletion) {
    bumpHabit(habitId);
    const entry = todayHabitEntries[habitId];
    const current = entry?.completion ?? 'none';
    const next: HabitCompletion = current === completion ? 'none' : completion;
    await handleHabitUpdate(habitId, { completion: next });

    // Update cached streak only when logging for today
    if (logDate !== today) return;
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habit.type !== undefined) return;

    const wasCompleted = current !== 'none';
    const isNowCompleted = next !== 'none';

    // Reward balance still keys off completion-state change
    if (wasCompleted !== isNowCompleted && habitReward) {
      const delta = isNowCompleted ? habitReward.earnPerCompletion : -habitReward.earnPerCompletion;
      const updatedReward = { ...habitReward, balance: Math.max(0, Math.min(habitReward.budget, habitReward.balance + delta)), updatedAt: Date.now() };
      setHabitReward(updatedReward);
      saveHabitRewardGoal(updatedReward).catch(() => {});
    }

    // Recompute streak from the full entry history. The previous logic
    // walked from yesterday only and never detected longer gaps.
    const allEntries = await getAllHabitEntriesForHabit(habitId);
    const merged: HabitEntry[] = [
      ...allEntries.filter(e => e.date !== today),
      { id: `${habitId}_${today}`, habitId, date: today, completion: next, createdAt: Date.now() },
    ];
    const derived = deriveStreakState(habit, merged, today);
    if (streakStateNeedsWrite(habit, derived)) {
      const updated: Habit = { ...habit, streakCount: derived.streakCount };
      if (derived.lastCompletedDate !== undefined) updated.lastCompletedDate = derived.lastCompletedDate;
      else delete updated.lastCompletedDate;
      setHabits(prev => prev.map(h => h.id === habitId ? updated : h));
      await saveHabit(updated);
    }
  }

  async function handleAddHabit(habit: Habit) {
    setHabits(prev => [...prev, habit]);
    setShowAddHabit(false);
    await saveHabit(habit);
  }

  async function handleSaveEditedHabit(habit: Habit) {
    setHabits(prev => prev.map(h => h.id === habit.id ? habit : h));
    setEditingHabit(null);
    await saveHabit(habit);
  }

  async function handleArchiveHabit(habitId: string) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habitId === NF_HABIT_ID) return;
    const updated = { ...habit, archived: true };
    setHabits(prev => prev.filter(h => h.id !== habitId));
    await saveHabit(updated);
  }

  async function handleDeleteHabit(habitId: string) {
    if (habitId === NF_HABIT_ID) return;
    setHabits(prev => prev.filter(h => h.id !== habitId));
    await persistDeleteHabit(habitId);
  }

  async function handleCreateTaskFromHabit(habit: Habit, title: string, recurrence?: RecurrenceRule) {
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: title.trim(),
      done: false,
      myDay: true,
      dueDate: today,
      sourceHabitId: habit.id,
      recurrence,
      recurringGroupId: recurrence ? crypto.randomUUID() : undefined,
      createdAt: Date.now(),
      order: Date.now(),
    };
    await saveTodo(todo);
    const updated: Habit = { ...habit, linkedTaskIds: [...(habit.linkedTaskIds ?? []), todo.id] };
    setHabits(prev => prev.map(h => h.id === habit.id ? updated : h));
    await saveHabit(updated);
  }

  function handleDragEnd() {
    const fromId = dragHabitId.current;
    const toId = dragOverHabitId.current;
    if (!fromId || !toId || fromId === toId) {
      dragHabitId.current = null;
      dragOverHabitId.current = null;
      return;
    }
    const ordered = [...habits].sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
    const fromIdx = ordered.findIndex(h => h.id === fromId);
    const toIdx = ordered.findIndex(h => h.id === toId);
    const reordered = [...ordered];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const withOrder = reordered.map((h, i) => ({ ...h, order: i }));
    setHabits(withOrder);
    dragHabitId.current = null;
    dragOverHabitId.current = null;
    // Persist order asynchronously
    Promise.all(withOrder.map(h => saveHabit(h))).catch(() => {});
  }

  // ── Run handlers ────────────────────────────────────────────────────────────

  async function handleLogRun() {
    const run: RunEntry = { id: Date.now().toString(), date: logDate, distanceKm: runDist };
    setTodayRuns(prev => [...prev, run]);
    setAllRuns(prev => [...prev, run]);
    markNew(run.id);
    flashBtn('logRun');
    await saveRun(run);
  }

  async function handleDeleteRun(id: string) {
    setTodayRuns(prev => prev.filter(r => r.id !== id));
    setAllRuns(prev => prev.filter(r => r.id !== id));
    await persistDeleteRun(id);
  }

  // ── Strava import handlers ──────────────────────────────────────────────────

  async function handleOpenStravaPanel() {
    setShowStravaPanel(true);
    setStravaError(null);
    setStravaLoading(true);
    try {
      const acts = await fetchStravaActivities();
      setStravaActivities(acts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'server_error';
      setStravaError(msg);
    } finally {
      setStravaLoading(false);
    }
  }

  async function handleImportActivity(act: StravaActivity) {
    if (importingId !== null) return;
    setImportingId(act.strava_id);
    try {
      const run = await importStravaActivity(act.strava_id);
      setAllRuns(prev => [...prev, run]);
      if (run.date === logDate) setTodayRuns(prev => [...prev, run]);
      setImportedIds(prev => new Set(prev).add(act.strava_id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'server_error';
      if (msg !== 'already_imported') setStravaError(msg);
      else setImportedIds(prev => new Set(prev).add(act.strava_id));
    } finally {
      setImportingId(null);
    }
  }

  // ── Gratitude handlers ──────────────────────────────────────────────────────

  function handlePhotoSelect(file: File) {
    setPhotoError(null);
    if (!file.type.startsWith('image/')) { setPhotoError('Please select an image file.'); return; }
    if (file.size > 20 * 1024 * 1024) { setPhotoError('Image must be under 20 MB.'); return; }
    const preview = URL.createObjectURL(file);
    setPendingPhoto(file);
    setPendingPhotoPreview(preview);
  }

  function handleClearPhoto() {
    if (pendingPhotoPreview) URL.revokeObjectURL(pendingPhotoPreview);
    setPendingPhoto(null);
    setPendingPhotoPreview(null);
    setPhotoError(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }

  async function handleAddGratitude() {
    const text = newGratitude.trim();
    if (!text) return;
    setPhotoError(null);
    const id = Date.now().toString();
    const entry: GratitudeEntry = { id, date: logDate, text, createdAt: Date.now() };
    if (pendingPhoto) {
      try {
        const blob = await compressImage(pendingPhoto);
        entry.photoUrl = await uploadGratitudePhoto(id, blob);
      } catch {
        setPhotoError('Photo upload failed — try again.');
        return;
      }
    }
    setGratitudeEntries(prev => [...prev, entry]);
    markNew(id);
    flashBtn('addGratitude');
    setNewGratitude('');
    handleClearPhoto();
    setGratitudeSaved(true);
    setTimeout(() => setGratitudeSaved(false), 2000);
    await saveGratitudeEntry(entry);
  }

  async function handleDeleteGratitude(id: string) {
    setGratitudeEntries(prev => prev.filter(e => e.id !== id));
    await deleteGratitudeEntry(id);
  }

  // ── Weight handlers ──────────────────────────────────────────────────────────

  async function handleChangeUnit(unit: WeightUnit) {
    const currentKg = unitToKg(weightDisplayValue, weightUnit);
    setWeightUnit(unit);
    setWeightDisplayValue(kgToUnit(currentKg, unit));
    await saveWeightUnit(unit);
  }

  async function handleLogWeight() {
    const kg = unitToKg(weightDisplayValue, weightUnit);
    const entry: WeightEntry = { date: logDate, kg, createdAt: Date.now() };
    setTodayWeightEntry(entry);
    setAllWeightEntries(prev => [...prev.filter(e => e.date !== logDate), entry]);
    flashBtn('logWeight');
    await logWeightEntry(entry);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-cobalt-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const WEIGHT_STEP = weightUnit === 'stone' ? 0.1 : 0.1;
  const WEIGHT_QUICK = weightUnit === 'lbs' ? [-2, -1, 1, 2] : [-1, -0.5, 0.5, 1];
  const WEIGHT_MIN = weightUnit === 'lbs' ? 66 : weightUnit === 'stone' ? 4.7 : 30;

  // Compute which tabs have data logged today
  const tabHasData: Record<LogTab, boolean> = {
    lifting: sets.length > 0,
    habits: Object.values(todayHabitEntries).some(e => e.completion !== 'none' || e.done || (e.value ?? 0) > 0),
    running: todayRuns.length > 0,
    gratitude: gratitudeEntries.length > 0,
    weight: todayWeightEntry !== null,
    planner: false,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="screen-eyebrow text-cobalt-500">Big Dawg · Today's Grind</p>
        <h1 className="screen-title">Log</h1>
        <div className="flex items-center gap-2 mt-2">
          {/* Date pill — transparent date input overlaid so one tap opens native picker */}
          <div className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-colors ${logDate !== today ? 'bg-cobalt-500/15 text-cobalt-500' : 'bg-slate-100 dark:bg-ink-elevated text-slate-500 dark:text-slate-400'}`}>
            <Calendar size={14} />
            <span>{logDate === today ? 'Today' : formatDate(logDate)}</span>
            <input
              type="date" max={today} value={logDate}
              onChange={e => { if (e.target.value) setLogDate(e.target.value); }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          {logDate !== today && (
            <button onClick={() => setLogDate(today)} className="text-xs text-slate-400 hover:text-cobalt-500 transition-colors">back to today</button>
          )}
        </div>
      </div>

      {/* Sub-tabs — drag to reorder */}
      <SortableTabBar
        tabs={logTabOrder}
        activeId={logTab}
        onTabChange={id => setLogTab(id as LogTab)}
        onReorder={newOrder => {
          setLogTabOrder(newOrder);
          localStorage.setItem('logTabOrder', JSON.stringify(newOrder.map(t => t.id)));
        }}
        dots={tabHasData}
      />

      {/* ── Lifting Tab ──────────────────────────────────────────────────────── */}
      {logTab === 'lifting' && (
        <>
          {/* Target Card */}
          {tracksTarget && (
            <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
              <div className="flex items-center gap-3">
                <Flame size={18} className={targetMet ? 'text-green-400' : 'text-orange-400'} />
                <div className="flex-1 h-2 bg-slate-100 dark:bg-ink-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${targetMet ? 'bg-green-500' : 'bg-cobalt-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`text-sm font-bold w-9 text-right ${targetMet ? 'text-green-400' : 'text-cobalt-400'}`}>{pct}%</span>
                <button onClick={() => setShowTargetEdit(t => !t)} className="text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 transition-colors ml-1">
                  <SlidersHorizontal size={15} />
                </button>
              </div>
              {showTargetEdit && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-line">
                  <button onClick={() => adjustTarget(-5)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-ink-elevated text-slate-700 dark:text-slate-300 text-lg hover:bg-slate-200 dark:hover:bg-ink-elevated transition-colors">−</button>
                  <span className="text-slate-600 dark:text-slate-300 text-sm flex-1 text-center">{effectiveTarget} reps target</span>
                  <button onClick={() => adjustTarget(5)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-ink-elevated text-slate-700 dark:text-slate-300 text-lg hover:bg-slate-200 dark:hover:bg-ink-elevated transition-colors">+</button>
                </div>
              )}
              {targetMet && <p className="text-green-400 text-xs font-semibold mt-2">Target smashed. Big dawg energy.</p>}
            </div>
          )}

          {/* Exercise Selector */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Exercise</span>
            <button
              onClick={() => { setShowExerciseDropdown(d => !d); setShowAddExercise(false); setNewExerciseName(''); }}
              className="w-full flex items-center justify-between bg-slate-100 dark:bg-ink-elevated hover:bg-slate-200 dark:hover:bg-ink-elevated rounded-xl px-4 py-3 transition-colors"
            >
              <span className="text-slate-900 dark:text-white font-semibold text-sm">{selectedExercise.name}</span>
              <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${showExerciseDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showExerciseDropdown && (
              <div className="mt-2 bg-slate-100 dark:bg-ink-elevated rounded-xl overflow-hidden">
                {exercises.map(ex => (
                  <div key={ex.id} className="flex items-center border-b border-slate-200 dark:border-[#253347] last:border-0">
                    <button onClick={() => handleSelectExercise(ex.id)} className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-200 dark:hover:bg-ink-elevated transition-colors">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${ex.id === selectedExerciseId ? 'border-cobalt-500 bg-cobalt-500' : 'border-slate-400 dark:border-slate-600'}`}>
                        {ex.id === selectedExerciseId && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <span className={`text-sm ${ex.id === selectedExerciseId ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>{ex.name}</span>
                    </button>
                    {ex.id !== DEFAULT_EXERCISE_ID && (
                      <button onClick={() => handleDeleteExercise(ex.id)} className="px-4 py-3 text-slate-400 dark:text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
                <div className="border-t border-slate-200 dark:border-[#253347]">
                  {!showAddExercise ? (
                    <button onClick={() => { setShowAddExercise(true); setTimeout(() => addExerciseInputRef.current?.focus(), 50); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-cobalt-500 hover:bg-slate-200 dark:hover:bg-ink-elevated transition-colors">
                      <Plus size={15} /> Add exercise
                    </button>
                  ) : (
                    <div className="p-3 flex gap-2">
                      <input ref={addExerciseInputRef} value={newExerciseName} onChange={e => setNewExerciseName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddExercise(); if (e.key === 'Escape') { setShowAddExercise(false); setNewExerciseName(''); } }}
                        placeholder="Exercise name"
                        className="flex-1 bg-white dark:bg-ink text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-slate-200 dark:border-transparent"
                      />
                      <button onClick={handleAddExercise} className="px-3 py-2 bg-cobalt-500 hover:bg-cobalt-600 text-white text-sm font-semibold rounded-xl transition-colors">Add</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedExercise.id !== DEFAULT_EXERCISE_ID && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-line space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-xs">Track daily target</span>
                  <button onClick={handleToggleTarget} className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${selectedExercise.trackTarget ? 'bg-cobalt-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${selectedExercise.trackTarget ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {selectedExercise.trackTarget && (
                  <div className="flex items-center gap-2">
                    <button className="stepper-btn" onClick={() => adjustTarget(-5)}>−</button>
                    <span className="text-slate-600 dark:text-slate-300 text-sm flex-1 text-center">{effectiveTarget ?? 40} reps target</span>
                    <button className="stepper-btn" onClick={() => adjustTarget(5)}>+</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Sets', value: sets.length },
              { label: 'Top Weight', value: todayWorkout ? `${getMaxWeight(todayWorkout)} kg` : '—' },
              { label: 'Total Reps', value: totalReps },
            ].map(stat => (
              <div key={stat.label} className="bg-white dark:bg-ink-surface rounded-2xl p-3 text-center shadow-sm border border-slate-200 dark:border-transparent">
                <div className="text-xl font-extrabold text-slate-900 dark:text-white">{stat.value}</div>
                <div className="text-xs text-slate-400 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Today's Sets */}
          {sets.length > 0 && (
            <div className="bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
              <button
                onClick={() => setShowSets(s => !s)}
                className="w-full flex items-center justify-between px-4 pt-3 pb-3"
              >
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{logDate === today ? "Today's" : formatDate(logDate)} Sets — {sets.length} logged</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showSets ? 'rotate-180' : ''}`} />
              </button>
              {showSets && (() => {
                // Build display groups: consecutive sets sharing a supersetGroup are one block
                type DisplayGroup =
                  | { kind: 'single'; set: WorkoutSet; n: number }
                  | { kind: 'superset'; items: { set: WorkoutSet; n: number }[]; gid: string };
                const groups: DisplayGroup[] = [];
                let i = 0, n = 1;
                while (i < sets.length) {
                  const s = sets[i];
                  if (s.supersetGroup) {
                    const gid = s.supersetGroup;
                    const items: { set: WorkoutSet; n: number }[] = [];
                    while (i < sets.length && sets[i].supersetGroup === gid) { items.push({ set: sets[i], n: n++ }); i++; }
                    groups.push({ kind: 'superset', items, gid });
                  } else {
                    groups.push({ kind: 'single', set: s, n: n++ }); i++;
                  }
                }
                return groups.map(g =>
                  g.kind === 'single' ? (
                    <div key={g.set.id} className={`flex items-center px-4 py-3 border-t border-slate-100 dark:border-line ${newItemId === g.set.id ? 'animate-pop-in' : ''}`}>
                      <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide w-12">Set {g.n}</span>
                      <span className="flex-1 text-slate-900 dark:text-white font-bold text-lg">{g.set.weight} kg × {g.set.reps}</span>
                      <button onClick={() => handleDeleteSet(g.set.id)} className="text-slate-400 dark:text-slate-600 hover:text-red-400 transition-colors p-1"><Trash2 size={16} /></button>
                    </div>
                  ) : (
                    <div key={g.gid} className={`border-t border-slate-100 dark:border-line ${g.items.some(it => newItemId === it.set.id) ? 'animate-pop-in' : ''}`}>
                      <div className="flex items-center gap-2 px-4 pt-2 pb-0.5">
                        <span className="text-xs font-bold text-violet-500 uppercase tracking-wider">Superset</span>
                        <div className="flex-1 h-px bg-violet-200 dark:bg-violet-900/40" />
                      </div>
                      {g.items.map(({ set: s, n: sn }) => (
                        <div key={s.id} className="flex items-center py-2.5 pr-4 pl-8 border-l-2 border-violet-400 dark:border-violet-600 ml-4">
                          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide w-12">Set {sn}</span>
                          <span className="flex-1 text-slate-900 dark:text-white font-bold text-lg">{s.weight} kg × {s.reps}</span>
                          <button onClick={() => handleDeleteSet(s.id)} className="text-slate-400 dark:text-slate-600 hover:text-red-400 transition-colors p-1"><Trash2 size={16} /></button>
                        </div>
                      ))}
                    </div>
                  )
                );
              })()}
            </div>
          )}

          {/* Add Set */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 space-y-4 shadow-sm border border-slate-200 dark:border-transparent">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Add Set</span>
            <div>
              <label className="text-slate-400 text-xs mb-2 block">Weight (kg)</label>
              <div className="flex items-center gap-3">
                <button className="stepper-btn" onClick={() => setWeight(w => Math.max(0, +(w - 0.5).toFixed(1)))}>−</button>
                <span className="text-slate-900 dark:text-white font-extrabold text-3xl flex-1 text-center">{weight}</span>
                <button className="stepper-btn" onClick={() => setWeight(w => +(w + 0.5).toFixed(1))}>+</button>
              </div>
              <div className="flex gap-2 mt-2 justify-center">
                {[-5, -2.5, 2.5, 5].map(d => (
                  <button key={d} onClick={() => setWeight(w => Math.max(0, +(w + d).toFixed(1)))}
                    className="text-xs text-cobalt-500 bg-slate-100 dark:bg-ink-elevated px-3 py-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-ink-elevated transition-colors font-semibold">
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-slate-400 text-xs mb-2 block">Reps</label>
              <div className="flex items-center gap-3">
                <button className="stepper-btn" onClick={() => setReps(r => Math.max(1, r - 1))}>−</button>
                <span className="text-slate-900 dark:text-white font-extrabold text-3xl flex-1 text-center">{reps}</span>
                <button className="stepper-btn" onClick={() => setReps(r => r + 1)}>+</button>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-slate-400 text-xs">Superset</span>
                {supersetGroupId && <p className="text-violet-500 text-xs mt-0.5">Active — log each set, then turn off</p>}
              </div>
              <button onClick={() => setSupersetGroupId(id => id ? null : Date.now().toString())}
                className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${supersetGroupId ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${supersetGroupId ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <button onClick={() => handleLogSet()} className={`w-full py-3.5 active:scale-[0.98] text-white font-bold rounded-xl transition-all ${supersetGroupId ? 'bg-violet-600 hover:bg-violet-500' : 'bg-cobalt-500 hover:bg-cobalt-600'} ${btnFlash === 'logSet' ? 'animate-btn-success' : ''}`}>
              Log Set
            </button>
          </div>
        </>
      )}

      {/* ── Habits Tab ───────────────────────────────────────────────────────── */}
      {logTab === 'habits' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Today's Habits</span>
            <div className="flex gap-3">
              <button onClick={() => setShowManageHabits(m => !m)} className="text-slate-400 text-xs hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                {showManageHabits ? 'Done' : 'Manage'}
              </button>
              <button onClick={() => setShowAddHabit(true)} className="text-cobalt-500 text-xs font-semibold flex items-center gap-1 hover:text-cobalt-400 transition-colors">
                <Plus size={12} /> Add
              </button>
            </div>
          </div>

          {(() => {
            const sortedHabits = [...habits].sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
            const amHabits = sortedHabits.filter(h => h.timeOfDay === 'am');
            const pmHabits = sortedHabits.filter(h => h.timeOfDay === 'pm');
            const ungrouped = sortedHabits.filter(h => !h.timeOfDay);
            const hasGroups = amHabits.length > 0 || pmHabits.length > 0;

            function renderHabit(habit: Habit) {
              return (
                <div
                  key={habit.id}
                  draggable
                  onDragStart={() => { dragHabitId.current = habit.id; }}
                  onDragEnter={() => { dragOverHabitId.current = habit.id; }}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => e.preventDefault()}
                  className={`cursor-grab active:cursor-grabbing ${bumpedHabitId === habit.id ? 'animate-habit-bump' : ''}`}
                >
                  {habit.type !== undefined ? (
                    <HabitCard
                      habit={habit}
                      entry={todayHabitEntries[habit.id] ?? null}
                      showManage={showManageHabits && habit.id !== NF_HABIT_ID}
                      onToggleCheckpoint={id => handleToggleCheckpoint(habit.id, id)}
                      onToggleBoolean={() => handleToggleBoolean(habit.id)}
                      onSetNumeric={v => handleSetNumeric(habit.id, v)}
                      onArchive={() => handleArchiveHabit(habit.id)}
                      onDelete={() => handleDeleteHabit(habit.id)}
                    />
                  ) : (
                    <AtomicHabitCard
                      habit={habit}
                      entry={todayHabitEntries[habit.id] ?? null}
                      today={today}
                      showManage={showManageHabits}
                      onToggleFull={() => handleSetCompletion(habit.id, 'full')}
                      onToggleMicro={() => handleSetCompletion(habit.id, 'micro')}
                      onToggleCheckpoint={cpId => handleToggleCheckpoint(habit.id, cpId)}
                      onArchive={() => handleArchiveHabit(habit.id)}
                      onDelete={() => handleDeleteHabit(habit.id)}
                      onEdit={() => setEditingHabit(habit)}
                      onMeditate={habit.isMeditation ? () => setMeditatingHabitId(habit.id) : undefined}
                      onCreateTask={() => setCreateTaskHabit(habit)}
                    />
                  )}
                </div>
              );
            }

            // Thin drop zone rendered before the first item in a group so
            // the user can drag a habit all the way to position 0.
            function topSentinel(firstId: string) {
              return (
                <div
                  key="__sentinel__"
                  className="h-2 -mb-1"
                  onDragOver={e => e.preventDefault()}
                  onDragEnter={() => { dragOverHabitId.current = firstId; }}
                />
              );
            }

            if (!hasGroups) {
              return (
                <>
                  {ungrouped.length > 0 && topSentinel(ungrouped[0].id)}
                  {ungrouped.map(renderHabit)}
                </>
              );
            }

            return (
              <>
                {amHabits.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 pt-1">Morning</div>
                    {topSentinel(amHabits[0].id)}
                    {amHabits.map(renderHabit)}
                  </>
                )}
                {pmHabits.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 pt-2">Evening</div>
                    {topSentinel(pmHabits[0].id)}
                    {pmHabits.map(renderHabit)}
                  </>
                )}
                {ungrouped.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 pt-2">Other</div>
                    {topSentinel(ungrouped[0].id)}
                    {ungrouped.map(renderHabit)}
                  </>
                )}
              </>
            );
          })()}

          {habits.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              <p className="text-sm">No habits yet. Tap Add to create one.</p>
            </div>
          )}

          {/* Reward section */}
          <div className="pt-1">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Reward Fund</span>
            </div>
            <HabitRewardCard
              reward={habitReward}
              onSave={async (goal) => {
                setHabitReward(goal);
                await saveHabitRewardGoal(goal);
              }}
            />
          </div>

          {/* Future Me section */}
          <FutureMeSection />
        </div>
      )}

      {/* ── Running Tab ──────────────────────────────────────────────────────── */}
      {logTab === 'running' && (
        <>
          {/* Weekly Volume */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">This Week</span>
              <span className="text-xs text-slate-400">Mon – today</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-slate-900 dark:text-white">{weeklyKm}</span>
              <span className="text-slate-400 text-lg font-semibold">km</span>
            </div>
          </div>

          {/* Log Run */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 space-y-3 shadow-sm border border-slate-200 dark:border-transparent">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Log Run</span>
            <div className="flex items-center gap-3">
              <button className="stepper-btn" onClick={() => setRunDist(d => Math.max(0.5, +(d - 0.5).toFixed(1)))}>−</button>
              <span className="text-slate-900 dark:text-white font-extrabold text-3xl flex-1 text-center">{runDist} km</span>
              <button className="stepper-btn" onClick={() => setRunDist(d => +(d + 0.5).toFixed(1))}>+</button>
            </div>
            <button onClick={handleLogRun} className={`w-full py-3.5 bg-slate-100 dark:bg-ink-elevated hover:bg-slate-200 dark:hover:bg-ink-elevated active:scale-[0.98] text-slate-900 dark:text-white font-bold rounded-xl transition-all ${btnFlash === 'logRun' ? 'animate-btn-success' : ''}`}>
              Log Run
            </button>
            {todayRuns.length > 0 && (
              <div className="space-y-2 pt-1">
                {todayRuns.map(run => (
                  <div key={run.id} className={`flex items-center bg-slate-100 dark:bg-ink-elevated rounded-xl px-4 py-3 ${newItemId === run.id ? 'animate-pop-in' : ''}`}>
                    <span className="text-cobalt-500 font-bold flex-1">{run.distanceKm} km</span>
                    <button onClick={() => handleDeleteRun(run.id)} className="text-slate-400 dark:text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                  </div>
                ))}
                <div className="text-slate-400 text-xs text-center">
                  Total: {todayRuns.reduce((sum, r) => +(sum + r.distanceKm).toFixed(1), 0)} km today
                </div>
              </div>
            )}
          </div>

          {/* Import from Strava */}
          {stravaStatus?.connected && (
            <div className="bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
              <button
                onClick={() => showStravaPanel ? setShowStravaPanel(false) : handleOpenStravaPanel()}
                className="w-full flex items-center px-4 py-3 hover:bg-slate-50 dark:hover:bg-ink-elevated transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-[#FC4C02]/10 flex items-center justify-center mr-2.5 flex-shrink-0">
                  <span className="text-[#FC4C02] font-extrabold text-[10px]">S</span>
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex-1 text-left">Import from Strava</span>
                <ChevronRight size={14} className={`text-slate-400 transition-transform duration-200 ${showStravaPanel ? 'rotate-90' : ''}`} />
              </button>

              {showStravaPanel && (
                <div className="border-t border-slate-100 dark:border-line">
                  {stravaLoading && (
                    <p className="text-slate-400 text-sm text-center py-6">Loading activities…</p>
                  )}
                  {stravaError && (
                    <div className="px-4 py-4 text-center">
                      <p className="text-red-400 text-sm">
                        {stravaError === 'rate_limit' && 'Strava rate limit hit — try again in a few minutes.'}
                        {stravaError === 'not_connected' && 'Strava disconnected. Reconnect in the Progress tab.'}
                        {stravaError !== 'rate_limit' && stravaError !== 'not_connected' && 'Could not load activities. Try again.'}
                      </p>
                    </div>
                  )}
                  {!stravaLoading && !stravaError && stravaActivities.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-6">No recent Strava activities found.</p>
                  )}
                  {!stravaLoading && stravaActivities.map(act => {
                    const alreadyDone = importedIds.has(act.strava_id);
                    const isImporting = importingId === act.strava_id;
                    return (
                      <div key={act.strava_id} className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-line last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-900 dark:text-white text-sm font-semibold truncate">{act.name}</p>
                          <p className="text-slate-400 text-xs">{act.type} · {act.distance_km} km · {new Date(act.start_date).toLocaleDateString()}</p>
                        </div>
                        {alreadyDone ? (
                          <span className="text-green-500 text-xs font-semibold ml-3 flex-shrink-0">Logged</span>
                        ) : (
                          <button
                            onClick={() => handleImportActivity(act)}
                            disabled={isImporting}
                            className="ml-3 px-3 py-1.5 bg-[#FC4C02] hover:bg-[#e34300] disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex-shrink-0"
                          >
                            {isImporting ? '…' : 'Import'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Gratitude Tab ────────────────────────────────────────────────────── */}
      {logTab === 'gratitude' && (
        <div className="space-y-3">
          {/* Saved entries */}
          {gratitudeEntries.length > 0 && (
            <div className="space-y-2">
              {gratitudeEntries.map(entry => (
                <div key={entry.id} className={`bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent ${newItemId === entry.id ? 'animate-pop-in' : ''}`}>
                  {entry.photoUrl && (
                    <button onClick={() => setLightboxUrl(entry.photoUrl!)} className="w-full block">
                      <img src={entry.photoUrl} alt="" className="w-full max-h-56 object-cover" />
                    </button>
                  )}
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <p className="flex-1 text-slate-900 dark:text-white text-sm leading-relaxed">{entry.text}</p>
                    <button onClick={() => handleDeleteGratitude(entry.id)} className="text-slate-400 dark:text-slate-600 hover:text-red-400 transition-colors mt-0.5 flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New entry form */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 space-y-3 shadow-sm border border-slate-200 dark:border-transparent">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Gratitude</span>
              {gratitudeSaved && <span className="text-green-400 text-xs font-semibold">Saved</span>}
            </div>

            {/* Photo preview */}
            {pendingPhotoPreview && (
              <div className="relative rounded-xl overflow-hidden">
                <img src={pendingPhotoPreview} alt="Preview" className="w-full max-h-48 object-cover" />
                <button onClick={handleClearPhoto}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors">
                  <X size={14} />
                </button>
              </div>
            )}

            <textarea value={newGratitude} onChange={e => setNewGratitude(e.target.value)}
              placeholder="What are you grateful for?" rows={2}
              className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
            />

            {photoError && <p className="text-red-400 text-xs">{photoError}</p>}

            <div className="flex gap-2">
              {/* Hidden file input */}
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoSelect(f); }}
              />
              <button onClick={() => photoInputRef.current?.click()}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${pendingPhoto ? 'bg-cobalt-500/15 dark:bg-cobalt-500/20 text-cobalt-500' : 'bg-slate-100 dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-ink-elevated'}`}>
                <ImagePlus size={14} />
                {pendingPhoto ? 'Change' : 'Photo'}
              </button>
              <button onClick={handleAddGratitude}
                className={`flex-1 py-2.5 bg-slate-100 dark:bg-ink-elevated hover:bg-slate-200 dark:hover:bg-ink-elevated active:scale-[0.98] text-slate-600 dark:text-slate-300 font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2 ${btnFlash === 'addGratitude' ? 'animate-btn-success' : ''}`}>
                <Plus size={14} /> Add Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"><X size={24} /></button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ── Weight Tab ───────────────────────────────────────────────────────── */}
      {logTab === 'weight' && (
        <div className="space-y-4">
          {/* Unit Selector */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Unit</span>
            <div className="grid grid-cols-3 gap-2">
              {(['kg', 'lbs', 'stone'] as WeightUnit[]).map(u => (
                <button key={u} onClick={() => handleChangeUnit(u)}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${weightUnit === u ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-ink-elevated'}`}>
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Log Weight */}
          <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 space-y-3 shadow-sm border border-slate-200 dark:border-transparent">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Log Weight</span>
            <div className="flex items-center gap-3">
              <button className="stepper-btn" onClick={() => setWeightDisplayValue(v => +(Math.max(WEIGHT_MIN, v - WEIGHT_STEP)).toFixed(1))}>−</button>
              <span className="text-slate-900 dark:text-white font-extrabold text-3xl flex-1 text-center">{weightDisplayValue} {weightUnit}</span>
              <button className="stepper-btn" onClick={() => setWeightDisplayValue(v => +(v + WEIGHT_STEP).toFixed(1))}>+</button>
            </div>
            <div className="flex gap-2 justify-center">
              {WEIGHT_QUICK.map(d => (
                <button key={d} onClick={() => setWeightDisplayValue(v => +(Math.max(WEIGHT_MIN, v + d)).toFixed(1))}
                  className="text-xs text-cobalt-500 bg-slate-100 dark:bg-ink-elevated px-3 py-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-ink-elevated transition-colors font-semibold">
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
            </div>
            <button onClick={handleLogWeight}
              className={`w-full py-3.5 bg-cobalt-500 hover:bg-cobalt-600 active:scale-[0.98] text-white font-bold rounded-xl transition-all ${btnFlash === 'logWeight' ? 'animate-btn-success' : ''}`}>
              {logDate === today ? "Log Today's Weight" : `Log Weight for ${formatDate(logDate)}`}
            </button>
            {todayWeightEntry && (
              <p className="text-green-400 text-xs text-center font-semibold">
                Logged ✓ ({kgToUnit(todayWeightEntry.kg, weightUnit)} {weightUnit})
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Planner Tab ──────────────────────────────────────────────────────── */}
      {logTab === 'planner' && <PlannerTab />}

      {/* Add Habit Modal */}
      {showAddHabit && <HabitModal onClose={() => setShowAddHabit(false)} onSave={handleAddHabit} />}

      {/* Edit Habit Modal */}
      {editingHabit && (
        <HabitModal
          initialHabit={editingHabit}
          onClose={() => setEditingHabit(null)}
          onSave={handleSaveEditedHabit}
          onDelete={() => { handleDeleteHabit(editingHabit.id); setEditingHabit(null); }}
        />
      )}

      {/* Meditation Overlay */}
      {meditatingHabitId && (
        <MeditationOverlay
          onComplete={() => handleSetCompletion(meditatingHabitId, 'full')}
          onClose={() => setMeditatingHabitId(null)}
        />
      )}

      {/* Create Task from Habit Modal */}
      {createTaskHabit && (
        <CreateTaskFromHabitModal
          habit={createTaskHabit}
          onClose={() => setCreateTaskHabit(null)}
          onSave={(title, recurrence) => {
            handleCreateTaskFromHabit(createTaskHabit, title, recurrence);
            setCreateTaskHabit(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Habit Card (legacy) ───────────────────────────────────────────────────────

function HabitCard({
  habit, entry, showManage,
  onToggleCheckpoint, onToggleBoolean, onSetNumeric, onArchive, onDelete,
}: {
  habit: Habit;
  entry: HabitEntry | null;
  showManage: boolean;
  onToggleCheckpoint: (id: string) => void;
  onToggleBoolean: () => void;
  onSetNumeric: (v: number) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const completion = habitCompletion(habit, entry);
  const allDone = completion === 1;

  return (
    <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-slate-300 dark:text-slate-700 cursor-grab touch-none"><GripVertical size={14} /></div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{habit.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {allDone && <span className="text-green-400 text-xs font-semibold">Done</span>}
          {showManage && (
            <>
              <button onClick={onArchive} className="text-slate-400 hover:text-yellow-400 transition-colors text-xs flex items-center gap-1">
                <X size={12} /> Archive
              </button>
              <button onClick={onDelete} className="text-slate-400 hover:text-red-400 transition-colors text-xs flex items-center gap-1">
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {habit.type === 'checkpoint' && (() => {
        const hasNumericLabels = (habit.checkpoints ?? []).some(cp => !isNaN(parseFloat(cp.label)));
        const total = entry?.value ?? 0;
        return (
          <>
            {hasNumericLabels && (
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white">{total}</span>
                {habit.unit && <span className="text-sm text-slate-400">{habit.unit}</span>}
              </div>
            )}
            <div className={`grid gap-2 ${(habit.checkpoints?.length ?? 0) <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {(habit.checkpoints ?? []).map(cp => {
                const done = entry?.checkpoints?.[cp.id] ?? false;
                return (
                  <button key={cp.id} onClick={() => onToggleCheckpoint(cp.id)}
                    className={`py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${done ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-ink-elevated'}`}>
                    {cp.label}
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}

      {habit.type === 'boolean' && (
        <button onClick={onToggleBoolean}
          className={`w-full py-3 rounded-xl font-semibold transition-all active:scale-95 ${entry?.done ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-ink-elevated'}`}>
          {entry?.done ? 'Done ✓' : 'Mark done'}
        </button>
      )}

      {habit.type === 'numeric' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button className="stepper-btn" onClick={() => onSetNumeric(Math.max(0, (entry?.value ?? 0) - 1))}>−</button>
            <span className="text-slate-900 dark:text-white font-extrabold text-2xl flex-1 text-center">
              {entry?.value ?? 0}{habit.unit ? ` ${habit.unit}` : ''}
            </span>
            <button className="stepper-btn" onClick={() => onSetNumeric((entry?.value ?? 0) + 1)}>+</button>
          </div>
          {(entry?.value ?? 0) > 0 && (
            <button
              onClick={() => onSetNumeric(0)}
              className="w-full text-xs text-slate-400 hover:text-red-400 transition-colors py-1 text-center"
            >
              Reset to zero
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Atomic Habit Card ────────────────────────────────────────────────────────

function AtomicHabitCard({
  habit, entry, today, showManage, onToggleFull, onToggleMicro, onToggleCheckpoint, onArchive, onDelete, onEdit, onMeditate, onCreateTask,
}: {
  habit: Habit;
  entry: HabitEntry | null;
  today: string;
  showManage: boolean;
  onToggleFull: () => void;
  onToggleMicro: () => void;
  onToggleCheckpoint: (cpId: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMeditate?: () => void;
  onCreateTask?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const completion = entry?.completion ?? 'none';
  const isDone = completion === 'full';
  const isMicro = completion === 'micro';
  const isAnyDone = isDone || isMicro;

  // Display name: new format uses name, old format used action
  const name = habit.name ?? habit.action ?? 'Habit';
  // Cue: new format uses cue, old format used trigger
  const cue = habit.cue ?? habit.trigger;

  const streak = habit.streakCount ?? 0;


  return (
    <div className="bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
      {/* Main row — always visible */}
      <div className="flex items-center px-4 py-3.5 gap-3">
        {/* Drag handle */}
        <div className="text-slate-300 dark:text-slate-700 flex-shrink-0 -ml-1 cursor-grab touch-none">
          <GripVertical size={14} />
        </div>

        {/* Checkbox — primary tap target */}
        <button onClick={onToggleFull} className="flex-shrink-0 transition-all active:scale-90">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
            isDone ? 'bg-cobalt-500' : 'border-2 border-slate-300 dark:border-slate-600 hover:border-cobalt-400'
          }`}>
            {isDone && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
          </div>
        </button>

        {/* Name + Cue (always visible) */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-tight ${isDone ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
            {habit.isBadHabit ? 'Avoided: ' : ''}{name}
          </p>
          {cue && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              When {cue}…
            </p>
          )}
        </div>

        {/* Begin pill — meditation habits only */}
        {habit.isMeditation && !isDone && onMeditate && (
          <button
            onClick={onMeditate}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0 bg-violet-600 hover:bg-violet-500 text-white transition-all active:scale-95"
          >
            Begin →
          </button>
        )}

        {/* Micro pill — visible on main row if habit has micro version */}
        {habit.microHabit && !isDone && (
          <button
            onClick={onToggleMicro}
            className={`text-xs px-2.5 py-1 rounded-lg font-semibold flex-shrink-0 transition-all active:scale-95 ${
              isMicro ? 'bg-yellow-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            {isMicro ? '½ ✓' : 'Micro'}
          </button>
        )}

        {/* Streak */}
        {streak > 0 && (
          <span className="text-xs font-bold flex-shrink-0 text-orange-400">
            🔥{streak}d
          </span>
        )}

        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)} className="text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 transition-colors p-1 flex-shrink-0">
          <ChevronDown size={14} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Checkpoints (touchpoints) — shown inline below main row */}
      {habit.checkpoints && habit.checkpoints.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {habit.checkpoints.map(cp => {
            const done = entry?.checkpoints?.[cp.id] ?? false;
            return (
              <button
                key={cp.id}
                onClick={e => { e.stopPropagation(); onToggleCheckpoint(cp.id); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                  done ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-ink-elevated'
                }`}
              >
                {done ? '✓ ' : ''}{cp.label}
              </button>
            );
          })}
        </div>
      )}


      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-line px-4 py-3 space-y-3">

          {/* Micro version (full detail) */}
          {habit.microHabit && (
            <button
              onClick={onToggleMicro}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.98] ${
                isMicro ? 'bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700/40' : 'bg-slate-100 dark:bg-ink-elevated hover:bg-slate-200 dark:hover:bg-ink-elevated'
              }`}
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                isMicro ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {isMicro && <div className="w-1.5 h-1.5 rounded-sm bg-white" />}
              </div>
              <div>
                <p className={`text-xs font-semibold ${isMicro ? 'text-yellow-700 dark:text-yellow-400' : 'text-slate-400 dark:text-slate-500'}`}>Two-Minute Rule</p>
                <p className={`text-sm ${isMicro ? 'text-yellow-800 dark:text-yellow-200' : 'text-slate-700 dark:text-slate-300'}`}>{habit.microHabit}</p>
              </div>
            </button>
          )}

          {/* Cue (full format) */}
          {cue && (
            <div className="flex gap-2 items-start">
              <span className="text-slate-400 text-xs mt-0.5 flex-shrink-0">📍</span>
              <p className="text-xs text-slate-500 leading-relaxed italic">
                "When {cue}, I will {name.toLowerCase()}."
              </p>
            </div>
          )}

          {/* Reward */}
          {habit.reward && (
            <div className={`rounded-xl px-3 py-2.5 transition-all ${
              isAnyDone ? 'bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700/30' : 'bg-slate-100 dark:bg-ink-elevated'
            }`}>
              {isAnyDone
                ? <p className="text-sm text-green-700 dark:text-green-400">🎉 Nice work! Enjoy: <span className="font-semibold">{habit.reward}</span></p>
                : <p className="text-xs text-slate-500">🎁 Reward: {habit.reward}</p>
              }
            </div>
          )}

          {/* Identity */}
          {habit.identity && (
            <div className="flex gap-2 items-start">
              <span className="text-slate-400 text-xs mt-0.5 flex-shrink-0">💪</span>
              <p className="text-xs text-slate-500">
                Reinforces: <span className="text-slate-600 dark:text-slate-400 italic">{habit.identity}</span>
              </p>
            </div>
          )}

          {/* Specific days */}
          {habit.frequency === 'specific_days' && habit.specificDays && habit.specificDays.length > 0 && (
            <div className="flex gap-2 items-center">
              <span className="text-slate-400 text-xs flex-shrink-0">📅</span>
              <p className="text-xs text-slate-500">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                  .filter((_, i) => habit.specificDays!.includes(i))
                  .join(', ')}
              </p>
            </div>
          )}

          {/* Next Action */}
          {habit.nextAction && (
            <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl px-3 py-2.5">
              <span className="text-yellow-500 text-xs mt-0.5 flex-shrink-0">⚡</span>
              <div>
                <p className="text-[10px] font-bold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">Next Action</p>
                <p className="text-xs text-slate-700 dark:text-slate-200 mt-0.5">{habit.nextAction}</p>
              </div>
            </div>
          )}

          {/* Linked tasks count */}
          {(habit.linkedTaskIds?.length ?? 0) > 0 && (
            <p className="text-xs text-violet-400 flex items-center gap-1">
              <span>🔗</span> {habit.linkedTaskIds!.length} linked task{habit.linkedTaskIds!.length !== 1 ? 's' : ''}
            </p>
          )}

          {/* Edit + Archive + Delete */}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={onEdit} className="flex items-center gap-1.5 text-xs text-cobalt-500 hover:text-cobalt-400 transition-colors">
              <Pencil size={12} /> Edit
            </button>
            {onCreateTask && (
              <button onClick={onCreateTask} className="flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-400 transition-colors">
                <Plus size={12} /> Task
              </button>
            )}
            {showManage && (
              <>
                <button onClick={onArchive} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-yellow-400 transition-colors">
                  <X size={12} /> Archive
                </button>
                <button onClick={onDelete} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors">
                  <Trash2 size={12} /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Meditation Overlay ───────────────────────────────────────────────────────

const SESSION_OPTIONS = [2, 5, 10, 15, 20];

function MeditationOverlay({
  onComplete,
  onClose,
}: {
  onComplete: () => void;
  onClose: () => void;
}) {
  const [sessionMinutes, setSessionMinutes] = useState(5);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fading, setFading] = useState(false);
  const totalSeconds = sessionMinutes * 60;

  useEffect(() => {
    if (!started || paused || fading) return;
    if (elapsed >= totalSeconds) {
      setFading(true);
      setTimeout(() => { onComplete(); onClose(); }, 1500);
      return;
    }
    const t = setTimeout(() => setElapsed(e => e + 1), 1000);
    return () => clearTimeout(t);
  }, [started, paused, fading, elapsed, totalSeconds]);

  // 4-1-6 cycle = 11 s
  const cyclePos = elapsed % 11;
  const phase: 'in' | 'hold' | 'out' = cyclePos < 4 ? 'in' : cyclePos < 5 ? 'hold' : 'out';
  const phaseLabel = phase === 'in' ? 'Breathe In' : phase === 'hold' ? 'Hold' : 'Breathe Out';
  const countdown = phase === 'in' ? 4 - cyclePos : phase === 'hold' ? 5 - cyclePos : 11 - cyclePos;
  const remaining = Math.max(0, totalSeconds - elapsed);

  function fmt(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function handleEnd() { onComplete(); onClose(); }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#03050f] transition-opacity duration-[1500ms] ${fading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
        <span className="text-slate-600 text-sm font-medium">🧘 Meditation</span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-400 transition-colors p-1">
          <X size={20} />
        </button>
      </div>

      {!started ? (
        /* ── Setup screen ─────────────────────────────────────────────────── */
        <div className="flex flex-col items-center gap-10 px-6 w-full max-w-xs text-center">
          <div>
            <div className="text-5xl mb-4">🧘</div>
            <h2 className="text-white text-2xl font-bold tracking-tight">Meditation</h2>
            <p className="text-slate-500 text-sm mt-2 leading-relaxed">
              4-1-6 breathing activates the parasympathetic nervous system for calm and stress relief
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 w-full">
            <span className="text-slate-600 text-xs uppercase tracking-wider font-semibold">Session length</span>
            <div className="flex gap-2">
              {SESSION_OPTIONS.map(m => (
                <button
                  key={m}
                  onClick={() => setSessionMinutes(m)}
                  className={`w-12 h-12 rounded-2xl text-sm font-bold transition-all ${
                    sessionMinutes === m
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                      : 'bg-[#0d1220] text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStarted(true)}
            className="w-24 h-24 rounded-full bg-violet-600 hover:bg-violet-500 active:scale-95 text-white font-bold text-lg transition-all shadow-xl shadow-violet-500/40 flex items-center justify-center"
          >
            Begin
          </button>
        </div>
      ) : (
        /* ── Active session ───────────────────────────────────────────────── */
        <div className="flex flex-col items-center gap-10">
          {/* Breathing circle */}
          <div className="relative flex items-center justify-center w-64 h-64">
            {/* Ambient glow layer */}
            <div
              className={`absolute w-64 h-64 rounded-full ${paused ? 'breathe-circle-paused' : 'breathe-circle'}`}
              style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)' }}
            />
            {/* Main ball */}
            <div
              className={`w-44 h-44 rounded-full ${paused ? 'breathe-circle-paused' : 'breathe-circle'}`}
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)' }}
            />
          </div>

          {/* Phase + countdown */}
          <div className="text-center -mt-4">
            <p className={`text-2xl font-light tracking-widest transition-colors duration-500 ${
              phase === 'hold' ? 'text-violet-300' : 'text-white'
            }`}>
              {phaseLabel}
            </p>
            <p className="text-5xl font-thin text-slate-400 mt-1 tabular-nums">{countdown}</p>
          </div>

          {/* Progress bar */}
          <div className="flex flex-col items-center gap-2 w-56">
            <div className="flex w-full justify-between">
              <span className="text-slate-600 text-xs tabular-nums">{fmt(elapsed)}</span>
              <span className="text-slate-600 text-xs tabular-nums">-{fmt(remaining)}</span>
            </div>
            <div className="w-full h-1 bg-[#0d1220] rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500/50 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, (elapsed / totalSeconds) * 100)}%` }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-3">
            <button
              onClick={() => setPaused(p => !p)}
              className="px-6 py-2.5 rounded-2xl bg-[#0d1220] hover:bg-[#151d30] text-slate-400 hover:text-white text-sm font-semibold transition-all"
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={handleEnd}
              className="px-6 py-2.5 rounded-2xl bg-[#0d1220] hover:bg-[#151d30] text-slate-400 hover:text-white text-sm font-semibold transition-all"
            >
              End Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Habit Reward Card ────────────────────────────────────────────────────────

function HabitRewardCard({
  reward,
  onSave,
}: {
  reward: HabitRewardGoal | null;
  onSave: (g: HabitRewardGoal) => void;
}) {
  const [editing, setEditing] = useState(!reward);
  const [goalName, setGoalName] = useState(reward?.goalName ?? '');
  const [budgetStr, setBudgetStr] = useState(String(reward?.budget ?? 50));
  const [earnStr, setEarnStr] = useState(String(reward?.earnPerCompletion ?? 1));
  const [currency, setCurrency] = useState(reward?.currency ?? '£');

  // Sync fields when reward prop changes (e.g. on first load)
  useEffect(() => {
    if (reward && editing && !goalName) {
      setGoalName(reward.goalName);
      setBudgetStr(String(reward.budget));
      setEarnStr(String(reward.earnPerCompletion));
      setCurrency(reward.currency);
    }
  }, [reward]);

  function handleSave() {
    const now = Date.now();
    const budget = Math.max(1, parseFloat(budgetStr) || 1);
    const earn = Math.max(0.01, parseFloat(earnStr) || 0.01);
    onSave({
      goalName: goalName.trim() || 'My Reward',
      budget,
      earnPerCompletion: earn,
      balance: reward?.balance ?? 0,
      currency,
      createdAt: reward?.createdAt ?? now,
      updatedAt: now,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 space-y-3 shadow-sm border border-slate-200 dark:border-transparent">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Reward Goal</span>
          {reward && (
            <button onClick={() => setEditing(false)} className="text-slate-400 text-xs hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              Cancel
            </button>
          )}
        </div>
        <div>
          <label className="text-slate-400 text-xs block mb-1.5">What's your reward?</label>
          <input
            value={goalName}
            onChange={e => setGoalName(e.target.value)}
            placeholder="e.g. New jumper"
            className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs block mb-1.5">Total budget</label>
            <div className="flex items-center gap-1.5">
              <input
                value={currency}
                onChange={e => setCurrency(e.target.value.slice(-1) || '£')}
                className="w-8 bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-lg px-1.5 py-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-cobalt-500"
              />
              <input
                type="number" min={1} value={budgetStr}
                onChange={e => setBudgetStr(e.target.value)}
                onBlur={e => setBudgetStr(String(Math.max(1, parseFloat(e.target.value) || 1)))}
                className="flex-1 bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500"
              />
            </div>
          </div>
          <div>
            <label className="text-slate-400 text-xs block mb-1.5">Earn per completion</label>
            <input
              type="number" min={0.01} step={0.5} value={earnStr}
              onChange={e => setEarnStr(e.target.value)}
              onBlur={e => setEarnStr(String(Math.max(0.01, parseFloat(e.target.value) || 0.01)))}
              className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={!goalName.trim()}
          className="w-full py-3 bg-cobalt-500 hover:bg-cobalt-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
        >
          Save Goal
        </button>
      </div>
    );
  }

  const pct = Math.min(100, Math.round(((reward?.balance ?? 0) / (reward?.budget ?? 1)) * 100));
  const isComplete = (reward?.balance ?? 0) >= (reward?.budget ?? Infinity);

  return (
    <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Reward</span>
        <button onClick={() => { setGoalName(reward?.goalName ?? ''); setBudgetStr(String(reward?.budget ?? 50)); setEarnStr(String(reward?.earnPerCompletion ?? 1)); setCurrency(reward?.currency ?? '£'); setEditing(true); }} className="text-slate-400 text-xs hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          Edit
        </button>
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-bold ${isComplete ? 'text-green-400' : 'text-slate-900 dark:text-white'}`}>
          {isComplete ? '🎉 ' : '🎁 '}{reward?.goalName}
        </span>
        <span className={`text-sm font-extrabold tabular-nums ${isComplete ? 'text-green-400' : 'text-cobalt-500'}`}>
          {reward?.currency}{(reward?.balance ?? 0).toFixed(2)} / {reward?.currency}{reward?.budget}
        </span>
      </div>
      <div className="h-2.5 bg-slate-100 dark:bg-ink-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-cobalt-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-slate-400">{pct}% saved</span>
        <span className="text-xs text-slate-400">{reward?.currency}{reward?.earnPerCompletion}/completion</span>
      </div>
      {isComplete && (
        <div className="mt-3 py-2.5 px-3 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700/30 rounded-xl text-center">
          <p className="text-sm font-semibold text-green-600 dark:text-green-400">Goal reached! Treat yourself 🎉</p>
        </div>
      )}
    </div>
  );
}

// ─── Habit Modal (Add + Edit) ──────────────────────────────────────────────────

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function HabitModal({
  initialHabit,
  onClose,
  onSave,
  onDelete,
}: {
  initialHabit?: Habit;
  onClose: () => void;
  onSave: (h: Habit) => void;
  onDelete?: () => void;
}) {
  const isEdit = !!initialHabit;
  const [name, setName] = useState(initialHabit?.name ?? '');
  const [frequency, setFrequency] = useState<HabitFrequency>(initialHabit?.frequency ?? 'daily');
  const [specificDays, setSpecificDays] = useState<number[]>(initialHabit?.specificDays ?? [1, 2, 3, 4, 5]);
  const [showDetails, setShowDetails] = useState(isEdit); // open details on edit
  const [cue, setCue] = useState(initialHabit?.cue ?? initialHabit?.trigger ?? '');
  const [microHabit, setMicroHabit] = useState(initialHabit?.microHabit ?? '');
  const [reward, setReward] = useState(initialHabit?.reward ?? '');
  const [identity, setIdentity] = useState(initialHabit?.identity ?? '');
  const [nextAction, setNextAction] = useState(initialHabit?.nextAction ?? '');
  const [isBadHabit, setIsBadHabit] = useState(initialHabit?.isBadHabit ?? false);
  const [isMeditation, setIsMeditation] = useState(initialHabit?.isMeditation ?? false);
  const [timeOfDay, setTimeOfDay] = useState<'am' | 'pm' | undefined>(initialHabit?.timeOfDay);
  // Touchpoints (optional checkpoints throughout the day)
  const [checkpoints, setCheckpoints] = useState<HabitCheckpoint[]>(
    initialHabit?.checkpoints && initialHabit.type === undefined ? initialHabit.checkpoints : []
  );
  const [newCheckpointLabel, setNewCheckpointLabel] = useState('');

  function toggleDay(i: number) {
    setSpecificDays(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i]);
  }

  function handleSave() {
    if (!name.trim()) return;
    const habit: Habit = {
      ...(initialHabit ?? {}),
      id: initialHabit?.id ?? Date.now().toString(),
      name: name.trim(),
      frequency,
      specificDays: frequency === 'specific_days' ? specificDays : undefined,
      cue: cue.trim() || undefined,
      microHabit: microHabit.trim() || undefined,
      reward: reward.trim() || undefined,
      identity: identity.trim() || undefined,
      nextAction: nextAction.trim() || undefined,
      isBadHabit: isBadHabit || undefined,
      isMeditation: isMeditation || undefined,
      timeOfDay: timeOfDay,
      checkpoints: checkpoints.length > 0 ? checkpoints : undefined,
      streakCount: initialHabit?.streakCount ?? 0,
      lastCompletedDate: initialHabit?.lastCompletedDate,
      createdAt: initialHabit?.createdAt ?? Date.now(),
      archived: initialHabit?.archived ?? false,
      order: initialHabit?.order,
    };
    onSave(habit);
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={onClose}>
      <div
        className="bg-slate-50 dark:bg-ink w-full max-w-lg mx-auto rounded-t-3xl p-5 space-y-4"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-slate-900 dark:text-white font-extrabold text-xl">{isEdit ? 'Edit Habit' : 'New Habit'}</h2>
          <button onClick={onClose} className="text-cobalt-500 font-semibold">Cancel</button>
        </div>

        {/* Habit name */}
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Run 10km, Morning meditation…"
          className="w-full bg-white dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-slate-200 dark:border-transparent"
        />

        {/* Frequency */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">How often?</div>
          <div className="grid grid-cols-2 gap-2">
            {(['daily', 'specific_days'] as HabitFrequency[]).map(f => (
              <button key={f} onClick={() => setFrequency(f)}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${frequency === f ? 'bg-cobalt-500 text-white' : 'bg-white dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-elevated border border-slate-200 dark:border-transparent'}`}>
                {f === 'daily' ? 'Daily' : 'Specific days'}
              </button>
            ))}
          </div>
          {frequency === 'specific_days' && (
            <div className="flex gap-1 mt-2">
              {DAY_LABELS.map((d, i) => (
                <button key={i} onClick={() => toggleDay(i)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${specificDays.includes(i) ? 'bg-cobalt-500 text-white' : 'bg-white dark:bg-ink-elevated text-slate-400 border border-slate-200 dark:border-transparent'}`}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Time of day (optional) */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Time of day (optional)</div>
          <div className="grid grid-cols-3 gap-2">
            {([undefined, 'am', 'pm'] as const).map(t => (
              <button key={t ?? 'none'} onClick={() => setTimeOfDay(t)}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${timeOfDay === t ? 'bg-cobalt-500 text-white' : 'bg-white dark:bg-ink-elevated text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-elevated border border-slate-200 dark:border-transparent'}`}>
                {t === undefined ? 'Any' : t === 'am' ? 'Morning' : 'Evening'}
              </button>
            ))}
          </div>
        </div>

        {/* Touchpoints (optional daily checkpoints) */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Touchpoints (optional)</div>
          <p className="text-xs text-slate-400 mb-2">Break the habit into smaller check-ins throughout the day, e.g. Breakfast, Lunch, Dinner.</p>
          {checkpoints.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {checkpoints.map(cp => (
                <div key={cp.id} className="flex items-center gap-1 bg-white dark:bg-ink-elevated border border-slate-200 dark:border-transparent rounded-lg px-2.5 py-1.5">
                  <span className="text-sm text-slate-700 dark:text-white">{cp.label}</span>
                  <button onClick={() => setCheckpoints(prev => prev.filter(c => c.id !== cp.id))} className="text-slate-400 hover:text-red-400 transition-colors ml-1">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={newCheckpointLabel}
              onChange={e => setNewCheckpointLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newCheckpointLabel.trim()) {
                  setCheckpoints(prev => [...prev, { id: Date.now().toString(), label: newCheckpointLabel.trim() }]);
                  setNewCheckpointLabel('');
                }
              }}
              placeholder="e.g. Breakfast, Lunch…"
              className="flex-1 bg-white dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-slate-200 dark:border-transparent"
            />
            <button
              onClick={() => {
                if (!newCheckpointLabel.trim()) return;
                setCheckpoints(prev => [...prev, { id: Date.now().toString(), label: newCheckpointLabel.trim() }]);
                setNewCheckpointLabel('');
              }}
              className="px-3 py-2 bg-slate-100 dark:bg-ink-elevated hover:bg-slate-200 dark:hover:bg-ink-elevated text-slate-600 dark:text-slate-300 text-sm font-semibold rounded-xl transition-colors"
            >
              Add
            </button>
          </div>
        </div>

        {/* Collapsible Atomic Habits details */}
        <button
          onClick={() => setShowDetails(d => !d)}
          className="flex items-center gap-2 text-slate-500 text-sm hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <ChevronDown size={14} className={`transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`} />
          {showDetails ? 'Hide details' : 'Add details (cue, micro habit, reward…)'}
        </button>

        {showDetails && (
          <div className="space-y-3 bg-white dark:bg-ink-surface rounded-xl p-4 border border-slate-200 dark:border-transparent">

            {/* Cue */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Cue — Make It Obvious
              </label>
              <input value={cue} onChange={e => setCue(e.target.value)}
                placeholder="e.g. After I wake up, At 6pm, After coffee"
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
              {cue && name && (
                <p className="text-xs text-cobalt-500/70 mt-1.5 italic">
                  "When {cue}, I will {name.toLowerCase()}."
                </p>
              )}
            </div>

            {/* Micro version */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Micro Version — Two-Minute Rule
              </label>
              <input value={microHabit} onChange={e => setMicroHabit(e.target.value)}
                placeholder="e.g. Put on running shoes, Do 5 pushups"
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
              <p className="text-slate-400 text-xs mt-1">The bare minimum when you can't do the full habit</p>
            </div>

            {/* Reward */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Reward — Make It Satisfying
              </label>
              <input value={reward} onChange={e => setReward(e.target.value)}
                placeholder="e.g. Protein cookie, 10 min YouTube"
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
            </div>

            {/* Identity */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Identity
              </label>
              <input value={identity} onChange={e => setIdentity(e.target.value)}
                placeholder="e.g. I am a disciplined runner"
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
            </div>

            {/* Next Action */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Next Action
              </label>
              <input value={nextAction} onChange={e => setNextAction(e.target.value)}
                placeholder="e.g. Put book on pillow, Lay out running clothes"
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
              <p className="text-slate-400 text-xs mt-1">A concrete prep step to make the habit easier to start</p>
            </div>

            {/* Bad habit toggle */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Track avoidance</p>
                <p className="text-xs text-slate-400">e.g. "No phone before noon"</p>
              </div>
              <button onClick={() => setIsBadHabit(b => !b)}
                className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${isBadHabit ? 'bg-cobalt-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isBadHabit ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="w-full py-3.5 bg-cobalt-500 hover:bg-cobalt-600 disabled:opacity-40 text-white font-bold rounded-xl transition-colors"
        >
          {isEdit ? 'Save Changes' : 'Add Habit'}
        </button>

        {isEdit && onDelete && (
          <button
            onClick={onDelete}
            className="w-full py-3 text-red-400 hover:text-red-300 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            <Trash2 size={14} /> Delete habit
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Create Task From Habit Modal ─────────────────────────────────────────────

function CreateTaskFromHabitModal({
  habit, onClose, onSave,
}: {
  habit: Habit;
  onClose: () => void;
  onSave: (title: string, recurrence?: RecurrenceRule) => void;
}) {
  const defaultTitle = habit.nextAction?.trim() || (habit.name ?? habit.action ?? 'Task');
  const [title, setTitle] = useState(defaultTitle);
  const [recurrenceType, setRecurrenceType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState(1);

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  function handleSubmit() {
    if (!title.trim()) return;
    let recurrence: RecurrenceRule | undefined;
    if (recurrenceType === 'daily') recurrence = { type: 'daily' };
    else if (recurrenceType === 'weekly') recurrence = { type: 'weekly', daysOfWeek: daysOfWeek.length ? daysOfWeek : [new Date().getDay()] };
    else if (recurrenceType === 'monthly') recurrence = { type: 'monthly', dayOfMonth };
    onSave(title, recurrence);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-ink-surface rounded-t-3xl p-6 space-y-5 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Create Task</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={20} /></button>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Task Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Repeat</label>
          <div className="flex gap-2 flex-wrap">
            {(['none', 'daily', 'weekly', 'monthly'] as const).map(t => (
              <button
                key={t}
                onClick={() => setRecurrenceType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${recurrenceType === t ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-600 dark:text-slate-300'}`}
              >
                {t === 'none' ? 'One-time' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {recurrenceType === 'weekly' && (
            <div className="flex gap-2 mt-3">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`w-9 h-9 rounded-full text-sm font-semibold transition-colors ${daysOfWeek.includes(i) ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-600 dark:text-slate-300'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {recurrenceType === 'monthly' && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-slate-500 dark:text-slate-400">Day of month</span>
              <button className="stepper-btn" onClick={() => setDayOfMonth(d => Math.max(1, d - 1))}>−</button>
              <span className="text-slate-900 dark:text-white font-bold text-lg w-8 text-center">{dayOfMonth}</span>
              <button className="stepper-btn" onClick={() => setDayOfMonth(d => Math.min(28, d + 1))}>+</button>
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="w-full py-3.5 bg-cobalt-500 hover:bg-cobalt-600 disabled:opacity-40 text-white font-bold rounded-xl transition-colors"
        >
          Add Task
        </button>
      </div>
    </div>
  );
}
