import type { ReactNode } from 'react';

export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-label={title}>
      <header className="section__header">
        <h2>{title}</h2>
        {actions === undefined ? null : <div className="section__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted';
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function fmt(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined) return '—';
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return Number(n.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
