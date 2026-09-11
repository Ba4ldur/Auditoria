import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/ui/cn';

const CONTROL =
  'h-9.5 w-full rounded-md border border-line-strong bg-white px-3 text-sm text-ink ' +
  'placeholder:text-ink-subtle transition-colors hover:border-navy-300 ' +
  'focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20 ' +
  'disabled:bg-canvas disabled:text-ink-subtle';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-muted">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

/** Chevron drawn as a background image so the control keeps a native select. */
const SELECT_CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' " +
  "viewBox='0 0 12 12'><path d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%23566a83' " +
  "stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(CONTROL, 'appearance-none bg-no-repeat pr-8', className)}
      style={{
        backgroundImage: SELECT_CHEVRON,
        backgroundPosition: 'right 0.7rem center',
        backgroundSize: '12px 12px',
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, 'h-auto min-h-20 py-2 leading-relaxed', className)} {...props} />;
}
