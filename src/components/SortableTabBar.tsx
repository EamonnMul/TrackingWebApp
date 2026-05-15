import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface TabDef {
  id: string;
  label: string;
}

interface SortableTabProps {
  tab: TabDef;
  isActive: boolean;
  dot?: boolean;
  onClick: () => void;
  textSize?: string;
  activeClass?: string;
}

function SortableTab({ tab, isActive, dot, onClick, textSize = 'text-xs', activeClass = 'bg-cobalt-500 text-white' }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex-1 relative"
      {...attributes}
      {...listeners}
    >
      <button
        onClick={onClick}
        className={`w-full py-2 rounded-xl ${textSize} font-semibold transition-colors select-none touch-none ${
          isActive
            ? activeClass
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {tab.label}
      </button>
      {dot && !isActive && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-500 pointer-events-none" />
      )}
    </div>
  );
}

interface SortableTabBarProps {
  tabs: TabDef[];
  activeId: string;
  onTabChange: (id: string) => void;
  onReorder: (newTabs: TabDef[]) => void;
  dots?: Record<string, boolean>;
  textSize?: string;
  activeClass?: string;
}

export function SortableTabBar({
  tabs,
  activeId,
  onTabChange,
  onReorder,
  dots,
  textSize,
  activeClass,
}: SortableTabBarProps) {
  // Distance constraint: 8px movement required before drag starts,
  // so normal taps still fire onClick for tab switching.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex(t => t.id === active.id);
    const newIndex = tabs.findIndex(t => t.id === over.id);
    onReorder(arrayMove(tabs, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex bg-white dark:bg-ink-surface rounded-2xl p-1 gap-1 shadow-sm border border-slate-200 dark:border-transparent">
          {tabs.map(tab => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={activeId === tab.id}
              dot={dots?.[tab.id]}
              onClick={() => onTabChange(tab.id)}
              textSize={textSize}
              activeClass={activeClass}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
