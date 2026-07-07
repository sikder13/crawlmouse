import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crawlAndPersist } from './audit';
import type { CrawlActivity } from '@crawlmouse/types';

// SPEC 04 §2 — the worker wiring around the batcher:
//   - crawlAndPersist hands the batcher's listener to runAudit as onProgress;
//   - after the crawl it emits finding_preview lines derived from the REAL computed findings
//     (honest early value while the slow persist runs) and a 'persisting' phase;
//   - the FINAL flush lands BEFORE persistAuditResults so activity is visible during persist;
//   - the grade/score NEVER appear in any activity label (grade-never-early);
//   - the notify-email send is a step in auditFn's existing flow (ruling 7: no new Inngest
//     function, zero app-sync risk) — pinned in source with the never-throw contract.

const RESULT = {
  url: 'https://x.com',
  cms: 'custom',
  cmsConfidence: 1,
  cmsMetadata: {},
  grade: 'B+',
  score: 82,
  breakdown: { orphanRatioScore: 1, depthScore: 1, anchorDiversityScore: 1, structureScore: 1 },
  startedAt: new Date(),
  completedAt: new Date(),
  pages: [{ url: 'https://x.com', urlHash: 'h', statusCode: 200, depth: 0, inDegree: 0, outDegree: 1, isOrphan: false }],
  links: [],
  findings: [
    { category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/lost-1' },
    { category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/lost-2' },
    { category: 'deep_page', severity: 'medium', pageUrl: 'https://x.com/deep', payload: { depth: 5 } },
  ],
};

function fakeBatcher() {
  const events: CrawlActivity[] = [];
  const order: string[] = [];
  return {
    events,
    order,
    batcher: {
      onActivity: (a: CrawlActivity) => events.push(a),
      flush: vi.fn(async () => { order.push('flush'); }),
    },
  };
}

describe('crawlAndPersist — progress wiring (SPEC 04 §2)', () => {
  it('passes the batcher listener to runAudit, previews REAL findings, and flushes BEFORE persist', async () => {
    const { events, order, batcher } = fakeBatcher();
    let receivedOnProgress: ((a: CrawlActivity) => void) | undefined;
    const runAudit = vi.fn(async (opts: { onProgress?: (a: CrawlActivity) => void }) => {
      receivedOnProgress = opts.onProgress;
      return RESULT;
    });
    const persistAuditResults = vi.fn(async () => { order.push('persist'); });

    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { __sb: true } as any,
      { auditId: 'aud-1', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any, createBatcher: () => batcher as any },
    );

    // The engine seam received the batcher's listener (real events flow worker-side).
    expect(receivedOnProgress).toBe(batcher.onActivity);
    // Real finding previews were emitted from the computed result — counts, not fabrications.
    const previews = events.filter((e) => e.kind === 'finding_preview');
    expect(previews.length).toBeGreaterThanOrEqual(1);
    expect(previews.some((e) => /2 orphan pages/i.test(e.label))).toBe(true);
    // The grade NEVER leaks into activity (grade-never-early).
    for (const e of events) expect(e.label).not.toMatch(/\bB\+|\b82\b|grade/i);
    // A real 'persisting' phase precedes the persist write, and the final flush lands first.
    expect(events.some((e) => e.kind === 'phase' && e.phase === 'persisting')).toBe(true);
    expect(order.indexOf('flush')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('persist'));
  });

  it('emits NO finding previews when the engine found nothing (never invent activity)', async () => {
    const { events, batcher } = fakeBatcher();
    const clean = { ...RESULT, findings: [] };
    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { __sb: true } as any,
      { auditId: 'aud-1', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: (async () => clean) as any, persistAuditResults: (async () => {}) as any, createBatcher: () => batcher as any },
    );
    expect(events.filter((e) => e.kind === 'finding_preview')).toEqual([]);
  });
});

describe('auditFn — the notify send rides the EXISTING function (ruling 7: no app-sync risk)', () => {
  const src = readFileSync(resolve(__dirname, 'audit.ts'), 'utf8');

  it('has a send-notify-email step wired to sendAuditNotification', () => {
    expect(src).toContain("step.run('send-notify-email'");
    expect(src).toContain('sendAuditNotification');
  });

  it('defines NO new inngest.createFunction (the app sync surface is unchanged)', () => {
    const fnCount = (src.match(/inngest\.createFunction\(/g) ?? []).length;
    expect(fnCount).toBe(1); // auditFn only — cron functions live in billing.ts
  });
});
