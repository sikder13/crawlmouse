'use client';

import { useState, type FormEvent } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function TakedownPage() {
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/takedown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, requesterEmail: email, reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Could not submit');
        return;
      }
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="max-w-xl mx-auto px-6 pt-12 pb-32">
        <h1 className="font-display font-bold text-4xl tracking-tight">Takedown request</h1>
        <p className="text-ink/70 mt-3 mb-8">
          If a public Crawlmouse report about your domain shouldn&rsquo;t exist, submit this form. We&rsquo;ll verify domain ownership before removing.
        </p>
        {submitted ? (
          <Card>
            <p className="text-ink/80">Thanks. We received your request and will review within 2 business days.</p>
          </Card>
        ) : (
          <Card>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Domain</label>
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Your email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Reason</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} rows={4} className="w-full rounded-lg border border-oat bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-peach/50" />
              </div>
              <Button type="submit" disabled={busy}>Submit request</Button>
              {error && <div className="text-warning text-sm">{error}</div>}
            </form>
          </Card>
        )}
      </main>
      <Footer />
    </>
  );
}
