import { useState, useEffect } from 'react';
import { Plus, Trash2, UtensilsCrossed, ChevronRight, X } from 'lucide-react';
import { BottomSheet, NumberInput, EmptyState } from '../ui';
import {
  getSavedMeals, saveSavedMeal, deleteSavedMeal, bumpSavedMealUsage, logManyFoods, genId,
} from '../../utils/nutrition';
import { mealComponentTotals, caloriesFromMacros } from '../../utils/nutritionCalc';
import {
  SavedMeal, MealComponent, FoodLog, MealCategory, MEAL_CATEGORIES,
} from '../../types';

type Mode = 'list' | 'create' | 'log';

export default function SavedMealSheet({
  open, onClose, date, onLogged,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  onLogged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('list');
  const [meals, setMeals] = useState<SavedMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<SavedMeal | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('list'); setActive(null); setLoading(true);
    getSavedMeals().then(setMeals).finally(() => setLoading(false));
  }, [open]);

  async function reload() {
    setMeals(await getSavedMeals());
  }

  return (
    <BottomSheet
      open={open} onClose={onClose}
      eyebrow="Saved meals"
      title={mode === 'create' ? 'New meal' : mode === 'log' ? (active?.name ?? 'Log meal') : 'Saved Meals'}
    >
      {mode === 'list' && (
        <div className="space-y-4">
          <button onClick={() => setMode('create')} className="btn-secondary w-full justify-center gap-2">
            <Plus size={15} className="text-cobalt-500" /> Create a meal
          </button>

          {loading && <p className="text-sm text-slate-500 text-center py-6">Loading…</p>}

          {!loading && meals.length === 0 && (
            <EmptyState
              icon={UtensilsCrossed}
              title="No saved meals yet"
              hint="Bundle foods you eat often — oats + whey, chicken + rice — and log them in one tap."
            />
          )}

          {meals.map(m => {
            const t = mealComponentTotals(m.components);
            return (
              <div key={m.id} className="card overflow-hidden">
                <button
                  onClick={() => { setActive(m); setMode('log'); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-ink-elevated transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{m.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {m.components.length} item{m.components.length !== 1 ? 's' : ''} · {Math.round(t.calories)} kcal · {Math.round(t.protein)}g protein
                    </p>
                  </div>
                  <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 shrink-0" />
                </button>
                <div className="flex border-t border-slate-100 dark:border-line">
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete "${m.name}"?`)) return;
                      await deleteSavedMeal(m.id);
                      reload();
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-red-400 flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === 'create' && (
        <CreateMealView
          busy={busy}
          onCancel={() => setMode('list')}
          onSave={async (name, components) => {
            setBusy(true);
            const meal: SavedMeal = {
              id: genId(), name, components, usageCount: 0, lastUsedAt: Date.now(), createdAt: Date.now(),
            };
            await saveSavedMeal(meal);
            setBusy(false);
            await reload();
            setMode('list');
          }}
        />
      )}

      {mode === 'log' && active && (
        <LogMealView
          meal={active}
          busy={busy}
          onBack={() => setMode('list')}
          onSubmit={async (category) => {
            setBusy(true);
            const now = Date.now();
            const logs: FoodLog[] = active.components.map(c => ({
              id: genId(), name: c.name, brand: c.brand, meal: category,
              calories: Math.round((c.calories || 0) * (c.quantity || 1)),
              protein: Math.round((c.protein || 0) * (c.quantity || 1) * 10) / 10,
              carbs: c.carbs != null ? Math.round(c.carbs * (c.quantity || 1) * 10) / 10 : undefined,
              fat: c.fat != null ? Math.round(c.fat * (c.quantity || 1) * 10) / 10 : undefined,
              fibre: c.fibre != null ? Math.round(c.fibre * (c.quantity || 1) * 10) / 10 : undefined,
              servingSize: c.servingSize, quantity: c.quantity || 1,
              loggedAt: now, source: 'saved_meal', savedFoodId: c.savedFoodId,
            }));
            await logManyFoods(date, logs);
            bumpSavedMealUsage(active.id).catch(() => {});
            setBusy(false);
            onLogged();
            onClose();
          }}
        />
      )}
    </BottomSheet>
  );
}

// ─── Create meal ─────────────────────────────────────────────────────────────

function CreateMealView({
  busy, onCancel, onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string, components: MealComponent[]) => void;
}) {
  const [name, setName] = useState('');
  const [components, setComponents] = useState<MealComponent[]>([]);
  const [cName, setCName] = useState('');
  const [cCals, setCCals] = useState<number | ''>('');
  const [cCalsDirty, setCCalsDirty] = useState(false);
  const [cCalsFocused, setCCalsFocused] = useState(false);
  const [cProtein, setCProtein] = useState<number | ''>('');
  const [cCarbs, setCCarbs] = useState<number | ''>('');
  const [cFat, setCFat] = useState<number | ''>('');
  const [cFibre, setCFibre] = useState<number | ''>('');

  const total = mealComponentTotals(components);
  const canAdd = cName.trim() && cCals !== '' && Number(cCals) > 0;
  const canSave = name.trim() && components.length > 0;

  // Auto-calc calories from macros until the user types calories directly.
  // Never write while the field has focus, or we'd fight the user's caret.
  const cAuto = caloriesFromMacros({ protein: cProtein, carbs: cCarbs, fat: cFat, fibre: cFibre });
  useEffect(() => {
    if (cCalsDirty || cCalsFocused) return;
    setCCals(cAuto > 0 ? cAuto : '');
  }, [cAuto, cCalsDirty, cCalsFocused]);

  function handleCCalsBlur() {
    setCCalsFocused(false);
    if (cCals === '') setCCalsDirty(false);
  }

  function addComponent() {
    if (!canAdd) return;
    setComponents(prev => [...prev, {
      name: cName.trim(), calories: Number(cCals), protein: Number(cProtein) || 0,
      carbs: cCarbs === '' ? undefined : Number(cCarbs),
      fat: cFat === '' ? undefined : Number(cFat),
      fibre: cFibre === '' ? undefined : Number(cFibre),
      quantity: 1,
    }]);
    setCName(''); setCCals(''); setCCalsDirty(false);
    setCProtein(''); setCCarbs(''); setCFat(''); setCFibre('');
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="eyebrow block mb-1">Meal name</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Breakfast oats" className="input" />
      </label>

      {components.length > 0 && (
        <div className="card divide-y divide-slate-100 dark:divide-line overflow-hidden">
          {components.map((c, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</p>
                <p className="tabular text-xs text-slate-500">{c.calories} kcal · {c.protein}g protein</p>
              </div>
              <button onClick={() => setComponents(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-400" aria-label="Remove">
                <X size={15} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 dark:bg-ink-inset">
            <span className="eyebrow">Total</span>
            <span className="tabular text-sm font-bold text-slate-900 dark:text-white">
              {Math.round(total.calories)} kcal · {Math.round(total.protein)}g
            </span>
          </div>
        </div>
      )}

      {/* Add component mini-form */}
      <div className="card p-3.5 space-y-3">
        <p className="eyebrow">Add item</p>
        <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Food name" className="input" />
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Protein" value={cProtein} onChange={setCProtein} suffix="g" placeholder="0" />
          <NumberInput label="Carbs" value={cCarbs} onChange={setCCarbs} suffix="g" placeholder="0" />
          <NumberInput label="Fat" value={cFat} onChange={setCFat} suffix="g" placeholder="0" />
          <NumberInput label="Fibre" value={cFibre} onChange={setCFibre} suffix="g" placeholder="0" />
          <NumberInput
            label="Calories"
            value={cCals}
            onChange={v => { setCCals(v); setCCalsDirty(v !== ''); }}
            onFocus={() => setCCalsFocused(true)}
            onBlur={handleCCalsBlur}
            suffix="kcal"
            placeholder="0"
          />
        </div>
        {!cCalsDirty && cAuto > 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Calories auto-calculated from macros.
          </p>
        )}
        <button disabled={!canAdd} onClick={addComponent} className="btn-secondary w-full justify-center gap-1.5">
          <Plus size={14} /> Add item
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
        <button disabled={!canSave || busy} onClick={() => onSave(name.trim(), components)} className="btn-primary flex-1">
          {busy ? 'Saving…' : 'Save meal'}
        </button>
      </div>
    </div>
  );
}

// ─── Log meal ────────────────────────────────────────────────────────────────

function LogMealView({
  meal, busy, onBack, onSubmit,
}: {
  meal: SavedMeal;
  busy: boolean;
  onBack: () => void;
  onSubmit: (category: MealCategory) => void;
}) {
  const [category, setCategory] = useState<MealCategory>(meal.defaultMeal ?? 'breakfast');
  const t = mealComponentTotals(meal.components);
  return (
    <div className="space-y-4">
      <div className="card-elevated p-4">
        <div className="flex items-baseline gap-4">
          <div>
            <span className="tabular text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{Math.round(t.calories)}</span>
            <span className="text-xs font-bold text-slate-500 ml-1">kcal</span>
          </div>
          <div>
            <span className="tabular text-xl font-extrabold text-cobalt-500">{Math.round(t.protein)}</span>
            <span className="text-xs font-bold text-slate-500 ml-1">g protein</span>
          </div>
        </div>
        <div className="mt-3 space-y-1">
          {meal.components.map((c, i) => (
            <p key={i} className="text-xs text-slate-500 dark:text-slate-400">
              {c.quantity > 1 ? `${c.quantity}× ` : ''}{c.name}
            </p>
          ))}
        </div>
      </div>

      <div>
        <span className="eyebrow block mb-1.5">Log to</span>
        <div className="grid grid-cols-4 gap-1.5">
          {MEAL_CATEGORIES.map(m => (
            <button
              key={m}
              onClick={() => setCategory(m)}
              className={`py-2 rounded-xl text-xs font-bold capitalize transition-all border ${
                category === m
                  ? 'bg-cobalt-500/15 border-cobalt-500/40 text-cobalt-500'
                  : 'bg-slate-100 dark:bg-ink-inset border-slate-200 dark:border-line text-slate-500 dark:text-slate-400'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="btn-ghost flex-1">Back</button>
        <button disabled={busy} onClick={() => onSubmit(category)} className="btn-primary flex-1">
          {busy ? 'Logging…' : 'Log meal'}
        </button>
      </div>
    </div>
  );
}
