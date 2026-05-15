import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getAllTodos, getTodayString } from '../utils/storage';

// ─── Tab order persistence ────────────────────────────────────────────────────

const DEFAULT_TABS = [
  { id: '/today', label: 'Home' },
  { id: '/', label: 'Log' },
  { id: '/progress', label: 'Progress' },
];
const NAV_ORDER_KEY = 'bottomNavOrder_v4';

function loadTabOrder() {
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

// ─── Single sortable tab ──────────────────────────────────────────────────────

function NavTab({ tab, active, hasDot }: { tab: { id: string; label: string }; active: boolean; hasDot: boolean }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });

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
        className={`w-full flex flex-col items-center justify-center py-4 gap-0.5 transition-colors select-none touch-none ${
          active ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        <span className={`text-xs font-bold tracking-wide ${active ? 'text-blue-500' : ''}`}>
          {tab.label}
        </span>
        {/* Active indicator dot */}
        {active && <span className="w-1 h-1 rounded-full bg-blue-500" />}
      </button>
      {/* Pending task hue — subtle violet glow behind label */}
      {hasDot && !active && (
        <span className="absolute top-3 right-[calc(50%-10px)] w-1.5 h-1.5 rounded-full bg-violet-500 pointer-events-none" />
      )}
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

export default function BottomNav() {
  const location = useLocation();
  const [tabs, setTabs] = useState(loadTabOrder);
  const [pendingToday, setPendingToday] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Fetch pending tasks count once on mount
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
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-[#1E2D45] z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto flex">
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
