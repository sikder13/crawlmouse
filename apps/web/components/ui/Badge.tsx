import type { ReactNode } from 'react';

export type BadgeTone = 'peach' | 'sage' | 'ink' | 'oat' | 'success' | 'warning' | 'info' | 'neutral';

// The peach/accent badge uses the darkened accent-fill with WHITE text (AA 4.60:1). Other fills
// carry ink/cream (white-on-sage/warning fail AA — see contrast.ts). Grade tones
// (peach/sage/ink/oat) are preserved; status tones (success/warning/info/neutral) are additive.
const TONES: Record<BadgeTone, string> = {
  peach: 'bg-accent-fill text-white',
  sage: 'bg-sage text-ink',
  ink: 'bg-ink text-cream',
  oat: 'bg-oat text-ink',
  success: 'bg-sage text-ink',
  warning: 'bg-warning text-ink',
  info: 'bg-peach-light text-ink',
  neutral: 'bg-oat text-ink',
};

export function Badge({ tone = 'peach', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-block text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
