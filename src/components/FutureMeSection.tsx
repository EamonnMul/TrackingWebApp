import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, CheckCircle2 } from 'lucide-react';
import { getAllFutureMeMessages, saveFutureMeMessage, deleteFutureMeMessage } from '../utils/storage';
import { FutureMeMessage } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minDatetime(): string {
  return toLocalInput(Date.now() + 60_000); // 1 minute from now
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FutureMeSection() {
  const [messages, setMessages] = useState<FutureMeMessage[]>([]);
  const [tab, setTab] = useState<'pending' | 'delivered'>('pending');
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<FutureMeMessage | null>(null);
  const [content, setContent] = useState('');
  const [deliverAt, setDeliverAt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAndDeliver(); }, []);

  async function loadAndDeliver() {
    const all = await getAllFutureMeMessages();
    const now = Date.now();
    const due = all.filter(m => !m.delivered && m.deliverAt <= now);
    for (const m of due) {
      const updated = { ...m, delivered: true, deliveredAt: now };
      await saveFutureMeMessage(updated);
    }
    const fresh = due.length > 0 ? await getAllFutureMeMessages() : all;
    setMessages(fresh.sort((a, b) => a.deliverAt - b.deliverAt));
  }

  const pending = messages.filter(m => !m.delivered);
  const delivered = messages.filter(m => m.delivered).sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0));

  function openCompose(existing?: FutureMeMessage) {
    setEditing(existing ?? null);
    setContent(existing?.content ?? '');
    setDeliverAt(existing ? toLocalInput(existing.deliverAt) : toLocalInput(Date.now() + 7 * 86_400_000));
    setComposing(true);
  }

  async function handleSave() {
    const trimmed = content.trim();
    if (!trimmed || !deliverAt) return;
    const deliverMs = new Date(deliverAt).getTime();
    if (deliverMs <= Date.now()) return;
    setSaving(true);
    try {
      const msg: FutureMeMessage = editing
        ? { ...editing, content: trimmed, deliverAt: deliverMs }
        : { id: crypto.randomUUID(), content: trimmed, createdAt: Date.now(), deliverAt: deliverMs, delivered: false };
      await saveFutureMeMessage(msg);
      setMessages(prev =>
        (editing ? prev.map(m => m.id === editing.id ? msg : m) : [...prev, msg])
          .sort((a, b) => a.deliverAt - b.deliverAt)
      );
      setComposing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteFutureMeMessage(id);
    setMessages(prev => prev.filter(m => m.id !== id));
  }

  const canSave = content.trim().length > 0 && !!deliverAt && new Date(deliverAt).getTime() > Date.now();

  return (
    <div className="pt-1">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Future Me</span>
          {pending.length > 0 && (
            <span className="bg-violet-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {pending.length}
            </span>
          )}
        </div>
        <button
          onClick={() => openCompose()}
          className="text-violet-500 text-xs font-semibold flex items-center gap-1 hover:text-violet-400 transition-colors"
        >
          <Plus size={12} /> Write
        </button>
      </div>

      {/* Pending / Delivered tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-[#1C2537] rounded-xl p-1 mb-3">
        {(['pending', 'delivered'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === t
                ? 'bg-white dark:bg-[#0A0F1E] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {t === 'pending' ? `Pending${pending.length > 0 ? ` (${pending.length})` : ''}` : 'Delivered'}
          </button>
        ))}
      </div>

      {/* Pending list */}
      {tab === 'pending' && (
        <div className="space-y-2">
          {pending.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-2xl mb-2">✉️</p>
              <p className="text-sm text-slate-400">Write a message to your future self.</p>
            </div>
          ) : pending.map(m => (
            <div key={m.id} className="bg-white dark:bg-[#111827] rounded-2xl p-4 border border-slate-200 dark:border-transparent shadow-sm">
              <p className="text-sm text-slate-500 dark:text-slate-600 italic mb-2">✉️ Sealed — opens {fmtDate(m.deliverAt)}</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => openCompose(m)} className="text-slate-400 hover:text-blue-400 transition-colors">
                  <Edit2 size={13} />
                </button>
                <button onClick={() => handleDelete(m.id)} className="text-slate-400 hover:text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delivered list */}
      {tab === 'delivered' && (
        <div className="space-y-2">
          {delivered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">No delivered messages yet.</p>
            </div>
          ) : delivered.map(m => (
            <div key={m.id} className="bg-white dark:bg-[#111827] rounded-2xl p-4 border border-violet-200 dark:border-violet-900/30 shadow-sm">
              <div className="flex items-center gap-1.5 text-violet-500 text-[10px] font-bold uppercase tracking-wider mb-2">
                <CheckCircle2 size={11} />
                <span>Delivered {m.deliveredAt ? fmtDate(m.deliveredAt) : ''}</span>
              </div>
              <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{m.content}</p>
              <div className="flex justify-end mt-2">
                <button onClick={() => handleDelete(m.id)} className="text-slate-400 hover:text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compose / Edit modal */}
      {composing && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setComposing(false)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-[#111827] rounded-3xl shadow-2xl p-6 animate-pop-in">
            <p className="text-[11px] font-bold text-violet-500 uppercase tracking-[0.12em] mb-1">
              {editing ? 'Edit message' : 'Write to Future Me'}
            </p>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5">
              {editing ? 'Update your message' : 'What do you want to tell yourself?'}
            </h2>

            <div className="mb-4">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-1.5">
                Message
              </label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Hey future me, I'm proud of you for..."
                rows={4}
                autoFocus
                className="w-full bg-slate-50 dark:bg-[#1C2537] text-slate-900 dark:text-white placeholder-slate-400 rounded-xl px-3.5 py-2.5 text-sm resize-none outline-none border-2 border-transparent focus:border-violet-400 transition-colors"
              />
            </div>

            <div className="mb-6">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block mb-1.5">
                Deliver on
              </label>
              <input
                type="datetime-local"
                value={deliverAt}
                min={minDatetime()}
                onChange={e => setDeliverAt(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#1C2537] text-slate-900 dark:text-white rounded-xl px-3.5 py-2.5 text-sm outline-none border-2 border-transparent focus:border-violet-400 transition-colors"
              />
            </div>

            <div className="flex gap-3 items-center">
              <button
                onClick={() => setComposing(false)}
                className="px-4 py-3 text-sm font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="flex-1 py-3 rounded-2xl text-sm font-bold bg-violet-600 hover:bg-violet-700 active:scale-95 text-white transition-all disabled:opacity-40 shadow-lg shadow-violet-500/20"
              >
                {saving ? 'Saving…' : editing ? 'Update →' : 'Send to future me →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
