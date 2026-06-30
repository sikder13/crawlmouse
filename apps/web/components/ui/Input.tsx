import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const BASE =
  'w-full rounded-control border bg-surface-raised px-4 py-3 text-body text-ink placeholder:text-ink/40 ' +
  'transition-colors hover:border-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-peach/50 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-oat/30 motion-reduce:transition-none';

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = '', invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${BASE} ${invalid ? 'border-warning ring-1 ring-warning' : 'border-oat'} ${className}`}
      {...rest}
    />
  );
});
