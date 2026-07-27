import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadinessScore, PublicReportSnapshot } from '@crawlmouse/types';
import { AiReadinessReportSection, REPORT_AI_MAX_FINDINGS } from './AiReadinessReportSection';

// SPEC 05 §10 (A13) — the client-ready report's AI-readiness section. Contracts:
//   - DIAGNOSTIC-ONLY: score/band/components/findings/matrix/llms.txt. Never a packet, a simulator
//     excerpt, or any cure content — the report snapshot has nowhere to put one, so this is structural;
//   - NULL-SAFE: a report minted before SPEC 05 has no `aiReadiness` key → renders nothing;
//   - every crawled string renders as escaped JSX text (A14/§12), never dangerouslySetInnerHTML;
//   - never a ranking/citation promise (A16).

const aiScore = (over: Partial<AiReadinessScore> = {}): AiReadinessScore => ({
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
    { id: 'f1', kind: 'js_blind_page', severity: 'high', targetUrl: 'https://ex.com/x', targetTitle: 'X', plainLanguage: 'AN_AI_SEES_EMPTY_SHELL', evidence: 'strong' },
    { id: 'f2', kind: 'missing_metadata', severity: 'medium', targetUrl: null, targetTitle: null, plainLanguage: 'MISSING_META_PLAIN', evidence: 'moderate' },
    { id: 'f3', kind: 'llms_txt_absent', severity: 'info', targetUrl: null, targetTitle: null, plainLanguage: 'LLMS_ABSENT_PLAIN', evidence: 'informational' },
  ],
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

const snap = (ai?: AiReadinessScore): PublicReportSnapshot =>
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
      id: `x${i}`,
      kind: 'thin_page' as const,
      severity: 'medium' as const,
      targetUrl: `https://ex.com/${i}`,
      targetTitle: null,
      plainLanguage: `PLAIN_${i}`,
      evidence: 'moderate' as const,
    }));
    const html = render(snap(aiScore({ findings: many })));
    expect(html).toContain(`PLAIN_${REPORT_AI_MAX_FINDINGS - 1}`);
    expect(html).not.toContain(`PLAIN_${REPORT_AI_MAX_FINDINGS}`);
    expect(html).toMatch(/3 more/);
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
              id: 'evil',
              kind: 'thin_page',
              severity: 'medium',
              targetUrl: 'https://ex.com/<img src=x onerror=alert(1)>',
              targetTitle: '<script>alert(1)</script>',
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
