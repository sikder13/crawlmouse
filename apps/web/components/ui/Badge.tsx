import type { ReactNode } from 'react';

type Tone = 'peach' | 'sage' | 'ink' | 'oat';

const TONES: Record<Tone, string> = {
  peach: 'bg-peach text-white',
  sage: 'bg-sage text-white',
  ink: 'bg-ink text-cream',
  oat: 'bg-oat text-ink',
};

export function Badge({ tone = 'peach', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${TONES[tone]}`}>
      {children}
    </span>
  );
}
