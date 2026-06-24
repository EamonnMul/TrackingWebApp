import { useState, useEffect, useCallback } from 'react';
import {
  Plus, CopyPlus, UtensilsCrossed, Settings2, Trash2,
  ChevronLeft, ChevronRight, Flame, Beef, CalendarDays,
} from 'lucide-react';
import {
  ScreenLoader, ProgressRing, StatTile, Sparkline, EmptyState, SectionLabel,
  BottomSheet, Stepper,
} from '../components/ui';
import AddFoodSheet from '../components/nutrition/AddFoodSheet';
import SavedMealSheet from '../components/nutrition/SavedMealSheet';
import NutritionTargetSheet from '../components/nutrition/NutritionTargetSheet';
import {
  getNutritionEntry, getNutritionTarget, getNutritionEntriesInRange,
  deleteFoodLog, updateFoodLog, copyDay, getTodayString,
} from '../utils/nutrition';
import {
  getAllWeightEntries, getWeightUnit, kgToUnit, formatDate,
} from '../utils/storage';
import { addDaysLocal } from '../utils/habitStreak';
import {
  sumFoodLogs, remaining, pctOfTarget, averageTotals, round,
} from '../utils/nutritionCalc';
import {
  NutritionEntry, NutritionTarget, FoodLog, MealCategory, MEAL_CATEGORIES,
  WeightEntry, WeightUnit,
} from '../types';

const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks',
};

export default function NutritionScreen() {
  const today = getTodayString();
  const [date, setDate] = useState(today);
  const [entry, setEntry] = useState<NutritionEntry | null>(null);
  const [target, setTarget] = useState<NutritionTarget | null>(null);
  const [loading, setLoading] = useState(true);

  // Week + weight snapshot (loads after first paint)
  const [weekEntries, setWeekEntries] = useState<NutritionEntry[] | null>(null);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');

  // Sheets
  const [showAdd, setShowAdd] = useState(false);
  const [showMeals, setShowMeals] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [addMeal, setAddMeal] = useState<MealCategory>('breakfast');
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isToday = date === today;

  const loadDay = useCallback(async () => {
    const [e, t] = await Promise.all([getNutritionEntry(date), getNutritionTarget()]);
    setEntry(e);
    setTarget(t);
    setLoading(false);
  }, [date]);

  useEffect(() => { setLoading(true); loadDay(); }, [loadDay]);

  // Week/weight snapshot
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      const weekStart = addDaysLocal(date, -6);
      const [week, w, unit] = await Promise.all([
        getNutritionEntriesInRange(weekStart, date),
        getAllWeightEntries(),
        getWeightUnit(),
      ]);
      if (cancelled) return;
      setWeekEntries(week);
      setWeights([...w].sort((a, b) => a.date.localeCompare(b.date)));
      setWeightUnit(unit);
    })();
    return () => { cancelled = true; };
  }, [loading, date, entry]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(t => (t === msg ? null : t)), 2500);
  }

  async function handleCopyYesterday() {
    const y = addDaysLocal(date, -1);
    const n = await copyDay(y, date);
    if (n === 0) { flash('Nothing logged yesterday to copy.'); return; }
    await loadDay();
    flash(`Copied ${n} item${n !== 1 ? 's' : ''} from yesterday.`);
  }

  if (loading) return <ScreenLoader />;

  const items = entry?.items ?? [];
  const totals = sumFoodLogs(items);

  // No target yet → onboarding
  if (!target) {
    return (
      <div className="space-y-5">
        <Header date={date} today={today} onPrev={() => setDate(addDaysLocal(date, -1))} onNext={() => setDate(addDaysLocal(date, 1))} isToday={isToday} onSettings={() => setShowTargets(true)} />
        <EmptyState
          icon={Flame}
          title="Set your daily targets"
          hint="Tell Fuel your calorie and protein goals to start tracking."
        >
          <button onClick={() => setShowTargets(true)} className="btn-primary mt-4">Set targets</button>
        </EmptyState>
        <NutritionTargetSheet open={showTargets} onClose={() => setShowTargets(false)} onSaved={loadDay} />
      </div>
    );
  }

  const calPct = pctOfTarget(target.calories, totals.calories);
  const proPct = pctOfTarget(target.protein, totals.protein);
  const calLeft = remaining(target.calories, totals.calories);
  const proLeft = remaining(target.protein, totals.protein);

  // Weekly average calories + sparkline
  const weekCals: number[] = [];
  if (weekEntries) {
    for (let i = 6; i >= 0; i--) {
      const d = addDaysLocal(date, -i);
      const e = weekEntries.find(x => x.date === d);
      weekCals.push(e ? Math.round(sumFoodLogs(e.items).calories) : 0);
    }
  }
  const weekAvg = weekEntries ? averageTotals(weekEntries).calories : 0;

  // Weight trend
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;

  return (
    <div className="space-y-5">
      <Header date={date} today={today} onPrev={() => setDate(addDaysLocal(date, -1))} onNext={() => setDate(addDaysLocal(date, 1))} isToday={isToday} onSettings={() => setShowTargets(true)} />

      {/* Hero: calories + protein rings */}
      <div className="card-elevated p-5">
        <div className="flex items-center justify-around">
          <RingStat
            pct={calPct}
            icon={<Flame size={14} className="text-fire-500" />}
            value={Math.round(totals.calories).toLocaleString()}
            label="kcal"
            sub={`${calLeft.toLocaleString()} left`}
          />
          <RingStat
            pct={proPct}
            accent
            icon={<Beef size={14} className="text-cobalt-500" />}
            value={String(Math.round(totals.protein))}
            label="g protein"
            sub={`${Math.round(proLeft)}g left`}
          />
        </div>

        {/* Optional macros */}
        {target.showMacros && (
          <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-slate-100 dark:border-line">
            <MacroMini label="Carbs" value={round(totals.carbs)} target={target.carbs} />
            <MacroMini label="Fat" value={round(totals.fat)} target={target.fat} />
            <MacroMini label="Fibre" value={round(totals.fibre)} target={target.fibre} />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-3 gap-2">
        <ActionButton icon={Plus} label="Add food" primary onClick={() => { setAddMeal(suggestMeal()); setShowAdd(true); }} />
        <ActionButton icon={UtensilsCrossed} label="Saved meal" onClick={() => setShowMeals(true)} />
        <ActionButton icon={CopyPlus} label="Copy day" onClick={handleCopyYesterday} />
      </div>

      {/* Snapshot: weekly avg + weight */}
      <div className="flex gap-2">
        <StatTile
          icon={Flame}
          label="Avg · 7d"
          value={weekAvg ? Math.round(weekAvg).toLocaleString() : '—'}
          unit={weekAvg ? 'kcal' : undefined}
        >
          {weekCals.filter(c => c > 0).length >= 2 && (
            <div className="mt-1.5"><Sparkline values={weekCals} positiveIsGood /></div>
          )}
        </StatTile>
        <StatTile
          icon={CalendarDays}
          label="Logged · 7d"
          value={weekEntries ? String(weekEntries.filter(e => e.items.length > 0).length) : '—'}
          unit="days"
        />
        <StatTile
          icon={Beef}
          label="Weight"
          value={latestWeight ? kgToUnit(latestWeight.kg, weightUnit).toFixed(1) : '—'}
          unit={latestWeight ? weightUnit : undefined}
        >
          {weights.length >= 2 && (
            <div className="mt-1.5"><Sparkline values={weights.slice(-14).map(w => w.kg)} /></div>
          )}
        </StatTile>
      </div>

      {/* Today's food, grouped by meal */}
      {items.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title={isToday ? 'Nothing logged yet' : 'No food logged'}
          hint={isToday ? 'Tap Add food to log your first item.' : 'This day has no entries.'}
        />
      ) : (
        <div className="space-y-4">
          {MEAL_CATEGORIES.map(cat => {
            const mealItems = items.filter(it => it.meal === cat);
            if (mealItems.length === 0) return null;
            const mt = sumFoodLogs(mealItems);
            return (
              <div key={cat}>
                <SectionLabel right={<span className="tabular text-[11px] font-bold text-slate-400">{Math.round(mt.calories)} kcal</span>}>
                  {MEAL_LABELS[cat]}
                </SectionLabel>
                <div className="card divide-y divide-slate-100 dark:divide-line overflow-hidden">
                  {mealItems.map(it => (
                    <button
                      key={it.id}
                      onClick={() => setEditing(it)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-ink-elevated transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {it.quantity !== 1 ? `${it.quantity}× ` : ''}{it.name}
                        </p>
                        <p className="tabular text-xs text-slate-500 dark:text-slate-400">
                          {Math.round(it.calories)} kcal · {round(it.protein)}g protein
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sheets */}
      <AddFoodSheet open={showAdd} onClose={() => setShowAdd(false)} date={date} defaultMeal={addMeal} onLogged={loadDay} />
      <SavedMealSheet open={showMeals} onClose={() => setShowMeals(false)} date={date} onLogged={loadDay} />
      <NutritionTargetSheet open={showTargets} onClose={() => setShowTargets(false)} onSaved={loadDay} />

      {/* Edit/delete a logged item */}
      <EditLogSheet
        log={editing}
        onClose={() => setEditing(null)}
        onSave={async (logId, patch) => { await updateFoodLog(date, logId, patch); setEditing(null); loadDay(); }}
        onDelete={async (logId) => { await deleteFoodLog(date, logId); setEditing(null); loadDay(); }}
      />

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900 dark:bg-ink-elevated border border-line text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-deep animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Header with date nav ────────────────────────────────────────────────────

function Header({
  date, today, onPrev, onNext, isToday, onSettings,
}: {
  date: string; today: string; onPrev: () => void; onNext: () => void; isToday: boolean; onSettings: () => void;
}) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <p className="screen-eyebrow text-cobalt-500">Fuel</p>
        <h1 className="screen-title">Nutrition</h1>
        <div className="flex items-center gap-1 mt-2">
          <button onClick={onPrev} className="btn-icon w-7 h-7" aria-label="Previous day"><ChevronLeft size={14} /></button>
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 min-w-[92px] text-center">
            {isToday ? 'Today' : formatDate(date)}
          </span>
          <button onClick={onNext} disabled={isToday} className="btn-icon w-7 h-7 disabled:opacity-30" aria-label="Next day"><ChevronRight size={14} /></button>
        </div>
      </div>
      <button onClick={onSettings} className="btn-icon" aria-label="Edit targets"><Settings2 size={16} /></button>
    </div>
  );
}

function RingStat({
  pct, value, label, sub, icon, accent,
}: {
  pct: number; value: string; label: string; sub: string; icon: React.ReactNode; accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <ProgressRing pct={pct} size={96} stroke={7}>
        <div className="flex flex-col items-center">
          <span className="tabular text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">{value}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{label}</span>
        </div>
      </ProgressRing>
      <div className="flex items-center gap-1 mt-2">
        {icon}
        <span className={`text-xs font-bold ${accent ? 'text-cobalt-500' : 'text-slate-600 dark:text-slate-300'}`}>{sub}</span>
      </div>
    </div>
  );
}

function MacroMini({ label, value, target }: { label: string; value: number; target?: number }) {
  const pct = target ? Math.min(100, pctOfTarget(target, value)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="eyebrow">{label}</span>
        <span className="tabular text-xs font-bold text-slate-700 dark:text-slate-300">
          {value}{target ? <span className="text-slate-400 font-semibold">/{target}g</span> : 'g'}
        </span>
      </div>
      {target ? (
        <div className="progress-track h-1.5"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      ) : null}
    </div>
  );
}

function ActionButton({
  icon: Icon, label, onClick, primary,
}: {
  icon: typeof Plus; label: string; onClick: () => void; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-all active:scale-[0.97] ${
        primary
          ? 'bg-cobalt-500 border-cobalt-500 text-white shadow-glow-cobalt hover:bg-cobalt-600'
          : 'card text-slate-700 dark:text-slate-200 hover:border-cobalt-500/40'
      }`}
    >
      <Icon size={18} className={primary ? 'text-white' : 'text-cobalt-500'} />
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  );
}

// ─── Edit/delete sheet ───────────────────────────────────────────────────────

function EditLogSheet({
  log, onClose, onSave, onDelete,
}: {
  log: FoodLog | null;
  onClose: () => void;
  onSave: (logId: string, patch: Partial<FoodLog>) => void;
  onDelete: (logId: string) => void;
}) {
  const [qty, setQty] = useState(1);
  const [meal, setMeal] = useState<MealCategory>('breakfast');

  useEffect(() => {
    if (log) { setQty(log.quantity || 1); setMeal(log.meal); }
  }, [log]);

  if (!log) return null;
  const current = log; // non-null capture so closures keep the narrowing

  // Per-serving derived from the snapshot so we can rescale on quantity change.
  const baseQty = current.quantity || 1;
  const perCal = current.calories / baseQty;
  const perPro = current.protein / baseQty;
  const perCarbs = current.carbs != null ? current.carbs / baseQty : undefined;
  const perFat = current.fat != null ? current.fat / baseQty : undefined;
  const perFibre = current.fibre != null ? current.fibre / baseQty : undefined;

  const newCal = Math.round(perCal * qty);
  const newPro = round(perPro * qty);

  function save() {
    const patch: Partial<FoodLog> = {
      quantity: qty, meal,
      calories: Math.round(perCal * qty),
      protein: round(perPro * qty),
    };
    if (perCarbs != null) patch.carbs = round(perCarbs * qty);
    if (perFat != null) patch.fat = round(perFat * qty);
    if (perFibre != null) patch.fibre = round(perFibre * qty);
    onSave(current.id, patch);
  }

  return (
    <BottomSheet
      open={!!current} onClose={onClose} eyebrow="Edit" title={current.name}
      footer={
        <div className="flex gap-2">
          <button onClick={() => { if (confirm('Delete this item?')) onDelete(current.id); }} className="btn-secondary px-4 text-red-400">
            <Trash2 size={15} />
          </button>
          <button onClick={save} className="btn-primary flex-1">Save</button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="card-elevated p-4 flex items-baseline gap-4">
          <div><span className="tabular text-3xl font-extrabold text-slate-900 dark:text-white">{newCal}</span><span className="text-xs font-bold text-slate-500 ml-1">kcal</span></div>
          <div><span className="tabular text-xl font-extrabold text-cobalt-500">{newPro}</span><span className="text-xs font-bold text-slate-500 ml-1">g protein</span></div>
        </div>
        <div>
          <span className="eyebrow block mb-1.5">Servings</span>
          <Stepper value={qty} onChange={setQty} step={0.5} min={0.5} suffix="×" />
        </div>
        <div>
          <span className="eyebrow block mb-1.5">Meal</span>
          <div className="grid grid-cols-4 gap-1.5">
            {MEAL_CATEGORIES.map(m => (
              <button
                key={m}
                onClick={() => setMeal(m)}
                className={`py-2 rounded-xl text-xs font-bold capitalize transition-all border ${
                  meal === m
                    ? 'bg-cobalt-500/15 border-cobalt-500/40 text-cobalt-500'
                    : 'bg-slate-100 dark:bg-ink-inset border-slate-200 dark:border-line text-slate-500 dark:text-slate-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}

/** Suggest a meal category based on local time of day. */
function suggestMeal(): MealCategory {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}
