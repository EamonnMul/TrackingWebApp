import { useState, useEffect } from 'react';
import { Plus, Trash2, Play, Check, ChevronDown, ChevronUp, Copy, Calendar, Dumbbell } from 'lucide-react';
import {
  getAllWorkoutPlans, saveWorkoutPlan, deleteWorkoutPlan,
  BUILT_IN_TEMPLATES,
  saveSetForExercise, getAllExercises, saveExercise,
  getTodayString,
  DEFAULT_EXERCISE_ID,
} from '../utils/storage';
import { WorkoutPlan, PlannedExercise, WorkoutSet, Exercise } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function newExercise(): PlannedExercise {
  return { id: crypto.randomUUID(), name: '', sets: 3, reps: 10 };
}

// ─── Active Workout ───────────────────────────────────────────────────────────

interface LoggedSet { exerciseIdx: number; setIdx: number; weight: string; reps: string; done: boolean; }

function ActiveWorkout({ plan, onFinish, onCancel }: {
  plan: WorkoutPlan;
  onFinish: (plan: WorkoutPlan) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<LoggedSet[]>(() =>
    plan.exercises.flatMap((ex, ei) =>
      Array.from({ length: ex.sets }, (_, si) => ({
        exerciseIdx: ei,
        setIdx: si,
        weight: ex.weight != null ? String(ex.weight) : '',
        reps: String(ex.reps),
        done: false,
      }))
    )
  );
  const [saving, setSaving] = useState(false);
  const [expandedEx, setExpandedEx] = useState<number | null>(0);

  function setRow(ei: number, si: number, patch: Partial<LoggedSet>) {
    setRows(prev => prev.map(r =>
      r.exerciseIdx === ei && r.setIdx === si ? { ...r, ...patch } : r
    ));
  }

  const doneCount = rows.filter(r => r.done).length;
  const totalSets = rows.length;

  async function handleFinish() {
    setSaving(true);
    try {
      const today = getTodayString();
      // Log each ticked set into exercise storage
      const grouped: Record<string, { ex: PlannedExercise; sets: LoggedSet[] }> = {};
      for (const r of rows) {
        if (!r.done) continue;
        const ex = plan.exercises[r.exerciseIdx];
        if (!grouped[ex.name]) grouped[ex.name] = { ex, sets: [] };
        grouped[ex.name].sets.push(r);
      }

      // Ensure exercises exist in Firestore
      const allEx = await getAllExercises();
      const exByName: Record<string, Exercise> = {};
      for (const e of allEx) exByName[e.name.toLowerCase()] = e;

      for (const [exName, { sets }] of Object.entries(grouped)) {
        const key = exName.toLowerCase();
        let exercise = exByName[key];
        if (!exercise) {
          exercise = { id: crypto.randomUUID(), name: exName, createdAt: Date.now() };
          await saveExercise(exercise);
        }
        for (const r of sets) {
          const w = parseFloat(r.weight) || 0;
          const reps = parseInt(r.reps) || 0;
          if (reps === 0) continue;
          const set: WorkoutSet = {
            id: crypto.randomUUID(),
            weight: w,
            reps,
            createdAt: Date.now(),
            exerciseName: exName,
          };
          await saveSetForExercise(exercise.id === DEFAULT_EXERCISE_ID ? DEFAULT_EXERCISE_ID : exercise.id, today, set);
        }
      }

      const completed: WorkoutPlan = { ...plan, status: 'done', completedAt: Date.now() };
      await saveWorkoutPlan(completed);
      onFinish(completed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span className="font-semibold">{plan.name}</span>
          <span>{doneCount}/{totalSets} sets</span>
        </div>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-cobalt-500 rounded-full transition-all"
            style={{ width: `${totalSets > 0 ? (doneCount / totalSets) * 100 : 0}%` }}
          />
        </div>
      </div>

      {plan.exercises.map((ex, ei) => {
        const exRows = rows.filter(r => r.exerciseIdx === ei);
        const exDone = exRows.filter(r => r.done).length;
        const open = expandedEx === ei;
        return (
          <div key={ex.id} className="bg-white dark:bg-ink-surface rounded-2xl border border-slate-200 dark:border-transparent shadow-sm overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3"
              onClick={() => setExpandedEx(open ? null : ei)}
            >
              <div className="flex items-center gap-2">
                {exDone === ex.sets ? (
                  <Check size={14} className="text-green-500 shrink-0" />
                ) : (
                  <Dumbbell size={14} className="text-slate-400 shrink-0" />
                )}
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{ex.name || 'Exercise'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{exDone}/{ex.sets}</span>
                {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </div>
            </button>

            {open && (
              <div className="px-4 pb-4 space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                  <span>Weight (kg)</span><span>Reps</span><span></span><span></span>
                </div>
                {exRows.map(r => (
                  <div key={r.setIdx} className={`grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center rounded-xl px-2 py-1.5 transition-colors ${r.done ? 'bg-green-50 dark:bg-green-900/20' : 'bg-slate-50 dark:bg-ink-elevated'}`}>
                    <input
                      type="number"
                      value={r.weight}
                      onChange={e => setRow(ei, r.setIdx, { weight: e.target.value })}
                      placeholder="0"
                      className="w-full bg-transparent text-sm font-semibold text-slate-900 dark:text-white outline-none"
                    />
                    <input
                      type="number"
                      value={r.reps}
                      onChange={e => setRow(ei, r.setIdx, { reps: e.target.value })}
                      placeholder="0"
                      className="w-full bg-transparent text-sm font-semibold text-slate-900 dark:text-white outline-none"
                    />
                    <span className="text-[10px] text-slate-400">Set {r.setIdx + 1}</span>
                    <button
                      onClick={() => setRow(ei, r.setIdx, { done: !r.done })}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${r.done ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-400'}`}
                    >
                      <Check size={11} />
                    </button>
                  </div>
                ))}
                {ex.notes && <p className="text-xs text-slate-400 italic pt-1">{ex.notes}</p>}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="px-4 py-3 text-sm font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleFinish}
          disabled={saving || doneCount === 0}
          className="flex-1 py-3 rounded-2xl text-sm font-bold bg-cobalt-500 hover:bg-cobalt-600 active:scale-95 text-white transition-all disabled:opacity-40 shadow-lg shadow-glow-cobalt"
        >
          {saving ? 'Saving…' : `Finish Workout (${doneCount} sets) →`}
        </button>
      </div>
    </div>
  );
}

// ─── Builder ──────────────────────────────────────────────────────────────────

function WorkoutBuilder({ initial, onSave, onCancel }: {
  initial?: WorkoutPlan;
  onSave: (plan: WorkoutPlan) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [exercises, setExercises] = useState<PlannedExercise[]>(
    initial?.exercises.length ? initial.exercises : [newExercise()]
  );
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(!initial);

  function updateEx(id: string, patch: Partial<PlannedExercise>) {
    setExercises(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  function addEx() {
    setExercises(prev => [...prev, newExercise()]);
  }

  function removeEx(id: string) {
    setExercises(prev => prev.filter(e => e.id !== id));
  }

  function loadTemplate(tplId: string) {
    const tpl = BUILT_IN_TEMPLATES.find(t => t.id === tplId);
    if (!tpl) return;
    setName(tpl.name);
    setExercises(tpl.exercises.map(e => ({ ...e, id: crypto.randomUUID() })));
    setShowTemplates(false);
  }

  async function handleSave() {
    if (!name.trim() || exercises.every(e => !e.name.trim())) return;
    setSaving(true);
    try {
      const plan: WorkoutPlan = initial
        ? { ...initial, name: name.trim(), date: date || undefined, exercises }
        : {
          id: crypto.randomUUID(),
          name: name.trim(),
          date: date || undefined,
          exercises,
          status: 'planned',
          createdAt: Date.now(),
        };
      await saveWorkoutPlan(plan);
      onSave(plan);
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim().length > 0 && exercises.some(e => e.name.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* Template picker */}
      {showTemplates && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-2">Start from a template</p>
          <div className="grid grid-cols-3 gap-2">
            {BUILT_IN_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => loadTemplate(tpl.id)}
                className="flex flex-col items-center gap-1 bg-white dark:bg-ink-surface rounded-2xl p-3 border border-slate-200 dark:border-transparent shadow-sm hover:border-cobalt-400 dark:hover:border-cobalt-500 transition-colors"
              >
                <span className="text-sm font-bold text-slate-900 dark:text-white">{tpl.name}</span>
                <span className="text-[10px] text-slate-400 text-center leading-tight">{tpl.description}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowTemplates(false)} className="mt-2 text-xs text-slate-400 underline">
            Build from scratch
          </button>
        </div>
      )}

      {/* Workout name */}
      <div>
        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-1.5">Workout name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Pull Day A"
          className="w-full bg-slate-50 dark:bg-ink-elevated text-slate-900 dark:text-white placeholder-slate-400 rounded-xl px-3.5 py-2.5 text-sm outline-none border-2 border-transparent focus:border-cobalt-400 transition-colors"
        />
      </div>

      {/* Scheduled date */}
      <div>
        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-1.5">Scheduled date (optional)</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full bg-slate-50 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-xl px-3.5 py-2.5 text-sm outline-none border-2 border-transparent focus:border-cobalt-400 transition-colors"
        />
      </div>

      {/* Exercises */}
      <div>
        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-2">Exercises</label>
        <div className="space-y-3">
          {exercises.map((ex, idx) => (
            <div key={ex.id} className="bg-white dark:bg-ink-surface rounded-2xl p-4 border border-slate-200 dark:border-transparent shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-slate-400 w-5 text-center">{idx + 1}</span>
                <input
                  value={ex.name}
                  onChange={e => updateEx(ex.id, { name: e.target.value })}
                  placeholder="Exercise name"
                  className="flex-1 bg-slate-50 dark:bg-ink-elevated text-slate-900 dark:text-white placeholder-slate-400 rounded-xl px-3 py-2 text-sm outline-none border-2 border-transparent focus:border-cobalt-400 transition-colors"
                />
                <button onClick={() => removeEx(ex.id)} className="text-slate-400 hover:text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'sets', label: 'Sets', min: 1 },
                  { key: 'reps', label: 'Reps', min: 1 },
                  { key: 'weight', label: 'kg (opt)', min: 0 },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{f.label}</label>
                    <input
                      type="number"
                      min={f.min}
                      value={f.key === 'weight' ? (ex.weight ?? '') : ex[f.key]}
                      onChange={e => {
                        const v = e.target.value === '' ? undefined : Number(e.target.value);
                        updateEx(ex.id, { [f.key]: v });
                      }}
                      placeholder={f.key === 'weight' ? '—' : ''}
                      className="w-full bg-slate-50 dark:bg-ink-elevated text-slate-900 dark:text-white rounded-lg px-2.5 py-1.5 text-sm outline-none border-2 border-transparent focus:border-cobalt-400 transition-colors"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={addEx}
          className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-sm text-slate-400 hover:border-cobalt-400 hover:text-cobalt-400 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus size={13} /> Add exercise
        </button>
      </div>

      <div className="flex gap-3 items-center">
        <button onClick={onCancel} className="px-4 py-3 text-sm font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="flex-1 py-3 rounded-2xl text-sm font-bold bg-cobalt-500 hover:bg-cobalt-600 active:scale-95 text-white transition-all disabled:opacity-40 shadow-lg shadow-glow-cobalt"
        >
          {saving ? 'Saving…' : initial ? 'Update →' : 'Save Workout →'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type View = 'list' | 'builder' | 'active';

export default function PlannerTab() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<WorkoutPlan | undefined>(undefined);
  const [activeWorkout, setActiveWorkout] = useState<WorkoutPlan | null>(null);
  const [listTab, setListTab] = useState<'planned' | 'done'>('planned');

  useEffect(() => { load(); }, []);

  async function load() {
    const all = await getAllWorkoutPlans();
    setPlans(all.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || b.createdAt - a.createdAt));
  }

  async function handleSave(plan: WorkoutPlan) {
    setPlans(prev => {
      const exists = prev.find(p => p.id === plan.id);
      const next = exists ? prev.map(p => p.id === plan.id ? plan : p) : [...prev, plan];
      return next.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || b.createdAt - a.createdAt);
    });
    setEditing(undefined);
    setView('list');
  }

  async function handleDelete(id: string) {
    await deleteWorkoutPlan(id);
    setPlans(prev => prev.filter(p => p.id !== id));
  }

  async function handleDuplicate(plan: WorkoutPlan) {
    const copy: WorkoutPlan = {
      ...plan,
      id: crypto.randomUUID(),
      name: `${plan.name} (copy)`,
      status: 'planned',
      createdAt: Date.now(),
      completedAt: undefined,
      date: undefined,
    };
    await saveWorkoutPlan(copy);
    setPlans(prev => [copy, ...prev]);
  }

  function handleFinish(completed: WorkoutPlan) {
    setPlans(prev => prev.map(p => p.id === completed.id ? completed : p));
    setActiveWorkout(null);
    setView('list');
    setListTab('done');
  }

  const today = getTodayString();
  const pending = plans.filter(p => p.status === 'planned');
  const done = plans.filter(p => p.status === 'done').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const todayPlans = pending.filter(p => p.date === today);

  if (view === 'active' && activeWorkout) {
    return (
      <ActiveWorkout
        plan={activeWorkout}
        onFinish={handleFinish}
        onCancel={() => { setActiveWorkout(null); setView('list'); }}
      />
    );
  }

  if (view === 'builder') {
    return (
      <WorkoutBuilder
        initial={editing}
        onSave={handleSave}
        onCancel={() => { setEditing(undefined); setView('list'); }}
      />
    );
  }

  // ── List view ──
  return (
    <div className="pt-1 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Workout Planner</span>
        <button
          onClick={() => { setEditing(undefined); setView('builder'); }}
          className="text-cobalt-500 text-xs font-semibold flex items-center gap-1 hover:text-cobalt-400 transition-colors"
        >
          <Plus size={12} /> Plan Workout
        </button>
      </div>

      {/* Today's workouts */}
      {todayPlans.length > 0 && (
        <div className="bg-cobalt-500/10 dark:bg-cobalt-500/15 rounded-2xl p-4 border border-cobalt-500/30 dark:border-cobalt-500/40">
          <p className="text-[11px] font-bold text-cobalt-500 uppercase tracking-wider mb-2">Today</p>
          <div className="space-y-2">
            {todayPlans.map(p => (
              <div key={p.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{p.name}</p>
                  <p className="text-xs text-slate-400">{p.exercises.length} exercises</p>
                </div>
                <button
                  onClick={() => { setActiveWorkout(p); setView('active'); }}
                  className="flex items-center gap-1.5 bg-cobalt-500 text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-cobalt-600 active:scale-95 transition-all"
                >
                  <Play size={11} /> Start
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex gap-1 bg-slate-100 dark:bg-ink-elevated rounded-xl p-1">
        {(['planned', 'done'] as const).map(t => (
          <button
            key={t}
            onClick={() => setListTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              listTab === t
                ? 'bg-white dark:bg-ink text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {t === 'planned' ? `Planned${pending.length > 0 ? ` (${pending.length})` : ''}` : `Done${done.length > 0 ? ` (${done.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Planned list */}
      {listTab === 'planned' && (
        <div className="space-y-2">
          {pending.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-2xl mb-2">🏋️</p>
              <p className="text-sm text-slate-400">No planned workouts. Hit + to create one.</p>
            </div>
          ) : pending.map(p => (
            <PlanCard
              key={p.id}
              plan={p}
              onStart={() => { setActiveWorkout(p); setView('active'); }}
              onEdit={() => { setEditing(p); setView('builder'); }}
              onDuplicate={() => handleDuplicate(p)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
      )}

      {/* Done list */}
      {listTab === 'done' && (
        <div className="space-y-2">
          {done.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">No completed workouts yet.</p>
            </div>
          ) : done.map(p => (
            <PlanCard
              key={p.id}
              plan={p}
              onDuplicate={() => handleDuplicate(p)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({ plan, onStart, onEdit, onDuplicate, onDelete }: {
  plan: WorkoutPlan;
  onStart?: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDone = plan.status === 'done';

  return (
    <div className={`bg-white dark:bg-ink-surface rounded-2xl border shadow-sm overflow-hidden ${isDone ? 'border-green-200 dark:border-green-900/30' : 'border-slate-200 dark:border-transparent'}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              {isDone && <Check size={12} className="text-green-500 shrink-0" />}
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{plan.name}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
              {plan.date && (
                <span className="flex items-center gap-0.5">
                  <Calendar size={10} />
                  {fmtDate(plan.date)}
                </span>
              )}
              <span>{plan.exercises.length} exercises</span>
              {isDone && plan.completedAt && (
                <span className="text-green-600 dark:text-green-400">
                  Completed {new Date(plan.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onStart && (
              <button
                onClick={onStart}
                className="flex items-center gap-1 bg-cobalt-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-cobalt-600 active:scale-95 transition-all"
              >
                <Play size={10} /> Start
              </button>
            )}
            <button onClick={() => setExpanded(e => !e)} className="text-slate-400 hover:text-slate-600 transition-colors">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-1">
            {plan.exercises.map((ex, i) => (
              <div key={ex.id} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="text-slate-300 dark:text-slate-600 w-4 text-center">{i + 1}</span>
                <span className="flex-1">{ex.name}</span>
                <span>{ex.sets}×{ex.reps}{ex.weight ? ` @ ${ex.weight}kg` : ''}</span>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
              {onEdit && (
                <button onClick={onEdit} className="text-xs text-cobalt-400 hover:text-cobalt-300 font-semibold transition-colors">
                  Edit
                </button>
              )}
              <button onClick={onDuplicate} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition-colors">
                <Copy size={11} /> Duplicate
              </button>
              <button onClick={onDelete} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 ml-auto transition-colors">
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
