import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { BottomSheet, Stepper } from '../ui';
import { PlannedRun, RunType } from '../../types';
import { savePlannedRun, deletePlannedRun } from '../../utils/storage';

export const RUN_TYPES: { id: RunType; label: string; hint: string }[] = [
  { id: 'easy',      label: 'Easy',      hint: 'Conversational' },
  { id: 'long',      label: 'Long',      hint: 'Time on feet' },
  { id: 'tempo',     label: 'Tempo',     hint: 'Comfortably hard' },
  { id: 'intervals', label: 'Intervals', hint: 'Reps + recovery' },
  { id: 'recovery',  label: 'Recovery',  hint: 'Very easy' },
];

/** Plan a new run, or edit/delete an existing one. */
export default function RunPlanSheet({
  open, onClose, date, existing, mode = 'plan', onSaved, onLog,
}: {
  open: boolean;
  onClose: () => void;
  /** date to plan for (ignored when editing) */
  date: string;
  existing?: PlannedRun | null;
  /** 'plan' edits the plan; 'log' records what was actually run. */
  mode?: 'plan' | 'log';
  onSaved: () => void;
  onLog?: (run: PlannedRun, actualKm: number) => Promise<void>;
}) {
  const [distance, setDistance] = useState(5);
  const [runType, setRunType] = useState<RunType>('easy');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDistance(existing?.distanceKm ?? 5);
    setRunType(existing?.runType ?? 'easy');
    setNotes(existing?.notes ?? '');
    setError(null);
  }, [open, existing]);

  const isLog = mode === 'log' && !!existing;

  async function logRun() {
    if (!existing || !onLog) return;
    setBusy(true); setError(null);
    try {
      await onLog(existing, Math.round(distance * 10) / 10);
      onClose();
    } catch {
      setError("Couldn't save that run. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true); setError(null);
    const run: PlannedRun = {
      id: existing?.id ?? crypto.randomUUID(),
      date: existing?.date ?? date,
      distanceKm: Math.round(distance * 10) / 10,
      runType,
      notes: notes.trim() || undefined,
      status: existing?.status ?? 'planned',
      createdAt: existing?.createdAt ?? Date.now(),
      completedAt: existing?.completedAt,
      loggedRunId: existing?.loggedRunId,
    };
    try {
      await savePlannedRun(run);
      onSaved();
      onClose();
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('Delete this planned run?')) return;
    setBusy(true); setError(null);
    try {
      await deletePlannedRun(existing.id);
      onSaved();
      onClose();
    } catch {
      setError("Couldn't delete. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      eyebrow={isLog ? 'Log run' : existing ? 'Edit planned run' : 'Plan a run'}
      title={`${distance} km ${isLog ? '' : RUN_TYPES.find(t => t.id === runType)?.label.toLowerCase() ?? ''}`.trim()}
      footer={
        <div className="space-y-2">
          {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
          <div className="flex gap-2">
            {existing && !isLog && (
              <button onClick={remove} className="btn-secondary px-4 text-red-400" aria-label="Delete">
                <Trash2 size={15} />
              </button>
            )}
            <button disabled={busy} onClick={isLog ? logRun : save} className="btn-primary flex-1">
              {busy ? 'Saving…' : isLog ? 'Log run' : existing ? 'Save changes' : 'Add to plan'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="eyebrow block mb-1.5">Distance</span>
          <Stepper value={distance} onChange={setDistance} step={0.5} min={0.5} suffix="km" />
        </div>

        {isLog && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Planned {existing!.distanceKm} km {RUN_TYPES.find(t => t.id === existing!.runType)?.label.toLowerCase()}.
            Adjust if you ran a different distance.
          </p>
        )}

        {!isLog && <div>
          <span className="eyebrow block mb-1.5">Type</span>
          <div className="grid grid-cols-3 gap-1.5">
            {RUN_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setRunType(t.id)}
                className={`py-2 rounded-xl border transition-all ${
                  runType === t.id
                    ? 'bg-cobalt-500/15 border-cobalt-500/40'
                    : 'bg-slate-100 dark:bg-ink-inset border-slate-200 dark:border-line'
                }`}
              >
                <p className={`text-xs font-bold ${runType === t.id ? 'text-cobalt-500' : 'text-slate-700 dark:text-slate-300'}`}>
                  {t.label}
                </p>
                <p className="text-[9px] text-slate-500 dark:text-slate-400">{t.hint}</p>
              </button>
            ))}
          </div>
        </div>}

        {!isLog && <label className="block">
          <span className="eyebrow block mb-1">Notes (optional)</span>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. 6 x 800m @ 5k pace"
            className="input"
          />
        </label>}
      </div>
    </BottomSheet>
  );
}
