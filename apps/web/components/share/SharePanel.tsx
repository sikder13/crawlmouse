'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Props { auditId: string }

export function SharePanel({ auditId }: Props) {
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationDomain, setVerificationDomain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auditId }),
      });
      const data = await res.json();
      if (data.error === 'verification_required') {
        setVerificationDomain(data.domain);
      } else if (data.slug) {
        setSlug(data.slug);
      } else {
        setError(data.error ?? 'Could not create public link');
      }
    } finally {
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
          <Button size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied!' : 'Copy'}</Button>
        </div>
        <a href={tweet} target="_blank" rel="noreferrer" className="inline-block bg-ink text-cream px-4 py-2 rounded-lg text-sm font-medium">Tweet your grade</a>
      </Card>
    );
  }

  if (verificationDomain) {
    return (
      <Card className="border-peach border-2">
        <div className="font-display font-bold text-xl mb-2">Verify <code className="font-mono text-base">{verificationDomain}</code> first</div>
        <p className="text-ink/70 text-sm mb-4">Public reports can only be minted by verified domain owners. This prevents anyone from publishing a Crawlmouse report about a site they don&rsquo;t own.</p>
        <Link href={{ pathname: '/dashboard' } as never}><Button>Start verification</Button></Link>
      </Card>
    );
  }

  return (
    <Card>
      <div className="font-display font-bold text-xl mb-2">Share this report</div>
      <p className="text-ink/70 text-sm mb-4">Generate a public, shareable URL with an auto-rendered social card. Only available if you&rsquo;ve verified domain ownership.</p>
      <Button onClick={mint} disabled={busy}>{busy ? 'Working...' : 'Make public'}</Button>
      {error && <div className="text-warning text-sm mt-2">{error}</div>}
    </Card>
  );
}
