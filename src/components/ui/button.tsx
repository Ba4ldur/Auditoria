import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/ui/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-navy-800 text-white hover:bg-navy-700 active:bg-navy-900 disabled:bg-navy-800/40 shadow-[0_1px_2px_rgb(13_32_56/0.18)]',
  secondary:
    'bg-white text-navy-800 border border-line-strong hover:bg-navy-50 active:bg-navy-100 disabled:text-ink-subtle',
  ghost: 'bg-transparent text-navy-700 hover:bg-navy-50 active:bg-navy-100',
  danger: 'bg-danger text-white hover:bg-[#8e1a22] active:bg-[#75151c]',
  gold: 'bg-gold-500 text-navy-950 hover:bg-gold-400 active:bg-gold-600 font-semibold',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: Variant;
  size?: Size;
}

/** A link styled as a button. Used for navigation actions in headers and rows. */
export function LinkButton({ className, href, variant = 'primary', size = 'md', ...props }: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
