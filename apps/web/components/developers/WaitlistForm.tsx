'use client';

import { useRef, useState, type FormEvent } from 'react';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';

const ERROR_COPY: Record<string, string> = {
  rate_limited: 'Whoa, speedy. You’ve hit today’s signup limit — try again tomorrow.',
  captcha_failed: 'That challenge didn’t check out. Mind giving it another go?',
  'invalid input': 'That doesn’t look like a valid email. Double-check and retry.',
};

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Waitlist captcha is always-on when configured (the route also verifies it server-side).
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance>(undefined);
  const needToken = turnstileEnabled(TURNSTILE_SITE_KEY);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/developers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken: token ?? undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // One-time token can't be reused on a retry — reset the widget + clear it.
        widgetRef.current?.reset();
        setToken(null);
        setError(ERROR_COPY[data.error as string] ?? 'Something went sideways. Please try again.');
        return;
      }
      setDone(true);
    } catch {
      widgetRef.current?.reset();
      setToken(null);
      setError('Something went sideways. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-lg font-display font-bold text-sage">You&rsquo;re on the list 🐭</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        type="email"
        placeholder="you@yourcompany.dev"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        aria-label="Email address"
      />
      <Turnstile ref={widgetRef} onToken={setToken} />
      <Button type="submit" size="md" className="w-full" disabled={busy || !email || (needToken && !token)}>
        {busy ? 'Signing you up...' : 'Get early access'}
      </Button>
      {error && <div className="text-warning text-sm">{error}</div>}
    </form>
  );
}
