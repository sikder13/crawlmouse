'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function UrlForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let parsed: URL;
    try {
      parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/audits/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: parsed.toString() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        return;
      }
      router.push(`/audit/${data.auditId}` as never);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          type="text"
          placeholder="https://your-store.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          invalid={!!error}
          disabled={submitting}
          autoFocus
          autoComplete="url"
        />
        <Button type="submit" size="lg" disabled={submitting || !url}>
          {submitting ? 'Starting...' : 'Grade it →'}
        </Button>
      </div>
      {error && <div className="mt-2 text-warning text-sm">{error}</div>}
      <div className="mt-3 text-xs text-ink/50">No signup needed. Free for the first audit per domain per 24h.</div>
    </form>
  );
}
