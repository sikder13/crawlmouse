import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// The solid orange (primary button, peach badge) uses the darkened accent-fill with WHITE text
// (AA 4.60:1). #ff7849 stays for accents/borders/rings. Other fills (sage/warning) keep ink text.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-fill text-white hover:brightness-95 active:brightness-90 focus-visible:ring-peach',
  secondary:
    'bg-transparent text-ink border-[1.5px] border-ink hover:bg-ink hover:text-cream active:bg-ink/90 focus-visible:ring-ink',
  ghost: 'bg-transparent text-ink-muted hover:bg-ink/5 hover:text-ink active:bg-ink/10 focus-visible:ring-ink',
  destructive: 'bg-warning-fill text-white hover:brightness-95 active:brightness-90 focus-visible:ring-warning',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-caption px-3 py-1.5 gap-1.5',
  md: 'text-body px-5 py-2.5 gap-2',
  lg: 'text-body-lg px-7 py-3.5 gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-control font-medium transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-cream ' +
  'disabled:opacity-50 disabled:cursor-not-allowed motion-reduce:transition-none';

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
