'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { t as translate, tr as trContent } from '@/i18n';
import { useWM } from '@/os/windows';
import type { LText, Locale, HealthStatus } from '@prod/engine';

export function useT() {
  const locale = useGame((s) => s.locale);
  return {
    locale,
    t: (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    tr: (text: LText | string | undefined) => trContent(text, locale),
  };
}

export function Panel({ children, title, inset, className }: { children: ReactNode; title?: string; inset?: boolean; className?: string }) {
  return (
    <div className={`panel ${inset ? 'inset' : ''} ${className ?? ''}`}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

export function Btn({ children, onClick, disabled, primary, danger, sm, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; sm?: boolean; title?: string }) {
  return (
    <button className={`btn ${primary ? 'primary' : ''} ${danger ? 'danger' : ''} ${sm ? 'sm' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Dot({ status }: { status: HealthStatus | 'ok' | 'warn' | 'error' | 'offline' }) {
  const sym = status === 'ok' ? '✓' : status === 'warn' ? '!' : status === 'error' ? '✕' : '○';
  return <span className={`dot ${status}`} title={status}>{sym}</span>;
}

export function Meter({ value, max = 1, tone }: { value: number; max?: number; tone?: 'ok' | 'warn' | 'error' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = pct > 90 ? 'error' : pct > 70 ? 'warn' : 'ok';
  return (
    <div className={`meter ${tone ?? auto}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="panel inset" style={{ margin: 0, padding: '6px 8px' }}>
      <div className="tiny muted">{label}</div>
      <div className="mono" style={{ fontSize: 16 }}>{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  );
}

/** A WHY?/Encyclopedia link that opens the Encyclopedia at a knowledge node. */
export function Why({ node, label }: { node: string; label?: string }) {
  const open = useWM((s) => s.open);
  const { t } = useT();
  if (!node) return null;
  return (
    <button className="btn sm" title={t('common.why')} onClick={() => open('encyclopedia', { node })}>
      {label ?? t('common.why')}
    </button>
  );
}

/** Short/expandable explanation block used by WHY and debrief. */
export function Expandable({ summary, children, open: openProp }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(!!openProp);
  const { t } = useT();
  return (
    <div>
      <div>{summary}</div>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
      <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setOpen(!open)}>
        {open ? t('common.less') : t('common.more')}
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted small" style={{ padding: 12, textAlign: 'center' }}>{children}</div>;
}

export function LockedNote({ children }: { children?: ReactNode }) {
  const { t } = useT();
  return <Empty>{children ?? t('common.locked')}</Empty>;
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${Math.round(n)} ms`;
}
export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}
export function money(n: number): string {
  return `₲${Math.round(n).toLocaleString('en-US')}`;
}
export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function ClientOnly({ children }: { children: ReactNode }) {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m ? <>{children}</> : null;
}

export type { Locale };
