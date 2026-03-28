import { useState } from 'react';
import { saveGratitudeEntry, saveTodo, getTodayString } from '../utils/storage';
import { GratitudeEntry, Todo } from '../types';

// ─── Trigger helpers (called from App.tsx) ────────────────────────────────────

const CHECKIN_KEY = 'checkinDate';

export function shouldShowCheckIn(): boolean {
  return localStorage.getItem(CHECKIN_KEY) !== getTodayString();
}

export function markCheckInDone(): void {
  localStorage.setItem(CHECKIN_KEY, getTodayString());
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DailyCheckIn({ onDismiss }: { onDismiss: () => void }) {
  const today = getTodayString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

  const [dateTab, setDateTab] = useState<'today' | 'yesterday'>('today');
  const [gratitude, setGratitude] = useState('');
  const [tasks, setTasks] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedDate = dateTab === 'today' ? today : yesterday;

  async function handleSave() {
    const hasGratitude = gratitude.trim().length > 0;
    const taskLines = tasks.split('\n').map(l => l.trim()).filter(Boolean);

    if (!hasGratitude && taskLines.length === 0) {
      onDismiss();
      return;
    }

    setSaving(true);
    try {
      const saves: Promise<void>[] = [];

      if (hasGratitude) {
        const entry: GratitudeEntry = {
          id: crypto.randomUUID(),
          date: selectedDate,
          text: gratitude.trim(),
          createdAt: Date.now(),
        };
        saves.push(saveGratitudeEntry(entry));
      }

      const now = Date.now();
      taskLines.forEach((title, i) => {
        const todo: Todo = {
          id: crypto.randomUUID(),
          title,
          done: false,
          dueDate: selectedDate,
          myDay: dateTab === 'today',
          createdAt: now + i,
          order: now + i,
        };
        saves.push(saveTodo(todo));
      });

      await Promise.all(saves);
    } finally {
      onDismiss();
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onDismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm bg-white dark:bg-[#111827] rounded-3xl shadow-2xl p-6 animate-pop-in">

        {/* Header */}
        <div className="mb-5">
          <p className="text-[11px] font-bold text-violet-500 uppercase tracking-[0.12em] mb-1">Daily Check-In</p>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-snug">
            Start strong 💪
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">30 seconds. Let's go.</p>
        </div>

        {/* Date toggle */}
        <div className="flex gap-2 mb-5 bg-slate-100 dark:bg-[#1C2537] rounded-xl p-1">
          {(['today', 'yesterday'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setDateTab(tab)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                dateTab === tab
                  ? 'bg-white dark:bg-[#0A0F1E] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Gratitude input */}
        <div className="mb-4">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-1.5">
            Grateful for
          </label>
          <textarea
            value={gratitude}
            onChange={e => setGratitude(e.target.value)}
            placeholder="Something good, however small..."
            rows={2}
            className="w-full bg-slate-50 dark:bg-[#1C2537] text-slate-900 dark:text-white placeholder-slate-400 rounded-xl px-3.5 py-2.5 text-sm resize-none outline-none border-2 border-transparent focus:border-violet-400 transition-colors"
          />
        </div>

        {/* Tasks input */}
        <div className="mb-6">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-1.5">
            Priorities — one per line
          </label>
          <textarea
            value={tasks}
            onChange={e => setTasks(e.target.value)}
            placeholder={"Finish report\nGym\nCall mum"}
            rows={3}
            className="w-full bg-slate-50 dark:bg-[#1C2537] text-slate-900 dark:text-white placeholder-slate-400 rounded-xl px-3.5 py-2.5 text-sm resize-none outline-none border-2 border-transparent focus:border-violet-400 transition-colors"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 items-center">
          <button
            onClick={onDismiss}
            className="px-4 py-3 text-sm font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-2xl text-sm font-bold bg-violet-600 hover:bg-violet-700 active:scale-95 text-white transition-all disabled:opacity-60 shadow-lg shadow-violet-500/20"
          >
            {saving ? 'Saving…' : 'Save & start →'}
          </button>
        </div>
      </div>
    </div>
  );
}
