'use client';

import { useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { track } from '@/lib/analytics';
import { startVerification } from '@/lib/verify-start';

interface Props { auditId: string }

export function SharePanel({ auditId }: Props) {
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationDomain, setVerificationDomain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auditId }),
      });
      const data = await res.json().catch(() => ({} as Record<string, string>));
      // DEAD post-SPEC-04 (§5): the mint route no longer returns `verification_required` (minting is
      // open + auth-optional), so this branch is unreachable. Kept, not deleted — flagged for the PR.
      if (data.error === 'verification_required') {
        setVerificationDomain(data.domain);
      } else if (data.slug) {
        setSlug(data.slug);
        track('public-share-clicked', { slug: data.slug });
      } else {
        setError(data.error ?? 'Could not create public link');
      }
    } finally {
      setBusy(false);
    }
  }

  async function startVerify(method: 'dns_txt' | 'meta_tag') {
    if (!verificationDomain) return;
    setBusy(true);
    setError(null);
    const result = await startVerification(verificationDomain, method);
    if (result.ok && result.redirectTo) {
      router.push(result.redirectTo as Route);
    } else {
      setError(result.error ?? 'Could not start verification');
      setBusy(false);
    }
  }

  if (slug) {
    const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/r/${slug}`;
    const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Crawlmouse just graded my site: ${publicUrl}`)}`;
    return (
      <Card>
        <div className="font-display font-bold text-xl mb-3">Your public report is live</div>
        <div className="flex items-center gap-2 mb-3">
          <code className="font-mono text-sm bg-oat px-3 py-2 rounded flex-1 break-all">{publicUrl}</code>
          <Button size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setError('Copy failed — select the URL manually.')); }}>{copied ? 'Copied!' : 'Copy'}</Button>
        </div>
        <p className="text-ink/70 text-sm mb-3">
          <a href={publicUrl} className="text-peach underline font-medium">View your report</a> — or download it as a PDF from the report page.
        </p>
        <a href={tweet} target="_blank" rel="noreferrer" className="inline-block bg-ink text-cream px-4 py-2 rounded-lg text-sm font-medium">Tweet your grade</a>
      </Card>
    );
  }

  // DEAD post-SPEC-04 (§5, flagged for the PR — kept, not deleted): `verificationDomain` is never set
  // now that minting is open, so this whole branch is unreachable. Copy corrected anyway so it can never
  // mislead: verification is the CLAIM step (makes the report yours), not a precondition to mint.
  if (verificationDomain) {
    return (
      <Card className="border-peach border-2">
        <div className="font-display font-bold text-xl mb-2">Claim <code className="font-mono text-base">{verificationDomain}</code></div>
        <p className="text-ink/70 text-sm mb-4">Minting is free and needs no verification. Verifying your domain <strong>claims</strong> the report — it becomes yours: listed, indexable, badge unlocked, and brandable on Pro.</p>
        <p className="text-ink/70 text-sm mb-3">Choose how you&rsquo;d like to prove ownership:</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => startVerify('dns_txt')} disabled={busy}>{busy ? 'Starting…' : 'Verify via DNS record'}</Button>
          <Button variant="secondary" onClick={() => startVerify('meta_tag')} disabled={busy}>Verify via meta tag</Button>
        </div>
        {error && <div className="text-warning text-sm mt-2">{error}</div>}
      </Card>
    );
  }

  return (
    <Card>
      <div className="font-display font-bold text-xl mb-2">Get your free report</div>
      <p className="text-ink/70 text-sm mb-4">Generate a public, shareable report URL with an auto-rendered social card — free and instant, no verification needed. Claiming it later (verify your domain) makes the report yours: listed, indexable, and brandable on Pro.</p>
      <Button onClick={mint} disabled={busy}>{busy ? 'Working...' : 'Get your free report'}</Button>
      {error && <div className="text-warning text-sm mt-2">{error}</div>}
    </Card>
  );
}
