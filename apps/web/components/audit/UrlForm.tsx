'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Turnstile } from '@/components/ui/Turnstile';
import { track } from '@/lib/analytics';
import { submitAuditRequest, shouldAutoResubmit } from '@/lib/submit-audit';

export function UrlForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Captcha only appears AFTER the funnel trips the per-IP limit (a `captcha_required` 429),
  // so the common below-the-limit path stays friction-free.
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  // Armed when a `captcha_required` came back; the NEXT Turnstile token then auto-continues the submit
  // (no manual second click). Disarmed once it fires so a later token (e.g. a widget reset after an
  // unrelated error) can't loop.
  const autoSubmitOnToken = useRef(false);
  const widgetRef = useRef<TurnstileInstance>(undefined);
  const router = useRouter();

  async function runSubmit(currentToken: string | null) {
    setError(null);
    setSubmitting(true);
    const outcome = await submitAuditRequest(url, currentToken);
    setSubmitting(false);
    switch (outcome.kind) {
      case 'invalid-url':
        setError('Please enter a valid URL');
        return;
      case 'captcha':
        // Surface the widget; the next token auto-continues (no manual second click).
        setCaptchaRequired(true);
        autoSubmitOnToken.current = true;
        setError('One quick check that you’re human — verifying…');
        return;
      case 'error':
        // A one-time Turnstile token can't be reused, so reset the widget + clear it.
        widgetRef.current?.reset();
        setToken(null);
        setError(outcome.message);
        return;
      case 'navigate':
        track('audit-submitted', { domain: outcome.domain });
        router.push(`/audit/${outcome.auditId}` as never);
        return;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runSubmit(token);
  }

  // Turnstile verified → auto-continue the submit with the fresh token, so the human flows straight
  // into the audit instead of having to click "Grade it" a second time.
  function handleToken(t: string | null) {
    setToken(t);
    if (shouldAutoResubmit(t, autoSubmitOnToken.current, submitting)) {
      autoSubmitOnToken.current = false;
      void runSubmit(t);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          type="text"
          placeholder="https://your-store.com"
          aria-label="Website URL to audit"
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
      {captchaRequired && <Turnstile ref={widgetRef} onToken={handleToken} className="mt-3" />}
      {error && <div className="mt-2 text-warning text-sm">{error}</div>}
      <div className="mt-3 text-xs text-ink/50">No signup needed. Free — re-audit the same site a few times per hour.</div>
    </form>
  );
}
