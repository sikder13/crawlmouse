import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReportSnapshotAiReadiness, PublicReportSnapshot } from '@crawlmouse/types';
import { AiReadinessReportSection, REPORT_AI_MAX_FINDINGS } from './AiReadinessReportSection';

// SPEC 05 §10 (A13) — the client-ready report's AI-readiness section. Contracts:
//   - DIAGNOSTIC-ONLY: score/band/components/findings/matrix/llms.txt. Never a packet, a simulator
//     excerpt, or any cure content — the report snapshot has nowhere to put one, so this is structural;
//   - NULL-SAFE: a report minted before SPEC 05 has no `aiReadiness` key → renders nothing;
//   - every crawled string renders as escaped JSX text (A14/§12), never dangerouslySetInnerHTML;
//   - never a ranking/citation promise (A16).

const aiScore = (over: Partial<ReportSnapshotAiReadiness> = {}): ReportSnapshotAiReadiness => ({
  score: 62,
  band: 'partial',
  components: {
    access: { score: 0.8, weight: 25 },
    contentWithoutJs: { score: 0.55, weight: 40 },
    machineLegibility: { score: 0.6, weight: 20 },
    retrievalPath: { score: 0.7, weight: 15 },
  },
  confidence: 'high',
  isEstimate: false,
  basis: { pagesAnalyzed: 42, siteJsRendered: false, retrievalPathBasis: 'full' },
  findings: [
    { kind: 'js_blind_page', severity: 'high', targetUrl: 'https://ex.com/x', plainLanguage: 'AN_AI_SEES_EMPTY_SHELL', evidence: 'strong' },
    { kind: 'missing_metadata', severity: 'medium', targetUrl: null, plainLanguage: 'MISSING_META_PLAIN', evidence: 'moderate' },
    { kind: 'llms_txt_absent', severity: 'info', targetUrl: null, plainLanguage: 'LLMS_ABSENT_PLAIN', evidence: 'informational' },
  ],
  totalFindings: 3,
  accessMatrix: {
    // Bot classes match the shipped registry (packages/engine/.../ai-readiness/constants.ts): the
    // OpenAI RETRIEVAL crawler is OAI-SearchBot; GPTBot is a TRAINING crawler. A fixture that swapped
    // them would let a filtering bug in blockedRetrievalBots pass unnoticed.
    bots: [
      { token: 'OAI-SearchBot', operator: 'OpenAI', botClass: 'retrieval', allowedPageRatio: 0.5, fullyBlocked: false, note: 'SEARCHBOT_NOTE' },
      { token: 'GPTBot', operator: 'OpenAI', botClass: 'training', allowedPageRatio: 1, fullyBlocked: false, note: 'GPTBOT_NOTE' },
    ],
    robotsTxtFound: true,
    wafDetected: true,
    wafNote: 'WAF_DISCLOSURE_NOTE',
  },
  llmsTxt: { present: false, parseable: false, note: 'LLMS_TXT_NOTE' },
  asOf: '2026-07-01',
  ...over,
});

const snap = (ai?: ReportSnapshotAiReadiness): PublicReportSnapshot =>
  ({
    version: 1,
    domain: 'ex.com',
    grade: 'C',
    score: 63.66,
    cms: null,
    mintedAt: '2026-07-07T12:00:00.000Z',
    pageCount: 42,
    orphanCount: 5,
    avgDepth: 2.4,
    confidence: 'high',
    coveragePct: 0.98,
    estimatedTotal: 43,
    findings: [],
    ledger: [],
    ledgerDisclaimer: 'd',
    projected: null,
    ...(ai ? { aiReadiness: ai } : {}),
  }) as PublicReportSnapshot;

const render = (s: PublicReportSnapshot) => renderToStaticMarkup(<AiReadinessReportSection snapshot={s} />);

describe('AiReadinessReportSection — A13 null-safety', () => {
  it('renders NOTHING for a report minted before SPEC 05 (no aiReadiness key)', () => {
    expect(render(snap())).toBe('');
  });

  it('renders nothing when the key is present but nullish (defensive — a hand-edited jsonb)', () => {
    const s = { ...snap(), aiReadiness: undefined } as PublicReportSnapshot;
    expect(render(s)).toBe('');
  });
});

describe('AiReadinessReportSection — diagnostic content (§10)', () => {
  it('renders the score, the band and the four LOCKED-weight component bars', () => {
    const html = render(snap(aiScore()));
    expect(html).toContain('62');
    expect(html).toContain('Partly ready');
    expect(html).toContain('AI crawler access');
    expect(html).toContain('Content without JavaScript');
    expect(html).toContain('Machine legibility');
    expect(html).toContain('Retrieval path');
    // the locked weights are shown so the number is auditable
    for (const w of ['25', '40', '20', '15']) expect(html).toContain(w);
  });

  it('renders findings in plain client-explainable language WITH their evidence labels', () => {
    const html = render(snap(aiScore()));
    expect(html).toContain('AN_AI_SEES_EMPTY_SHELL');
    expect(html).toContain('Strong evidence');
    expect(html).toContain('MISSING_META_PLAIN');
    expect(html).toContain('Moderate evidence');
  });

  it('caps the findings list so the section stays a summary, and says how many were withheld', () => {
    const many = Array.from({ length: REPORT_AI_MAX_FINDINGS + 3 }, (_, i) => ({
      kind: 'thin_page' as const,
      severity: 'medium' as const,
      targetUrl: `https://ex.com/${i}`,
      plainLanguage: `PLAIN_${i}`,
      evidence: 'moderate' as const,
    }));
    const html = render(snap(aiScore({ findings: many, totalFindings: many.length })));
    expect(html).toContain(`PLAIN_${REPORT_AI_MAX_FINDINGS - 1}`);
    expect(html).not.toContain(`PLAIN_${REPORT_AI_MAX_FINDINGS}`);
    expect(html).toMatch(/3 more findings/);
  });

  it('summarises the access matrix and discloses the WAF caveat (§2, never scored)', () => {
    const html = render(snap(aiScore()));
    // Only the RESTRICTED retrieval crawler is called out — a fully-allowed training crawler is not a
    // finding, so listing it would manufacture alarm the data does not support.
    expect(html).toContain('OAI-SearchBot');
    expect(html).toContain('SEARCHBOT_NOTE');
    expect(html).not.toContain('GPTBOT_NOTE');
    expect(html).toContain('WAF_DISCLOSURE_NOTE');
  });

  it('renders the llms.txt status note and the asOf evidence date', () => {
    const html = render(snap(aiScore()));
    expect(html).toContain('LLMS_TXT_NOTE');
    expect(html).toContain('2026-07-01');
  });

  it('frames a low-confidence score as an estimate rather than a fact', () => {
    const html = render(snap(aiScore({ isEstimate: true, confidence: 'low' })));
    expect(html.toLowerCase()).toContain('estimate');
  });
});

describe('AiReadinessReportSection — gating + honesty guards', () => {
  it('is DIAGNOSTIC-ONLY — no packet body, no simulator excerpt, no cure/prescription surface', () => {
    const html = render(snap(aiScore()));
    for (const banned of ['excerpt', 'What AI Sees', 'Copy packet', 'Generate llms.txt', 'suggested']) {
      expect(html).not.toContain(banned);
    }
  });

  it('escapes crawled strings — an injected tag never becomes markup (A14/§12)', () => {
    const html = render(
      snap(
        aiScore({
          findings: [
            {
              kind: 'thin_page',
              severity: 'medium',
              targetUrl: 'https://ex.com/<img src=x onerror=alert(1)>',
              plainLanguage: '<script>alert(2)</script>',
              evidence: 'moderate',
            },
          ],
        }),
      ),
    );
    // The payload must survive only as INERT TEXT: every angle bracket escaped, so no tag is ever
    // opened. Asserting on the escaped form (not on the substring "onerror=", which is harmless once
    // "<" is "&lt;") is what actually pins the no-injection property.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('makes no ranking or guaranteed-citation claim (A16)', () => {
    const html = render(snap(aiScore())).toLowerCase();
    for (const claim of ['ai ranking', 'rank higher', 'guaranteed citation', 'will be cited by']) {
      expect(html).not.toContain(claim);
    }
  });
});

// SPEC 05 §14 — the report section fires `ai_report_section_viewed`. There is no testing-library in this
// repo, so mount effects can't be observed from renderToStaticMarkup; the wiring is pinned at SOURCE
// level (the established pattern from spec04.1-events-guard), and the name is additionally typechecked
// against FunnelEvent by TrackView's prop type. The "never fires without AI data" half IS behavioural:
// the tracker sits inside the early-return, which the A13 empty-render test above pins.
describe('AiReadinessReportSection — §14 observability', () => {
  it('mounts a fire-once TrackView for ai_report_section_viewed', () => {
    const src = readFileSync(resolve(__dirname, 'AiReadinessReportSection.tsx'), 'utf8');
    expect(src).toMatch(/<TrackView\s+event="ai_report_section_viewed"/);
  });

  it('places the tracker AFTER the no-data early return, so a pre-SPEC-05 report never emits it', () => {
    const src = readFileSync(resolve(__dirname, 'AiReadinessReportSection.tsx'), 'utf8');
    const earlyReturn = src.indexOf('if (!ai) return null');
    const tracker = src.indexOf('ai_report_section_viewed');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(tracker).toBeGreaterThan(earlyReturn);
    // and behaviourally: no AI data ⇒ nothing rendered at all (hence no island, hence no event)
    expect(render(snap())).toBe('');
  });
});

// Gaps the review found: the severity ORDER that decides which findings survive the cap, the withheld
// boundary, the weight→label pairing, and shape-drift resilience on a frozen artifact.
describe('AiReadinessReportSection — ordering, boundaries and shape drift', () => {
  const f = (severity: 'high' | 'medium' | 'info', tag: string) => ({
    kind: 'thin_page' as const,
    severity,
    targetUrl: null,
    plainLanguage: tag,
    evidence: 'moderate' as const,
  });

  it('a PROTOTYPE severity from the frozen snapshot cannot invert the order or forge a tone', () => {
    // `severity` is written VERBATIM from the unvalidated `audits.ai_readiness` jsonb into the minted
    // snapshot, so this reader is the last line. A plain index resolves `__proto__`/`constructor`/
    // `toString`/`valueOf` through the prototype chain: the comparator returns NaN, which `SortCompare`
    // normalises to `+0`, so the value compares EQUAL to everything and corrupts the order around it —
    // infos render above highs, permanently, on a world-readable indexable artifact
    // that §5 forbids mutating in place. The tone lookup fails the same way, yielding a FUNCTION that
    // reaches `TONES[tone]` in Badge as a malformed className.
    //
    // This site was the FIFTH copy of a rank map a previous pass consolidated to one, and the only copy
    // with neither the guard nor a test — all 18 existing cases here passed without it.
    // ITERATED, not listed: every own property of Object.prototype is a key that resolves through the
    // chain. A hand-picked four is a sample, and this file has already shipped a sampled test that
    // missed the members that mattered.
    for (const evil of Object.getOwnPropertyNames(Object.prototype)) {
      const findings = [
        f('info', 'INFO_1'),
        { ...f('info', 'EVIL_1'), severity: evil as never },
        f('high', 'HIGH_1'),
        f('medium', 'MED_1'),
      ];
      const html = render(snap(aiScore({ findings, totalFindings: findings.length })));
      const at = (t: string) => html.indexOf(t);
      expect(at('HIGH_1'), `${evil}: high must still outrank medium`).toBeLessThan(at('MED_1'));
      expect(at('MED_1'), `${evil}: medium must still outrank info`).toBeLessThan(at('INFO_1'));
      expect(at('EVIL_1'), `${evil}: unknown severity sorts last`).toBeGreaterThan(at('INFO_1'));
      // THE TONE GUARD. The previous assertion here was `not.toContain('function')`, which is VACUOUS:
      // the resolved function reaches Badge as a coerced key, `TONES[fn]` is `undefined`, and nothing is
      // ever stringified into the markup — so it passed with the guard removed. Assert the POSITIVE
      // instead: the fallback tone's real class string must be present, and no `undefined` class.
      expect(html, `${evil}: unknown tone must fall back to the neutral BadgeTone`).toContain('bg-oat text-ink');
      expect(html, `${evil}: no undefined className`).not.toContain('rounded-full undefined');
    }
  });

  it('renders HIGH before MEDIUM before INFO, and never withholds a high to show an info', () => {
    // Deliberately supplied in the WORST order: a reversed comparator would show the infos and hide
    // the highs — the failure mode that matters on a shared, indexable report.
    const findings = [
      f('info', 'INFO_1'), f('info', 'INFO_2'), f('info', 'INFO_3'), f('info', 'INFO_4'),
      f('medium', 'MED_1'), f('medium', 'MED_2'),
      f('high', 'HIGH_1'), f('high', 'HIGH_2'),
    ];
    const html = render(snap(aiScore({ findings, totalFindings: findings.length })));
    const at = (t: string) => html.indexOf(t);
    expect(at('HIGH_1')).toBeGreaterThan(-1);
    expect(at('HIGH_2')).toBeGreaterThan(-1);
    expect(at('HIGH_1')).toBeLessThan(at('MED_1'));
    expect(at('MED_1')).toBeLessThan(at('INFO_1'));
    // 8 findings, cap 6 ⇒ the two withheld must be the LOWEST severity, never the highs.
    expect(html).not.toContain('INFO_4');
  });

  it('says nothing about withheld findings when everything fits exactly at the cap', () => {
    const findings = Array.from({ length: REPORT_AI_MAX_FINDINGS }, (_, i) => f('medium', `EXACT_${i}`));
    const html = render(snap(aiScore({ findings, totalFindings: findings.length })));
    expect(html).toContain(`EXACT_${REPORT_AI_MAX_FINDINGS - 1}`);
    expect(html).not.toMatch(/more findings, not listed/);
    expect(html).not.toMatch(/…and 0 more/);
  });

  it('reports the honest PRE-CAP total, not the size of the capped array', () => {
    // The snapshot keeps at most MAX_AI_FINDINGS; counting the array would tell the reader "19 more"
    // when the site actually had 494 more.
    const findings = Array.from({ length: 25 }, (_, i) => f('medium', `P_${i}`));
    const html = render(snap(aiScore({ findings, totalFindings: 500 })));
    expect(html).toContain(`${500 - REPORT_AI_MAX_FINDINGS} more findings`);
  });

  it('pairs each locked weight with ITS OWN component label (a swapped mapping must fail)', () => {
    const html = render(snap(aiScore()));
    for (const [label, weight] of [
      ['AI crawler access', 25],
      ['Content without JavaScript', 40],
      ['Machine legibility', 20],
      ['Retrieval path', 15],
    ] as const) {
      const i = html.indexOf(label);
      expect(i).toBeGreaterThan(-1);
      // the weight must appear in this label's own row, not merely somewhere on the page
      expect(html.slice(i, i + 400)).toContain(`weight ${weight}`);
    }
  });

  it('DEGRADES rather than 500s on a frozen snapshot whose shape drifted', () => {
    // A minted snapshot outlives the code that wrote it and can never be migrated, so an unknown band
    // or a missing array must not throw — that would permanently break an indexed public URL.
    const drifted = { ...aiScore(), band: 'renamed_in_spec_06' } as unknown as ReportSnapshotAiReadiness;
    expect(() => render(snap(drifted))).not.toThrow();
    // ALL SIX unbounded reads, not just the four the first pass guarded.
    const missing = {
      ...aiScore(),
      findings: undefined,
      accessMatrix: undefined,
      llmsTxt: undefined,
      components: undefined,
      basis: undefined,
    } as unknown as ReportSnapshotAiReadiness;
    expect(() => render(snap(missing))).not.toThrow();
    // and a partially-drifted components block (one sub-score renamed away)
    const partial = { ...aiScore(), components: { access: { score: 0.8, weight: 25 } } } as unknown as ReportSnapshotAiReadiness;
    expect(() => render(snap(partial))).not.toThrow();
  });
});
