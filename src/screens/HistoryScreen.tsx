import { useState, useEffect } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { getAllWorkouts, formatDate, getMaxWeight } from '../utils/storage';
import { DayWorkout } from '../types';

export default function HistoryScreen() {
  const [workouts, setWorkouts] = useState<DayWorkout[]>([]);
  const [selected, setSelected] = useState<DayWorkout | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAllWorkouts().then(all => {
      setWorkouts([...all].sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    });
  }, []);

  const totalSessions = workouts.length;
  const totalSets = workouts.reduce((sum, w) => sum + w.sets.length, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-cobalt-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="screen-eyebrow text-cobalt-500">Ledger · All Sessions</p>
        <h1 className="screen-title">History</h1>
      </div>

      {workouts.length === 0 ? (
        <div className="card flex flex-col items-center justify-center h-64 border-dashed">
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base">No sessions yet</p>
          <p className="text-slate-500 dark:text-slate-500 text-sm mt-1">
            Your training log starts on the Log tab.
          </p>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="card grid grid-cols-2 divide-x divide-slate-200 dark:divide-line py-3">
            <div className="flex flex-col items-center">
              <span className="numeric-lg text-slate-900 dark:text-white">{totalSessions}</span>
              <span className="eyebrow mt-1">Sessions</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="numeric-lg text-slate-900 dark:text-white">{totalSets}</span>
              <span className="eyebrow mt-1">Sets Logged</span>
            </div>
          </div>

          {/* List */}
          <div className="space-y-2">
            {workouts.map(w => {
              const totalReps = w.sets.reduce((sum, s) => sum + s.reps, 0);
              return (
                <button
                  key={w.date}
                  onClick={() => setSelected(w)}
                  className="card w-full px-4 py-3.5 flex items-center gap-3 text-left
                             hover:border-cobalt-500/40 dark:hover:border-cobalt-500/40
                             active:scale-[0.995] transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 dark:text-white font-bold text-[15px]">
                      {formatDate(w.date)}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                      {w.sets.length} sets · {totalReps} reps
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className="numeric-lg text-cobalt-400">{getMaxWeight(w)}</span>
                      <span className="text-cobalt-500 text-[11px] font-bold">kg</span>
                    </div>
                    <div className="eyebrow mt-0.5">Top Set</div>
                  </div>
                  <ChevronRight size={14} className="text-slate-400 dark:text-slate-600" />
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-ink-surface w-full max-w-lg rounded-t-3xl
                       border-t border-slate-200 dark:border-line flex flex-col animate-fade-in"
            style={{ maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-line" />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-2 pb-4 border-b border-slate-200 dark:border-line">
              <div>
                <p className="eyebrow-accent">Session</p>
                <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-0.5">
                  {formatDate(selected.date)}
                </h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="btn-icon"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {/* Stats tiles */}
              <div className="grid grid-cols-3 gap-2">
                <SummaryTile label="Top Set" value={String(getMaxWeight(selected))} unit="kg" highlight />
                <SummaryTile label="Sets" value={String(selected.sets.length)} />
                <SummaryTile
                  label="Reps"
                  value={String(selected.sets.reduce((sum, s) => sum + s.reps, 0))}
                />
              </div>

              <p className="section-label">Sets</p>

              <div className="card overflow-hidden">
                {selected.sets.map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-4 px-4 py-3
                      ${i < selected.sets.length - 1 ? 'border-b border-slate-200 dark:border-line' : ''}
                    `}
                  >
                    <span className="eyebrow w-8">{String(i + 1).padStart(2, '0')}</span>
                    <div className="flex-1 flex items-baseline gap-2">
                      <span className="numeric-lg text-slate-900 dark:text-white">{s.weight}</span>
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-semibold">kg</span>
                      <span className="text-slate-400 dark:text-slate-500 text-sm font-semibold ml-1">× {s.reps}</span>
                    </div>
                    <span className="numeric-md text-slate-500 dark:text-slate-400">
                      {s.weight * s.reps}
                      <span className="eyebrow ml-1">vol</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label, value, unit, highlight,
}: {
  label: string; value: string; unit?: string; highlight?: boolean;
}) {
  return (
    <div className={highlight ? 'stat-tile-accent' : 'stat-tile'}>
      <span className="eyebrow">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={`numeric-lg ${highlight ? 'text-cobalt-400' : 'text-slate-900 dark:text-white'}`}>
          {value}
        </span>
        {unit && <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold">{unit}</span>}
      </div>
    </div>
  );
}
