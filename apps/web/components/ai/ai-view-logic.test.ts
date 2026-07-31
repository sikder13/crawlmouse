import { describe, it, expect } from 'vitest';
import type { AiReadinessScore, AiBotAccess } from '@crawlmouse/types';
import { bandMeta, componentBars, evidenceLabel, findingSummary, pageClassMeta, partitionRetrievalBots, reachPercent } from './ai-view-logic';

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

  it('does NOT cut mid-abbreviation — the shipped heading_structure copy, verbatim', () => {
    // REGRESSION PINNED. A first version cut at the first `. ` or ` — `, which is abbreviation-blind.
    // This is the exact string the engine emits (assemble.ts:140) and it rendered as
    // "This page skips heading levels (e.g — Race Days" — a broken fragment with an unclosed
    // parenthesis, on the free result page, strictly worse than the bare label it replaced. The test
    // that shipped it claimed to be "measured against real production findings" and omitted this one.
    const out = findingSummary({
      plainLanguage: 'This page skips heading levels (e.g. H1 → H3), which weakens the machine-readable outline.',
      targetTitle: 'Race Days',
      targetUrl: null,
    });
    expect(out).not.toContain('(e.g —');
    expect(out).not.toMatch(/\(e\.g\s*[·—]/);
    expect(out).toContain('This page skips heading levels');
    expect(out).toContain('Race Days');
  });

  it('separates target with a MIDDOT, because the finding copy itself contains em dashes', () => {
    // The engine's own copy uses ' — ' inside the sentence, so an em-dash separator made the target
    // read as a continuation: "...but nothing links to it — Orphan".
    const out = findingSummary({
      plainLanguage: 'This page is readable but nothing links to it — assistants may never find it.',
      targetTitle: 'Orphan',
      targetUrl: null,
    });
    expect(out).toContain(' · Orphan');
  });

  it('keeps PAGE-level rows distinct when scopes share a long prefix', () => {
    // THE ROUND-2 BLOCKER. For page-level findings `plainLanguage` is generic BY DESIGN, so the scope is
    // the whole distinguisher — and head-truncating it collapsed real sites back to identical rows,
    // which is the exact symptom this summary exists to remove. For a url-only row it was strictly
    // WORSE than the bare label it replaced, which printed the whole url.
    const generic = 'This page is missing its meta description — a basic signal every crawler reads.';
    const urls = [7, 8, 9].map((n) => `https://shop.example.com/collections/womens-running-shoes/products/aero-glide-${n}`);
    const urlRows = urls.map((targetUrl) => findingSummary({ plainLanguage: generic, targetTitle: null, targetUrl }));
    expect(new Set(urlRows).size, `url rows collapsed:\n${urlRows.join('\n')}`).toBe(3);

    const titles = [1, 2, 3].map((n) => `How to train for a marathon in twelve weeks — a complete guide, part ${n}`);
    const titleRows = titles.map((targetTitle) => findingSummary({ plainLanguage: generic, targetTitle, targetUrl: null }));
    expect(new Set(titleRows).size, `title rows collapsed:\n${titleRows.join('\n')}`).toBe(3);

    // The distinguishing TAIL is what must survive the bound.
    expect(urlRows[0]).toContain('aero-glide-7');
    expect(titleRows[2]).toContain('part 3');
  });

  it('is bounded on BOTH halves, and degrades to the scope when there is no finding text', () => {
    const long = findingSummary({ plainLanguage: 'x'.repeat(400), targetTitle: 'y'.repeat(400), targetUrl: null });
    expect(long.length).toBeLessThanOrEqual(88 + 3 + 60 + 2); // head + ' · ' + scope, both ellipsised
    expect(findingSummary({ plainLanguage: '', targetTitle: null, targetUrl: null })).toBe('Site-wide');
    expect(findingSummary({ plainLanguage: '   ', targetTitle: null, targetUrl: 'https://ex.com/a' })).toBe('https://ex.com/a');
    // An EMPTY title must fall through to the url, not render an empty row (`||`, not `??`).
    expect(findingSummary({ plainLanguage: '', targetTitle: '', targetUrl: 'https://ex.com/b' })).toBe('https://ex.com/b');
    // A non-string on the unvalidated jsonb must not throw AND must not be returned raw — a returned
    // object renders as "Objects are not valid as a React child" and 500s the page.
    expect(() => findingSummary({ plainLanguage: 12345 as never, targetTitle: null, targetUrl: null })).not.toThrow();
    for (const bad of [{ a: 1 }, [1, 2], 42, true]) {
      expect(typeof findingSummary({ plainLanguage: '', targetTitle: bad as never, targetUrl: null }), String(bad)).toBe('string');
      expect(typeof findingSummary({ plainLanguage: 'x', targetTitle: bad as never, targetUrl: null }), String(bad)).toBe('string');
    }
    // Astral characters at the boundary must never be split. THE OFFSET MUST BE ODD: the caps (88, 60)
    // are both even and every emoji is exactly 2 UTF-16 units, so a pure-emoji vector lands a raw
    // `.slice()` cleanly BETWEEN pairs and the assertion passes with the code-point logic removed —
    // which is precisely how the first version of this case shipped vacuous. An odd-length prefix
    // shifts every pair across the boundary.
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const prefix of ['', 'a', 'abc']) {
      const both = findingSummary({
        plainLanguage: `${prefix}${'😀'.repeat(200)}`,
        targetTitle: `${prefix}${'🚀'.repeat(200)}`,
        targetUrl: null,
      });
      expect(lone.test(both), `prefix ${JSON.stringify(prefix)} split a surrogate pair`).toBe(false);
    }
  });
});

describe('reachPercent — the blocked group must state the SHARE, not just "blocked"', () => {
  it('never rounds a RESTRICTED bot up to 100% — that contradicts its own heading', () => {
    // `partitionRetrievalBots` sends anything < 1 to `blocked`, and rounding sent 299/300 to
    // "Blocked or restricted — reaches 100% of your pages". The trigger is ordinary: a single
    // `Disallow: /cart` matching one crawled path on a 200+ page site. Flooring can only understate,
    // which is the safe direction for a restriction warning.
    expect(reachPercent({ allowedPageRatio: 299 / 300 })).toBe(99);
    expect(reachPercent({ allowedPageRatio: 0.999 })).toBe(99);
    expect(reachPercent({ allowedPageRatio: 0.9999999 })).toBe(99);
    // Every ratio the blocked group can hold must render below 100.
    for (const r of [0, 0.01, 0.5, 0.9, 0.99, 0.999, 1 - Number.EPSILON]) {
      expect(reachPercent({ allowedPageRatio: r }), `ratio ${r}`).toBeLessThan(100);
    }
  });

  it('renders the same number the finding text quotes', () => {
    // The commit that introduced the partition justified folding partial access into `blocked` with
    // "its note says so". It does not: `note` is a static registry blurb ("Fetches pages for ChatGPT
    // search results…") that never carries the share, so a bot at 50% was STRING-IDENTICAL to one at 0%.
    expect(reachPercent({ allowedPageRatio: 0 })).toBe(0);
    expect(reachPercent({ allowedPageRatio: 0.5 })).toBe(50);
    expect(reachPercent({ allowedPageRatio: 0.998 })).toBe(99); // floored — never reads 100% while blocked
    expect(reachPercent({ allowedPageRatio: 1 })).toBe(100);
  });

  it('returns null rather than NaN for a drifted frozen snapshot', () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '0.5']) {
      expect(reachPercent({ allowedPageRatio: bad as never }), String(bad)).toBeNull();
    }
    expect(reachPercent({ allowedPageRatio: -1 })).toBe(0);   // clamped
    expect(reachPercent({ allowedPageRatio: 5 })).toBe(100);  // clamped
  });
});
