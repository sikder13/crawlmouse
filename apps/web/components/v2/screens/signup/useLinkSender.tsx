'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
import { sendLink, type LinkRequest, type SendOutcome } from './send-link';

export type SendState = 'idle' | 'verifying' | 'sending' | SendOutcome;

/** How long a send waits for the Turnstile widget before it gives up (a blocked script never answers). */
export const VERIFY_TIMEOUT_MS = 60_000;

/** What the forms say while the widget is asked. */
export const VERIFYING_COPY = 'One check that you are a person, then the link is sent.';

/**
 * Sends a sign-in link, asking Turnstile first when it is configured. The route requires a token
 * whenever Turnstile is enforced (always in production), and a token works once: the widget appears
 * when a send is asked for, the send goes as soon as the widget answers, and the widget is reset for
 * the next one, as LoginForm does. A widget that fails, expires or never answers within
 * VERIFY_TIMEOUT_MS ends the wait as `verification`, so the form can be sent again. Without a site
 * key (local development) it sends at once.
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

  const giveUp = useCallback(() => {
    setQueued(null);
    setToken(null);
    setState('verification');
  }, []);

  useEffect(() => {
    if (!queued || !token) return;
    const body = queued;
    setQueued(null);
    setToken(null);
    ref.current?.reset();
    void send(body, token);
  }, [queued, token, send]);

  useEffect(() => {
    if (!queued) return;
    const t = window.setTimeout(giveUp, VERIFY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [queued, giveUp]);

  const onToken = useCallback(
    (t: string | null) => {
      if (t) setToken(t);
      else giveUp();
    },
    [giveUp],
  );

  return {
    state,
    /** The widget, while a send waits for it; nothing otherwise. */
    widget: needed && queued ? <Turnstile ref={ref} onToken={onToken} /> : null,
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
