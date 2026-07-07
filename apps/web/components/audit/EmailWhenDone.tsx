'use client';

import { useState } from 'react';
import { submitNotifyRequest } from '@/lib/notify-submit';

// SPEC 04 §2 — the calm email-me-when-done escape valve. Posts via lib/notify-submit (per-IP +
// per-email capped server-side; fires `email-captured` source='wait' on acceptance only). Never
// blocks or nags — one input, one quiet confirmation.

export function EmailWhenDone({ auditId }: { auditId: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || state === 'saving') return;
    setState('saving');
    setState(await submitNotifyRequest(auditId, email));
  }

  if (state === 'saved') {
    return (
      <div className="bg-white border border-oat rounded-2xl p-5 text-sm text-ink/70">
        We’ll email you when your report is ready. You can close this tab.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white border border-oat rounded-2xl p-5">
      <label htmlFor="notify-email" className="block text-sm text-ink/70 mb-2">
        Don’t want to wait? We’ll email you when it’s done.
      </label>
      <div className="flex gap-2">
        <input
          id="notify-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 border border-oat rounded-lg px-3 py-2 text-sm bg-cream/50 focus:outline-none focus:border-peach"
        />
        <button
          type="submit"
          disabled={state === 'saving'}
          className="bg-peach text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
        >
          {state === 'saving' ? 'Saving…' : 'Email me'}
        </button>
      </div>
      {state === 'error' && (
        <p className="mt-2 text-sm text-warning">Couldn’t save that address right now — the audit keeps running either way.</p>
      )}
    </form>
  );
}
