import type { ReactNode } from 'react';

export type BadgeTone = 'peach' | 'sage' | 'ink' | 'oat' | 'success' | 'warning' | 'info' | 'neutral';

// AA-safe text: ink on light fills, cream on ink (white-on-peach ~2.6:1 and white-on-sage
// ~3.1:1 fail WCAG AA — see contrast.ts). Grade tones (peach/sage/ink/oat) are preserved;
// status tones (success/warning/info/neutral) are additive.
const TONES: Record<BadgeTone, string> = {
  peach: 'bg-peach text-ink',
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
