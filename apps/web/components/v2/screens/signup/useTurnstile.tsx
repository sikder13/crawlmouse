'use client';

import { useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';

/**
 * The Turnstile widget for a form that asks for a sign-in link. The route requires a token whenever
 * Turnstile is enforced (always in production), and a token works once, so `spend` hands it over and
 * resets the widget for the next send, as LoginForm does. Without a site key (local development)
 * the widget renders nothing and no token is needed.
 */
export function useTurnstile() {
  const ref = useRef<TurnstileInstance | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const needed = turnstileEnabled(TURNSTILE_SITE_KEY);

  return {
    /** True when the form must wait for the widget before it can send. */
    waiting: needed && !token,
    widget: needed ? <Turnstile ref={ref} onToken={setToken} /> : null,
    spend(): string | undefined {
      const t = token ?? undefined;
      setToken(null);
      ref.current?.reset();
      return t;
    },
  };
}
