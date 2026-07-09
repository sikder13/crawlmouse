'use client';

import { useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { track } from '@/lib/analytics';
import { startVerification } from '@/lib/verify-start';
import { claimReport } from '@/lib/claim-report';

interface Props {
  slug: string;
  domain: string;
  // 'claim'  — non-owner entry: verify the domain, then come back and claim.
  // 'finish' — verified owner whose report isn't claimed yet: one-tap POST /claim.
  mode: 'claim' | 'finish';
  /** Refetch the ownership probe after a successful claim (R2 single source of truth). */
  onClaimed: () => void;
}

// SPEC 04.1 §2 — the claim entry on the /r/ owner island. It never gates anything itself: the server
// routes enforce auth → verified-domain ownership. It only routes the user through the EXISTING verify
// flow (reused, not rebuilt), carrying a `?next=` back to this report (R1), and fires `report_claimed`
// on a successful claim.
export function ClaimControl({ slug, domain, mode, onClaimed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // The return target back to THIS report — validated to a same-origin path by the verify page (R1).
  const nextParam = `?next=${encodeURIComponent(`/r/${slug}`)}`;

  async function startVerify(method: 'dns_txt' | 'meta_tag') {
    setBusy(true);
    setError(null);
    const result = await startVerification(domain, method);
    if (result.ok && result.redirectTo) {
      router.push(`${result.redirectTo}${nextParam}` as Route);
    } else if (result.authRequired) {
      router.push(`/login${nextParam}` as Route); // anon → sign in first, then return to claim (R1)
    } else {
      setError(result.error ?? 'Could not start verification');
      setBusy(false);
    }
  }

  async function finishClaim() {
    setBusy(true);
    setError(null);
    const r = await claimReport(slug, fetch);
    if (r.ok) {
      track('report_claimed', { slug });
      onClaimed(); // refetch → the island re-renders into the owner controls (R2)
      return;
    }
    if (r.error === 'auth_required') {
      router.push(`/login${nextParam}` as Route);
      return;
    }
    setError(
      r.error === 'verification_required'
        ? 'Verify your domain first.'
        : r.error === 'rate_limited'
          ? 'Too many attempts — please try again shortly.'
          : 'Could not claim — please try again.',
    );
    setBusy(false);
  }

  if (mode === 'finish') {
    return (
      <Card variant="raised" className="no-print">
        <Badge tone="sage">Domain verified</Badge>
        <h3 className="mt-2 font-display text-h3">Finish claiming this report</h3>
        <p className="mt-1 text-body text-ink-muted">
          You&rsquo;ve verified <strong>{domain}</strong>. Claim it to make this report yours — listed,
          indexable, badge unlocked, and brandable on Pro.
        </p>
        <Button className="mt-3" type="button" onClick={finishClaim} disabled={busy}>
          {busy ? 'Claiming…' : 'Finish claiming'}
        </Button>
        {error && <p className="mt-2 text-caption text-warning">{error}</p>}
      </Card>
    );
  }

  return (
    <Card variant="raised" className="no-print">
      <div className="text-overline uppercase text-ink-muted">Own this site?</div>
      <h3 className="mt-1 font-display text-h3">Claim this report</h3>
      <p className="mt-1 text-body text-ink-muted">
        Claiming makes this report <strong>yours</strong> — listed on leaderboards, indexable by Google,
        badge unlocked, and (on Pro) brandable with your own logo. Verify your domain to claim it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => startVerify('dns_txt')} disabled={busy}>
          {busy ? 'Starting…' : 'Verify via DNS'}
        </Button>
        <Button variant="secondary" type="button" onClick={() => startVerify('meta_tag')} disabled={busy}>
          Verify via meta tag
        </Button>
      </div>
      {error && <p className="mt-2 text-caption text-warning">{error}</p>}
    </Card>
  );
}
