import type { HTMLAttributes, ReactNode } from 'react';

export type CardVariant = 'default' | 'raised' | 'locked';
export type CardSize = 'sm' | 'md' | 'lg';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: CardVariant;
  size?: CardSize;
  interactive?: boolean;
}

// `default` matches the legacy flat card (bg-white border-oat rounded-2xl p-6) via tokens —
// non-owned surfaces keep their look. `raised` adds elevation; `locked` is the visible-but-
// locked cure shell. `size` retires GradeCard's `!p-7 !rounded-3xl` overrides.
const VARIANTS: Record<CardVariant, string> = {
  default: 'bg-surface-raised border border-oat',
  raised: 'bg-surface-raised border border-oat shadow-raised',
  locked: 'bg-surface-raised/60 border border-dashed border-oat',
};

const SIZES: Record<CardSize, string> = {
  sm: 'p-4 rounded-card',
  md: 'p-6 rounded-card',
  lg: 'p-7 rounded-card-lg',
};

const INTERACTIVE =
  'cursor-pointer transition-shadow hover:shadow-raised motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peach focus-visible:ring-offset-2 focus-visible:ring-offset-cream';

export function Card({
  children,
  variant = 'default',
  size = 'md',
  interactive = false,
  className = '',
  ...rest
}: Props) {
  return (
    <div
      className={`${VARIANTS[variant]} ${SIZES[size]} ${interactive ? INTERACTIVE : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
