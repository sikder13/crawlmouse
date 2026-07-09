'use client';

import { useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { Button, buttonClasses } from '../ui/Button';
import { Card } from '../ui/Card';
import { type ShareChannel, shareIntentUrl, shareMessage } from './share-intents';
import { reportShareUrl, withRef } from '@/lib/share-url';
import { mintReport } from '@/lib/mint-share';

const CHANNELS: { id: ShareChannel; label: string }[] = [
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'facebook', label: 'Facebook' },
];

interface Props {
  grade: string;
  score: number;
  // Report context: an already-public /r/ URL to share directly. Reveal context: the audit id to mint
  // one-step into a /r/ URL. `auditId` WINS — at the reveal we must NEVER share the capability URL.
  shareUrl?: string;
  auditId?: string;
  // compact: the impulse-capture row on the grade card (D1). full: the richer bottom section.
  compact?: boolean;
}

// The designed share moment (§6, Part 4): grade-forward + grade-adaptive copy, worldwide multi-channel
// intents + copy-link. Share text carries the grade only (never crawled content); intent URLs are
// whitelisted + encoded. At the grade reveal (`auditId`) the first share action MINTS the audit into a
// public report and shares that /r/ URL — never the private capability URL — with a ?ref for attribution.
export function ShareSurface({ grade, score, shareUrl, auditId, compact = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In-flight guard as a REF (not the async `minting` state) so a fast double-click can't fire two mints
  // before the disabled-state re-render commits.
  const mintingRef = useRef(false);
  const msg = shareMessage(grade, score);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://crawlmouse.com';

  // Reveal flow: mint first (channels appear only once the /r/ slug exists). Report flow: use shareUrl.
  const mintMode = auditId != null;
  const showChannels = slug != null || (!mintMode && shareUrl != null);
  // The per-channel share URL: the minted /r/ slug wins; else the passed report URL; NEVER the
  // capability URL (window.location on /audit/[id]). Each carries ?ref for the K measurement (§13).
  const urlFor = (ref: ShareChannel | 'copy'): string =>
    slug ? reportShareUrl(origin, slug, ref) : withRef(shareUrl ?? origin, ref);
  // The public report URL to view / download, once one exists (a minted slug wins; else a passed
  // report URL) — never the private capability URL. Drives the "View your report" affordance (§5).
  const reportUrl = slug ? `${origin}/r/${slug}` : shareUrl ?? null;

  async function mint() {
    if (!auditId || mintingRef.current) return;
    mintingRef.current = true;
    setMinting(true);
    setError(null);
    const r = await mintReport(auditId, fetch, track);
    if (r.ok) setSlug(r.slug);
    // Distinguish the daily-cap case (a bare retry would just re-hit the 429) from a transient error.
    else setError(r.error === 'captcha_required'
      ? 'You’ve hit today’s sharing limit — please try again tomorrow.'
      : 'Could not create a shareable link — please try again.');
    setMinting(false);
    mintingRef.current = false;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(urlFor('copy'));
      setCopied(true);
      track('share_completed', { channel: 'copy', grade });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave state unchanged
    }
  }

  const channelLinks = CHANNELS.map((c) => (
    <a
      key={c.id}
      href={shareIntentUrl(c.id, urlFor(c.id), msg.text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('share_completed', { channel: c.id, grade })}
      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
    >
      {c.label}
    </a>
  ));
  const copyBtn = (
    <Button variant="secondary" size="sm" type="button" onClick={copyLink}>
      {copied ? 'Copied ✓' : 'Copy link'}
    </Button>
  );
  // The one-step mint affordance shown at the reveal until the public link exists.
  const mintCta = (
    <Button size="sm" type="button" onClick={mint} disabled={minting}>
      {minting ? 'Creating your report…' : 'Get your free report'}
    </Button>
  );
  const controls = showChannels ? (<>{channelLinks}{copyBtn}</>) : mintCta;

  if (compact) {
    // SPEC 04.2 FIX 4 — PRE-MINT, the top grade card LEADS with a prominent primary "Get your free report"
    // CTA (the eye lands here right after the grade), framed by its value prop — not a bare button that reads
    // as a share action. POST-MINT (once the /r/ slug exists) it becomes the compact "Share it:" channel row.
    // Display/layout ONLY: `showChannels`, `controls`, and the mint flow are unchanged.
    if (!showChannels) {
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-body text-ink-muted">
            Get a <span className="font-medium text-ink">shareable, client-ready report</span> for this grade — one click, no sign-up.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {controls}
            {error && <span className="text-caption text-warning">{error}</span>}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption font-medium text-ink-muted">Share it:</span>
        {controls}
        {error && <span className="text-caption text-warning">{error}</span>}
      </div>
    );
  }

  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">Get your free report</div>
      <p className="mt-2 text-body">{msg.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">{controls}</div>
      {error && <p className="mt-2 text-caption text-warning">{error}</p>}
      {reportUrl && (
        <>
          <p className="mt-3 text-caption">
            <a href={reportUrl} className="font-medium text-peach underline">View your report</a> — or download it as a PDF from the report page.
          </p>
          {/* Honest reframing (§5): verification is the CLAIM step, never a precondition to mint/share. */}
          <p className="mt-2 text-caption text-ink-muted">
            Minting is free and instant — no verification needed. Want it on leaderboards, indexed by Google,
            and branded with your logo? <span className="font-medium text-ink">Claim</span> the report from its
            page (Pro adds white-label).
          </p>
        </>
      )}
    </Card>
  );
}
