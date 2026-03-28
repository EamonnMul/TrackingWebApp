import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">History</h1>
        <p className="text-slate-400 text-sm mt-0.5">Every rep counts.</p>
      </div>

      {workouts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64">
          <p className="text-slate-400 font-semibold text-lg">No sessions logged yet.</p>
          <p className="text-slate-600 text-sm mt-1">Get after it on the Log tab.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workouts.map(w => {
            const totalReps = w.sets.reduce((sum, s) => sum + s.reps, 0);
            return (
              <button
                key={w.date}
                onClick={() => setSelected(w)}
                className="w-full bg-[#111827] rounded-2xl p-4 flex items-center hover:bg-[#1C2537] active:scale-[0.99] transition-all text-left"
              >
                <div className="flex-1">
                  <div className="text-white font-bold text-base">{formatDate(w.date)}</div>
                  <div className="text-slate-400 text-sm mt-0.5">
                    {w.sets.length} sets · {totalReps} reps
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-blue-400 text-2xl font-extrabold">{getMaxWeight(w)}</div>
                  <div className="text-slate-500 text-xs">kg max</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-[#0A0F1E] w-full max-w-lg rounded-t-3xl flex flex-col"
            style={{ maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#1E2D45]">
              <div>
                <div className="text-white font-extrabold text-xl">{formatDate(selected.date)}</div>
                <div className="text-slate-400 text-sm mt-0.5">
                  {selected.sets.length} sets · {selected.sets.reduce((sum, s) => sum + s.reps, 0)} total reps
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-blue-400 font-semibold hover:text-blue-300 transition-colors text-base"
              >
                Done
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {selected.sets.map((s, i) => (
                <div key={s.id} className="flex items-center bg-[#111827] rounded-xl px-4 py-3">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wide w-12">
                    Set {i + 1}
                  </span>
                  <span className="flex-1 text-white font-bold text-lg">
                    {s.weight} kg{' '}
                    <span className="text-slate-400 font-normal">×</span>{' '}
                    {s.reps}
                  </span>
                  <span className="text-slate-400 text-sm">{s.reps} reps</span>
                </div>
              ))}

              {/* Summary */}
              <div className="bg-[#111827] rounded-2xl p-4 mt-2">
                {[
                  { label: 'Max Weight', value: `${getMaxWeight(selected)} kg` },
                  { label: 'Total Sets', value: String(selected.sets.length) },
                  {
                    label: 'Total Reps',
                    value: String(selected.sets.reduce((sum, s) => sum + s.reps, 0)),
                    highlight: true,
                  },
                ].map(row => (
                  <div
                    key={row.label}
                    className="flex justify-between items-center py-3 border-b border-[#1E2D45] last:border-0 last:pb-0 first:pt-0"
                  >
                    <span className="text-slate-400 text-sm">{row.label}</span>
                    <span className={`font-bold text-sm ${row.highlight ? 'text-blue-400' : 'text-white'}`}>
                      {row.value}
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
