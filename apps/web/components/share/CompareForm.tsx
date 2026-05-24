'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function CompareForm() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const start = async (url: string) => {
        const u = url.startsWith('http') ? url : `https://${url}`;
        const res = await fetch('/api/audits/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: u }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'failed');
        return data.auditId as string;
      };
      const [idA, idB] = await Promise.all([start(a), start(b)]);
      router.push({ pathname: `/audit/${idA}?compare=${idB}` } as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Your site</label>
        <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="https://your-store.com" autoFocus />
      </div>
      <div>
        <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Competitor</label>
        <Input value={b} onChange={(e) => setB(e.target.value)} placeholder="https://competitor.com" />
      </div>
      <Button type="submit" size="lg" disabled={busy || !a || !b} className="w-full">{busy ? 'Starting both...' : 'Compare →'}</Button>
      {error && <div className="text-warning text-sm">{error}</div>}
    </form>
  );
}
