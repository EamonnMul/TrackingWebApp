/**
 * Shared UI primitives — the building blocks of the design system.
 * Keep these dumb and presentational; no data fetching, no Firebase.
 */
import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

// ─── Spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ size = 8 }: { size?: number }) {
  return (
    <div
      className={`w-${size} h-${size} border-2 border-cobalt-500 border-t-transparent rounded-full animate-spin`}
      style={{ width: size * 4, height: size * 4 }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function ScreenLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner />
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card border-dashed flex flex-col items-center justify-center text-center px-6 py-10">
      {Icon && (
        <span className="w-11 h-11 rounded-full bg-slate-100 dark:bg-ink-inset border border-slate-200 dark:border-line flex items-center justify-center mb-3">
          <Icon size={20} className="text-slate-400 dark:text-slate-500" />
        </span>
      )}
      <p className="text-[15px] font-bold text-slate-700 dark:text-slate-300">{title}</p>
      {hint && <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">{hint}</p>}
      {children}
    </div>
  );
}

// ─── Section label ───────────────────────────────────────────────────────────

export function SectionLabel({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-1 mb-2">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.12em]">
        {children}
      </p>
      {right}
    </div>
  );
}

// ─── Progress ring ───────────────────────────────────────────────────────────

export function ProgressRing({
  pct,
  size = 64,
  stroke = 5,
  children,
}: {
  pct: number; // 0–100
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const complete = clamped >= 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-ink-inset"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
          className={`transition-all duration-500 ${complete ? 'stroke-success-500' : 'stroke-cobalt-500'}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  width = 88,
  height = 28,
  positiveIsGood = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** colour the trend by direction: true = rising is green, false = falling is green */
  positiveIsGood?: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const rising = values[values.length - 1] >= values[0];
  const good = positiveIsGood ? rising : !rising;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={path}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={good ? 'stroke-success-500' : 'stroke-fire-500'}
      />
      <circle cx={lx} cy={ly} r={2.5} className={good ? 'fill-success-500' : 'fill-fire-500'} />
    </svg>
  );
}

// ─── Stat tile ───────────────────────────────────────────────────────────────

export function StatTile({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 card px-3.5 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={11} className="text-slate-400 dark:text-slate-500 shrink-0" />}
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider truncate">
          {label}
        </p>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="tabular text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {value}
        </span>
        {unit && (
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{unit}</span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-[11px] font-semibold">{sub}</div>}
      {children}
    </div>
  );
}

export function SkeletonTile() {
  return (
    <div className="flex-1 card px-3.5 py-3 animate-pulse">
      <div className="h-2.5 w-12 rounded bg-slate-200 dark:bg-ink-inset mb-2.5" />
      <div className="h-5 w-16 rounded bg-slate-200 dark:bg-ink-inset" />
    </div>
  );
}
