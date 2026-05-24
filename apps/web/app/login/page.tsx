'use client';

import { useState, type FormEvent } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not send magic link');
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="max-w-md mx-auto px-6 pt-24 pb-32">
        <Card>
          <h1 className="font-display font-bold text-3xl">Sign in</h1>
          {sent ? (
            <p className="mt-4 text-ink/80">
              Check your inbox &mdash; we sent a magic link to <strong>{email}</strong>. The link expires in 10 minutes.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink/60">Enter your email and we&rsquo;ll send you a one-time sign-in link. No password.</p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                <Input
                  type="email"
                  placeholder="you@yourstore.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" size="md" className="w-full" disabled={loading || !email}>
                  {loading ? 'Sending...' : 'Send magic link'}
                </Button>
                {error && <div className="text-warning text-sm">{error}</div>}
              </form>
            </>
          )}
        </Card>
      </main>
      <Footer />
    </>
  );
}
