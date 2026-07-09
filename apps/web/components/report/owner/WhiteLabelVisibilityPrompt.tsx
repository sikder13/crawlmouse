'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { track } from '@/lib/analytics';
import { saveVisibility } from '@/lib/visibility-save';

interface Props {
  slug: string;
  /** Called once the owner has chosen (either way) — closes the prompt + refetches (R2). */
  onResolved: () => void;
}

// SPEC 04.1 §4 — shown the moment white-label turns ON. A white-labeled report is usually a private
// client deliverable, so PRIVATE is the recommended, one-tap default — but never a silent flip: the
// owner explicitly chooses, and can change it later from the visibility controls. Both choices write
// THROUGH the visibility route (the enable already defaulted it unlisted+noindex; this confirms or
// overrides). Keeping it public fires `leaderboard_opt_in` (§7).
export function WhiteLabelVisibilityPrompt({ slug, onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(makePublic: boolean) {
    setBusy(true);
    setError(null);
    const r = await saveVisibility(slug, { listed: makePublic, indexable: makePublic }, fetch);
    if (!r.ok) {
      // Don't silently close on failure — the report would stay private and the owner wouldn't know.
      setError(r.error === 'rate_limited' ? 'Too many changes — please try again shortly.' : 'Could not save — please try again.');
      setBusy(false);
      return;
    }
    if (makePublic) track('leaderboard_opt_in', { slug });
    onResolved();
  }

  return (
    <Card variant="raised" className="no-print border-peach">
      <div className="text-overline uppercase text-ink-muted">One quick choice</div>
      <p className="mt-2 text-body">
        White-labeled reports are usually <strong>private client deliverables</strong>. Keep this one
        unlisted and out of Google, or keep it public on your leaderboards?
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" type="button" disabled={busy} onClick={() => choose(false)}>
          Keep it private (recommended)
        </Button>
        <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => choose(true)}>
          Keep it public
        </Button>
      </div>
      {error && <p className="mt-2 text-caption text-warning">{error}</p>}
    </Card>
  );
}
