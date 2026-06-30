'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { track } from '@/lib/analytics';
import { reauditEffects, reauditOutcome } from './dashboard-logic';
import { ReauditButtonView } from './ReauditButtonView';

// One-tap re-audit (the audit → fix → re-audit → watch-it-climb loop as one action). Consumes SPEC 02's
// POST /api/audits/[id]/reaudit → ReauditResponse.newAuditId → /audit/[newId]. FIX 1: it SURFACES every
// non-200 (notably the 429 captcha_required when the audit bucket is exhausted) the same way the /start
// form does — the on-demand Turnstile + an inline alert — instead of silently resetting.
export function ReauditButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance>(undefined);

  async function reaudit() {
    setRunning(true);
    setError(null);
    track('reaudit_clicked', { auditId });
    try {
      const res = await fetch(`/api/audits/${auditId}/reaudit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken: token ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));
      const eff = reauditEffects(reauditOutcome(res.ok, data));
      if ('navigateTo' in eff) {
        router.push(`/audit/${eff.navigateTo}`);
        return;
      }
      // Every non-navigate outcome resets the one-time Turnstile token (a token can't be reused, and on
      // a REPEAT captcha re-sending the consumed token would loop) — the rule locked by reauditEffects.
      widgetRef.current?.reset();
      setToken(null);
      if (eff.showCaptcha) setCaptchaRequired(true);
      setError(eff.error);
      setRunning(false);
    } catch {
      widgetRef.current?.reset();
      setToken(null);
      setError('Network error. Please try again.');
      setRunning(false);
    }
  }

  return (
    <ReauditButtonView
      running={running}
      error={error}
      captchaRequired={captchaRequired}
      disabled={captchaRequired && !token}
      onReaudit={reaudit}
      onToken={setToken}
      widgetRef={widgetRef}
    />
  );
}
