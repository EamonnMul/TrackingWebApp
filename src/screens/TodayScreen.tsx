import { useState, useEffect } from 'react';
import { Plus, Check, Zap, Lightbulb } from 'lucide-react';
import {
  getAllTodos, saveTodo, getTodayString,
  getAllHabits, saveHabit, saveHabitEntry, getHabitEntryForDate,
} from '../utils/storage';
import { Todo, Habit, HabitEntry, HabitCompletion } from '../types';

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

export default function TodayScreen() {
  const today = getTodayString();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitEntries, setHabitEntries] = useState<Record<string, HabitEntry>>({});
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [convertedHabit, setConvertedHabit] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const [allTodos, allHabits] = await Promise.all([getAllTodos(), getAllHabits()]);
    setTodos(allTodos.sort((a, b) => a.order - b.order));

    const relevantHabits = allHabits.filter(isHabitForToday);
    setHabits(relevantHabits);

    const entries: Record<string, HabitEntry> = {};
    await Promise.all(
      relevantHabits.map(async h => {
        const e = await getHabitEntryForDate(h.id, today);
        if (e) entries[h.id] = e;
      })
    );
    setHabitEntries(entries);

    // Smart suggestion: tasks completed 3+ times with same name → suggest habit
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

  // ── Derived state ────────────────────────────────────────────────────────────

  const pendingTasks = todos.filter(t => !t.done && (t.myDay || t.dueDate === today));
  const completedTodayTasks = todos.filter(t => t.done && t.completedDate === today);
  const habitsDone = habits.filter(h => isHabitDone(h, habitEntries[h.id])).length;
  const habitsTotal = habits.length;
  const nextActionHabits = habits.filter(h => h.nextAction && !isHabitDone(h, habitEntries[h.id]));

  // ── Task handlers ────────────────────────────────────────────────────────────

  async function handleAddTask() {
    const title = newTask.trim();
    if (!title) return;
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      done: false,
      myDay: true,
      dueDate: today,
      createdAt: Date.now(),
      order: Date.now(),
    };
    setTodos(prev => [...prev, todo]);
    setNewTask('');
    await saveTodo(todo);
  }

  async function handleToggleTask(id: string) {
    const updated = todos.map(t => {
      if (t.id !== id) return t;
      const nowDone = !t.done;
      return { ...t, done: nowDone, completedDate: nowDone ? today : undefined };
    });
    setTodos(updated);
    const todo = updated.find(t => t.id === id)!;
    await saveTodo(todo);
  }

  // ── Habit handlers ───────────────────────────────────────────────────────────

  async function toggleHabit(habitId: string) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    const entry = habitEntries[habitId];
    const current = entry?.completion ?? 'none';
    const next: HabitCompletion = current === 'full' ? 'none' : 'full';

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
    const wasCompleted = current !== 'none';
    const isNowCompleted = next !== 'none';
    if (wasCompleted === isNowCompleted) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    let streakCount = habit.streakCount ?? 0;
    let lastCompletedDate = habit.lastCompletedDate;
    if (isNowCompleted) {
      if (habit.lastCompletedDate === yesterdayStr) streakCount++;
      else if (habit.lastCompletedDate !== today) streakCount = 1;
      lastCompletedDate = today;
    } else {
      if (habit.lastCompletedDate === today) {
        streakCount = Math.max(0, streakCount - 1);
        lastCompletedDate = streakCount > 0 ? yesterdayStr : undefined;
      }
    }
    const updated: Habit = { ...habit, streakCount };
    if (lastCompletedDate !== undefined) updated.lastCompletedDate = lastCompletedDate;
    else delete updated.lastCompletedDate;
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
    setConvertedHabit(habit.name ?? '');
    setSuggestionDismissed(true);
    setTimeout(() => setConvertedHabit(null), 3000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const progressPct = habitsTotal > 0 ? (habitsDone / habitsTotal) * 100 : 0;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{greeting()}</p>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-0.5">
          {fmtDateLong(today)}
        </h1>
      </div>

      {/* Progress summary */}
      {(habitsTotal > 0 || pendingTasks.length > 0) && (
        <div className="flex items-center gap-3">
          {habitsTotal > 0 && (
            <div className="flex-1 bg-white dark:bg-[#111827] rounded-2xl px-4 py-3 border border-slate-200 dark:border-transparent shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Habits</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">{habitsDone}/{habitsTotal}</span>
              </div>
            </div>
          )}
          {pendingTasks.length > 0 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl px-4 py-3 border border-slate-200 dark:border-transparent shadow-sm shrink-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tasks</p>
              <p className="text-xl font-extrabold text-slate-900 dark:text-white">{pendingTasks.length}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tasks ───────────────────────────────────────────────────────────── */}
      {(pendingTasks.length > 0 || completedTodayTasks.length > 0) && (
        <section>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-2 px-1">Tasks</p>
          <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden border border-slate-200 dark:border-transparent shadow-sm">
            {pendingTasks.map(todo => (
              <TodayTaskRow
                key={todo.id}
                todo={todo}
                onToggle={() => handleToggleTask(todo.id)}
              />
            ))}
            {completedTodayTasks.length > 0 && pendingTasks.length > 0 && (
              <div className="border-t border-slate-100 dark:border-[#1E2D45]" />
            )}
            {completedTodayTasks.map(todo => (
              <TodayTaskRow
                key={todo.id}
                todo={todo}
                onToggle={() => handleToggleTask(todo.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Quick-add task */}
      <div className="flex gap-2">
        <input
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); }}
          placeholder="Add a task for today…"
          className="flex-1 bg-white dark:bg-[#111827] text-slate-900 dark:text-white rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-slate-200 dark:border-transparent"
        />
        <button onClick={handleAddTask}
          className="w-12 h-12 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-2xl flex items-center justify-center transition-all">
          <Plus size={18} />
        </button>
      </div>

      {/* ── Habits ──────────────────────────────────────────────────────────── */}
      {habits.length > 0 && (
        <section>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-2 px-1">Habits</p>
          <div className="bg-white dark:bg-[#111827] rounded-2xl overflow-hidden border border-slate-200 dark:border-transparent shadow-sm">
            {habits.map(habit => {
              const entry = habitEntries[habit.id];
              const done = isHabitDone(habit, entry);
              const streak = habit.streakCount ?? 0;
              const linkedPendingTasks = todos.filter(t => !t.done && t.sourceHabitId === habit.id);
              return (
                <div key={habit.id} className="border-b border-slate-100 dark:border-[#1E2D45] last:border-0">
                  <div className="flex items-center px-4 py-3.5 gap-3">
                    <button onClick={() => toggleHabit(habit.id)} className="flex-shrink-0 transition-all active:scale-90">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                        done ? 'bg-blue-600' : 'border-2 border-slate-300 dark:border-slate-600 hover:border-blue-400'
                      }`}>
                        {done && <Check size={12} className="text-white" />}
                      </div>
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${done ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                        {habit.name ?? habit.action ?? 'Habit'}
                      </p>
                      {habit.nextAction && !done && (
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                          <Zap size={10} className="text-yellow-500 shrink-0" />
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
                      <span className="text-xs font-bold text-orange-400 flex-shrink-0">🔥{streak}d</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Next Actions ────────────────────────────────────────────────────── */}
      {nextActionHabits.length > 0 && (
        <section>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-2 px-1 flex items-center gap-1.5">
            <Zap size={11} className="text-yellow-500" /> Prep for success
          </p>
          <div className="space-y-2">
            {nextActionHabits.map(h => (
              <div key={h.id} className="bg-white dark:bg-[#111827] rounded-2xl px-4 py-3 border border-slate-200 dark:border-transparent shadow-sm flex items-start gap-3">
                <Zap size={14} className="text-yellow-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-slate-900 dark:text-white font-semibold">{h.nextAction}</p>
                  <p className="text-xs text-slate-400 mt-0.5">For: {h.name ?? h.action}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Smart suggestion ────────────────────────────────────────────────── */}
      {suggestion && !suggestionDismissed && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl p-4 border border-violet-200 dark:border-violet-900/30 shadow-sm">
          <div className="flex items-start gap-3">
            <Lightbulb size={16} className="text-violet-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Turn "{suggestion}" into a habit?
              </p>
              <p className="text-xs text-slate-400 mt-0.5">You've completed this task 3+ times.</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setSuggestionDismissed(true)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors px-2"
            >
              Dismiss
            </button>
            <button
              onClick={handleCreateHabitFromSuggestion}
              className="flex-1 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 active:scale-95 text-white transition-all"
            >
              Create habit →
            </button>
          </div>
        </div>
      )}

      {/* ── Converted habit toast ────────────────────────────────────────────── */}
      {convertedHabit && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-xl animate-pop-in">
          ✓ Habit created: {convertedHabit}
        </div>
      )}

      {/* Empty state */}
      {pendingTasks.length === 0 && habits.length === 0 && (
        <div className="text-center py-12">
          <p className="text-3xl mb-3">🌅</p>
          <p className="text-base font-bold text-slate-900 dark:text-white">Your day is clear</p>
          <p className="text-sm text-slate-400 mt-1">Add tasks above or habits in the Log tab.</p>
        </div>
      )}
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TodayTaskRow({ todo, onToggle }: { todo: Todo; onToggle: () => void }) {
  return (
    <div className="flex items-center px-4 py-3 gap-3 border-b border-slate-100 dark:border-[#1E2D45] last:border-0">
      <button onClick={onToggle} className="flex-shrink-0 transition-all active:scale-90">
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          todo.done ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600 hover:border-blue-400'
        }`}>
          {todo.done && <Check size={10} className="text-white" />}
        </div>
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${todo.done ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
          {todo.title}
        </p>
        {todo.sourceHabitId && (
          <p className="text-[10px] text-violet-400 mt-0.5">From habit</p>
        )}
      </div>
      {todo.priority === 'high' && !todo.done && (
        <span className="text-[10px] font-bold text-red-400 shrink-0">HIGH</span>
      )}
    </div>
  );
}
