import { useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Dumbbell, Footprints, Check, Play,
} from 'lucide-react';
import { WorkoutPlan, PlannedRun } from '../../types';
import { addDaysLocal } from '../../utils/habitStreak';
import { RUN_TYPES } from './RunPlanSheet';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday-anchored start of the week containing `dateStr`. */
export function weekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const dow = dt.getDay();              // 0 = Sun
  return addDaysLocal(dateStr, -(dow === 0 ? 6 : dow - 1));
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d, 12).getDay()];
}
function dayNum(dateStr: string): string {
  return String(Number(dateStr.split('-')[2]));
}

/**
 * The week planner. Shows lifting and running side by side for each day so a
 * hybrid week is legible at a glance — which is the whole point of planning
 * ahead rather than deciding session by session.
 */
export default function ScheduleView({
  anchorDate, today, plans, runs,
  onPrevWeek, onNextWeek, onThisWeek,
  onAddWorkout, onAddRun, onStartWorkout, onEditRun, onCompleteRun,
}: {
  anchorDate: string;
  today: string;
  plans: WorkoutPlan[];
  runs: PlannedRun[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onAddWorkout: (date: string) => void;
  onAddRun: (date: string) => void;
  onStartWorkout: (p: WorkoutPlan) => void;
  onEditRun: (r: PlannedRun) => void;
  onCompleteRun: (r: PlannedRun) => void;
}) {
  const start = weekStart(anchorDate);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysLocal(start, i)),
    [start],
  );

  const byDate = useMemo(() => {
    const map: Record<string, { plans: WorkoutPlan[]; runs: PlannedRun[] }> = {};
    for (const d of days) map[d] = { plans: [], runs: [] };
    for (const p of plans) if (p.date && map[p.date]) map[p.date].plans.push(p);
    for (const r of runs) if (map[r.date]) map[r.date].runs.push(r);
    return map;
  }, [days, plans, runs]);

  // Week summary — the numbers you actually plan against.
  const totals = useMemo(() => {
    let sessions = 0, km = 0, done = 0;
    for (const d of days) {
      const c = byDate[d];
      sessions += c.plans.length + c.runs.length;
      km += c.runs.reduce((s, r) => s + r.distanceKm, 0);
      done += c.plans.filter(p => p.status === 'done').length
            + c.runs.filter(r => r.status === 'done').length;
    }
    return { sessions, km: Math.round(km * 10) / 10, done };
  }, [days, byDate]);

  const inThisWeek = weekStart(today) === start;
  const [sy, sm, sd] = start.split('-').map(Number);
  const monthLabel = new Date(sy, sm - 1, sd, 12)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      {/* Week nav */}
      <div className="flex items-center justify-between">
        <button onClick={onPrevWeek} className="btn-icon relative before:absolute before:-inset-1.5" aria-label="Previous week">
          <ChevronLeft size={15} />
        </button>
        <button onClick={onThisWeek} className="text-center" aria-label="Jump to this week">
          <p className="text-sm font-bold text-slate-900 dark:text-white">{monthLabel}</p>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {inThisWeek ? 'This week' : 'Tap for this week'}
          </p>
        </button>
        <button onClick={onNextWeek} className="btn-icon relative before:absolute before:-inset-1.5" aria-label="Next week">
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Week totals */}
      {totals.sessions > 0 && (
        <div className="card flex divide-x divide-slate-200 dark:divide-line py-2.5">
          {[
            ['Sessions', String(totals.sessions)],
            ['Planned km', totals.km ? String(totals.km) : '—'],
            ['Done', `${totals.done}/${totals.sessions}`],
          ].map(([label, value]) => (
            <div key={label} className="flex-1 text-center">
              <p className="tabular text-base font-extrabold text-slate-900 dark:text-white">{value}</p>
              <p className="eyebrow mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Days */}
      <div className="space-y-2">
        {days.map(d => {
          const cell = byDate[d];
          const isToday = d === today;
          const isPast = d < today;
          const empty = cell.plans.length === 0 && cell.runs.length === 0;
          return (
            <div
              key={d}
              className={`card overflow-hidden ${isToday ? 'border-cobalt-500/40' : ''} ${
                isPast && empty ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-3 px-3.5 py-2 border-b border-slate-100 dark:border-line">
                <div className={`flex flex-col items-center justify-center w-9 shrink-0 ${
                  isToday ? 'text-cobalt-500' : 'text-slate-500 dark:text-slate-400'}`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider">{dayLabel(d)}</span>
                  <span className="tabular text-sm font-extrabold">{dayNum(d)}</span>
                </div>
                <span className="flex-1 text-[11px] text-slate-400 dark:text-slate-500">
                  {empty ? (isPast ? 'Nothing logged' : 'Tap + to plan') : ''}
                </span>
                <button
                  onClick={() => onAddWorkout(d)}
                  className="btn-icon relative before:absolute before:-inset-1.5"
                  aria-label={`Plan workout for ${dayLabel(d)} ${dayNum(d)}`}
                >
                  <Dumbbell size={15} />
                </button>
                <button
                  onClick={() => onAddRun(d)}
                  className="btn-icon relative before:absolute before:-inset-1.5"
                  aria-label={`Plan run for ${dayLabel(d)} ${dayNum(d)}`}
                >
                  <Footprints size={15} />
                </button>
              </div>

              {!empty && (
                <div className="divide-y divide-slate-100 dark:divide-line">
                  {cell.plans.map(p => (
                    <div key={p.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <Dumbbell size={13} className="text-cobalt-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${
                          p.status === 'done'
                            ? 'line-through text-slate-400 dark:text-slate-500'
                            : 'text-slate-900 dark:text-white'}`}>
                          {p.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {p.exercises.length} exercise{p.exercises.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      {p.status === 'done' ? (
                        <span className="chip-success"><Check size={10} strokeWidth={3} /> Done</span>
                      ) : (
                        <button
                          onClick={() => onStartWorkout(p)}
                          className="chip-accent px-3 py-2 active:scale-95 transition-transform"
                        >
                          <Play size={10} /> Start
                        </button>
                      )}
                    </div>
                  ))}

                  {cell.runs.map(r => (
                    <div key={r.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <Footprints size={13} className="text-success-500 shrink-0" />
                      <button onClick={() => onEditRun(r)} className="flex-1 min-w-0 text-left">
                        <p className={`text-sm font-semibold truncate ${
                          r.status === 'done'
                            ? 'line-through text-slate-400 dark:text-slate-500'
                            : 'text-slate-900 dark:text-white'}`}>
                          <span className="tabular">{r.distanceKm}</span> km ·{' '}
                          {RUN_TYPES.find(t => t.id === r.runType)?.label ?? r.runType}
                        </p>
                        {r.notes && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{r.notes}</p>
                        )}
                      </button>
                      {r.status === 'done' ? (
                        <span className="chip-success"><Check size={10} strokeWidth={3} /> Done</span>
                      ) : (
                        <button
                          onClick={() => onCompleteRun(r)}
                          className="chip-accent px-3 py-2 active:scale-95 transition-transform"
                        >
                          <Check size={10} strokeWidth={3} /> Log
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => onAddWorkout(days.includes(today) ? today : start)}
        className="btn-secondary w-full justify-center gap-1.5"
      >
        <Plus size={14} /> Plan a workout
      </button>
    </div>
  );
}
