import { useState, useEffect } from 'react';
import { BottomSheet, NumberInput } from '../ui';
import { getNutritionTarget, saveNutritionTarget } from '../../utils/nutrition';
import { NutritionTarget, NutritionMode } from '../../types';

const MODES: { id: NutritionMode; label: string; hint: string }[] = [
  { id: 'cutting', label: 'Cutting', hint: 'Lean out' },
  { id: 'maintenance', label: 'Maintain', hint: 'Hold steady' },
  { id: 'bulking', label: 'Bulking', hint: 'Build up' },
];

export default function NutritionTargetSheet({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [calories, setCalories] = useState<number | ''>('');
  const [protein, setProtein] = useState<number | ''>('');
  const [carbs, setCarbs] = useState<number | ''>('');
  const [fat, setFat] = useState<number | ''>('');
  const [fibre, setFibre] = useState<number | ''>('');
  const [water, setWater] = useState<number | ''>('');
  const [mode, setMode] = useState<NutritionMode>('maintenance');
  const [showMacros, setShowMacros] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    getNutritionTarget().then(t => {
      setCalories(t?.calories ?? 2200);
      setProtein(t?.protein ?? 170);
      setCarbs(t?.carbs ?? '');
      setFat(t?.fat ?? '');
      setFibre(t?.fibre ?? '');
      setWater(t?.water ?? '');
      setMode(t?.mode ?? 'maintenance');
      setShowMacros(t?.showMacros ?? false);
    });
  }, [open]);

  const valid = calories !== '' && Number(calories) > 0 && protein !== '' && Number(protein) >= 0;

  async function save() {
    setBusy(true);
    const target: NutritionTarget = {
      calories: Number(calories), protein: Number(protein),
      carbs: carbs === '' ? undefined : Number(carbs),
      fat: fat === '' ? undefined : Number(fat),
      fibre: fibre === '' ? undefined : Number(fibre),
      water: water === '' ? undefined : Number(water),
      mode, showMacros, updatedAt: Date.now(),
    };
    await saveNutritionTarget(target);
    setBusy(false);
    onSaved();
    onClose();
  }

  return (
    <BottomSheet
      open={open} onClose={onClose} eyebrow="Targets" title="Daily Targets"
      footer={
        <button disabled={!valid || busy} onClick={save} className="btn-primary w-full">
          {busy ? 'Saving…' : 'Save targets'}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="eyebrow block mb-1.5">Goal</span>
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`py-2.5 rounded-xl border transition-all ${
                  mode === m.id
                    ? 'bg-cobalt-500/15 border-cobalt-500/40'
                    : 'bg-slate-100 dark:bg-ink-inset border-slate-200 dark:border-line'
                }`}
              >
                <p className={`text-sm font-bold ${mode === m.id ? 'text-cobalt-500' : 'text-slate-700 dark:text-slate-300'}`}>{m.label}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">{m.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Calories" value={calories} onChange={setCalories} suffix="kcal" placeholder="2200" />
          <NumberInput label="Protein" value={protein} onChange={setProtein} suffix="g" placeholder="170" />
        </div>

        <label className="flex items-center justify-between gap-3 cursor-pointer select-none card px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Track carbs, fat &amp; more</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Show extra macros on the dashboard</p>
          </div>
          <input type="checkbox" checked={showMacros} onChange={e => setShowMacros(e.target.checked)} className="w-5 h-5 accent-cobalt-500 shrink-0" />
        </label>

        {showMacros && (
          <div className="grid grid-cols-2 gap-3 animate-fade-in">
            <NumberInput label="Carbs" value={carbs} onChange={setCarbs} suffix="g" placeholder="optional" />
            <NumberInput label="Fat" value={fat} onChange={setFat} suffix="g" placeholder="optional" />
            <NumberInput label="Fibre" value={fibre} onChange={setFibre} suffix="g" placeholder="optional" />
            <NumberInput label="Water" value={water} onChange={setWater} suffix="ml" placeholder="optional" />
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
