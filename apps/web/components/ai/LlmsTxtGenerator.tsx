'use client';

import { useState } from 'react';
import { track } from '@/lib/analytics';
import { Button } from '../ui/Button';

// PRO — generate + download llms.txt for this audit. Owner+Pro gating is enforced SERVER-SIDE by the route
// (401 auth / 402 pro / 404 owner); this is a thin client trigger. Honest framing (§8, no ranking claim):
// llms.txt is read mainly by AI coding agents today, not consumed by AI search engines.
export function LlmsTxtGenerator({ auditId }: { auditId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/llms-txt`);
      if (!res.ok) {
        setError('Could not generate llms.txt. Please try again.');
        return;
      }
      const text = await res.text();
      const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = href;
      a.download = 'llms.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      track('llms_txt_generated');
    } catch {
      setError('Could not generate llms.txt. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="secondary" size="sm" onClick={generate} loading={loading}>
        Generate llms.txt
      </Button>
      <p className="mt-2 max-w-prose text-caption text-ink-muted">
        llms.txt is read mainly by AI coding agents — it is not consumed by AI search engines as of 2026,
        so it doesn&rsquo;t change how you rank or get cited.
      </p>
      {error ? (
        <p className="mt-2 text-caption text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
