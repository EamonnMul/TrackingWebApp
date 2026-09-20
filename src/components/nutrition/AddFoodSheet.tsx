import { useState, useEffect, useMemo } from 'react';
import { Search, Zap, PencilLine, Star, Clock, ChevronRight, BookOpen } from 'lucide-react';
import { STARTER_FOODS, searchStarterFoods, StarterFood } from '../../data/starterFoods';
import { BottomSheet, Stepper, NumberInput, EmptyState } from '../ui';
import {
  getSavedFoods, getRecents, saveSavedFood, bumpSavedFoodUsage, logFood, genId,
} from '../../utils/nutrition';
import { scaleServing, caloriesFromMacros } from '../../utils/nutritionCalc';
import {
  SavedFood, RecentFood, FoodLog, MealCategory, MEAL_CATEGORIES,
} from '../../types';

type Mode = 'browse' | 'quickadd' | 'manual' | 'confirm';

/** A food selected for logging, normalised to per-serving values. */
interface Candidate {
  name: string;
  brand?: string;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing?: number;
  fatPerServing?: number;
  fibrePerServing?: number;
  servingSize?: string;
  savedFoodId?: string;
  barcode?: string;
  source: FoodLog['source'];
}

const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
};

export default function AddFoodSheet({
  open, onClose, date, defaultMeal, onLogged,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  defaultMeal: MealCategory;
  onLogged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('browse');
  const [savedFoods, setSavedFoods] = useState<SavedFood[]>([]);
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset to a clean browse state whenever the sheet is opened.
  useEffect(() => {
    if (!open) return;
    setMode('browse');
    setQuery('');
    setCandidate(null);
    setLoading(true);
    Promise.all([getSavedFoods(), getRecents()])
      .then(([f, r]) => { setSavedFoods(f); setRecents(r); })
      .finally(() => setLoading(false));
  }, [open]);

  const filteredRecents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? recents.filter(r => r.name.toLowerCase().includes(q)) : recents;
    return list.slice(0, 12);
  }, [recents, query]);

  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Avoid duplicating items already shown in recents (match by savedFoodId/name).
    const recentKeys = new Set(filteredRecents.map(r => r.savedFoodId ?? r.name.toLowerCase()));
    const list = q ? savedFoods.filter(f => f.name.toLowerCase().includes(q)) : savedFoods;
    return list.filter(f => !recentKeys.has(f.id) && !recentKeys.has(f.name.toLowerCase())).slice(0, 20);
  }, [savedFoods, query, filteredRecents]);

  // Library (CoFID) results rank below the user's own foods — their data wins.
  const filteredLibrary = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const ownNames = new Set([
      ...filteredRecents.map(r => r.name.toLowerCase()),
      ...filteredSaved.map(f => f.name.toLowerCase()),
    ]);
    return searchStarterFoods(q, 30).filter(f => !ownNames.has(f.name.toLowerCase()));
  }, [query, filteredRecents, filteredSaved]);

  function pickRecent(r: RecentFood) {
    setCandidate({
      name: r.name, brand: r.brand,
      caloriesPerServing: r.caloriesPerServing, proteinPerServing: r.proteinPerServing,
      carbsPerServing: r.carbsPerServing, fatPerServing: r.fatPerServing, fibrePerServing: r.fibrePerServing,
      servingSize: r.servingSize, savedFoodId: r.savedFoodId, barcode: r.barcode,
      source: r.savedFoodId ? 'saved_food' : 'manual',
    });
    setMode('confirm');
  }

  function pickLibrary(f: StarterFood) {
    setCandidate({
      name: f.name,
      caloriesPerServing: f.calories, proteinPerServing: f.protein,
      carbsPerServing: f.carbs, fatPerServing: f.fat,
      fibrePerServing: f.fibre ?? undefined,
      servingSize: f.servingLabel,
      source: 'external_database',
    });
    setMode('confirm');
  }

  function pickSaved(f: SavedFood) {
    setCandidate({
      name: f.name, brand: f.brand,
      caloriesPerServing: f.caloriesPerServing, proteinPerServing: f.proteinPerServing,
      carbsPerServing: f.carbsPerServing, fatPerServing: f.fatPerServing, fibrePerServing: f.fibrePerServing,
      servingSize: f.servingSize, savedFoodId: f.id, barcode: f.barcode,
      source: 'saved_food',
    });
    setMode('confirm');
  }

  const titleByMode: Record<Mode, string> = {
    browse: 'Add Food', quickadd: 'Quick Add', manual: 'Create Food', confirm: 'Confirm',
  };

  return (
    <BottomSheet open={open} onClose={onClose} eyebrow={MEAL_LABELS[defaultMeal]} title={titleByMode[mode]}>
      {mode === 'browse' && (
        <BrowseView
          query={query} setQuery={setQuery}
          loading={loading}
          recents={filteredRecents} saved={filteredSaved} library={filteredLibrary}
          onPickRecent={pickRecent} onPickSaved={pickSaved} onPickLibrary={pickLibrary}
          onQuickAdd={() => setMode('quickadd')}
          onManual={() => setMode('manual')}
        />
      )}

      {mode === 'quickadd' && (
        <QuickAddView
          busy={busy}
          onCancel={() => setMode('browse')}
          onSubmit={async ({ name, calories, protein, meal }) => {
            setBusy(true);
            const food: FoodLog = {
              id: genId(), name, meal, calories, protein,
              quantity: 1, loggedAt: Date.now(), source: 'quick_add',
            };
            await logFood(date, food);
            setBusy(false);
            onLogged();
            onClose();
          }}
        />
      )}

      {mode === 'manual' && (
        <ManualView
          busy={busy}
          onCancel={() => setMode('browse')}
          onSubmit={async ({ food, saveAsFrequent, meal, quantity }) => {
            setBusy(true);
            const scaled = scaleServing(
              { calories: food.caloriesPerServing, protein: food.proteinPerServing, carbs: food.carbsPerServing, fat: food.fatPerServing, fibre: food.fibrePerServing },
              quantity,
            );
            let savedFoodId: string | undefined;
            if (saveAsFrequent) {
              const sf: SavedFood = {
                id: genId(), name: food.name, brand: food.brand,
                caloriesPerServing: food.caloriesPerServing, proteinPerServing: food.proteinPerServing,
                carbsPerServing: food.carbsPerServing, fatPerServing: food.fatPerServing, fibrePerServing: food.fibrePerServing,
                servingSize: food.servingSize, usageCount: 1, lastUsedAt: Date.now(), createdAt: Date.now(),
              };
              await saveSavedFood(sf);
              savedFoodId = sf.id;
            }
            const log: FoodLog = {
              id: genId(), name: food.name, brand: food.brand, meal,
              ...scaled, servingSize: food.servingSize, quantity,
              loggedAt: Date.now(), source: 'manual', savedFoodId,
            };
            await logFood(date, log);
            setBusy(false);
            onLogged();
            onClose();
          }}
        />
      )}

      {mode === 'confirm' && candidate && (
        <ConfirmView
          candidate={candidate}
          defaultMeal={defaultMeal}
          busy={busy}
          onBack={() => setMode('browse')}
          onSubmit={async ({ quantity, meal }) => {
            setBusy(true);
            const scaled = scaleServing(
              { calories: candidate.caloriesPerServing, protein: candidate.proteinPerServing, carbs: candidate.carbsPerServing, fat: candidate.fatPerServing, fibre: candidate.fibrePerServing },
              quantity,
            );
            const log: FoodLog = {
              id: genId(), name: candidate.name, brand: candidate.brand, meal,
              ...scaled, servingSize: candidate.servingSize, quantity,
              loggedAt: Date.now(), source: candidate.source,
              savedFoodId: candidate.savedFoodId, barcode: candidate.barcode,
            };
            await logFood(date, log);
            if (candidate.savedFoodId) bumpSavedFoodUsage(candidate.savedFoodId).catch(() => {});
            setBusy(false);
            onLogged();
            onClose();
          }}
        />
      )}
    </BottomSheet>
  );
}

// ─── Browse ──────────────────────────────────────────────────────────────────

function BrowseView({
  query, setQuery, loading, recents, saved, library,
  onPickRecent, onPickSaved, onPickLibrary, onQuickAdd, onManual,
}: {
  query: string; setQuery: (s: string) => void; loading: boolean;
  recents: RecentFood[]; saved: SavedFood[]; library: StarterFood[];
  onPickRecent: (r: RecentFood) => void; onPickSaved: (f: SavedFood) => void;
  onPickLibrary: (f: StarterFood) => void;
  onQuickAdd: () => void; onManual: () => void;
}) {
  const nothing = !loading && recents.length === 0 && saved.length === 0 && library.length === 0;
  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search your foods…"
          className="input pl-9"
        />
      </div>

      {/* Fast actions */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onQuickAdd} className="btn-secondary justify-start gap-2">
          <Zap size={15} className="text-cobalt-500" /> Quick add
        </button>
        <button onClick={onManual} className="btn-secondary justify-start gap-2">
          <PencilLine size={15} className="text-cobalt-500" /> Create food
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">Loading…</p>}

      {nothing && (
        <EmptyState
          icon={Search}
          title={query ? 'Nothing found' : 'No saved foods yet'}
          hint={query
            ? `No match for "${query}" in your foods or the library. Quick-add it instead.`
            : `Search ${STARTER_FOODS.length} common foods, or quick-add your own.`}
        />
      )}

      {recents.length > 0 && (
        <div>
          <p className="section-label flex items-center gap-1.5"><Clock size={11} /> Recent</p>
          <div className="card divide-y divide-slate-100 dark:divide-line overflow-hidden">
            {recents.map((r, i) => (
              <FoodRow
                key={`r-${i}`} name={r.name} brand={r.brand}
                cals={r.caloriesPerServing} protein={r.proteinPerServing}
                serving={r.servingSize} onClick={() => onPickRecent(r)}
              />
            ))}
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div>
          <p className="section-label flex items-center gap-1.5"><Star size={11} /> Saved foods</p>
          <div className="card divide-y divide-slate-100 dark:divide-line overflow-hidden">
            {saved.map(f => (
              <FoodRow
                key={f.id} name={f.name} brand={f.brand}
                cals={f.caloriesPerServing} protein={f.proteinPerServing}
                serving={f.servingSize} onClick={() => onPickSaved(f)}
              />
            ))}
          </div>
        </div>
      )}

      {library.length > 0 && (
        <div>
          <p className="section-label flex items-center gap-1.5">
            <BookOpen size={11} /> Food library
          </p>
          <div className="card divide-y divide-slate-100 dark:divide-line overflow-hidden">
            {library.map(f => (
              <FoodRow
                key={f.id} name={f.name}
                cals={f.calories} protein={f.protein}
                serving={f.servingLabel} onClick={() => onPickLibrary(f)}
              />
            ))}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 px-1">
            Typical values from UK CoFID. Check the packet for branded items — your
            edits are saved and take priority next time.
          </p>
        </div>
      )}
    </div>
  );
}

function FoodRow({
  name, brand, cals, protein, serving, onClick,
}: {
  name: string; brand?: string; cals: number; protein: number; serving?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-slate-50 dark:active:bg-ink-elevated transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {brand ? `${brand} · ` : ''}{serving ?? 'per serving'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="tabular text-sm font-bold text-slate-900 dark:text-white">{cals} <span className="text-[11px] font-semibold text-slate-500">kcal</span></p>
        <p className="tabular text-[11px] font-semibold text-cobalt-500">{protein}g protein</p>
      </div>
      <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
    </button>
  );
}

// ─── Quick add ───────────────────────────────────────────────────────────────

function QuickAddView({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { name: string; calories: number; protein: number; meal: MealCategory }) => void;
}) {
  const [name, setName] = useState('');
  const [calories, setCalories] = useState<number | ''>('');
  const [protein, setProtein] = useState<number | ''>('');
  const [meal, setMeal] = useState<MealCategory>('snack');
  const valid = name.trim() && calories !== '' && Number(calories) > 0;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="eyebrow block mb-1">Name</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Flat white" className="input" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="Calories" value={calories} onChange={setCalories} suffix="kcal" placeholder="0" />
        <NumberInput label="Protein" value={protein} onChange={setProtein} suffix="g" placeholder="0" />
      </div>
      <MealPicker meal={meal} setMeal={setMeal} />
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost flex-1">Back</button>
        <button
          disabled={!valid || busy}
          onClick={() => onSubmit({ name: name.trim(), calories: Number(calories), protein: Number(protein) || 0, meal })}
          className="btn-primary flex-1"
        >
          {busy ? 'Logging…' : 'Log food'}
        </button>
      </div>
    </div>
  );
}

// ─── Manual create ───────────────────────────────────────────────────────────

function ManualView({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: {
    food: { name: string; brand?: string; caloriesPerServing: number; proteinPerServing: number; carbsPerServing?: number; fatPerServing?: number; fibrePerServing?: number; servingSize?: string };
    saveAsFrequent: boolean; meal: MealCategory; quantity: number;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('');
  const [cals, setCals] = useState<number | ''>('');
  const [calsDirty, setCalsDirty] = useState(false); // user typed calories manually
  const [calsFocused, setCalsFocused] = useState(false);
  const [protein, setProtein] = useState<number | ''>('');
  const [carbs, setCarbs] = useState<number | ''>('');
  const [fat, setFat] = useState<number | ''>('');
  const [fibre, setFibre] = useState<number | ''>('');
  const [meal, setMeal] = useState<MealCategory>('breakfast');
  const [qty, setQty] = useState(1);
  const [saveAsFrequent, setSaveAsFrequent] = useState(true);
  const valid = name.trim() && cals !== '' && Number(cals) > 0;

  // Auto-calc calories from macros (4/4/9) until the user types calories
  // themselves — then their number wins and we stop syncing. Never write
  // into the field while it has focus, or we'd fight the user's caret
  // (clear-then-type-9 would become "1209").
  const autoCals = caloriesFromMacros({ protein, carbs, fat, fibre });
  useEffect(() => {
    if (calsDirty || calsFocused) return;
    setCals(autoCals > 0 ? autoCals : '');
  }, [autoCals, calsDirty, calsFocused]);

  function handleCalsChange(v: number | '') {
    setCals(v);
    setCalsDirty(v !== '');
  }

  function handleCalsBlur() {
    setCalsFocused(false);
    // Leaving the field empty hands control back to the auto-calc.
    if (cals === '') setCalsDirty(false);
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="eyebrow block mb-1">Name</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Greek yoghurt" className="input" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow block mb-1">Brand (optional)</span>
          <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Fage" className="input" />
        </label>
        <label className="block">
          <span className="eyebrow block mb-1">Serving (optional)</span>
          <input value={serving} onChange={e => setServing(e.target.value)} placeholder="e.g. 170g pot" className="input" />
        </label>
      </div>
      <p className="eyebrow">Per serving</p>
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="Protein" value={protein} onChange={setProtein} suffix="g" placeholder="0" />
        <NumberInput label="Carbs" value={carbs} onChange={setCarbs} suffix="g" placeholder="0" />
        <NumberInput label="Fat" value={fat} onChange={setFat} suffix="g" placeholder="0" />
        <NumberInput label="Fibre" value={fibre} onChange={setFibre} suffix="g" placeholder="0" />
        <NumberInput
          label="Calories"
          value={cals}
          onChange={handleCalsChange}
          onFocus={() => setCalsFocused(true)}
          onBlur={handleCalsBlur}
          suffix="kcal"
          placeholder="0"
        />
      </div>
      {!calsDirty && autoCals > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2">
          Calories auto-calculated from macros (P×4 + C×4 + F×9 + fibre×2).
        </p>
      )}
      {calsDirty && autoCals > 0 && autoCals !== Number(cals) && (
        <button
          type="button"
          onClick={() => { setCals(autoCals); setCalsDirty(false); }}
          className="text-[11px] font-semibold text-cobalt-500 -mt-2 block"
        >
          Recalculate from macros → {autoCals} kcal
        </button>
      )}

      <MealPicker meal={meal} setMeal={setMeal} />

      <div>
        <span className="eyebrow block mb-1.5">Servings</span>
        <Stepper value={qty} onChange={setQty} step={0.5} min={0.5} suffix="×" />
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={saveAsFrequent} onChange={e => setSaveAsFrequent(e.target.checked)} className="w-4 h-4 accent-cobalt-500" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Save as a frequent food</span>
      </label>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost flex-1">Back</button>
        <button
          disabled={!valid || busy}
          onClick={() => onSubmit({
            food: {
              name: name.trim(), brand: brand.trim() || undefined, servingSize: serving.trim() || undefined,
              caloriesPerServing: Number(cals), proteinPerServing: Number(protein) || 0,
              carbsPerServing: carbs === '' ? undefined : Number(carbs),
              fatPerServing: fat === '' ? undefined : Number(fat),
              fibrePerServing: fibre === '' ? undefined : Number(fibre),
            },
            saveAsFrequent, meal, quantity: qty,
          })}
          className="btn-primary flex-1"
        >
          {busy ? 'Logging…' : 'Log food'}
        </button>
      </div>
    </div>
  );
}

// ─── Confirm amount ──────────────────────────────────────────────────────────

function ConfirmView({
  candidate, defaultMeal, busy, onBack, onSubmit,
}: {
  candidate: Candidate;
  defaultMeal: MealCategory;
  busy: boolean;
  onBack: () => void;
  onSubmit: (v: { quantity: number; meal: MealCategory }) => void;
}) {
  const [qty, setQty] = useState(1);
  const [meal, setMeal] = useState<MealCategory>(defaultMeal);
  const cals = Math.round(candidate.caloriesPerServing * qty);
  const protein = Math.round(candidate.proteinPerServing * qty * 10) / 10;

  return (
    <div className="space-y-4">
      <div className="card-elevated p-4">
        <p className="text-base font-bold text-slate-900 dark:text-white">{candidate.name}</p>
        {(candidate.brand || candidate.servingSize) && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {candidate.brand ? `${candidate.brand} · ` : ''}{candidate.servingSize ?? 'per serving'}
          </p>
        )}
        <div className="flex items-baseline gap-4 mt-3">
          <div>
            <span className="tabular text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{cals}</span>
            <span className="text-xs font-bold text-slate-500 ml-1">kcal</span>
          </div>
          <div>
            <span className="tabular text-xl font-extrabold text-cobalt-500">{protein}</span>
            <span className="text-xs font-bold text-slate-500 ml-1">g protein</span>
          </div>
        </div>
      </div>

      <div>
        <span className="eyebrow block mb-1.5">Servings</span>
        <Stepper value={qty} onChange={setQty} step={0.5} min={0.5} suffix="×" />
      </div>

      <MealPicker meal={meal} setMeal={setMeal} />

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="btn-ghost flex-1">Back</button>
        <button disabled={busy} onClick={() => onSubmit({ quantity: qty, meal })} className="btn-primary flex-1">
          {busy ? 'Logging…' : 'Log food'}
        </button>
      </div>
    </div>
  );
}

// ─── Meal category picker ────────────────────────────────────────────────────

function MealPicker({ meal, setMeal }: { meal: MealCategory; setMeal: (m: MealCategory) => void }) {
  return (
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
  );
}
