import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Home, Dumbbell, LineChart, LucideIcon } from 'lucide-react';
import { getAllTodos, getTodayString } from '../utils/storage';

// ─── Tab definitions ─────────────────────────────────────────────────────────

interface Tab {
  id: string;
  label: string;
  Icon: LucideIcon;
}

const DEFAULT_TABS: Tab[] = [
  { id: '/today',    label: 'Home',     Icon: Home },
  { id: '/',         label: 'Log',      Icon: Dumbbell },
  { id: '/progress', label: 'Progress', Icon: LineChart },
];
const NAV_ORDER_KEY = 'bottomNavOrder_v5';

function loadTabOrder(): Tab[] {
  try {
    const stored = localStorage.getItem(NAV_ORDER_KEY);
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      if (ids.length === DEFAULT_TABS.length && DEFAULT_TABS.every(t => ids.includes(t.id))) {
        return ids.map(id => DEFAULT_TABS.find(t => t.id === id)!);
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_TABS;
}

// ─── Single sortable tab ─────────────────────────────────────────────────────

function NavTab({ tab, active, hasDot }: { tab: Tab; active: boolean; hasDot: boolean }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const { Icon } = tab;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex-1 relative"
      {...attributes}
      {...listeners}
    >
      <button
        onClick={() => navigate(tab.id)}
        className="w-full flex flex-col items-center justify-center pt-2 pb-2 gap-1
                   select-none touch-none transition-colors"
      >
        <span
          className={`inline-flex items-center justify-center w-14 h-8 rounded-full transition-all
            ${active
              ? 'bg-cobalt-500/15 border border-cobalt-500/40 text-cobalt-400'
              : 'text-slate-500 dark:text-slate-500'
            }`}
        >
          <Icon size={active ? 19 : 18} strokeWidth={active ? 2.4 : 2} />
        </span>
        <span
          className={`text-[10px] font-bold tracking-wider transition-colors
            ${active ? 'text-cobalt-500 dark:text-cobalt-400' : 'text-slate-500 dark:text-slate-500'}
          `}
        >
          {tab.label}
        </span>
      </button>
      {/* Pending-task indicator */}
      {hasDot && !active && (
        <span
          className="absolute top-2 right-[calc(50%-12px)] w-1.5 h-1.5 rounded-full
                     bg-fire-600 shadow-glow-fire pointer-events-none"
        />
      )}
    </div>
  );
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

export default function BottomNav() {
  const location = useLocation();
  const [tabs, setTabs] = useState<Tab[]>(loadTabOrder);
  const [pendingToday, setPendingToday] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    const today = getTodayString();
    getAllTodos().then(all => {
      const count = all.filter(t => !t.done && (t.myDay || t.dueDate === today)).length;
      setPendingToday(count);
    }).catch(() => {});
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex(t => t.id === active.id);
    const newIndex = tabs.findIndex(t => t.id === over.id);
    const next = arrayMove(tabs, oldIndex, newIndex);
    setTabs(next);
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next.map(t => t.id)));
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40
                 bg-white/95 dark:bg-ink-surface/95
                 backdrop-blur-lg
                 border-t border-slate-200 dark:border-line"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto flex px-2 pt-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map(tab => (
              <NavTab
                key={tab.id}
                tab={tab}
                active={location.pathname === tab.id}
                hasDot={tab.id === '/today' && pendingToday > 0}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </nav>
  );
}
