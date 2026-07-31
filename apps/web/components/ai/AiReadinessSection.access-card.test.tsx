import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadinessClient, AiBotAccess } from '@crawlmouse/types';
import { AiReadinessSection } from './AiReadinessSection';

/**
 * THE RESULT PAGE'S ACCESS CARD — the surface the reported defect actually lived on.
 *
 * The helper was pinned and the public report was pinned, but this component had NO test, so a mutation
 * that renders the BLOCKED list under the "Can reach" heading — i.e. re-creates the exact production
 * defect — passed the entire 1290-test web suite. The bug was never in the helper; it was in which list
 * the JSX put under which heading, and that is what this file asserts.
 *
 * Fixture is the verbatim access matrix from production audit 15a79871 (racedays.run).
 */
const bot = (token: string, operator: string, allowedPageRatio: number, fullyBlocked: boolean): AiBotAccess => ({
  token, operator, botClass: 'retrieval', allowedPageRatio, fullyBlocked,
  note: `${operator} retrieval crawler.`,
});

const BLOCKED = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot'];
const REACHING = ['Claude-SearchBot', 'Claude-User', 'Perplexity-User'];

const client = (bots: AiBotAccess[]): AiReadinessClient => ({
  score: {
    score: 79, band: 'partial', confidence: 'high', isEstimate: false,
    components: {
      access: { score: 0.5, weight: 25 }, contentWithoutJs: { score: 1, weight: 40 },
      machineLegibility: { score: 0.6, weight: 20 }, retrievalPath: { score: 0.7, weight: 15 },
    },
    basis: { pagesAnalyzed: 419, siteJsRendered: false, retrievalPathBasis: 'full' },
    findings: [], totalFindings: 0,
    accessMatrix: { bots, robotsTxtFound: true, wafDetected: false, wafNote: null },
    llmsTxt: { present: false, parseable: false, note: 'n' }, asOf: '2026-07-30',
  },
  homepageView: null, whatAiSees: null, aiPackets: null, hasMoreAiPackets: false,
  totalFindings: 0, whatAiSeesTotalPages: 419,
} as unknown as AiReadinessClient);

const render = (bots: AiBotAccess[]) =>
  renderToStaticMarkup(<AiReadinessSection aiReadiness={client(bots)} auditId="a1" />);

/** The markup between the reach heading and the blocked heading — i.e. what a reader sees as "reachers". */
const reachSection = (html: string): string => {
  const start = html.indexOf('Can reach your pages');
  const end = html.indexOf('Blocked or restricted');
  return start < 0 ? '' : html.slice(start, end < 0 ? undefined : end);
};

describe('AiReadinessSection — the access card must never present a blocked bot as a reacher', () => {
  const PROD = [
    ...BLOCKED.map((t) => bot(t, 'Op', 0, true)),
    ...REACHING.map((t) => bot(t, 'Op', 1, false)),
  ];

  it('puts the reachers under the reach heading and the blocked under the blocked heading', () => {
    const html = render(PROD);
    const reach = reachSection(html);
    for (const t of BLOCKED) expect(reach, `${t} is fully blocked and must not appear as a reacher`).not.toContain(t);
    for (const t of REACHING) expect(reach, `${t} reaches everything and must appear here`).toContain(t);
    // …and the blocked ones ARE rendered, under their own heading — not silently dropped.
    for (const t of BLOCKED) expect(html).toContain(t);
  });

  it('states the reach share for a blocked bot, so 0% and 50% are distinguishable', () => {
    const half = render([bot('OAI-SearchBot', 'OpenAI', 0.5, false), bot('Claude-User', 'Anthropic', 1, false)]);
    const none = render([bot('OAI-SearchBot', 'OpenAI', 0, true), bot('Claude-User', 'Anthropic', 1, false)]);
    expect(half).toContain('reaches 50% of your pages');
    expect(none).toContain('reaches 0% of your pages');
    expect(half).not.toBe(none); // they rendered string-identically before the share was shown
  });

  it('states its SCOPE without promising a list the page may not contain', () => {
    const html = render(PROD);
    expect(html).toContain('Search and citation crawlers only');
    // It must NOT point at the findings: that ledger is severity-capped, and `training_bot_blocked` is
    // `info`, so on a real audit (5 high + 414 medium) it is evicted and the promise is unkeepable.
    expect(html).not.toMatch(/training crawlers are listed/i);
    expect(html).not.toMatch(/findings below/i);
  });

  it('WIRES findingSummary into the collapsed row — not a bare scope label', () => {
    // `findingSummary` is unit-tested, but nothing asserted the component USES it: reverting the row to
    // `targetTitle ?? targetUrl ?? 'Site-wide'` — the exact shipped H3 defect — passed the whole suite.
    const c = client(PROD);
    (c.score as { findings: unknown[] }).findings = [{
      id: 'f1', kind: 'retrieval_bot_blocked', severity: 'high', targetUrl: null, targetTitle: null,
      plainLanguage: "OpenAI's OAI-SearchBot can reach only 0% of your pages — blocking a crawler costs visibility.",
      evidence: 'strong',
    }];
    const html = renderToStaticMarkup(<AiReadinessSection aiReadiness={c} auditId="a1" />);
    // ASSERT ON THE <summary> ONLY. `plainLanguage` also renders inside the EXPANDED body, so checking
    // the whole document passes with the fix removed — the first version of this assertion did exactly
    // that and let the reverted row through. The collapsed row is what the defect was about.
    const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1]!);
    expect(summaries.length, 'a finding row must render').toBeGreaterThan(0);
    const joined = summaries.join(' ');
    expect(joined, 'the collapsed row must state the finding').toContain('can reach only 0% of your pages');
    expect(joined, 'and must not be the bare scope label').not.toMatch(/>\s*Site-wide\s*</);
  });

  it('renders NO two identical collapsed rows on the production shape (shared <title>)', () => {
    // The component-level counterpart of the ai-view-logic case. Asserted on the RENDERED <summary>
    // elements, because that is where the defect was visible and where a helper test cannot see it:
    // 43 of 100 delivered rows read as just two strings on audit 15a79871 (x34 "…0 H1 headings ·
    // Racedays", x9 "…missing its meta description · Racedays") while every row had a distinct url.
    const H1 = 'This page has 0 H1 headings (a clear outline uses exactly one).';
    const META = 'This page is missing its meta description — a basic signal every crawler reads.';
    const paths = ['', '/blog/about', '/blog/clubs', '/blog/contact', '/blog/events', '/club/bdo'];
    const c = client(PROD);
    (c.score as { findings: unknown[] }).findings = paths.flatMap((p, i) =>
      [H1, META].map((plainLanguage, j) => ({
        id: `f${i}-${j}`, kind: j === 0 ? 'heading_structure' : 'missing_metadata', severity: 'medium',
        // The shared, non-distinguishing title this CMS emits site-wide.
        targetTitle: 'Racedays', targetUrl: `https://www.racedays.run${p}`, plainLanguage, evidence: 'moderate',
      })),
    );
    const html = renderToStaticMarkup(<AiReadinessSection aiReadiness={c} auditId="a1" />);
    const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1]!);
    expect(summaries.length).toBe(paths.length * 2);
    expect(new Set(summaries).size, `identical rows rendered:\n${summaries.join('\n')}`).toBe(summaries.length);
    // The title must not have been silently dropped from the UI — it moved into the expanded body.
    expect(html).toContain('Racedays');
  });

  it('a bot with an unusable ratio still RENDERS rather than vanishing from both groups', () => {
    // A drifted frozen snapshot must not make a bot vanish from BOTH lists.
    const odd = [{ ...bot('Weird-Bot', 'Op', 1, false), allowedPageRatio: undefined as unknown as number }];
    const html = render(odd);
    expect(html).toContain('Weird-Bot');
  });

  it('degrades rather than throwing when the matrix is empty', () => {
    expect(() => render([])).not.toThrow();
    expect(render([])).toContain('No AI retrieval crawler data is available');
  });
});
