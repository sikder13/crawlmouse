'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
import { sendLink, type LinkRequest, type SendOutcome } from './send-link';

export type SendState = 'idle' | 'verifying' | 'sending' | SendOutcome;

/**
 * Sends a sign-in link, asking Turnstile first when it is configured. The route requires a token
 * whenever Turnstile is enforced (always in production), and a token works once: the widget appears
 * when a send is asked for, the send goes as soon as the widget answers, and the widget is reset for
 * the next one, as LoginForm does. Without a site key (local development) it sends at once.
 */
export function useLinkSender(onSent?: (body: LinkRequest) => void) {
  const ref = useRef<TurnstileInstance | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [queued, setQueued] = useState<LinkRequest | null>(null);
  const [state, setState] = useState<SendState>('idle');
  const needed = turnstileEnabled(TURNSTILE_SITE_KEY);

  const send = useCallback(
    async (body: LinkRequest, turnstileToken?: string) => {
      setState('sending');
      const outcome = await sendLink({ ...body, turnstileToken });
      setState(outcome);
      if (outcome === 'sent') onSent?.(body);
    },
    [onSent],
  );

  useEffect(() => {
    if (!queued || !token) return;
    const body = queued;
    setQueued(null);
    setToken(null);
    ref.current?.reset();
    void send(body, token);
  }, [queued, token, send]);

  return {
    state,
    /** The widget, while a send waits for it; nothing otherwise. */
    widget:
      needed && (queued || state === 'verifying') ? (
        <Turnstile ref={ref} onToken={setToken} />
      ) : null,
    request(body: LinkRequest) {
      if (!needed) {
        void send(body);
        return;
      }
      setState('verifying');
      setQueued(body);
    },
  };
}
