'use client';

import { useState } from 'react';
import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import { track } from '@/lib/analytics';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { type ShareChannel, shareIntentUrl, shareMessage } from './share-intents';

const CHANNELS: { id: ShareChannel; label: string }[] = [
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'facebook', label: 'Facebook' },
];

// The designed share moment (§3/§4, Part 4): grade-forward + grade-adaptive copy, worldwide
// multi-channel intents (LinkedIn/WhatsApp/Telegram included), copy-link, and a claim/leaderboard
// hook. Share text carries the grade (never crawled content); intent URLs are whitelisted + encoded.
export function ShareSurface({ audit, shareUrl }: { audit: ClientAuditV2; shareUrl?: string }) {
  const [copied, setCopied] = useState(false);
  if (audit.grade == null || audit.score == null) return null;

  const url = shareUrl ?? (typeof window !== 'undefined' ? window.location.href : 'https://crawlmouse.com');
  const msg = shareMessage(audit.grade, audit.score);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track('public-share-clicked', { channel: 'copy', grade: audit.grade });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave state unchanged
    }
  }

  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">Share your grade</div>
      <p className="mt-2 text-body">{msg.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <a
            key={c.id}
            href={shareIntentUrl(c.id, url, msg.text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('public-share-clicked', { channel: c.id, grade: audit.grade })}
          >
            <Button variant="secondary" size="sm">
              {c.label}
            </Button>
          </a>
        ))}
        <Button variant="secondary" size="sm" type="button" onClick={copyLink}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </Button>
      </div>
      <p className="mt-3 text-caption text-ink-muted">
        Verify your domain to mint a public report with a shareable grade card and land on the{' '}
        <span className="font-medium text-ink">leaderboard</span>.
      </p>
    </Card>
  );
}
