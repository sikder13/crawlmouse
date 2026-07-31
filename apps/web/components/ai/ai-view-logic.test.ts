import { describe, it, expect } from 'vitest';
import type { AiReadinessScore, AiBotAccess } from '@crawlmouse/types';
import { bandMeta, componentBars, evidenceLabel, findingSummary, pageClassMeta, partitionRetrievalBots } from './ai-view-logic';

describe('ai-view-logic', () => {
  it('maps each band to a label + tone (no ranking claim)', () => {
    expect(bandMeta('ready')).toEqual({ label: 'AI-ready', tone: 'success' });
    expect(bandMeta('partial').tone).toBe('info');
    expect(bandMeta('at_risk').tone).toBe('warning');
    for (const b of ['ready', 'partial', 'at_risk'] as const) {
      expect(bandMeta(b).label.toLowerCase()).not.toMatch(/rank|cited|guaranteed/);
    }
  });

  it('maps each page class to label + tone + honest meaning', () => {
    expect(pageClassMeta('readable').tone).toBe('success');
    expect(pageClassMeta('js_blind').label).toBe('JavaScript-blind');
    expect(pageClassMeta('js_blind').meaning.toLowerCase()).toContain('javascript');
    expect(pageClassMeta('thin').tone).toBe('neutral');
  });

  it('labels evidence honestly', () => {
    expect(evidenceLabel('strong')).toBe('Strong evidence');
    expect(evidenceLabel('contested')).toContain('Contested');
  });

  it('renders the four LOCKED-weight component bars with percentages rounded at the boundary', () => {
    const score = {
      components: {
        access: { score: 1, weight: 25 },
        contentWithoutJs: { score: 0.5, weight: 40 },
        machineLegibility: { score: 0.666, weight: 20 },
        retrievalPath: { score: 0.5, weight: 15 },
      },
    } as AiReadinessScore;
    const bars = componentBars(score);
    expect(bars.map((b) => [b.key, b.pct, b.weight])).toEqual([
      ['access', 100, 25],
      ['content', 50, 40],
      ['legibility', 67, 20], // 0.666 -> 67
      ['retrieval', 50, 15],
    ]);
  });

  it('partitions retrieval bots into can-reach and blocked, never mixing them', () => {
    const bots: AiBotAccess[] = [
      { token: 'PerplexityBot', operator: 'Perplexity', botClass: 'retrieval', allowedPageRatio: 0.5, fullyBlocked: false, note: 'x' },
      { token: 'OAI-SearchBot', operator: 'OpenAI', botClass: 'retrieval', allowedPageRatio: 1, fullyBlocked: false, note: 'x' },
      { token: 'GPTBot', operator: 'OpenAI', botClass: 'training', allowedPageRatio: 0, fullyBlocked: true, note: 'x' },
    ];
    const { canReach, blocked } = partitionRetrievalBots(bots);
    expect(canReach.map((b) => b.token)).toEqual(['OAI-SearchBot']);
    expect(blocked.map((b) => b.token)).toEqual(['PerplexityBot']); // partial access is NOT "can reach"
    // Training-class bots belong to neither group — the card is about the scored retrieval story.
    expect([...canReach, ...blocked].map((b) => b.token)).not.toContain('GPTBot');
  });

  it('A BOT AT allowedPageRatio 0 CAN NEVER APPEAR UNDER "can reach"', () => {
    // THE SHIPPED DEFECT, pinned. Production audit 15a79871 had OAI-SearchBot, ChatGPT-User and
    // PerplexityBot at ratio 0 / fullyBlocked, while the card listed all three under "Who can reach
    // your content" — contradicting the findings on the same screen, which said each reached 0%.
    const blockedTokens = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot'];
    const bots: AiBotAccess[] = [
      ...blockedTokens.map((token) => ({
        token, operator: 'Op', botClass: 'retrieval' as const, allowedPageRatio: 0, fullyBlocked: true,
        note: 'can reach only 0% of your pages',
      })),
      { token: 'Claude-SearchBot', operator: 'Anthropic', botClass: 'retrieval', allowedPageRatio: 1, fullyBlocked: false, note: 'x' },
    ];
    const { canReach, blocked } = partitionRetrievalBots(bots);
    for (const t of blockedTokens) {
      expect(canReach.map((b) => b.token), `${t} is fully blocked and must never be a reacher`).not.toContain(t);
      expect(blocked.map((b) => b.token)).toContain(t);
    }
    expect(canReach.map((b) => b.token)).toEqual(['Claude-SearchBot']);
    // The two groups are a PARTITION: disjoint, and together they are every retrieval bot.
    expect(canReach.filter((b) => blocked.includes(b))).toEqual([]);
    expect(canReach.length + blocked.length).toBe(4);
  });

  it('the partition is exhaustive across the whole ratio range — no bot is silently dropped', () => {
    const bots: AiBotAccess[] = [0, 0.01, 0.5, 0.99, 1].map((r, i) => ({
      token: `T${i}`, operator: 'Op', botClass: 'retrieval' as const, allowedPageRatio: r, fullyBlocked: r === 0, note: 'x',
    }));
    const { canReach, blocked } = partitionRetrievalBots(bots);
    expect(canReach.length + blocked.length).toBe(bots.length);
    expect(canReach.map((b) => b.token)).toEqual(['T4']); // only ratio 1
  });
});

describe('findingSummary — a collapsed row must state the finding, never a bare label', () => {
  // THE SHIPPED DEFECT: collapsed rows rendered `targetTitle ?? targetUrl ?? 'Site-wide'`, so every
  // site-level finding showed a bare "Site-wide". On a real production audit that is THREE IDENTICAL
  // rows (three blocked retrieval bots), which reads like a rendering bug rather than a diagnosis.
  // Strings below are the real `plainLanguage` values from production audit 15a79871.
  const BOTS = [
    "OpenAI's OAI-SearchBot can reach only 0% of your pages — blocking a search/citation crawler costs you visibility in its answers.",
    "OpenAI's ChatGPT-User can reach only 0% of your pages — blocking a search/citation crawler costs you visibility in its answers.",
    "Perplexity's PerplexityBot can reach only 0% of your pages — blocking a search/citation crawler costs you visibility in its answers.",
  ];

  it('states the finding for a SITE-LEVEL row instead of a bare scope label', () => {
    for (const plainLanguage of BOTS) {
      const out = findingSummary({ plainLanguage, targetTitle: null, targetUrl: null });
      expect(out).not.toBe('Site-wide');
      expect(out).toContain('can reach only 0% of your pages');
    }
  });

  it('keeps the three blocked-bot rows DISTINGUISHABLE from one another', () => {
    // The whole point: a generic per-kind label would render three identical rows and be no better.
    const rows = BOTS.map((plainLanguage) => findingSummary({ plainLanguage, targetTitle: null, targetUrl: null }));
    expect(new Set(rows).size).toBe(3);
    expect(rows[0]).toContain('OAI-SearchBot');
    expect(rows[1]).toContain('ChatGPT-User');
    expect(rows[2]).toContain('PerplexityBot');
  });

  it('states BOTH what and where for a page-level row', () => {
    // Page findings invert the problem: `plainLanguage` is generic across pages and the TITLE is the
    // distinguisher, so the row needs both halves.
    const out = findingSummary({
      plainLanguage: 'This page has very little text. That is fine for a contact or landing page, but if it should carry substance…',
      targetTitle: 'Version history | Racedays',
      targetUrl: 'https://racedays.run/changelog',
    });
    expect(out).toContain('This page has very little text');
    expect(out).toContain('Version history | Racedays');
  });

  it('is bounded, and degrades to the scope when there is no finding text', () => {
    const long = findingSummary({ plainLanguage: 'x'.repeat(400), targetTitle: null, targetUrl: null });
    expect(long.length).toBeLessThanOrEqual(96);
    expect(findingSummary({ plainLanguage: '', targetTitle: null, targetUrl: null })).toBe('Site-wide');
    expect(findingSummary({ plainLanguage: '   ', targetTitle: null, targetUrl: 'https://ex.com/a' })).toBe('https://ex.com/a');
  });
});
