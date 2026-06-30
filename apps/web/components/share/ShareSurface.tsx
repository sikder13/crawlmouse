'use client';

import { useState } from 'react';
import { track } from '@/lib/analytics';
import { Button, buttonClasses } from '../ui/Button';
import { Card } from '../ui/Card';
import { type ShareChannel, shareIntentUrl, shareMessage } from './share-intents';

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
  shareUrl?: string;
  // compact: the impulse-capture row on the grade card (D1). full: the richer bottom section.
  compact?: boolean;
}

// The designed share moment (§3/§4, Part 4): grade-forward + grade-adaptive copy, worldwide
// multi-channel intents + copy-link. Share text carries the grade (never crawled content); intent
// URLs are whitelisted + encoded. `compact` renders the on-card impulse row at the reveal peak.
export function ShareSurface({ grade, score, shareUrl, compact = false }: Props) {
  const [copied, setCopied] = useState(false);
  const url = shareUrl ?? (typeof window !== 'undefined' ? window.location.href : 'https://crawlmouse.com');
  const msg = shareMessage(grade, score);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track('public-share-clicked', { channel: 'copy', grade });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave state unchanged
    }
  }

  const channelLinks = CHANNELS.map((c) => (
    <a
      key={c.id}
      href={shareIntentUrl(c.id, url, msg.text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('public-share-clicked', { channel: c.id, grade })}
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

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption font-medium text-ink-muted">Share your grade:</span>
        {channelLinks}
        {copyBtn}
      </div>
    );
  }

  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">Share your grade</div>
      <p className="mt-2 text-body">{msg.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {channelLinks}
        {copyBtn}
      </div>
      <p className="mt-3 text-caption text-ink-muted">
        Verify your domain to mint a public report with a shareable grade card and land on the{' '}
        <span className="font-medium text-ink">leaderboard</span>.
      </p>
    </Card>
  );
}
