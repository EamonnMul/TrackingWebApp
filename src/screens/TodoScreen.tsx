import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Flag, Calendar, ChevronDown, Sun, Repeat2 } from 'lucide-react';
import { getAllTodos, saveTodo, deleteTodo, getTodayString, formatDate, getAllHabits, saveHabit } from '../utils/storage';
import { Todo, Habit, RecurrenceRule } from '../types';

// ─── Recurrence helpers ───────────────────────────────────────────────────────

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

type TodoView = 'myDay' | 'all';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-slate-500',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export default function TodoScreen() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [view, setView] = useState<TodoView>('myDay');
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const today = getTodayString();

  useEffect(() => {
    Promise.all([getAllTodos(), getAllHabits()]).then(([allTodos, allHabits]) => {
      setTodos(allTodos.sort((a, b) => a.order - b.order));
      setHabits(allHabits);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (editingTitle) setTimeout(() => editRef.current?.focus(), 50);
  }, [editingTitle]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function sortedTodos(list: Todo[]) {
    return [...list].sort((a, b) => {
      // Incomplete first, then by order
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.order - b.order;
    });
  }

  const myDayTodos = selectedDate === today
    ? todos.filter(t => !t.done ? (t.myDay || t.dueDate === today) : t.completedDate === today)
    : todos.filter(t => !t.done ? t.dueDate === selectedDate : t.completedDate === selectedDate);
  const displayTodos = sortedTodos(view === 'myDay' ? myDayTodos : todos);
  const todayPendingCount = todos.filter(t => !t.done && (t.myDay || t.dueDate === today)).length;

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    const isToday = selectedDate === today;
    const todo: Todo = {
      id: Date.now().toString(),
      title,
      done: false,
      myDay: view === 'myDay' && isToday,
      dueDate: view === 'myDay' ? selectedDate : undefined,
      createdAt: Date.now(),
      order: Date.now(),
    };
    setTodos(prev => [...prev, todo]);
    setNewTitle('');
    await saveTodo(todo);
  }

  async function handleToggle(id: string) {
    const original = todos.find(t => t.id === id)!;
    const nowDone = !original.done;
    const updated = todos.map(t =>
      t.id === id ? { ...t, done: nowDone, completedDate: nowDone ? today : undefined } : t
    );
    setTodos(updated);
    const todo = updated.find(t => t.id === id)!;
    await saveTodo(todo);

    // Auto-create next occurrence for recurring tasks
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
    const todo = updated.find(t => t.id === id)!;
    await saveTodo(todo);
  }

  async function handleMoveUp(id: string) {
    const sorted = sortedTodos(view === 'myDay' ? myDayTodos : todos);
    const idx = sorted.findIndex(t => t.id === id);
    if (idx <= 0) return;
    const a = sorted[idx - 1];
    const b = sorted[idx];
    const newOrder = a.order;
    const updated = todos.map(t => {
      if (t.id === a.id) return { ...t, order: b.order };
      if (t.id === b.id) return { ...t, order: newOrder };
      return t;
    });
    setTodos(updated);
    await Promise.all([
      saveTodo(updated.find(t => t.id === a.id)!),
      saveTodo(updated.find(t => t.id === b.id)!),
    ]);
  }

  async function handleMoveDown(id: string) {
    const sorted = sortedTodos(view === 'myDay' ? myDayTodos : todos);
    const idx = sorted.findIndex(t => t.id === id);
    if (idx >= sorted.length - 1) return;
    const a = sorted[idx];
    const b = sorted[idx + 1];
    const updated = todos.map(t => {
      if (t.id === a.id) return { ...t, order: b.order };
      if (t.id === b.id) return { ...t, order: a.order };
      return t;
    });
    setTodos(updated);
    await Promise.all([
      saveTodo(updated.find(t => t.id === a.id)!),
      saveTodo(updated.find(t => t.id === b.id)!),
    ]);
  }

  const [convertedHabitName, setConvertedHabitName] = useState<string | null>(null);

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
    // Mark the task done
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-cobalt-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const incompleteTodos = displayTodos.filter(t => !t.done);
  const completedTodos = displayTodos.filter(t => t.done);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="screen-eyebrow text-cobalt-500">Inbox</p>
        <h1 className="screen-title">Tasks</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {view === 'myDay' ? formatDate(selectedDate) : `${todos.filter(t => !t.done).length} remaining`}
        </p>
      </div>

      {/* View Tabs */}
      <div className="flex bg-white dark:bg-ink-surface rounded-2xl p-1 gap-1 shadow-sm border border-slate-200 dark:border-transparent">
        {([
          { id: 'myDay', label: 'My Day', icon: <Sun size={12} /> },
          { id: 'all', label: 'All Tasks', icon: null },
        ] as { id: TodoView; label: string; icon: React.ReactNode }[]).map(tab => (
          <button key={tab.id} onClick={() => setView(tab.id)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              view === tab.id ? 'bg-cobalt-500 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {tab.icon}{tab.label}
            {tab.id === 'myDay' && todayPendingCount > 0 && view !== 'myDay' && (
              <span className="bg-cobalt-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {todayPendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Today reminder — shown on All Tasks view when there are pending tasks */}
      {view === 'all' && todayPendingCount > 0 && (
        <button
          onClick={() => setView('myDay')}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-cobalt-500/10 dark:bg-cobalt-500/15 border border-cobalt-500/30 dark:border-cobalt-500/40 rounded-xl text-left"
        >
          <Sun size={13} className="text-cobalt-500 flex-shrink-0" />
          <span className="text-xs text-cobalt-500 dark:text-cobalt-400 font-medium">
            {todayPendingCount} task{todayPendingCount !== 1 ? 's' : ''} still to do today
          </span>
          <span className="ml-auto text-xs text-cobalt-400">View →</span>
        </button>
      )}

      {/* Date navigator — My Day only */}
      {view === 'myDay' && (
        <div className="flex items-center bg-white dark:bg-ink-surface rounded-2xl shadow-sm border border-slate-200 dark:border-transparent">
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split('T')[0]);
            }}
            className="px-4 py-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-xl"
          >‹</button>
          <div className="flex-1 text-center">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{formatDate(selectedDate)}</span>
            {selectedDate !== today && (
              <button
                onClick={() => setSelectedDate(today)}
                className="block mx-auto text-xs text-cobalt-500 hover:text-cobalt-400 mt-0.5"
              >Back to today</button>
            )}
          </div>
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().split('T')[0]);
            }}
            className="px-4 py-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-xl"
          >›</button>
        </div>
      )}

      {/* Add Task */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Add a task…"
          className="flex-1 bg-white dark:bg-ink-surface text-slate-900 dark:text-white rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-slate-200 dark:border-transparent"
        />
        <button onClick={handleAdd}
          className="w-12 h-12 bg-cobalt-500 hover:bg-cobalt-600 active:scale-95 text-white rounded-2xl flex items-center justify-center transition-all">
          <Plus size={20} />
        </button>
      </div>

      {/* Empty state */}
      {displayTodos.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <p className="text-slate-500 text-sm">
            {view === 'myDay' ? 'No tasks for today. Add something above.' : 'No tasks yet.'}
          </p>
        </div>
      )}

      {/* Incomplete tasks */}
      {incompleteTodos.length > 0 && (
        <div className="bg-white dark:bg-ink-surface rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-transparent">
          {incompleteTodos.map((todo, idx) => (
            <TodoItem
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

      {convertedHabitName && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-xl animate-pop-in">
          ✓ Habit created: {convertedHabitName}
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
            <TodoItem
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
    </div>
  );
}

// ─── TodoItem ─────────────────────────────────────────────────────────────────

function TodoItem({
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
      {/* Main row */}
      <div className="flex items-center px-4 py-3 gap-3">
        {/* Checkbox */}
        <button onClick={onToggle}
          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
            todo.done ? 'bg-cobalt-500 border-cobalt-500' : 'border-slate-600 hover:border-cobalt-500'
          }`}>
          {todo.done && <div className="w-2 h-2 rounded-full bg-white" />}
        </button>

        {/* Title */}
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
            {/* Meta badges */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {todo.priority && (
                <span className={`text-xs font-semibold ${PRIORITY_COLORS[todo.priority]}`}>
                  {todo.priority === 'high' ? '●' : todo.priority === 'medium' ? '◐' : '○'} {PRIORITY_LABELS[todo.priority]}
                </span>
              )}
              {todo.dueDate && (
                <span className={`text-xs ${isOverdue ? 'text-red-400' : 'text-slate-500'}`}>
                  {isOverdue ? '⚠ ' : ''}{formatDate(todo.dueDate)}
                </span>
              )}
              {todo.myDay && !todo.dueDate && (
                <span className="text-xs text-slate-600">My Day</span>
              )}
              {todo.recurrence && (
                <span className="text-[10px] text-cobalt-400 flex items-center gap-0.5">
                  <Repeat2 size={9} /> {todo.recurrence.type}
                </span>
              )}
            </div>
          </button>
        )}

        {/* Expand button */}
        <button onClick={onExpand} className="text-slate-600 hover:text-slate-400 transition-colors">
          <ChevronDown size={15} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-line pt-3">
          {/* Notes */}
          <textarea
            value={notesValue}
            onChange={e => setNotesValue(e.target.value)}
            onBlur={() => onUpdate({ notes: notesValue.trim() || undefined })}
            placeholder="Add notes…"
            rows={2}
            className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-cobalt-500 placeholder:text-slate-600"
          />

          {/* Due date + My Day */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Due date</label>
              <div className="relative">
                <input type="date" value={todo.dueDate ?? ''}
                  onChange={e => onUpdate({ dueDate: e.target.value || undefined })}
                  className="w-full bg-slate-100 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cobalt-500" />
              </div>
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

          {/* My Day toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sun size={14} className="text-slate-500" />
              <span className="text-slate-400 text-sm">Add to My Day</span>
            </div>
            <button onClick={() => onUpdate({ myDay: !todo.myDay })}
              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${todo.myDay ? 'bg-cobalt-500' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${todo.myDay ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Recurrence */}
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

          {/* From habit badge */}
          {habitName && (
            <div className="flex items-center gap-1.5 text-xs text-violet-400">
              <span>🔗</span> From habit: <span className="font-semibold">{habitName}</span>
            </div>
          )}

          {/* Convert to habit */}
          {!todo.sourceHabitId && !todo.done && (
            <button onClick={onConvertToHabit}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-400 hover:border-cobalt-400 hover:text-cobalt-400 transition-colors">
              ↻ Convert to habit
            </button>
          )}

          {/* Reorder + Delete */}
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
