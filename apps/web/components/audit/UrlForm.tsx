'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Turnstile } from '@/components/ui/Turnstile';
import { track } from '@/lib/analytics';

export function UrlForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Captcha only appears AFTER the funnel trips the per-IP limit (a `captcha_required` 429),
  // so the common below-the-limit path stays friction-free.
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance>(undefined);
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
        body: JSON.stringify({ url: parsed.toString(), turnstileToken: token ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'captcha_required') {
          // Surface the widget on demand; keep the entered URL so the next submit just adds the token.
          setCaptchaRequired(true);
          setError('Quick check: please confirm you’re human, then try again.');
          return;
        }
        // Any other failure: a one-time token can't be reused, so reset the widget + clear it.
        widgetRef.current?.reset();
        setToken(null);
        setError(data.error ?? 'Something went wrong');
        return;
      }
      track('audit-submitted', { domain: parsed.hostname });
      router.push(`/audit/${data.auditId}` as never);
    } catch {
      widgetRef.current?.reset();
      setToken(null);
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
        <Button type="submit" size="lg" disabled={submitting || !url || (captchaRequired && !token)}>
          {submitting ? 'Starting...' : 'Grade it →'}
        </Button>
      </div>
      {captchaRequired && <Turnstile ref={widgetRef} onToken={setToken} className="mt-3" />}
      {error && <div className="mt-2 text-warning text-sm">{error}</div>}
      <div className="mt-3 text-xs text-ink/50">No signup needed. Free for the first audit per domain per hour.</div>
    </form>
  );
}
