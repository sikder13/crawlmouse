'use client';

import { useRef, useState, type FormEvent } from 'react';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
import { track } from '@/lib/analytics';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Sign-in captcha is always-on when configured (the route also verifies it server-side).
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance>(undefined);
  const needToken = turnstileEnabled(TURNSTILE_SITE_KEY);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken: token ?? undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // One-time token can't be reused on a retry — reset the widget + clear it.
        widgetRef.current?.reset();
        setToken(null);
        setError(data.error ?? 'Could not send magic link');
        return;
      }
      setSent(true);
      track('email-captured', {});
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="max-w-md mx-auto px-6 pt-24 pb-32">
        <Card>
          <h1 className="font-display font-bold text-h2">Sign in</h1>
          {sent ? (
            <p className="mt-4 text-body text-ink">
              Check your inbox &mdash; we sent a magic link to <strong>{email}</strong>. It expires in 10 minutes; open it on any device.
            </p>
          ) : (
            <>
              {/* The signup value-moment (§6): no signup is needed to run an audit — this surface
                  asks only when there's a reason to (save, track, monitor), and names the payoff. */}
              <p className="mt-2 text-body text-ink-muted">
                Save every audit to your dashboard, track your grade over time, and unlock monitoring &mdash; free with an account. No password.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                <Input
                  type="email"
                  placeholder="you@yourstore.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Turnstile ref={widgetRef} onToken={setToken} />
                <Button type="submit" size="md" className="w-full" disabled={loading || !email || (needToken && !token)}>
                  {loading ? 'Sending...' : 'Send magic link'}
                </Button>
                {error && <div className="text-warning text-sm">{error}</div>}
              </form>
              <p className="mt-4 text-caption text-ink-muted">
                New here? The same link creates your account and claims any audits you&rsquo;ve already run.
              </p>
            </>
          )}
        </Card>
      </main>
      <Footer />
    </>
  );
}
