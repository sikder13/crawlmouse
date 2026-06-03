'use client';

import { forwardRef } from 'react';
import { Turnstile as MarsidevTurnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';

interface Props {
  /** Called with the token on a successful challenge, or null when the challenge errors/expires. */
  onToken: (token: string | null) => void;
  className?: string;
}

// Shared Turnstile widget. Renders nothing when no site key is configured so dev stays
// frictionless. The library component is declared with a `TurnstileInstance | undefined` ref,
// so the wrapper + consumers' refs must use that exact element type (no `any`, no @ts-ignore).
export const Turnstile = forwardRef<TurnstileInstance | undefined, Props>(function Turnstile(
  { onToken, className },
  ref,
) {
  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <MarsidevTurnstile
      ref={ref}
      siteKey={TURNSTILE_SITE_KEY}
      onSuccess={(token) => onToken(token)}
      onError={() => onToken(null)}
      onExpire={() => onToken(null)}
      options={{ theme: 'light', size: 'flexible' }}
      className={className}
    />
  );
});
