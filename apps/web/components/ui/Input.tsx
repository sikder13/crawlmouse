import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = '', invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg border bg-white px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-peach/50 ${invalid ? 'border-warning ring-1 ring-warning' : 'border-oat'} ${className}`}
      {...rest}
    />
  );
});
