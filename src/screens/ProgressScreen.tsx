import { useState, useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import {
  getAllWorkoutsForExercise,
  getWorkoutByDateForExercise,
  deleteSetForExercise,
  getAllRuns,
  getAllHabitEntriesForHabit,
  getAllGratitudeEntries,
  saveGratitudeEntry,
  deleteGratitudeEntry,
  uploadGratitudePhoto,
  getDailyTarget,
  saveDailyTarget,
  getDailyTargetHistory,
  saveDailyTargetForDate,
  saveExercise,
  getMaxWeight,
  getTodayString,
  formatDate,
  getAllExercises,
  getAllHabits,
  DEFAULT_EXERCISE_ID,
  DEFAULT_EXERCISE_NAME,
  NF_HABIT_ID,
  DEFAULT_NF_HABIT,
  getWeightGoal,
  saveWeightGoal,
  getAllWeightEntries,
  deleteWeightEntry,
  getWeightUnit,
  saveWeightUnit,
  kgToUnit,
  unitToKg,
} from '../utils/storage';
import {
  DayWorkout, WorkoutSet, RunEntry, GratitudeEntry, Exercise, Habit, HabitEntry,
  WeightEntry, WeightGoal, WeightUnit,
} from '../types';
import { ChevronDown, Trash2, Plus, ImagePlus, X, Pencil, Link2, Link2Off } from 'lucide-react';
import { SortableTabBar, TabDef } from '../components/SortableTabBar';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getStravaStatus, startStravaOAuth, disconnectStrava, StravaStatus } from '../utils/strava';

const DEFAULT_EXERCISE: Exercise = {
  id: DEFAULT_EXERCISE_ID,
  name: DEFAULT_EXERCISE_NAME,
  createdAt: 0,
};

const ALL_EXERCISES_ID = 'all';

type ProgressTab = 'lifting' | 'running' | 'habits' | 'gratitude' | 'weight';

const PROGRESS_TAB_IDS: ProgressTab[] = ['lifting', 'running', 'habits', 'gratitude', 'weight'];
const PROGRESS_TABS_BASE: TabDef[] = [
  { id: 'lifting', label: 'Lifting' },
  { id: 'running', label: 'Running' },
  { id: 'habits', label: 'Habits' },
  { id: 'gratitude', label: 'Gratitude' },
  { id: 'weight', label: 'Weight' },
];

function loadProgressTabOrder(): TabDef[] {
  try {
    const stored = localStorage.getItem('progressTabOrder');
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      if (ids.length === PROGRESS_TAB_IDS.length && PROGRESS_TAB_IDS.every(id => ids.includes(id))) {
        return ids.map(id => PROGRESS_TABS_BASE.find(t => t.id === id)!);
      }
    }
  } catch { /* ignore */ }
  return PROGRESS_TABS_BASE;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function habitCompletion(habit: Habit, entry: HabitEntry | null): number {
  if (!entry) return 0;
  // New atomic habits format
  if (habit.type === undefined) {
    if (entry.completion === 'full') return 1;
    if (entry.completion === 'micro') return 0.5;
    return 0;
  }
  // Legacy formats
  if (habit.type === 'boolean') return entry.done ? 1 : 0;
  if (habit.type === 'checkpoint') {
    const cps = habit.checkpoints ?? [];
    if (!cps.length) return 0;
    return cps.filter(cp => entry.checkpoints?.[cp.id]).length / cps.length;
  }
  if (habit.type === 'numeric') return (entry.value ?? 0) > 0 ? 1 : 0;
  return 0;
}

function habitDisplayName(habit: Habit): string {
  return habit.name ?? habit.trigger ?? 'Habit';
}

/** Epley 1RM estimate */
function epley1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function getRunsForRange(runs: RunEntry[], range: 'week' | 'month' | 'year' | 'all', today: string): RunEntry[] {
  if (range === 'all') return runs;
  const now = new Date(today);
  let start: Date;
  if (range === 'week') {
    start = new Date(now);
    const day = now.getDay();
    start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  const startStr = start.toISOString().split('T')[0];
  return runs.filter(r => r.date >= startStr && r.date <= today);
}

/** Returns the active target for a given date from history, falling back to current target */
function getTargetForDate(history: Record<string, number>, date: string, currentTarget: number): number {
  const keys = Object.keys(history).filter(d => d <= date).sort();
  if (keys.length === 0) return currentTarget;
  return history[keys[keys.length - 1]];
}

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Strava connection state ─────────────────────────────────────────────────
  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [stravaConnecting, setStravaConnecting] = useState(false);

  const [workouts, setWorkouts] = useState<DayWorkout[]>([]);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [nfMap, setNfMap] = useState<Record<string, HabitEntry>>({});
  const [gratitudeMap, setGratitudeMap] = useState<Record<string, GratitudeEntry[]>>({});
  const [showAddGratitude, setShowAddGratitude] = useState(false);
  const [newGratitudeText, setNewGratitudeText] = useState('');
  const [newGratitudeDate, setNewGratitudeDate] = useState(() => getTodayString());
  const [newGratitudePhoto, setNewGratitudePhoto] = useState<File | null>(null);
  const [newGratitudePhotoPreview, setNewGratitudePhotoPreview] = useState<string | null>(null);
  const [gratitudePhotoError, setGratitudePhotoError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const progressPhotoInputRef = useRef<HTMLInputElement>(null);
  const [dailyTarget, setDailyTarget] = useState(40);
  const [targetHistory, setTargetHistory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [progressTab, setProgressTab] = useState<ProgressTab>('lifting');
  const [progressTabOrder, setProgressTabOrder] = useState<TabDef[]>(loadProgressTabOrder);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Exercises
  const [exercises, setExercises] = useState<Exercise[]>([DEFAULT_EXERCISE]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(ALL_EXERCISES_ID);
  const [allExercisesWorkouts, setAllExercisesWorkouts] = useState<DayWorkout[]>([]);
  const [showDoneToday, setShowDoneToday] = useState(false);
  const [todayExerciseStatus, setTodayExerciseStatus] = useState<Record<string, boolean>>({});
  const [showPR, setShowPR] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [runRange, setRunRange] = useState<'week' | 'month' | 'year' | 'all'>('week');

  // Habits
  const [allHabits, setAllHabits] = useState<Habit[]>([]);
  const [selectedHabitId, setSelectedHabitId] = useState<string>('');
  const [habitEntriesMap, setHabitEntriesMap] = useState<Record<string, HabitEntry>>({});
  const [showHabitDropdown, setShowHabitDropdown] = useState(false);

  // Weight
  const [weightGoal, setWeightGoal] = useState<WeightGoal | null>(null);
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');

  const today = getTodayString();

  useEffect(() => {
    (async () => {
      try {
        const [allWorkouts, allRuns, nfEntries, allGratitude, target, customExercises, customHabits, goal, wEntries, unit] = await Promise.all([
          getAllWorkoutsForExercise(DEFAULT_EXERCISE_ID),
          getAllRuns(),
          getAllHabitEntriesForHabit(NF_HABIT_ID),
          getAllGratitudeEntries(),
          getDailyTarget(),
          getAllExercises(),
          getAllHabits(),
          getWeightGoal(),
          getAllWeightEntries(),
          getWeightUnit(),
        ]);

        // Load target history separately — don't fail the whole load if missing
        const tHistory = await getDailyTargetHistory().catch(() => ({} as Record<string, number>));
        setTargetHistory(tHistory);

        setWorkouts([...allWorkouts].sort((a, b) => a.date.localeCompare(b.date)));
        setRuns(allRuns);

        const nf: Record<string, HabitEntry> = {};
        nfEntries.forEach(e => { nf[e.date] = e; });
        setNfMap(nf);
        setHabitEntriesMap(nf);

        const grouped = allGratitude.reduce((acc, e) => {
          (acc[e.date] ??= []).push(e);
          return acc;
        }, {} as Record<string, GratitudeEntry[]>);
        setGratitudeMap(grouped);

        setDailyTarget(target);

        const allExercises = [DEFAULT_EXERCISE, ...customExercises.sort((a, b) => a.createdAt - b.createdAt)];
        setExercises(allExercises);

        const activeHabits = customHabits.filter(h => !h.archived);
        setAllHabits(activeHabits);
        if (activeHabits.length > 0) setSelectedHabitId(activeHabits[0].id);

        setWeightGoal(goal);
        setWeightUnit(unit);
        setWeightEntries([...wEntries].sort((a, b) => a.date.localeCompare(b.date)));

        // Load all exercises' workouts and merge by date for "All" view (non-blocking)
        setLoading(false);
        Promise.all(allExercises.map(ex => getAllWorkoutsForExercise(ex.id).then(ws => ({ ex, ws })))).then(results => {
          const mergedByDate: Record<string, DayWorkout> = {};
          results.forEach(({ ex, ws }) => {
            ws.forEach(w => {
              const taggedSets = w.sets.map(s => ({ ...s, exerciseName: ex.name }));
              if (mergedByDate[w.date]) {
                mergedByDate[w.date] = { ...mergedByDate[w.date], sets: [...mergedByDate[w.date].sets, ...taggedSets] };
              } else {
                mergedByDate[w.date] = { ...w, sets: taggedSets };
              }
            });
          });
          setAllExercisesWorkouts(Object.values(mergedByDate).sort((a, b) => a.date.localeCompare(b.date)));
        }).catch(() => {/* ignore — "All" view may show partial data */});

        // Load today's workout status
        Promise.all(allExercises.map(ex => getWorkoutByDateForExercise(ex.id, today).then(w => ({ id: ex.id, hasData: !!w && w.sets.length > 0 }))))
          .then(checks => {
            const statusMap: Record<string, boolean> = {};
            checks.forEach(({ id, hasData }) => { statusMap[id] = hasData; });
            setTodayExerciseStatus(statusMap);
          }).catch(() => {/* ignore */});

      } catch (err) {
        console.error('ProgressScreen load error:', err);
        setLoading(false);
      }
    })();
    // Load Strava connection status
    getStravaStatus().then(setStravaStatus).catch(() => setStravaStatus({ connected: false }));

    // Handle post-OAuth redirect params
    if (searchParams.get('stravaConnected') === 'true') {
      getStravaStatus().then(s => { setStravaStatus(s); setStravaConnecting(false); });
      setSearchParams({}, { replace: true });
    }
    if (searchParams.get('stravaError')) {
      setStravaConnecting(false);
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload workouts when exercise changes
  useEffect(() => {
    if (loading || selectedExerciseId === ALL_EXERCISES_ID) return;
    getAllWorkoutsForExercise(selectedExerciseId).then(w => {
      setWorkouts([...w].sort((a, b) => a.date.localeCompare(b.date)));
    });
  }, [selectedExerciseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload habit entries when habit changes
  useEffect(() => {
    if (loading) return;
    getAllHabitEntriesForHabit(selectedHabitId).then(entries => {
      const map: Record<string, HabitEntry> = {};
      entries.forEach(e => { map[e.date] = e; });
      setHabitEntriesMap(map);
    });
  }, [selectedHabitId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAllView = selectedExerciseId === ALL_EXERCISES_ID;
  const activeWorkouts = isAllView ? allExercisesWorkouts : workouts;
  const selectedExercise = exercises.find(e => e.id === selectedExerciseId) ?? DEFAULT_EXERCISE;
  const exerciseTarget: number | undefined = isAllView
    ? undefined
    : selectedExercise.id === DEFAULT_EXERCISE_ID
      ? dailyTarget
      : selectedExercise.target;
  const effectiveTarget = exerciseTarget ?? dailyTarget;

  const selectedHabit = allHabits.find(h => h.id === selectedHabitId) ?? allHabits[0];
  const workoutMap = Object.fromEntries(activeWorkouts.map(w => [w.date, w]));

  // ── Target adjustment ──────────────────────────────────────────────────────
  async function adjustTarget(delta: number) {
    if (selectedExercise.id === DEFAULT_EXERCISE_ID) {
      const next = Math.max(5, dailyTarget + delta);
      setDailyTarget(next);
      await saveDailyTarget(next);
      const updated = { ...targetHistory, [today]: next };
      setTargetHistory(updated);
      await saveDailyTargetForDate(today, next);
    } else {
      const current = exerciseTarget ?? 40;
      const next = Math.max(5, current + delta);
      const updated = { ...selectedExercise, target: next };
      setExercises(prev => prev.map(e => e.id === updated.id ? updated : e));
      await saveExercise(updated);
    }
  }

  async function handleDeleteSet(date: string, setId: string) {
    await deleteSetForExercise(selectedExerciseId, date, setId);
    setWorkouts(prev => prev.map(w => w.date === date
      ? { ...w, sets: w.sets.filter(s => s.id !== setId) }
      : w
    ).filter(w => w.sets.length > 0));
  }

  // ── Lifting stats ──────────────────────────────────────────────────────────
  const totalSets = activeWorkouts.reduce((sum, w) => sum + w.sets.length, 0);
  const totalReps = activeWorkouts.reduce((sum, w) => sum + w.sets.reduce((s2, s) => s2 + s.reps, 0), 0);

  // Best 1RM via Epley formula across all sets
  const bestOneRM = activeWorkouts.reduce((max, w) => {
    return w.sets.reduce((m, s) => Math.max(m, epley1RM(s.weight, s.reps)), max);
  }, 0);

  // Best single set by volume (weight × reps)
  let bestVolumeSet: { weight: number; reps: number } = { weight: 0, reps: 0 };
  activeWorkouts.forEach(w => {
    w.sets.forEach(s => {
      if (s.weight * s.reps > bestVolumeSet.weight * bestVolumeSet.reps) {
        bestVolumeSet = { weight: s.weight, reps: s.reps };
      }
    });
  });

  const liftingStreak = (() => {
    if (exerciseTarget === undefined) return 0;
    let count = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const dt = new Date(d); dt.setDate(dt.getDate() - i);
      const ds = dt.toISOString().split('T')[0];
      const w = workoutMap[ds];
      if (w && w.sets.reduce((s, x) => s + x.reps, 0) >= effectiveTarget) count++;
      else break;
    }
    return count;
  })();

  // ── Running stats ──────────────────────────────────────────────────────────
  const totalRunKm = +(runs.reduce((sum, r) => sum + r.distanceKm, 0)).toFixed(1);
  const runDays = new Set(runs.map(r => r.date)).size;

  // ── Habit stats ────────────────────────────────────────────────────────────
  const habitEntries = Object.values(habitEntriesMap);
  const habitDaysLogged = habitEntries.length;
  const habitFullDays = selectedHabit ? habitEntries.filter(e => habitCompletion(selectedHabit, e) === 1).length : 0;
  const habitCompletionRate = habitDaysLogged > 0 && selectedHabit ? Math.round((habitFullDays / habitDaysLogged) * 100) : 0;
  const habitStreak = (() => {
    if (!selectedHabit) return 0;
    let count = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const dt = new Date(d); dt.setDate(dt.getDate() - i);
      const ds = dt.toISOString().split('T')[0];
      if (habitCompletion(selectedHabit, habitEntriesMap[ds] ?? null) >= 0.5) count++;
      else break;
    }
    return count;
  })();

  // ── Gratitude stats ────────────────────────────────────────────────────────
  const gratitudeDays = Object.keys(gratitudeMap).length;
  const totalGratitudeEntries = Object.values(gratitudeMap).reduce((s, a) => s + a.length, 0);

  async function handleAddGratitudeEntry() {
    const text = newGratitudeText.trim();
    if (!text || !newGratitudeDate) return;
    setGratitudePhotoError(null);
    const id = Date.now().toString();
    const entry: GratitudeEntry = { id, date: newGratitudeDate, text, createdAt: Date.now() };
    if (newGratitudePhoto) {
      try {
        const blob = await compressImage(newGratitudePhoto);
        entry.photoUrl = await uploadGratitudePhoto(id, blob);
      } catch {
        setGratitudePhotoError('Photo upload failed — try again.');
        return;
      }
    }
    setGratitudeMap(prev => ({
      ...prev,
      [newGratitudeDate]: [...(prev[newGratitudeDate] ?? []), entry],
    }));
    setNewGratitudeText('');
    if (newGratitudePhotoPreview) URL.revokeObjectURL(newGratitudePhotoPreview);
    setNewGratitudePhoto(null);
    setNewGratitudePhotoPreview(null);
    setShowAddGratitude(false);
    await saveGratitudeEntry(entry);
  }

  async function handleDeleteGratitudeEntry(id: string, date: string) {
    setGratitudeMap(prev => {
      const updated = (prev[date] ?? []).filter(e => e.id !== id);
      if (updated.length === 0) { const next = { ...prev }; delete next[date]; return next; }
      return { ...prev, [date]: updated };
    });
    await deleteGratitudeEntry(id);
  }

  // ── Weight handlers ────────────────────────────────────────────────────────
  async function handleDeleteWeightEntry(date: string) {
    setWeightEntries(prev => prev.filter(e => e.date !== date));
    await deleteWeightEntry(date);
  }

  async function handleSaveGoal(goal: WeightGoal) {
    setWeightGoal(goal);
    setShowGoalForm(false);
    await saveWeightGoal(goal);
  }

  async function handleChangeWeightUnit(unit: WeightUnit) {
    setWeightUnit(unit);
    await saveWeightUnit(unit);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Exercise filter
  const filteredExercises = showDoneToday
    ? exercises.filter(ex => todayExerciseStatus[ex.id])
    : exercises;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Progress</h1>
        <p className="text-slate-400 text-sm mt-0.5">The gains don't lie.</p>
      </div>

      {/* Sub-tabs — drag to reorder */}
      <SortableTabBar
        tabs={progressTabOrder}
        activeId={progressTab}
        onTabChange={id => setProgressTab(id as ProgressTab)}
        onReorder={newOrder => {
          setProgressTabOrder(newOrder);
          localStorage.setItem('progressTabOrder', JSON.stringify(newOrder.map(t => t.id)));
        }}
        textSize="text-[10px]"
      />

      {/* ── Lifting Tab ──────────────────────────────────────────────────────── */}
      {progressTab === 'lifting' && (
        <>
          {/* Exercise selector dropdown */}
          <div className="relative">
            <select
              value={selectedExerciseId}
              onChange={e => setSelectedExerciseId(e.target.value)}
              className="w-full bg-white dark:bg-[#111827] text-slate-900 dark:text-white border border-slate-200 dark:border-transparent rounded-2xl px-4 py-3 text-sm font-semibold appearance-none shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={ALL_EXERCISES_ID}>All Exercises</option>
              {exercises.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {todayExerciseStatus[ex.id] ? '● ' : ''}{ex.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>


          {!isAllView && activeWorkouts.length > 0 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 flex items-center justify-between shadow-sm border border-slate-200 dark:border-transparent">
              <span className="text-slate-500 dark:text-slate-400 text-sm">Daily target (today)</span>
              {exerciseTarget === undefined ? (
                <span className="text-slate-400 text-xs italic">Not set — toggle in Log tab</span>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => adjustTarget(-5)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-[#1C2537] text-slate-700 dark:text-slate-300 text-lg hover:bg-slate-200 dark:hover:bg-[#253347] transition-colors">−</button>
                  <span className="text-slate-900 dark:text-white font-bold text-sm w-16 text-center">{exerciseTarget} reps</span>
                  <button onClick={() => adjustTarget(5)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-[#1C2537] text-slate-700 dark:text-slate-300 text-lg hover:bg-slate-200 dark:hover:bg-[#253347] transition-colors">+</button>
                </div>
              )}
            </div>
          )}

          {/* Lifting chart — single exercise only */}
          {!isAllView && activeWorkouts.length >= 2 && (
            <LiftingChart workouts={activeWorkouts} />
          )}

          {/* Calendar — collapsible */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
            <button onClick={() => setShowCalendar(c => !c)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Calendar</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showCalendar ? 'rotate-180' : ''}`} />
            </button>
            {showCalendar && (
              <div className="px-2 pb-3">
                <BaseCalendar
                  onDayPress={setSelectedDate}
                  cellStyle={ds => {
                    const w = workoutMap[ds];
                    const r = w?.sets.reduce((s, x) => s + x.reps, 0) ?? 0;
                    const dayTarget = isAllView ? undefined : getTargetForDate(targetHistory, ds, dailyTarget);
                    if (dayTarget !== undefined && r >= dayTarget) return 'bg-green-600 text-white';
                    if (r > 0) return 'bg-blue-500/60 text-blue-900 dark:text-blue-200';
                    return 'bg-slate-100 dark:bg-[#1C2537] text-slate-400 dark:text-slate-600';
                  }}
                  legend={
                    <>
                      <LegendItem color="bg-green-600" label="Hit target" />
                      <LegendItem color="bg-blue-500/60" label="Partial" />
                    </>
                  }
                />
              </div>
            )}
          </div>

          {/* Recent Days */}
          {activeWorkouts.length > 0 ? (
            <ExpandableLiftingLog
              workouts={activeWorkouts}
              exerciseTarget={isAllView ? undefined : exerciseTarget}
              exerciseName={isAllView ? 'All Exercises' : selectedExercise.name}
              targetHistory={isAllView ? {} : targetHistory}
              currentTarget={dailyTarget}
              isAllView={isAllView}
              onDeleteSet={isAllView ? undefined : handleDeleteSet}
            />
          ) : <EmptyState text="No lifting data yet." />}
        </>
      )}

      {/* ── Running Tab ──────────────────────────────────────────────────────── */}
      {progressTab === 'running' && (
        <>
          {/* Strava connection */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl px-4 py-3 shadow-sm border border-slate-200 dark:border-transparent flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#FC4C02]/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[#FC4C02] font-extrabold text-xs">S</span>
            </div>
            <div className="flex-1 min-w-0">
              {stravaStatus === null ? (
                <span className="text-slate-400 text-sm">Checking Strava…</span>
              ) : stravaStatus.connected ? (
                <>
                  <span className="text-slate-900 dark:text-white text-sm font-semibold truncate block">{stravaStatus.athleteName}</span>
                  <span className="text-green-500 text-xs">Connected</span>
                </>
              ) : (
                <span className="text-slate-500 dark:text-slate-400 text-sm">Strava not connected</span>
              )}
            </div>
            {stravaStatus?.connected ? (
              <button
                onClick={async () => { await disconnectStrava(); setStravaStatus({ connected: false }); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-[#1C2537] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors"
              >
                <Link2Off size={13} /> Disconnect
              </button>
            ) : stravaStatus !== null ? (
              <button
                onClick={() => { setStravaConnecting(true); startStravaOAuth(); }}
                disabled={stravaConnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#FC4C02] hover:bg-[#e34300] disabled:opacity-60 transition-colors"
              >
                <Link2 size={13} /> {stravaConnecting ? 'Connecting…' : 'Connect'}
              </button>
            ) : null}
          </div>

          {/* Calendar — collapsible */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
            <button onClick={() => setShowCalendar(c => !c)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Calendar</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showCalendar ? 'rotate-180' : ''}`} />
            </button>
            {showCalendar && (
              <div className="px-2 pb-3">
                <BaseCalendar
                  onDayPress={setSelectedDate}
                  cellStyle={ds => runs.some(r => r.date === ds) ? 'bg-orange-500 text-white' : 'bg-slate-100 dark:bg-[#1C2537] text-slate-400 dark:text-slate-600'}
                  legend={<LegendItem color="bg-orange-500" label="Run logged" />}
                />
              </div>
            )}
          </div>

          {/* Range selector */}
          <div className="flex bg-white dark:bg-[#111827] rounded-2xl p-1 gap-1 shadow-sm border border-slate-200 dark:border-transparent">
            {(['week', 'month', 'year', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRunRange(r)}
                className={`flex-1 py-2 rounded-xl text-[10px] font-semibold capitalize transition-colors ${
                  runRange === r ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}>
                {r === 'all' ? 'All Time' : r === 'week' ? 'This Week' : r === 'month' ? 'This Month' : 'This Year'}
              </button>
            ))}
          </div>

          {/* Filtered stats */}
          {(() => {
            const rangeRuns = getRunsForRange(runs, runRange, today);
            const rangeKm = +(rangeRuns.reduce((s, r) => s + r.distanceKm, 0)).toFixed(1);
            const rangeDays = new Set(rangeRuns.map(r => r.date)).size;
            return (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="km" value={`${rangeKm}`} />
                  <StatCard label="Runs" value={rangeRuns.length} />
                  <StatCard label="Avg / run" value={rangeRuns.length > 0 ? `${(rangeKm / rangeRuns.length).toFixed(1)} km` : '—'} />
                </div>
                {rangeRuns.length > 0 ? (
                  <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
                    <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-[#1E2D45]">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Runs — {rangeRuns.length} logged, {rangeDays} days</span>
                    </div>
                    {[...rangeRuns].sort((a, b) => b.date.localeCompare(a.date)).map(r => (
                      <div key={r.id} className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-[#1E2D45] last:border-0">
                        <span className="text-slate-500 dark:text-slate-400 text-sm flex-1">{formatDate(r.date)}</span>
                        <span className="text-orange-500 font-bold text-sm mr-3">{r.distanceKm} km</span>
                        <button onClick={() => navigate(`/?date=${r.date}`)} className="text-slate-300 dark:text-slate-700 hover:text-blue-500 transition-colors" title="Edit this day">
                          <Pencil size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState text="No runs in this period." />}
              </>
            );
          })()}
        </>
      )}

      {/* ── Habits Tab ───────────────────────────────────────────────────────── */}
      {progressTab === 'habits' && (
        <>
          {allHabits.length === 0 && (
            <EmptyState text="No habits yet. Add habits in the Log tab to track progress here." />
          )}
          {/* Habit Selector */}
          {allHabits.length > 1 && (
            <div className="relative">
              <button onClick={() => setShowHabitDropdown(d => !d)}
                className="w-full flex items-center justify-between bg-white dark:bg-[#111827] hover:bg-slate-50 dark:hover:bg-[#1C2537] rounded-2xl px-4 py-3 transition-colors shadow-sm border border-slate-200 dark:border-transparent">
                <span className="text-slate-900 dark:text-white font-semibold text-sm">{habitDisplayName(selectedHabit)}</span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${showHabitDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showHabitDropdown && (
                <div className="mt-1 bg-slate-100 dark:bg-[#1C2537] rounded-xl overflow-hidden z-10 relative border border-slate-200 dark:border-transparent">
                  {allHabits.map(h => (
                    <button key={h.id} onClick={() => { setSelectedHabitId(h.id); setShowHabitDropdown(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-200 dark:hover:bg-[#253347] transition-colors border-b border-slate-200 dark:border-[#253347] last:border-0 ${h.id === selectedHabitId ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${h.id === selectedHabitId ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
                      {habitDisplayName(h)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedHabit && (
            <>
              {/* Calendar — collapsible */}
              <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
                <button onClick={() => setShowCalendar(c => !c)} className="w-full flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Calendar</span>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showCalendar ? 'rotate-180' : ''}`} />
                </button>
                {showCalendar && (
                  <div className="px-2 pb-3">
                    <BaseCalendar
                      onDayPress={setSelectedDate}
                      cellStyle={ds => {
                        const c = habitCompletion(selectedHabit, habitEntriesMap[ds] ?? null);
                        if (c === 1) return 'bg-purple-600 text-white';
                        if (c > 0) return 'bg-purple-500/50 text-purple-900 dark:text-purple-200';
                        return 'bg-slate-100 dark:bg-[#1C2537] text-slate-400 dark:text-slate-600';
                      }}
                      legend={
                        <>
                          <LegendItem color="bg-purple-600" label="Complete" />
                          <LegendItem color="bg-purple-500/50" label="Partial" />
                        </>
                      }
                    />
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Streak" value={`${habitStreak}d`} />
                <StatCard label="Completion" value={`${habitCompletionRate}%`} />
                <StatCard label="Days Logged" value={habitDaysLogged} />
                <StatCard label="Full Days" value={habitFullDays} />
              </div>

              {/* Daily Log */}
              <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
                <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-[#1E2D45]">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Daily Log — {habitDisplayName(selectedHabit)}</span>
                </div>
                {Object.keys(habitEntriesMap).length === 0 ? (
                  <p className="text-slate-400 text-sm p-4">No entries yet.</p>
                ) : (
                  Object.entries(habitEntriesMap)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([date, entry]) => <HabitDayRow key={date} date={date} habit={selectedHabit} entry={entry} />)
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Gratitude Tab ────────────────────────────────────────────────────── */}
      {progressTab === 'gratitude' && (
        <>
          {/* Calendar — collapsible */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
            <button onClick={() => setShowCalendar(c => !c)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Calendar</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showCalendar ? 'rotate-180' : ''}`} />
            </button>
            {showCalendar && (
              <div className="px-2 pb-3">
                <BaseCalendar
                  onDayPress={setSelectedDate}
                  cellStyle={ds => (gratitudeMap[ds]?.length ?? 0) > 0 ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-[#1C2537] text-slate-400 dark:text-slate-600'}
                  legend={<LegendItem color="bg-amber-500" label="Entry written" />}
                />
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Days" value={gratitudeDays} />
            <StatCard label="Total Entries" value={totalGratitudeEntries} />
          </div>

          {/* Add Entry */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
            <button onClick={() => setShowAddGratitude(s => !s)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Add Entry</span>
              <Plus size={14} className="text-slate-400" />
            </button>
            {showAddGratitude && (
              <div className="px-4 pb-4 space-y-2">
                <input type="date" max={today} value={newGratitudeDate}
                  onChange={e => setNewGratitudeDate(e.target.value)}
                  className="w-full text-sm bg-slate-100 dark:bg-[#1C2537] text-slate-900 dark:text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 border-none"
                />
                {newGratitudePhotoPreview && (
                  <div className="relative rounded-xl overflow-hidden">
                    <img src={newGratitudePhotoPreview} alt="Preview" className="w-full max-h-48 object-cover" />
                    <button onClick={() => { if (newGratitudePhotoPreview) URL.revokeObjectURL(newGratitudePhotoPreview); setNewGratitudePhoto(null); setNewGratitudePhotoPreview(null); if (progressPhotoInputRef.current) progressPhotoInputRef.current.value = ''; }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                )}
                <textarea value={newGratitudeText} onChange={e => setNewGratitudeText(e.target.value)}
                  placeholder="What are you grateful for?" rows={2}
                  className="w-full bg-slate-100 dark:bg-[#1C2537] text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
                {gratitudePhotoError && <p className="text-red-400 text-xs">{gratitudePhotoError}</p>}
                <input ref={progressPhotoInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (!f.type.startsWith('image/')) { setGratitudePhotoError('Please select an image file.'); return; }
                    if (f.size > 20 * 1024 * 1024) { setGratitudePhotoError('Image must be under 20 MB.'); return; }
                    setGratitudePhotoError(null);
                    setNewGratitudePhoto(f);
                    setNewGratitudePhotoPreview(URL.createObjectURL(f));
                  }}
                />
                <div className="flex gap-2">
                  <button onClick={() => progressPhotoInputRef.current?.click()}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${newGratitudePhoto ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-500' : 'bg-slate-100 dark:bg-[#1C2537] text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#253347]'}`}>
                    <ImagePlus size={14} />
                    {newGratitudePhoto ? 'Change' : 'Photo'}
                  </button>
                  <button onClick={handleAddGratitudeEntry}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-semibold rounded-xl text-sm transition-all">
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Feed */}
          <div className="space-y-2">
            {Object.entries(gratitudeMap)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, entries]) => (
                <div key={date} className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
                  <div className="px-4 pt-4 pb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400 flex-1">{formatDate(date)}</span>
                    <button onClick={() => navigate(`/?date=${date}`)} className="text-slate-300 dark:text-slate-700 hover:text-blue-500 transition-colors mr-2" title="Edit this day">
                      <Pencil size={12} />
                    </button>
                  </div>
                  <div className="space-y-3 px-4 pb-4">
                    {entries.sort((a, b) => a.createdAt - b.createdAt).map(entry => (
                      <div key={entry.id}>
                        {entry.photoUrl && (
                          <button onClick={() => setLightboxUrl(entry.photoUrl!)} className="w-full mb-2 block rounded-xl overflow-hidden">
                            <img src={entry.photoUrl} alt="" className="w-full max-h-56 object-cover" />
                          </button>
                        )}
                        <div className="flex items-start gap-2">
                          <p className="flex-1 text-slate-900 dark:text-white text-sm leading-relaxed">{entry.text}</p>
                          <button onClick={() => handleDeleteGratitudeEntry(entry.id, date)} className="text-slate-300 dark:text-slate-700 hover:text-red-400 transition-colors mt-0.5 flex-shrink-0">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            {gratitudeDays === 0 && <EmptyState text="No gratitude entries yet." />}
          </div>
        </>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"><X size={24} /></button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ── Weight Tab ───────────────────────────────────────────────────────── */}
      {progressTab === 'weight' && (
        <WeightTab
          weightGoal={weightGoal}
          weightEntries={weightEntries}
          onDeleteEntry={handleDeleteWeightEntry}
          onRequestGoalForm={() => setShowGoalForm(true)}
          today={today}
          unit={weightUnit}
          onUnitChange={handleChangeWeightUnit}
        />
      )}

      <button onClick={() => signOut(auth)} className="w-full py-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm transition-colors">
        Sign out
      </button>

      {/* Day detail sheet — not shown for weight tab */}
      {selectedDate && progressTab !== 'weight' && (
        <DaySheet
          date={selectedDate}
          progressTab={progressTab}
          workoutMap={workoutMap}
          runs={runs}
          habitEntriesMap={habitEntriesMap}
          selectedHabit={selectedHabit}
          gratitudeMap={gratitudeMap}
          effectiveTarget={getTargetForDate(targetHistory, selectedDate, dailyTarget)}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {showGoalForm && (
        <WeightGoalForm
          current={weightGoal}
          latestKg={weightEntries.length > 0 ? weightEntries[weightEntries.length - 1].kg : undefined}
          today={today}
          onClose={() => setShowGoalForm(false)}
          onSave={handleSaveGoal}
          unit={weightUnit}
        />
      )}
    </div>
  );
}

// ─── Lifting Chart ─────────────────────────────────────────────────────────────

type ChartRange  = '1m' | '3m' | '6m' | 'all';
type ChartMetric = 'reps' | 'sets' | 'volume';

const METRIC_LABELS: Record<ChartMetric, string> = {
  reps: 'Reps',
  sets: 'Sets',
  volume: 'Volume',
};

function filterByRange(workouts: DayWorkout[], range: ChartRange): DayWorkout[] {
  if (range === 'all') return workouts;
  const now = new Date();
  const months = range === '1m' ? 1 : range === '3m' ? 3 : 6;
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
    .toISOString().split('T')[0];
  return workouts.filter(w => w.date >= cutoff);
}

function metricValue(w: DayWorkout, metric: ChartMetric): number {
  if (metric === 'sets')   return w.sets.length;
  if (metric === 'reps')   return w.sets.reduce((s, x) => s + x.reps, 0);
  /* volume */             return w.sets.reduce((s, x) => s + x.reps * x.weight, 0);
}

function LiftingChart({ workouts }: { workouts: DayWorkout[] }) {
  const [range,  setRange]  = useState<ChartRange>('all');
  const [metric, setMetric] = useState<ChartMetric>('reps');

  const sorted = [...filterByRange(workouts, range)].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 2) {
    return (
      <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
        <ChartControls range={range} onRange={setRange} metric={metric} onMetric={setMetric} />
        <p className="text-xs text-slate-400 text-center py-6">Not enough sessions in this range.</p>
      </div>
    );
  }

  const W = 320;
  const H = 120;
  const PAD = { top: 10, right: 12, bottom: 24, left: 38 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = sorted.map(w => metricValue(w, metric));
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const yRange = maxY - minY || 1;

  const delta = values[values.length - 1] - values[0];
  const isUp  = delta >= 0;
  const color = isUp ? '#3b82f6' : '#f87171';

  function toX(i: number) { return PAD.left + (i / (sorted.length - 1)) * plotW; }
  function toY(v: number) { return PAD.top + plotH - ((v - minY) / yRange) * plotH; }

  const pts      = values.map((v, i) => [toX(i), toY(v)] as [number, number]);
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  // 3 Y-axis ticks: min, mid, max
  const midY = Math.round((minY + maxY) / 2);
  const yTicks = [
    { val: maxY, y: toY(maxY) },
    { val: midY, y: toY(midY) },
    { val: minY, y: toY(minY) },
  ];
  const fmtY = (v: number) => metric === 'volume' ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))) : String(Math.round(v));

  const deltaStr = metric === 'volume'
    ? `${isUp ? '+' : ''}${Math.round(delta)} kg·reps`
    : `${isUp ? '+' : ''}${delta} ${metric}`;

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
      <ChartControls range={range} onRange={setRange} metric={metric} onMetric={setMetric} />

      <div className="flex items-baseline gap-2 mt-1 mb-2">
        <span className={`text-sm font-bold ${isUp ? 'text-blue-400' : 'text-red-400'}`}>
          {isUp ? '↑' : '↓'} {deltaStr}
        </span>
        <span className="text-xs text-slate-400">vs first session</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {/* Grid lines + Y labels */}
        {yTicks.map(({ val, y }, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
              stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.5" />
            <text x={PAD.left - 4} y={y + 3.5} textAnchor="end" fontSize="8.5" fill="#64748b">
              {fmtY(val)}
            </text>
          </g>
        ))}
        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots */}
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill={color} stroke="#111827" strokeWidth="1.5" />
        ))}
        {/* X labels: first and last */}
        <text x={toX(0)} y={H - 4} textAnchor="start" fontSize="9" fill="#64748b">
          {sorted[0].date.slice(5)}
        </text>
        <text x={toX(sorted.length - 1)} y={H - 4} textAnchor="end" fontSize="9" fill="#64748b">
          {sorted[sorted.length - 1].date.slice(5)}
        </text>
      </svg>
    </div>
  );
}

function ChartControls({
  range, onRange, metric, onMetric,
}: {
  range: ChartRange; onRange: (r: ChartRange) => void;
  metric: ChartMetric; onMetric: (m: ChartMetric) => void;
}) {
  const pill = (active: boolean) =>
    `px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
      active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-300'
    }`;
  return (
    <div className="flex items-center justify-between gap-2">
      {/* Metric toggle */}
      <div className="flex gap-1">
        {(['reps', 'sets', 'volume'] as ChartMetric[]).map(m => (
          <button key={m} onClick={() => onMetric(m)} className={pill(metric === m)}>
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>
      {/* Range filter */}
      <div className="flex gap-1">
        {(['1m', '3m', '6m', 'all'] as ChartRange[]).map(r => (
          <button key={r} onClick={() => onRange(r)} className={pill(range === r)}>
            {r.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Expandable Lifting Log ───────────────────────────────────────────────────

function ExpandableLiftingLog({ workouts, exerciseTarget, exerciseName, targetHistory, currentTarget, isAllView, onDeleteSet }: {
  workouts: DayWorkout[];
  exerciseTarget: number | undefined;
  exerciseName: string;
  targetHistory: Record<string, number>;
  currentTarget: number;
  isAllView?: boolean;
  onDeleteSet?: (date: string, setId: string) => void;
}) {
  const navigate = useNavigate();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const recent = [...workouts].reverse().slice(0, 10);

  function exportCSV() {
    const rows = [['Date', 'Exercise', 'Set', 'Weight (kg)', 'Reps', 'Est. 1RM (kg)']];
    [...workouts].sort((a, b) => a.date.localeCompare(b.date)).forEach(w => {
      w.sets.forEach((s, i) => {
        rows.push([w.date, isAllView ? (s.exerciseName ?? exerciseName) : exerciseName, String(i + 1), String(s.weight), String(s.reps), String(epley1RM(s.weight, s.reps))]);
      });
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${exerciseName.replace(/\s+/g, '_')}_history.csv`;
    a.click();
  }

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-[#1E2D45] flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Days — {exerciseName}</span>
        <button onClick={exportCSV} className="text-xs text-slate-400 hover:text-blue-400 transition-colors font-medium">
          Export CSV ↓
        </button>
      </div>
      {recent.map(w => {
        const reps = w.sets.reduce((s, x) => s + x.reps, 0);
        const best1RM = Math.max(...w.sets.map(s => epley1RM(s.weight, s.reps)));
        const isExpanded = expandedDate === w.date;
        const dayTarget = exerciseTarget !== undefined
          ? getTargetForDate(targetHistory, w.date, currentTarget)
          : undefined;
        const exerciseNames = isAllView
          ? [...new Set(w.sets.map(s => s.exerciseName).filter(Boolean))] as string[]
          : [];
        return (
          <div key={w.date} className="border-b border-slate-100 dark:border-[#1E2D45] last:border-0">
            <div className="flex items-stretch">
            <button
              className="flex-1 flex items-center px-4 py-3 hover:bg-slate-50 dark:hover:bg-[#1C2537] transition-colors text-left"
              onClick={() => setExpandedDate(isExpanded ? null : w.date)}
            >
              <span className="flex-1 min-w-0">
                <span className="text-slate-500 dark:text-slate-400 text-sm block">{formatDate(w.date)}</span>
                {exerciseNames.length > 0 && (
                  <span className="text-blue-500 text-xs truncate block">{exerciseNames.join(', ')}</span>
                )}
              </span>
              {!isAllView && (
                <span className="text-right mr-4 flex-shrink-0">
                  <span className="text-slate-900 dark:text-white font-bold text-sm block">{best1RM} kg</span>
                  <span className="text-slate-400 text-xs block">est. 1RM</span>
                </span>
              )}
              <span className={`text-sm font-semibold mr-3 flex-shrink-0 ${dayTarget !== undefined && reps >= dayTarget ? 'text-green-500' : 'text-slate-400'}`}>
                {reps} reps
              </span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={() => navigate(`/?date=${w.date}`)} className="px-3 text-slate-300 dark:text-slate-700 hover:text-blue-500 transition-colors flex-shrink-0" title="Edit this day">
              <Pencil size={12} />
            </button>
            </div>
            {isExpanded && (
              <div className="px-4 pb-3 space-y-1.5">
                {(() => {
                  type PGroup =
                    | { kind: 'single'; set: WorkoutSet; n: number }
                    | { kind: 'superset'; items: { set: WorkoutSet; n: number }[]; gid: string };
                  const groups: PGroup[] = [];
                  let gi = 0, gn = 1;
                  while (gi < w.sets.length) {
                    const s = w.sets[gi];
                    if (s.supersetGroup) {
                      const gid = s.supersetGroup;
                      const items: { set: WorkoutSet; n: number }[] = [];
                      while (gi < w.sets.length && w.sets[gi].supersetGroup === gid) { items.push({ set: w.sets[gi], n: gn++ }); gi++; }
                      groups.push({ kind: 'superset', items, gid });
                    } else {
                      groups.push({ kind: 'single', set: s, n: gn++ }); gi++;
                    }
                  }
                  return groups.map(g =>
                    g.kind === 'single' ? (
                      <div key={g.set.id} className="flex items-center bg-slate-100 dark:bg-[#1C2537] rounded-xl px-3 py-2 gap-2">
                        <span className="text-slate-400 text-xs font-semibold uppercase w-10 flex-shrink-0">Set {g.n}</span>
                        {isAllView && g.set.exerciseName && <span className="text-blue-500 text-xs font-semibold flex-shrink-0">{g.set.exerciseName}</span>}
                        <span className="text-slate-900 dark:text-white font-semibold text-sm">{g.set.weight} kg × {g.set.reps}</span>
                        <span className="ml-auto text-slate-400 text-xs flex-shrink-0">1RM ≈ {epley1RM(g.set.weight, g.set.reps)} kg</span>
                        {onDeleteSet && (
                          <button onClick={() => onDeleteSet(w.date, g.set.id)} className="text-slate-400 hover:text-red-400 transition-colors flex-shrink-0 ml-1">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div key={g.gid} className="rounded-xl overflow-hidden border-l-2 border-violet-400 dark:border-violet-600">
                        <div className="bg-violet-50 dark:bg-violet-900/20 px-3 py-1">
                          <span className="text-xs font-bold text-violet-500 uppercase tracking-wider">Superset</span>
                        </div>
                        {g.items.map(({ set: s, n: sn }) => (
                          <div key={s.id} className="flex items-center bg-slate-100 dark:bg-[#1C2537] px-3 py-2 gap-2 mt-px">
                            <span className="text-slate-400 text-xs font-semibold uppercase w-10 flex-shrink-0">Set {sn}</span>
                            {isAllView && s.exerciseName && <span className="text-blue-500 text-xs font-semibold flex-shrink-0">{s.exerciseName}</span>}
                            <span className="text-slate-900 dark:text-white font-semibold text-sm">{s.weight} kg × {s.reps}</span>
                            <span className="ml-auto text-slate-400 text-xs flex-shrink-0">1RM ≈ {epley1RM(s.weight, s.reps)} kg</span>
                          </div>
                        ))}
                      </div>
                    )
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Weight Tab ───────────────────────────────────────────────────────────────

function WeightTab({
  weightGoal, weightEntries, onDeleteEntry, onRequestGoalForm, today, unit, onUnitChange,
}: {
  weightGoal: WeightGoal | null;
  weightEntries: WeightEntry[];
  onDeleteEntry: (date: string) => void;
  onRequestGoalForm: () => void;
  today: string;
  unit: WeightUnit;
  onUnitChange: (u: WeightUnit) => void;
}) {
  const navigate = useNavigate();
  const latestEntry = weightEntries.length > 0 ? weightEntries[weightEntries.length - 1] : null;

  let progressInfo: {
    changeSoFar: number; changeNeeded: number; pct: number; onTrack: boolean; daysLeft: number;
  } | null = null;

  if (weightGoal && latestEntry) {
    const changeNeeded = weightGoal.targetKg - weightGoal.startKg;
    const changeSoFar = +(latestEntry.kg - weightGoal.startKg).toFixed(2);
    const pct = changeNeeded !== 0 ? Math.round((changeSoFar / changeNeeded) * 100) : 100;
    const startMs = new Date(weightGoal.startDate).getTime();
    const targetMs = new Date(weightGoal.targetDate).getTime();
    const nowMs = Date.now();
    const totalDays = (targetMs - startMs) / 86400000;
    const daysSoFar = (nowMs - startMs) / 86400000;
    const timePct = totalDays > 0 ? Math.min(100, Math.round((daysSoFar / totalDays) * 100)) : 0;
    const onTrack = pct >= timePct * 0.8;
    const daysLeft = Math.max(0, Math.round((targetMs - nowMs) / 86400000));
    progressInfo = { changeSoFar: kgToUnit(changeSoFar, unit), changeNeeded: kgToUnit(changeNeeded, unit), pct, onTrack, daysLeft };
  }

  return (
    <div className="space-y-4">
      {/* Unit Selector */}
      <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Unit</span>
        <div className="grid grid-cols-3 gap-2">
          {(['kg', 'lbs', 'stone'] as WeightUnit[]).map(u => (
            <button key={u} onClick={() => onUnitChange(u)}
              className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${unit === u ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-[#1C2537] text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#253347]'}`}>
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Goal Card */}
      {weightGoal ? (
        <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 space-y-3 shadow-sm border border-slate-200 dark:border-transparent">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Goal</span>
            <button onClick={onRequestGoalForm} className="text-blue-500 text-xs font-semibold hover:text-blue-400">Edit</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{latestEntry ? kgToUnit(latestEntry.kg, unit) : '—'}</div>
              <div className="text-xs text-slate-400 mt-0.5">Current {unit}</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{kgToUnit(weightGoal.targetKg, unit)}</div>
              <div className="text-xs text-slate-400 mt-0.5">Target {unit}</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{progressInfo?.daysLeft ?? '—'}</div>
              <div className="text-xs text-slate-400 mt-0.5">Days left</div>
            </div>
          </div>
          {progressInfo && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Change so far</span>
                <span>{progressInfo.changeSoFar > 0 ? '+' : ''}{progressInfo.changeSoFar} {unit} of {progressInfo.changeNeeded > 0 ? '+' : ''}{progressInfo.changeNeeded} {unit} needed</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-[#1C2537] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${progressInfo.onTrack ? 'bg-green-500' : 'bg-orange-500'}`}
                  style={{ width: `${Math.max(0, Math.min(100, Math.abs(progressInfo.pct)))}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className={progressInfo.onTrack ? 'text-green-500 font-semibold' : 'text-orange-500 font-semibold'}>
                  {progressInfo.onTrack ? 'On track' : 'Behind pace'}
                </span>
                <span className="text-slate-400">{Math.abs(progressInfo.pct)}% complete</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 text-center shadow-sm border border-slate-200 dark:border-transparent">
          <p className="text-slate-400 text-sm mb-3">No weight goal set.</p>
          <button onClick={onRequestGoalForm}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition-colors">
            Set Goal
          </button>
        </div>
      )}

      {/* Line Chart */}
      {weightEntries.length >= 1 && (
        <WeightChart entries={weightEntries} goalKg={weightGoal?.targetKg} unit={unit} today={today} />
      )}

      {/* History */}
      {weightEntries.length > 0 && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
          <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-[#1E2D45]">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">History</span>
          </div>
          {[...weightEntries].reverse().map((entry, i, arr) => {
            const prev = arr[i + 1];
            const deltaKg = prev ? +(entry.kg - prev.kg).toFixed(2) : null;
            const deltaDisplay = deltaKg !== null ? kgToUnit(Math.abs(deltaKg), unit) * Math.sign(deltaKg) : null;
            return (
              <div key={entry.date} className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-[#1E2D45] last:border-0">
                <span className="text-slate-500 dark:text-slate-400 text-sm flex-1">{formatDate(entry.date)}</span>
                {deltaDisplay !== null && (
                  <span className={`text-xs font-semibold mr-3 ${deltaDisplay < 0 ? 'text-green-500' : deltaDisplay > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {deltaDisplay > 0 ? `+${+(deltaDisplay).toFixed(1)}` : +(deltaDisplay).toFixed(1)}
                  </span>
                )}
                <span className="text-slate-900 dark:text-white font-bold text-sm mr-3">{kgToUnit(entry.kg, unit)} {unit}</span>
                <button onClick={() => navigate(`/?date=${entry.date}`)} className="text-slate-300 dark:text-slate-700 hover:text-blue-500 transition-colors mr-2" title="Edit this day">
                  <Pencil size={12} />
                </button>
                <button onClick={() => onDeleteEntry(entry.date)} className="text-slate-400 hover:text-red-400 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Weight Line Chart ─────────────────────────────────────────────────────────

function WeightChart({ entries, goalKg, unit, today }: {
  entries: WeightEntry[];
  goalKg?: number;
  unit: WeightUnit;
  today: string;
}) {
  const W = 320;
  const H = 140;
  const PAD = { top: 16, right: 12, bottom: 28, left: 42 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = entries.map(e => kgToUnit(e.kg, unit));
  const goalDisplay = goalKg !== undefined ? kgToUnit(goalKg, unit) : undefined;

  const allY = goalDisplay !== undefined ? [...values, goalDisplay] : values;
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const yRange = maxY - minY || 1;

  const dates = entries.map(e => e.date);
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const minMs = new Date(minDate).getTime();
  const maxMs = new Date(maxDate).getTime();
  const xRange = maxMs - minMs || 1;

  function toX(date: string) {
    return PAD.left + ((new Date(date).getTime() - minMs) / xRange) * plotW;
  }
  function toY(val: number) {
    return PAD.top + plotH - ((val - minY) / yRange) * plotH;
  }

  const points = entries.map(e => ({ x: toX(e.date), y: toY(kgToUnit(e.kg, unit)), date: e.date }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const yLabels = [minY, (minY + maxY) / 2, maxY].map(v => +v.toFixed(1));

  const xLabels: { x: number; label: string }[] = [
    { x: toX(minDate), label: minDate.slice(5) },
    { x: toX(maxDate), label: maxDate.slice(5) },
  ];
  if (entries.length > 5) {
    const mid = entries[Math.floor(entries.length / 2)];
    xLabels.splice(1, 0, { x: toX(mid.date), label: mid.date.slice(5) });
  }

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Weight Over Time</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
        {yLabels.map((val, i) => (
          <line key={i} x1={PAD.left} x2={W - PAD.right} y1={toY(val)} y2={toY(val)}
            stroke="#e2e8f0" strokeWidth="1" className="dark:[stroke:#1E2D45]" />
        ))}
        {goalDisplay !== undefined && (
          <line x1={PAD.left} x2={W - PAD.right} y1={toY(goalDisplay)} y2={toY(goalDisplay)}
            stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
        )}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.date === today ? 4 : 2.5}
            fill={p.date === today ? '#60a5fa' : '#3b82f6'}
            stroke={p.date === today ? '#1e40af' : 'none'} strokeWidth="1.5" />
        ))}
        {yLabels.map((val, i) => (
          <text key={i} x={PAD.left - 5} y={toY(val) + 4}
            textAnchor="end" fontSize="9" fill="#94a3b8">{val}</text>
        ))}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - 4}
            textAnchor="middle" fontSize="9" fill="#94a3b8">{l.label}</text>
        ))}
        {goalDisplay !== undefined && (
          <text x={W - PAD.right + 2} y={toY(goalDisplay) + 4}
            fontSize="8" fill="#22c55e" opacity="0.8">goal</text>
        )}
      </svg>
    </div>
  );
}

// ─── Weight Goal Form ─────────────────────────────────────────────────────────

function WeightGoalForm({
  current, latestKg, today, onClose, onSave, unit,
}: {
  current: WeightGoal | null;
  latestKg?: number;
  today: string;
  onClose: () => void;
  onSave: (goal: WeightGoal) => void;
  unit: WeightUnit;
}) {
  const startKgInit = current?.startKg ?? latestKg ?? 80;
  const targetKgInit = current?.targetKg ?? 75;
  const [startDisplay, setStartDisplay] = useState(kgToUnit(startKgInit, unit));
  const [targetDisplay, setTargetDisplay] = useState(kgToUnit(targetKgInit, unit));
  const [targetDate, setTargetDate] = useState(current?.targetDate ?? '');
  const stepMin = unit === 'lbs' ? 66 : unit === 'stone' ? 4.7 : 30;

  function handleSave() {
    if (!targetDate) return;
    onSave({
      startKg: unitToKg(startDisplay, unit),
      targetKg: unitToKg(targetDisplay, unit),
      targetDate,
      startDate: current?.startDate ?? today,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={onClose}>
      <div className="bg-slate-50 dark:bg-[#0A0F1E] w-full max-w-lg mx-auto rounded-t-3xl p-5 space-y-4"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-slate-900 dark:text-white font-extrabold text-xl">Weight Goal</h2>
          <button onClick={onClose} className="text-blue-500 font-semibold">Cancel</button>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Starting Weight ({unit})</label>
          <div className="flex items-center gap-3">
            <button className="stepper-btn" onClick={() => setStartDisplay(w => +(Math.max(stepMin, w - 0.5)).toFixed(1))}>−</button>
            <span className="text-slate-900 dark:text-white font-extrabold text-2xl flex-1 text-center">{startDisplay} {unit}</span>
            <button className="stepper-btn" onClick={() => setStartDisplay(w => +(w + 0.5).toFixed(1))}>+</button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Target Weight ({unit})</label>
          <div className="flex items-center gap-3">
            <button className="stepper-btn" onClick={() => setTargetDisplay(w => +(Math.max(stepMin, w - 0.5)).toFixed(1))}>−</button>
            <span className="text-slate-900 dark:text-white font-extrabold text-2xl flex-1 text-center">{targetDisplay} {unit}</span>
            <button className="stepper-btn" onClick={() => setTargetDisplay(w => +(w + 0.5).toFixed(1))}>+</button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Target Date</label>
          <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} min={today}
            className="w-full bg-white dark:bg-[#1C2537] text-slate-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 border border-slate-200 dark:border-transparent" />
        </div>

        <button onClick={handleSave}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors">
          Save Goal
        </button>
      </div>
    </div>
  );
}

// ─── Day Sheet ─────────────────────────────────────────────────────────────────

function DaySheet({
  date, progressTab, workoutMap, runs, habitEntriesMap, selectedHabit, gratitudeMap, effectiveTarget, onClose,
}: {
  date: string;
  progressTab: ProgressTab;
  workoutMap: Record<string, DayWorkout>;
  runs: RunEntry[];
  habitEntriesMap: Record<string, HabitEntry>;
  selectedHabit: Habit;
  gratitudeMap: Record<string, GratitudeEntry[]>;
  effectiveTarget: number;
  onClose: () => void;
}) {
  const workout = workoutMap[date] ?? null;
  const dayRuns = runs.filter(r => r.date === date);
  const habitEntry = habitEntriesMap[date] ?? null;
  const gratitudeEntries = (gratitudeMap[date] ?? []).sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="bg-slate-50 dark:bg-[#0A0F1E] w-full max-w-lg rounded-t-3xl flex flex-col" style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-200 dark:border-[#1E2D45] flex-shrink-0">
          <div className="text-slate-900 dark:text-white font-extrabold text-xl">{formatDate(date)}</div>
          <button onClick={onClose} className="text-blue-500 font-semibold hover:text-blue-400">Done</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {progressTab === 'lifting' && (workout ? (
            <>
              {workout.sets.map((s, i) => (
                <div key={s.id} className="flex items-center bg-white dark:bg-[#1C2537] rounded-xl px-4 py-2.5 border border-slate-200 dark:border-transparent">
                  <span className="text-slate-400 text-xs font-semibold uppercase w-12">Set {i + 1}</span>
                  <span className="flex-1 text-slate-900 dark:text-white font-bold">{s.weight} kg × {s.reps}</span>
                  <span className="text-slate-400 text-xs">1RM ≈ {epley1RM(s.weight, s.reps)} kg</span>
                </div>
              ))}
              <div className="flex justify-between text-sm px-1 pt-1">
                <span className="text-slate-400">Total reps</span>
                <span className={`font-bold ${workout.sets.reduce((s, x) => s + x.reps, 0) >= effectiveTarget ? 'text-green-500' : 'text-slate-900 dark:text-white'}`}>
                  {workout.sets.reduce((s, x) => s + x.reps, 0)}
                </span>
              </div>
            </>
          ) : <p className="text-slate-400 text-sm">No lifting on this day.</p>)}

          {progressTab === 'running' && (dayRuns.length > 0 ? (
            <>
              {dayRuns.map(r => (
                <div key={r.id} className="flex items-center bg-white dark:bg-[#1C2537] rounded-xl px-4 py-2.5 border border-slate-200 dark:border-transparent">
                  <span className="text-orange-500 font-bold flex-1">{r.distanceKm} km</span>
                </div>
              ))}
              {dayRuns.length > 1 && (
                <div className="flex justify-between text-sm px-1 pt-1">
                  <span className="text-slate-400">Total</span>
                  <span className="text-slate-900 dark:text-white font-bold">{dayRuns.reduce((s, r) => +(s + r.distanceKm).toFixed(1), 0)} km</span>
                </div>
              )}
            </>
          ) : <p className="text-slate-400 text-sm">No run on this day.</p>)}

          {progressTab === 'habits' && <HabitEntryDisplay habit={selectedHabit} entry={habitEntry} />}

          {progressTab === 'gratitude' && (gratitudeEntries.length > 0 ? (
            <div className="space-y-2">
              {gratitudeEntries.map(e => (
                <p key={e.id} className="text-slate-900 dark:text-white text-sm leading-relaxed bg-white dark:bg-[#1C2537] rounded-xl px-4 py-3 border border-slate-200 dark:border-transparent">{e.text}</p>
              ))}
            </div>
          ) : <p className="text-slate-400 text-sm">No gratitude on this day.</p>)}
        </div>
      </div>
    </div>
  );
}

// ─── Habit Day Row ─────────────────────────────────────────────────────────────

function HabitDayRow({ date, habit, entry }: { date: string; habit: Habit; entry: HabitEntry }) {
  const navigate = useNavigate();
  const done = habitCompletion(habit, entry) === 1;
  return (
    <div className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-[#1E2D45] last:border-0">
      <span className="text-slate-500 dark:text-slate-400 text-sm flex-1">{formatDate(date)}</span>
      {habit.type === undefined && (() => {
        const c = entry.completion ?? 'none';
        return (
          <span className={`text-sm font-semibold ${c === 'full' ? 'text-green-500' : c === 'micro' ? 'text-yellow-500' : 'text-slate-400'}`}>
            {c === 'full' ? 'Done' : c === 'micro' ? 'Micro' : '—'}
          </span>
        );
      })()}
      {habit.type === 'checkpoint' && (() => {
        const cps = habit.checkpoints ?? [];
        const score = cps.filter(cp => entry.checkpoints?.[cp.id]).length;
        return (
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {cps.map(cp => (
                <span key={cp.id} className={`text-xs ${entry.checkpoints?.[cp.id] ? 'text-blue-500' : 'text-slate-300 dark:text-slate-700'}`}>
                  {cp.label}
                </span>
              ))}
            </div>
            <span className={`text-xs font-bold w-8 text-right ${done ? 'text-green-500' : 'text-slate-400'}`}>{score}/{cps.length}</span>
          </div>
        );
      })()}
      {habit.type === 'boolean' && (
        <span className={`text-sm font-semibold ${done ? 'text-green-500' : 'text-slate-400'}`}>{entry.done ? 'Done' : '—'}</span>
      )}
      {habit.type === 'numeric' && (
        <span className="text-slate-900 dark:text-white font-bold text-sm">{entry.value ?? 0}{habit.unit ? ` ${habit.unit}` : ''}</span>
      )}
      <button onClick={() => navigate(`/?date=${date}`)} className="ml-2 text-slate-300 dark:text-slate-700 hover:text-blue-500 transition-colors flex-shrink-0" title="Edit this day">
        <Pencil size={12} />
      </button>
    </div>
  );
}

// ─── Habit Entry Display ──────────────────────────────────────────────────────

function HabitEntryDisplay({ habit, entry }: { habit: Habit; entry: HabitEntry | null }) {
  if (!entry) return <p className="text-slate-400 text-sm">No entry for this day.</p>;

  if (habit.type === undefined) {
    const c = entry.completion ?? 'none';
    const name = habit.name ?? habit.action ?? 'Habit';
    return (
      <div className="space-y-2">
        <div className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-center ${
          c === 'full' ? 'bg-green-600 text-white' :
          c === 'micro' ? 'bg-yellow-500 text-white' :
          'bg-slate-100 dark:bg-[#1C2537] text-slate-400'
        }`}>
          {c === 'full' ? `✓ ${name}` : c === 'micro' ? `~ ${habit.microHabit ?? 'Micro version'}` : 'Not completed'}
        </div>
        {c !== 'none' && habit.reward && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700/30 rounded-xl px-3 py-2">
            <p className="text-green-700 dark:text-green-400 text-sm">🎉 {habit.reward}</p>
          </div>
        )}
        {habit.identity && (
          <p className="text-xs text-slate-400 px-1">💪 {habit.identity}</p>
        )}
      </div>
    );
  }

  if (habit.type === 'checkpoint') {
    const cps = habit.checkpoints ?? [];
    return (
      <div className="flex gap-2 flex-wrap">
        {cps.map(cp => {
          const done = entry.checkpoints?.[cp.id] ?? false;
          return (
            <div key={cp.id} className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-center ${done ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-[#1C2537] text-slate-400'}`}>
              {cp.label}
            </div>
          );
        })}
      </div>
    );
  }
  if (habit.type === 'boolean') {
    return (
      <div className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-center ${entry.done ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-[#1C2537] text-slate-400'}`}>
        {entry.done ? 'Done' : 'Not done'}
      </div>
    );
  }
  if (habit.type === 'numeric') {
    return (
      <div className="bg-slate-100 dark:bg-[#1C2537] rounded-xl px-4 py-2.5 text-sm">
        <span className="text-slate-900 dark:text-white font-bold">{entry.value ?? 0}</span>
        {habit.unit && <span className="text-slate-400 ml-1">{habit.unit}</span>}
      </div>
    );
  }
  return null;
}

// ─── Base Calendar ─────────────────────────────────────────────────────────────

function BaseCalendar({
  onDayPress, cellStyle, legend,
}: {
  onDayPress: (date: string) => void;
  cellStyle: (dateStr: string) => string;
  legend?: React.ReactNode;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const todayStr = getTodayString();

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="text-slate-400 hover:text-slate-600 dark:hover:text-white w-8 h-8 flex items-center justify-center text-xl">‹</button>
        <span className="text-slate-900 dark:text-white font-bold text-sm">{monthLabel}</span>
        <button onClick={nextMonth} className="text-slate-400 hover:text-slate-600 dark:hover:text-white w-8 h-8 flex items-center justify-center text-xl">›</button>
      </div>
      <div className="grid grid-cols-7 mb-2">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-xs text-slate-400 font-semibold py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDayOfWeek }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          return (
            <button key={day} onClick={() => onDayPress(dateStr)}
              className={`aspect-square flex items-center justify-center rounded-lg text-xs font-semibold transition-all active:scale-95 hover:opacity-80 ${cellStyle(dateStr)} ${dateStr === todayStr ? 'ring-2 ring-blue-500' : ''}`}>
              {day}
            </button>
          );
        })}
      </div>
      {legend && <div className="flex flex-wrap gap-3 mt-3 justify-center">{legend}</div>}
    </div>
  );
}

// ─── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-transparent">
      <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-center">
      <p className="text-slate-400 text-sm">{text}</p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      <div className={`w-3 h-3 rounded ${color}`} />
      {label}
    </div>
  );
}
