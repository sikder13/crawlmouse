import type { ReactNode } from 'react';

export type BadgeTone = 'peach' | 'sage' | 'ink' | 'oat' | 'success' | 'warning' | 'info' | 'neutral';

// Solid saturated fills (peach/sage/warning) use the darkened *-fill tokens with WHITE text (all
// AA — see contrast.ts). ink = cream text. Light-tint chips (oat/info/neutral) keep ink text —
// white is invisible on a light tint. Grade tones + additive status tones.
const TONES: Record<BadgeTone, string> = {
  peach: 'bg-accent-fill text-white',
  sage: 'bg-sage-fill text-white',
  ink: 'bg-ink text-cream',
  oat: 'bg-oat text-ink',
  success: 'bg-sage-fill text-white',
  warning: 'bg-warning-fill text-white',
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
