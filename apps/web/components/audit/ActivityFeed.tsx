'use client';

import { useEffect, useRef } from 'react';
import type { CrawlActivityEvent } from '@crawlmouse/types';

// SPEC 04 §2 — the live activity feed: a compact, auto-scrolling projection of REAL crawl events
// (nothing here is synthetic; an empty feed says so honestly). Labels are attacker-controlled
// crawled content (URL paths/titles) rendered exclusively as React text nodes — inert by
// construction, never markup.

const DISPLAY_CAP = 8;

const KIND_ICON: Record<string, string> = {
  fetch_ok: '✓',
  fetch_blocked: '⚠',
  fetch_dead: '✕',
  sitemap_seeded: '◈',
  cms_detected: '◈',
  finding_preview: '●',
  phase: '▸',
};

const KIND_TONE: Record<string, string> = {
  fetch_ok: 'text-sage',
  fetch_blocked: 'text-warning',
  fetch_dead: 'text-ink/40',
  sitemap_seeded: 'text-peach',
  cms_detected: 'text-peach',
  finding_preview: 'text-peach',
  phase: 'text-ink/70',
};

export function ActivityFeed({ events }: { events: CrawlActivityEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const visible = events.slice(-DISPLAY_CAP);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-ink/50 mb-3">Live crawl activity</div>
      <div aria-live="polite" className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-sm">
        {visible.length === 0 && (
          <div className="text-ink/50">Waiting for the first pages…</div>
        )}
        {visible.map((e) => (
          <div key={e.seq} className="flex gap-2 items-baseline">
            <span aria-hidden className={KIND_TONE[e.kind] ?? 'text-ink/60'}>{KIND_ICON[e.kind] ?? '•'}</span>
            <span className="text-ink/80 break-all">{e.label}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
