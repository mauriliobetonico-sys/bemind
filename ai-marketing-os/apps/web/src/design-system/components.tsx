'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export function Button({
  variant = 'default',
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx('ds-btn', variant !== 'default' && `ds-btn-${variant}`, size === 'sm' && 'ds-btn-sm', className)}
    />
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('ds-card', 'ds-fade-in', className)}>
      {(title || action) && (
        <header className="ds-card-header">
          {title && <h2 className="ds-card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('ds-badge', tone !== 'neutral' && `ds-badge-${tone}`)}>{children}</span>;
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'danger' }) {
  const color = tone === 'warn' ? 'var(--warn-ink)' : tone === 'danger' ? 'var(--danger-ink)' : undefined;
  return (
    <div className="ds-card ds-fade-in" style={{ padding: 'var(--space-4)', gap: 6 }}>
      <span className="ds-eyebrow">{label}</span>
      <span className="ds-stat-value" style={{ color }}>
        {value}
      </span>
      {hint && <span className="ds-stat-hint">{hint}</span>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ds-page-header">
      <div className="ds-stack" style={{ gap: 6 }}>
        {eyebrow && <span className="ds-eyebrow">{eyebrow}</span>}
        <h1 className="ds-page-title">{title}</h1>
      </div>
      {actions && <div className="ds-row">{actions}</div>}
    </header>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
}

export function Input({ label, error, hint, className, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={cx('ds-field', className)}>
      <label className="ds-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="ds-input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : undefined} {...props} />
      {hint && !error && <span className="ds-stat-hint">{hint}</span>}
      {error && (
        <span id={`${id}-e`} className="ds-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export function Select({
  label,
  error,
  className,
  options,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div className={cx('ds-field', className)}>
      <label className="ds-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="ds-select" aria-invalid={error ? true : undefined} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="ds-field-error">{error}</span>}
    </div>
  );
}

export function Textarea({ label, error, className, ...props }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className={cx('ds-field', className)}>
      <label className="ds-label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="ds-textarea" aria-invalid={error ? true : undefined} {...props} />
      {error && <span className="ds-field-error">{error}</span>}
    </div>
  );
}

export function Alert({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger' | 'ok' | 'warn'; children: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('ds-alert', tone !== 'neutral' && `ds-alert-${tone}`)}>
      {children}
    </div>
  );
}

/** Módulo ainda não construído: nunca simular dados, sempre sinalizar a fase. */
export function PendingModule({ label, phase }: { label: string; phase: number }) {
  return (
    <div className="ds-pending">
      <span>{label}</span>
      <Badge>Fase {phase}</Badge>
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span className="ds-avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

export function Timeline({ items }: { items: { id: string; at: string | Date; content: ReactNode }[] }) {
  if (items.length === 0) return <EmptyState>Nenhuma atividade registrada ainda.</EmptyState>;
  return (
    <ol className="ds-timeline">
      {items.map((i) => {
        const d = new Date(i.at);
        return (
          <li key={i.id}>
            <time dateTime={d.toISOString()} title={d.toLocaleString('pt-BR')}>
              {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </time>
            <span>{i.content}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="ds-empty">{children}</div>;
}

export function Skeleton({ height = 18, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="ds-skeleton" style={{ height, width }} aria-hidden="true" />;
}
