import { useState, useEffect, useRef } from 'react';
import {
  Plus, Check, Zap, Trash2, ChevronDown, Sun, Repeat2, Lightbulb,
  Flame, Footprints, Scale, Dumbbell,
} from 'lucide-react';
import {
  getAllTodos, saveTodo, deleteTodo, getTodayString, formatDate,
  getAllHabits, saveHabit, saveHabitEntry,
  getAllHabitEntriesForHabit,
  getAllRuns, getAllWeightEntries, getWeightGoal, getWeightUnit, kgToUnit,
  getAllExercises, getAllWorkoutsForExercise, DEFAULT_EXERCISE_ID,
} from '../utils/storage';
import {
  Todo, Habit, HabitEntry, HabitCompletion, RecurrenceRule,
  WeightEntry, WeightGoal, WeightUnit,
} from '../types';
import {
  deriveStreakState,
  streakStateNeedsWrite,
} from '../utils/habitStreak';
import {
  ProgressRing, Sparkline, StatTile, SkeletonTile, SectionLabel, EmptyState, ScreenLoader,
} from '../components/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtDateLong(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function nextOccurrence(rule: RecurrenceRule, fromDate: string): string {
  const d = new Date(fromDate + 'T12:00:00');
  if (rule.type === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (rule.type === 'weekly') {
    const days = rule.daysOfWeek ?? [];
    if (days.length === 0) {
      d.setDate(d.getDate() + 7);
    } else {
      const current = d.getDay();
      const sorted = [...days].sort((a, b) => a - b);
      const next = sorted.find(day => day > current) ?? sorted[0];
      const diff = next > current ? next - current : 7 - current + next;
      d.setDate(d.getDate() + diff);
    }
  } else if (rule.type === 'monthly') {
    const day = rule.dayOfMonth ?? d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, maxDay));
  }
  return d.toISOString().split('T')[0];
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Monday of the current week, local time, as YYYY-MM-DD. */
function getWeekStartLocal(todayStr: string): string {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const dow = dt.getDay(); // 0=Sun
  const diff = dow === 0 ? 6 : dow - 1;
  dt.setDate(dt.getDate() - diff);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

interface Snapshot {
  weights: WeightEntry[];     // sorted ascending by date
  weightGoal: WeightGoal | null;
  weightUnit: WeightUnit;
  runKmWeek: number;
  setsWeek: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-slate-500',
};

function isHabitForToday(habit: Habit): boolean {
  if (habit.archived) return false;
  if (habit.frequency === 'specific_days' && habit.specificDays) {
    return habit.specificDays.includes(new Date().getDay());
  }
  return true;
}

function isHabitDone(habit: Habit, entry: HabitEntry | undefined): boolean {
  if (!entry) return false;
  if (habit.type !== undefined) return entry.done ?? false;
  return entry.completion === 'full' || entry.completion === 'micro';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type TaskView = 'today' | 'all';

export default function TodayScreen() {
  const today = getTodayString();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitEntries, setHabitEntries] = useState<Record<string, HabitEntry>>({});
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newPriority, setNewPriority] = useState<Todo['priority']>(undefined);
  const [newRecurrence, setNewRecurrence] = useState<RecurrenceRule | undefined>(undefined);
  const [newRecDays, setNewRecDays] = useState<number[]>([]);
  const [newRecDayOfMonth, setNewRecDayOfMonth] = useState(1);
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [taskView, setTaskView] = useState<TaskView>('today');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [convertedHabitName, setConvertedHabitName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  // Full entry history per habit, kept in a ref so streak recomputation
  // on toggle doesn't require another Firestore round-trip.
  const entryHistoryRef = useRef<Record<string, HabitEntry[]>>({});
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [bumpedHabit, setBumpedHabit] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  // Snapshot data loads after the core UI so first paint stays fast.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      try {
        const weekStart = getWeekStartLocal(today);
        const [weights, weightGoal, weightUnit, runs, exercises] = await Promise.all([
          getAllWeightEntries(),
          getWeightGoal(),
          getWeightUnit(),
          getAllRuns(),
          getAllExercises(),
        ]);
        const exerciseIds = [DEFAULT_EXERCISE_ID, ...exercises.map(e => e.id).filter(id => id !== DEFAULT_EXERCISE_ID)];
        const workoutLists = await Promise.all(exerciseIds.map(id => getAllWorkoutsForExercise(id)));
        const setsWeek = workoutLists.flat()
          .filter(w => w.date >= weekStart && w.date <= today)
          .reduce((sum, w) => sum + w.sets.length, 0);
        const runKmWeek = runs
          .filter(r => r.date >= weekStart && r.date <= today)
          .reduce((sum, r) => sum + r.distanceKm, 0);
        if (!cancelled) {
          setSnapshot({
            weights: [...weights].sort((a, b) => a.date.localeCompare(b.date)),
            weightGoal, weightUnit, runKmWeek, setsWeek,
          });
        }
      } catch {
        if (!cancelled) setSnapshot({ weights: [], weightGoal: null, weightUnit: 'kg', runKmWeek: 0, setsWeek: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [loading]);
  useEffect(() => {
    if (editingTitle) setTimeout(() => editRef.current?.focus(), 50);
  }, [editingTitle]);

  async function load() {
    const [allTodos, allHabits] = await Promise.all([getAllTodos(), getAllHabits()]);
    setTodos(allTodos.sort((a, b) => a.order - b.order));

    const relevantHabits = allHabits.filter(isHabitForToday);

    // For each habit, pull its full entry history so we can derive an
    // up-to-date streak (the cached habit.streakCount can be stale if
    // the user missed a day without opening the app — that was the bug).
    const allEntriesByHabit = await Promise.all(
      relevantHabits.map(h => getAllHabitEntriesForHabit(h.id))
    );

    // Recompute streak/lastCompletedDate per habit; write back to Firestore
    // if it changed. Fire-and-forget so we don't block the UI.
    const habitsWithFreshStreak = relevantHabits.map((h, i) => {
      // Skip non-standard habit shapes (typed habits manage their own state)
      if (h.type !== undefined) return h;
      const derived = deriveStreakState(h, allEntriesByHabit[i], today);
      if (streakStateNeedsWrite(h, derived)) {
        const next: Habit = { ...h, streakCount: derived.streakCount };
        if (derived.lastCompletedDate !== undefined) {
          next.lastCompletedDate = derived.lastCompletedDate;
        } else {
          delete next.lastCompletedDate;
        }
        saveHabit(next).catch(() => {});
        return next;
      }
      return h;
    });
    setHabits(habitsWithFreshStreak);

    // Keep the existing "today's entry" map for the UI's quick lookup.
    const entries: Record<string, HabitEntry> = {};
    relevantHabits.forEach((h, i) => {
      const todayEntry = allEntriesByHabit[i].find(e => e.date === today);
      if (todayEntry) entries[h.id] = todayEntry;
    });
    setHabitEntries(entries);

    // Stash full entry history so toggleHabit can recompute without re-reading.
    entryHistoryRef.current = Object.fromEntries(
      relevantHabits.map((h, i) => [h.id, allEntriesByHabit[i]])
    );

    // Smart suggestion: tasks completed 3+ times → offer to create habit
    const habitNames = new Set(allHabits.map(h => (h.name ?? h.action ?? '').toLowerCase().trim()));
    const counts: Record<string, number> = {};
    for (const t of allTodos.filter(t => t.done)) {
      const k = t.title.toLowerCase().trim();
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const match = Object.entries(counts).find(([name, cnt]) => cnt >= 3 && !habitNames.has(name));
    if (match) setSuggestion(match[0]);

    setLoading(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  function sortedTodos(list: Todo[]) {
    return [...list].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.order - b.order;
    });
  }

  const todayTodos = todos.filter(t => {
    if (t.done) return t.completedDate === today;
    // Exclude tasks with a future due date regardless of myDay flag
    if (t.dueDate && t.dueDate > today) return false;
    return t.myDay || t.dueDate === today;
  });
  const displayTodos = sortedTodos(taskView === 'today' ? todayTodos : todos);
  const incompleteTodos = displayTodos.filter(t => !t.done);
  const completedTodos = displayTodos.filter(t => t.done);
  const todayPendingCount = todayTodos.filter(t => !t.done).length;
  const habitsDone = habits.filter(h => isHabitDone(h, habitEntries[h.id])).length;

  // ── Task handlers ─────────────────────────────────────────────────────────

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    const dueDate = newDueDate || today;
    const isToday = dueDate === today;
    let recurrence = newRecurrence;
    if (recurrence?.type === 'weekly') recurrence = { ...recurrence, daysOfWeek: newRecDays.length ? newRecDays : [new Date().getDay()] };
    if (recurrence?.type === 'monthly') recurrence = { ...recurrence, dayOfMonth: newRecDayOfMonth };
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      done: false,
      myDay: isToday,
      dueDate,
      priority: newPriority,
      recurrence,
      recurringGroupId: recurrence ? crypto.randomUUID() : undefined,
      createdAt: Date.now(),
      order: Date.now(),
    };
    setTodos(prev => [...prev, todo]);
    setNewTitle('');
    setNewDueDate('');
    setNewPriority(undefined);
    setNewRecurrence(undefined);
    setNewRecDays([]);
    setNewRecDayOfMonth(1);
    setShowAddOptions(false);
    await saveTodo(todo);
  }

  async function handleToggle(id: string) {
    const original = todos.find(t => t.id === id)!;
    const nowDone = !original.done;
    const updated = todos.map(t =>
      t.id === id ? { ...t, done: nowDone, completedDate: nowDone ? today : undefined } : t
    );
    setTodos(updated);
    await saveTodo(updated.find(t => t.id === id)!);

    if (nowDone && original.recurrence) {
      const base = original.dueDate ?? today;
      const nextDate = nextOccurrence(original.recurrence, base);
      const next: Todo = {
        id: crypto.randomUUID(),
        title: original.title,
        done: false,
        dueDate: nextDate,
        myDay: false,
        priority: original.priority,
        notes: original.notes,
        sourceHabitId: original.sourceHabitId,
        recurrence: original.recurrence,
        recurringGroupId: original.recurringGroupId ?? original.id,
        createdAt: Date.now(),
        order: Date.now(),
      };
      await saveTodo(next);
      setTodos(prev => [...prev, next]);
    }
  }

  async function handleDelete(id: string) {
    setTodos(prev => prev.filter(t => t.id !== id));
    setExpandedId(null);
    await deleteTodo(id);
  }

  async function handleUpdate(id: string, patch: Partial<Todo>) {
    const updated = todos.map(t => t.id === id ? { ...t, ...patch } : t);
    setTodos(updated);
    await saveTodo(updated.find(t => t.id === id)!);
  }

  async function handleMoveUp(id: string) {
    const sorted = sortedTodos(taskView === 'today' ? todayTodos : todos);
    const idx = sorted.findIndex(t => t.id === id);
    if (idx <= 0) return;
    const a = sorted[idx - 1], b = sorted[idx];
    const updated = todos.map(t => {
      if (t.id === a.id) return { ...t, order: b.order };
      if (t.id === b.id) return { ...t, order: a.order };
      return t;
    });
    setTodos(updated);
    await Promise.all([saveTodo(updated.find(t => t.id === a.id)!), saveTodo(updated.find(t => t.id === b.id)!)]);
  }

  async function handleMoveDown(id: string) {
    const sorted = sortedTodos(taskView === 'today' ? todayTodos : todos);
    const idx = sorted.findIndex(t => t.id === id);
    if (idx >= sorted.length - 1) return;
    const a = sorted[idx], b = sorted[idx + 1];
    const updated = todos.map(t => {
      if (t.id === a.id) return { ...t, order: b.order };
      if (t.id === b.id) return { ...t, order: a.order };
      return t;
    });
    setTodos(updated);
    await Promise.all([saveTodo(updated.find(t => t.id === a.id)!), saveTodo(updated.find(t => t.id === b.id)!)]);
  }

  async function handleConvertToHabit(todo: Todo) {
    const habit: Habit = {
      id: crypto.randomUUID(),
      name: todo.title,
      frequency: 'daily',
      createdAt: Date.now(),
      archived: false,
    };
    await saveHabit(habit);
    setHabits(prev => [...prev, habit]);
    const updated = { ...todo, done: true, completedDate: today };
    setTodos(prev => prev.map(t => t.id === todo.id ? updated : t));
    await saveTodo(updated);
    setConvertedHabitName(habit.name ?? '');
    setTimeout(() => setConvertedHabitName(null), 3000);
  }

  function startEditTitle(todo: Todo) {
    setEditingTitle(todo.id);
    setEditTitleValue(todo.title);
    setExpandedId(todo.id);
  }

  async function commitEditTitle(id: string) {
    const title = editTitleValue.trim();
    if (title) await handleUpdate(id, { title });
    setEditingTitle(null);
  }

  // ── Habit handlers ────────────────────────────────────────────────────────

  async function toggleHabit(habitId: string) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    const entry = habitEntries[habitId];
    const current = entry?.completion ?? 'none';
    const next: HabitCompletion = current === 'full' ? 'none' : 'full';
    if (next === 'full') {
      setBumpedHabit(habitId);
      setTimeout(() => setBumpedHabit(b => (b === habitId ? null : b)), 400);
    }
    const newEntry: HabitEntry = {
      ...(entry ?? {}),
      id: `${habitId}_${today}`,
      habitId,
      date: today,
      completion: next,
      createdAt: entry?.createdAt ?? Date.now(),
    };
    setHabitEntries(prev => ({ ...prev, [habitId]: newEntry }));
    await saveHabitEntry(newEntry);

    if (habit.type !== undefined) return;

    // Recompute streak from the full entry history. Source of truth is the
    // entry list — never trust the cached habit.streakCount.
    const history = entryHistoryRef.current[habitId] ?? [];
    const otherEntries = history.filter(e => e.date !== today);
    const updatedHistory = [...otherEntries, newEntry];
    entryHistoryRef.current[habitId] = updatedHistory;

    const derived = deriveStreakState(habit, updatedHistory, today);
    const updated: Habit = { ...habit, streakCount: derived.streakCount };
    if (derived.lastCompletedDate !== undefined) {
      updated.lastCompletedDate = derived.lastCompletedDate;
    } else {
      delete updated.lastCompletedDate;
    }
    setHabits(prev => prev.map(h => h.id === habitId ? updated : h));
    saveHabit(updated).catch(() => {});
  }

  async function handleCreateHabitFromSuggestion() {
    if (!suggestion) return;
    const habit: Habit = {
      id: crypto.randomUUID(),
      name: suggestion.charAt(0).toUpperCase() + suggestion.slice(1),
      frequency: 'daily',
      createdAt: Date.now(),
      archived: false,
    };
    await saveHabit(habit);
    setConvertedHabitName(habit.name ?? '');
    setSuggestionDismissed(true);
    setTimeout(() => setConvertedHabitName(null), 3000);
  }

  if (loading) {
    return <ScreenLoader />;
  }

  const allHabitsDone = habits.length > 0 && habitsDone === habits.length;

  // Ring tracks habits when they exist, otherwise today's tasks.
  const todayDoneCount = todayTodos.filter(t => t.done).length;
  const ringDone = habits.length > 0 ? habitsDone : todayDoneCount;
  const ringTotal = habits.length > 0 ? habits.length : todayTodos.length;
  const progressPct = ringTotal > 0 ? (ringDone / ringTotal) * 100 : 0;

  // One clear next action: first unfinished habit, else first pending task.
  const nextHabit = habits.find(h => !isHabitDone(h, habitEntries[h.id]));
  const nextTask = !nextHabit ? todayTodos.find(t => !t.done) : undefined;

  // Weight snapshot derivations
  const latestWeight = snapshot && snapshot.weights.length > 0
    ? snapshot.weights[snapshot.weights.length - 1] : null;
  const weightDelta = latestWeight && snapshot?.weightGoal
    ? latestWeight.kg - snapshot.weightGoal.targetKg : null;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <p className="screen-eyebrow text-cobalt-500">{greeting()}</p>
        <h1 className="screen-title">
          {fmtDateLong(today)}
        </h1>
      </div>

      {/* ── Hero: today's loop ─────────────────────────────────────────────── */}
      {(habits.length > 0 || todayPendingCount > 0) && (
        <div className={`card-elevated p-4 flex items-center gap-4 ${allHabitsDone ? 'border-success-500/40' : ''}`}>
          <ProgressRing pct={progressPct} size={64} stroke={5}>
            <span className="tabular text-sm font-extrabold text-slate-900 dark:text-white">
              {ringDone}/{ringTotal}
            </span>
          </ProgressRing>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">
              {allHabitsDone ? 'All habits done' : 'Up next'}
            </p>
            {nextHabit ? (
              <>
                <p className="text-[15px] font-bold text-slate-900 dark:text-white truncate">
                  {nextHabit.name ?? nextHabit.action ?? 'Habit'}
                </p>
                {(nextHabit.microHabit || nextHabit.nextAction) && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate flex items-center gap-1">
                    <Zap size={10} className="text-fire-500 shrink-0" />
                    {nextHabit.microHabit ?? nextHabit.nextAction}
                  </p>
                )}
              </>
            ) : nextTask ? (
              <>
                <p className="text-[15px] font-bold text-slate-900 dark:text-white truncate">{nextTask.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {todayPendingCount} task{todayPendingCount !== 1 ? 's' : ''} left today
                </p>
              </>
            ) : (
              <>
                <p className="text-[15px] font-bold text-success-500">Clean sweep.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Everything's logged. Go be a big dawg.</p>
              </>
            )}
          </div>
          {nextHabit && (
            <button
              onClick={() => toggleHabit(nextHabit.id)}
              aria-label={`Complete ${nextHabit.name ?? 'habit'}`}
              className="shrink-0 w-10 h-10 rounded-full bg-cobalt-500 hover:bg-cobalt-600 active:scale-90 text-white flex items-center justify-center transition-all shadow-glow-cobalt"
            >
              <Check size={18} strokeWidth={3} />
            </button>
          )}
        </div>
      )}

      {/* ── Snapshot: weight · running · lifting ───────────────────────────── */}
      {snapshot === null ? (
        <div className="flex gap-2">
          <SkeletonTile /><SkeletonTile /><SkeletonTile />
        </div>
      ) : (snapshot.weights.length > 0 || snapshot.runKmWeek > 0 || snapshot.setsWeek > 0) && (
        <div className="flex gap-2">
          {latestWeight && (
            <StatTile
              icon={Scale}
              label="Weight"
              value={kgToUnit(latestWeight.kg, snapshot.weightUnit).toFixed(1)}
              unit={snapshot.weightUnit}
              sub={
                weightDelta !== null && (
                  <span className={Math.abs(weightDelta) < 0.05 ? 'text-success-500' : 'text-slate-500 dark:text-slate-400'}>
                    {Math.abs(weightDelta) < 0.05
                      ? 'At goal'
                      : `${Math.abs(kgToUnit(Math.abs(weightDelta), snapshot.weightUnit)).toFixed(1)} ${snapshot.weightUnit} to goal`}
                  </span>
                )
              }
            >
              {snapshot.weights.length >= 2 && (
                <div className="mt-1.5">
                  <Sparkline values={snapshot.weights.slice(-14).map(w => w.kg)} />
                </div>
              )}
            </StatTile>
          )}
          <StatTile
            icon={Footprints}
            label="Run · wk"
            value={snapshot.runKmWeek.toFixed(1)}
            unit="km"
          />
          <StatTile
            icon={Dumbbell}
            label="Sets · wk"
            value={String(snapshot.setsWeek)}
          />
        </div>
      )}

      {/* ── Habits ──────────────────────────────────────────────────────────── */}
      {habits.length > 0 && (
        <section>
          <SectionLabel
            right={
              allHabitsDone ? (
                <span className="chip-success">
                  <Check size={10} strokeWidth={3} /> Clean sweep
                </span>
              ) : undefined
            }
          >
            Habits
          </SectionLabel>
          <div className="card overflow-hidden">
            {habits.map(habit => {
              const entry = habitEntries[habit.id];
              const done = isHabitDone(habit, entry);
              const streak = habit.streakCount ?? 0;
              const linkedPendingTasks = todos.filter(t => !t.done && t.sourceHabitId === habit.id);
              return (
                <div
                  key={habit.id}
                  className={`border-b border-slate-100 dark:border-line last:border-0 ${
                    bumpedHabit === habit.id ? 'animate-habit-bump' : ''
                  }`}
                >
                  <div className={`flex items-center px-4 py-3.5 gap-3 transition-colors ${done ? 'bg-success-500/[0.04]' : ''}`}>
                    <button
                      onClick={() => toggleHabit(habit.id)}
                      aria-label={`${done ? 'Uncheck' : 'Complete'} ${habit.name ?? 'habit'}`}
                      className="flex-shrink-0 transition-all active:scale-90"
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                        done
                          ? 'bg-success-500 shadow-glow-success'
                          : 'border-2 border-slate-300 dark:border-slate-600 hover:border-cobalt-400'
                      }`}>
                        {done && <Check size={13} strokeWidth={3} className="text-white" />}
                      </div>
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold transition-colors ${done ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
                        {habit.name ?? habit.action ?? 'Habit'}
                      </p>
                      {habit.nextAction && !done && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                          <Zap size={10} className="text-fire-500 shrink-0" />
                          {habit.nextAction}
                        </p>
                      )}
                      {linkedPendingTasks.length > 0 && (
                        <p className="text-[10px] text-violet-400 mt-0.5">
                          {linkedPendingTasks.length} linked task{linkedPendingTasks.length !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    {streak > 0 && (
                      <span className="chip-fire flex-shrink-0">
                        <Flame size={10} strokeWidth={2.5} />
                        <span className="tabular">{streak}d</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Tasks ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em]">Tasks</p>
          <div className="flex bg-slate-100 dark:bg-ink-elevated rounded-xl p-0.5 gap-0.5">
            {(['today', 'all'] as TaskView[]).map(v => (
              <button key={v} onClick={() => setTaskView(v)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  taskView === v ? 'bg-white dark:bg-ink-elevated text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'
                }`}>
                {v === 'today' ? 'Today' : 'All'}
                {v === 'all' && taskView !== 'all' && todos.filter(t => !t.done).length > todayPendingCount && (
                  <span className="ml-1 text-[9px] text-slate-400">+{todos.filter(t => !t.done).length - todayPendingCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Add task */}
        <div className="bg-white dark:bg-ink-surface rounded-2xl border border-slate-200 dark:border-transparent shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <input
              ref={inputRef}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Add a task…"
              className="flex-1 bg-transparent text-slate-900 dark:text-white text-sm focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 py-1"
            />
            <button
              onClick={() => setShowAddOptions(s => !s)}
              className={`p-1.5 rounded-lg transition-colors ${showAddOptions ? 'text-cobalt-500 bg-cobalt-500/10 dark:bg-cobalt-500/15' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
              title="More options"
            >
              <ChevronDown size={14} className={`transition-transform duration-200 ${showAddOptions ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={handleAdd} disabled={!newTitle.trim()}
              className="w-8 h-8 bg-cobalt-500 hover:bg-cobalt-600 disabled:opacity-30 active:scale-95 text-white rounded-xl flex items-center justify-center transition-all">
              <Plus size={15} />
            </button>
          </div>

          {showAddOptions && (
            <div className="border-t border-slate-100 dark:border-line px-3 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">Due date</label>
                  <input type="date" value={newDueDate}
                    onChange={e => setNewDueDate(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">Priority</label>
                  <select value={newPriority ?? ''}
                    onChange={e => setNewPriority((e.target.value as Todo['priority']) || undefined)}
                    className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500">
                    <option value="">None</option>
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">⚪ Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <Repeat2 size={10} /> Repeat
                </label>
                <select value={newRecurrence?.type ?? ''}
                  onChange={e => {
                    const type = e.target.value as RecurrenceRule['type'] | '';
                    setNewRecurrence(type ? { type } : undefined);
                    if (!type) { setNewRecDays([]); setNewRecDayOfMonth(1); }
                  }}
                  className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500">
                  <option value="">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>

                {newRecurrence?.type === 'weekly' && (
                  <div className="flex gap-1 mt-2">
                    {DAY_LABELS.map((d, i) => (
                      <button key={i} type="button"
                        onClick={() => setNewRecDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          newRecDays.includes(i) ? 'bg-cobalt-500 text-white' : 'bg-slate-100 dark:bg-ink-elevated text-slate-400'
                        }`}>{d}</button>
                    ))}
                  </div>
                )}

                {newRecurrence?.type === 'monthly' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-400">Day</span>
                    <input type="number" min={1} max={28} value={newRecDayOfMonth}
                      onChange={e => setNewRecDayOfMonth(Math.min(28, Math.max(1, +e.target.value)))}
                      className="w-14 bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500"
                    />
                    <span className="text-xs text-slate-400">of each month</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Incomplete tasks */}
        {incompleteTodos.length > 0 && (
          <div className="bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
            {incompleteTodos.map((todo, idx) => (
              <TaskItem
                key={todo.id}
                todo={todo}
                isExpanded={expandedId === todo.id}
                isEditingTitle={editingTitle === todo.id}
                editTitleValue={editTitleValue}
                editRef={editRef}
                today={today}
                isFirst={idx === 0}
                isLast={idx === incompleteTodos.length - 1}
                onToggle={() => handleToggle(todo.id)}
                onExpand={() => setExpandedId(expandedId === todo.id ? null : todo.id)}
                onStartEdit={() => startEditTitle(todo)}
                onEditChange={setEditTitleValue}
                onEditCommit={() => commitEditTitle(todo.id)}
                onUpdate={patch => handleUpdate(todo.id, patch)}
                onDelete={() => handleDelete(todo.id)}
                onMoveUp={() => handleMoveUp(todo.id)}
                onMoveDown={() => handleMoveDown(todo.id)}
                onConvertToHabit={() => handleConvertToHabit(todo)}
                habitName={todo.sourceHabitId ? (habits.find(h => h.id === todo.sourceHabitId)?.name ?? undefined) : undefined}
              />
            ))}
          </div>
        )}

        {/* Completed tasks */}
        {completedTodos.length > 0 && (
          <div className="bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
            <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-line">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Completed ({completedTodos.length})
              </span>
            </div>
            {completedTodos.map((todo, idx) => (
              <TaskItem
                key={todo.id}
                todo={todo}
                isExpanded={expandedId === todo.id}
                isEditingTitle={editingTitle === todo.id}
                editTitleValue={editTitleValue}
                editRef={editRef}
                today={today}
                isFirst={idx === 0}
                isLast={idx === completedTodos.length - 1}
                onToggle={() => handleToggle(todo.id)}
                onExpand={() => setExpandedId(expandedId === todo.id ? null : todo.id)}
                onStartEdit={() => startEditTitle(todo)}
                onEditChange={setEditTitleValue}
                onEditCommit={() => commitEditTitle(todo.id)}
                onUpdate={patch => handleUpdate(todo.id, patch)}
                onDelete={() => handleDelete(todo.id)}
                onMoveUp={() => handleMoveUp(todo.id)}
                onMoveDown={() => handleMoveDown(todo.id)}
                onConvertToHabit={() => handleConvertToHabit(todo)}
                habitName={todo.sourceHabitId ? (habits.find(h => h.id === todo.sourceHabitId)?.name ?? undefined) : undefined}
              />
            ))}
          </div>
        )}

        {displayTodos.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-4">
            {taskView === 'today' ? 'Nothing due today. Add a task above.' : 'No tasks yet.'}
          </p>
        )}
      </section>

      {/* ── Smart suggestion ──────────────────────────────────────────────── */}
      {suggestion && !suggestionDismissed && (
        <div className="bg-white dark:bg-ink-surface rounded-2xl p-4 border border-violet-200 dark:border-violet-900/30 shadow-sm">
          <div className="flex items-start gap-3">
            <Lightbulb size={16} className="text-violet-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Turn "{suggestion}" into a habit?</p>
              <p className="text-xs text-slate-400 mt-0.5">You've completed this task 3+ times.</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setSuggestionDismissed(true)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors px-2">
              Dismiss
            </button>
            <button onClick={handleCreateHabitFromSuggestion}
              className="flex-1 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 active:scale-95 text-white transition-all">
              Create habit →
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {displayTodos.length === 0 && habits.length === 0 && (
        <EmptyState
          icon={Sun}
          title="Your day is clear"
          hint="Add a task above, or set up habits in the Log tab."
        />
      )}

      {/* Toast */}
      {convertedHabitName && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-xl animate-pop-in">
          ✓ Habit created: {convertedHabitName}
        </div>
      )}
    </div>
  );
}

// ─── TaskItem ─────────────────────────────────────────────────────────────────

function TaskItem({
  todo, isExpanded, isEditingTitle, editTitleValue, editRef, today,
  isFirst, isLast,
  onToggle, onExpand, onStartEdit, onEditChange, onEditCommit,
  onUpdate, onDelete, onMoveUp, onMoveDown, onConvertToHabit, habitName,
}: {
  todo: Todo;
  isExpanded: boolean;
  isEditingTitle: boolean;
  editTitleValue: string;
  editRef: React.RefObject<HTMLInputElement>;
  today: string;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onUpdate: (patch: Partial<Todo>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onConvertToHabit: () => void;
  habitName?: string;
}) {
  const [notesValue, setNotesValue] = useState(todo.notes ?? '');
  const isOverdue = todo.dueDate && todo.dueDate < today && !todo.done;

  return (
    <div className="border-b border-slate-100 dark:border-line last:border-0">
      <div className="flex items-center px-4 py-3 gap-3">
        <button onClick={onToggle}
          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
            todo.done ? 'bg-cobalt-500 border-cobalt-500' : 'border-slate-600 hover:border-cobalt-500'
          }`}>
          {todo.done && <div className="w-2 h-2 rounded-full bg-white" />}
        </button>

        {isEditingTitle ? (
          <input
            ref={editRef}
            value={editTitleValue}
            onChange={e => onEditChange(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={e => { if (e.key === 'Enter') onEditCommit(); }}
            className="flex-1 bg-transparent text-slate-900 dark:text-white text-sm focus:outline-none"
          />
        ) : (
          <button className="flex-1 text-left" onDoubleClick={onStartEdit}>
            <span className={`text-sm font-medium ${todo.done ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
              {todo.title}
            </span>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {todo.priority && (
                <span className={`text-xs font-semibold ${PRIORITY_COLORS[todo.priority]}`}>
                  {todo.priority === 'high' ? '●' : todo.priority === 'medium' ? '◐' : '○'} {todo.priority}
                </span>
              )}
              {todo.dueDate && (
                <span className={`text-xs ${isOverdue ? 'text-red-400' : 'text-slate-500'}`}>
                  {isOverdue ? '⚠ ' : ''}{formatDate(todo.dueDate)}
                </span>
              )}
              {todo.recurrence && (
                <span className="text-[10px] text-cobalt-400 flex items-center gap-0.5">
                  <Repeat2 size={9} /> {todo.recurrence.type}
                </span>
              )}
              {todo.sourceHabitId && (
                <span className="text-[10px] text-violet-400">from habit</span>
              )}
            </div>
          </button>
        )}

        <button onClick={onExpand} className="text-slate-600 hover:text-slate-400 transition-colors">
          <ChevronDown size={15} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-line pt-3">
          <textarea
            value={notesValue}
            onChange={e => setNotesValue(e.target.value)}
            onBlur={() => onUpdate({ notes: notesValue.trim() || undefined })}
            placeholder="Add notes…"
            rows={2}
            className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-600"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Due date</label>
              <input type="date" value={todo.dueDate ?? ''}
                onChange={e => onUpdate({ dueDate: e.target.value || undefined })}
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Priority</label>
              <select value={todo.priority ?? ''}
                onChange={e => onUpdate({ priority: (e.target.value as Todo['priority']) || undefined })}
                className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500">
                <option value="">None</option>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">⚪ Low</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sun size={14} className="text-slate-500" />
              <span className="text-slate-400 text-sm">Add to Today</span>
            </div>
            <button onClick={() => onUpdate({ myDay: !todo.myDay })}
              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${todo.myDay ? 'bg-cobalt-500' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${todo.myDay ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <Repeat2 size={11} /> Repeat
            </label>
            <select
              value={todo.recurrence?.type ?? ''}
              onChange={e => {
                const type = e.target.value as RecurrenceRule['type'] | '';
                if (!type) {
                  onUpdate({ recurrence: undefined, recurringGroupId: undefined });
                } else {
                  const defaultDays = todo.dueDate
                    ? [new Date(todo.dueDate + 'T12:00:00').getDay()]
                    : [new Date().getDay()];
                  onUpdate({
                    recurrence: {
                      type,
                      ...(type === 'weekly' ? { daysOfWeek: defaultDays } : {}),
                      ...(type === 'monthly' ? { dayOfMonth: todo.dueDate ? new Date(todo.dueDate + 'T12:00:00').getDate() : new Date().getDate() } : {}),
                    },
                    recurringGroupId: todo.recurringGroupId ?? todo.id,
                  });
                }
              }}
              className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500"
            >
              <option value="">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>

            {todo.recurrence?.type === 'weekly' && (
              <div className="flex gap-1 mt-2">
                {DAY_LABELS.map((d, i) => (
                  <button key={i}
                    onClick={() => {
                      const days = todo.recurrence?.daysOfWeek ?? [];
                      const next = days.includes(i) ? days.filter(x => x !== i) : [...days, i];
                      if (next.length > 0) onUpdate({ recurrence: { ...todo.recurrence!, daysOfWeek: next } });
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      (todo.recurrence?.daysOfWeek ?? []).includes(i)
                        ? 'bg-cobalt-500 text-white'
                        : 'bg-slate-100 dark:bg-ink-elevated text-slate-400'
                    }`}
                  >{d}</button>
                ))}
              </div>
            )}

            {todo.recurrence?.type === 'monthly' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-400">Day</span>
                <input type="number" min={1} max={28}
                  value={todo.recurrence.dayOfMonth ?? 1}
                  onChange={e => onUpdate({ recurrence: { ...todo.recurrence!, dayOfMonth: Math.min(28, Math.max(1, +e.target.value)) } })}
                  className="w-14 bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500"
                />
                <span className="text-xs text-slate-400">of each month</span>
              </div>
            )}
          </div>

          {habitName && (
            <div className="flex items-center gap-1.5 text-xs text-violet-400">
              <span>🔗</span> From habit: <span className="font-semibold">{habitName}</span>
            </div>
          )}

          {!todo.sourceHabitId && !todo.done && (
            <button onClick={onConvertToHabit}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-400 hover:border-cobalt-400 hover:text-cobalt-400 transition-colors">
              ↻ Convert to habit
            </button>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-line">
            <button onClick={onMoveUp} disabled={isFirst}
              className="text-slate-600 hover:text-slate-300 disabled:opacity-30 transition-colors text-lg px-2">↑</button>
            <button onClick={onMoveDown} disabled={isLast}
              className="text-slate-600 hover:text-slate-300 disabled:opacity-30 transition-colors text-lg px-2">↓</button>
            <div className="flex-1" />
            <button onClick={onDelete}
              className="flex items-center gap-1.5 text-red-400 hover:text-red-300 text-xs font-semibold transition-colors">
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
