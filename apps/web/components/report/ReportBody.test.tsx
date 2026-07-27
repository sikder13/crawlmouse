import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportBody } from './ReportBody';
import type { PublicReportSnapshot } from '@crawlmouse/types';

// SPEC 04 §4 — V7 (deterministic client-ready report) + V8 (no gated cure leaks into the rendered/
// printed report). The snapshot is FREE-only (structural), so nothing gated can render; this pins it.

const snap = (over: Partial<PublicReportSnapshot> = {}): PublicReportSnapshot => ({
  version: 1,
  domain: 'ex.com',
  grade: 'C',
  score: 63.66,
  cms: 'wordpress',
  mintedAt: '2026-07-07T12:00:00.000Z',
  pageCount: 42,
  orphanCount: 5,
  avgDepth: 2.4,
  confidence: 'high',
  coveragePct: 0.98,
  estimatedTotal: 43,
  findings: [
    { category: 'orphan', severity: 'critical', pageUrl: 'https://ex.com/a' },
    { category: 'deep_page', severity: 'medium', pageUrl: 'https://ex.com/deep' },
  ],
  ledger: [
    { category: 'orphan', targetUrl: 'https://ex.com/lost', targetTitle: 'Lost page', marginalDelta: 5.1, effort: 'low', rationale: 'Add internal links from related hubs.' },
    { category: 'deep_page', targetUrl: 'https://ex.com/deep', targetTitle: 'Deep page', marginalDelta: 3.4, effort: 'medium', rationale: 'Link it from a top-level hub.' },
  ],
  ledgerDisclaimer: 'Each impact is an individual estimate — they are not additive.',
  projected: { grade: 'B', score: 76.09 },
  ...over,
});

describe('ReportBody', () => {
  it('renders the full section-slot report: summary, findings, prioritised fixes, methodology, footer', () => {
    const html = renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />);
    expect(html).toContain('Executive summary');
    expect(html).toContain('What we found');
    expect(html).toContain('Prioritised fixes');
    expect(html).toContain('Methodology');
    // finding comprehension copy (what/why) is present
    expect(html.toLowerCase()).toContain('orphan');
    // action list shows the per-fix impact + effort + disclaimer, never a summed total
    expect(html).toContain('+5.1 pts');
    expect(html).toContain('+3.4 pts');
    expect(html).toContain('not additive');
    expect(html).not.toContain('8.5'); // 5.1 + 3.4 must NEVER be summed and shown
    // guardrail footer: disclaimer + timestamp + dispute link
    expect(html).toContain('as of 2026-07-07');
    expect(html).toContain('/takedown');
    expect(html).toContain('run a fresh audit');
  });

  it('is deterministic — same snapshot → byte-identical markup (V7)', () => {
    expect(renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />)).toBe(
      renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />),
    );
  });

  it('NEVER leaks gated cure content — no prescription/packet strings in the rendered report (V8)', () => {
    const html = renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />);
    for (const banned of ['suggestedLinks', 'actionPacket', 'action_packet', 'Copy the fix', 'prescription']) {
      expect(html).not.toContain(banned);
    }
  });

  it('shows the "unverified — automated report" label ONLY when unclaimed (guardrail)', () => {
    expect(renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />)).toContain('Unverified');
    expect(renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={true} />)).not.toContain('Unverified');
  });

  it('escapes attacker-controlled crawled strings (targetTitle/URL) as inert text — no markup injection', () => {
    const hostile = '<img src=x onerror=pwn()>';
    const html = renderToStaticMarkup(
      <ReportBody
        snapshot={snap({ ledger: [{ category: 'orphan', targetUrl: 'https://ex.com/x', targetTitle: hostile, marginalDelta: 2, effort: 'low', rationale: hostile }] })}
        claimed={false}
      />,
    );
    expect(html).toContain('&lt;img'); // escaped
    expect(html).not.toContain('<img src=x'); // never live markup
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('shows the Crawlmouse wordmark by default (no white-label) — the viral vector', () => {
    expect(renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />)).toContain('Crawlmouse');
  });

  it('white-labels the report (owner brand above the frozen sections, Crawlmouse dropped) — §5', () => {
    const html = renderToStaticMarkup(
      <ReportBody snapshot={snap()} claimed={true} whiteLabel={{ brandName: 'Acme Agency', logoPath: null }} />,
    );
    expect(html).toContain('Acme Agency');
    expect(html).not.toContain('Crawlmouse');
    // the brand letterhead precedes the first (grade) section — the seam array itself is untouched
    expect(html.indexOf('Acme Agency')).toBeLessThan(html.indexOf('report-grade'));
  });

  it('a clean site omits the findings + fixes sections (never fabricates)', () => {
    const html = renderToStaticMarkup(
      <ReportBody snapshot={snap({ grade: 'A', score: 93, orphanCount: 0, findings: [], ledger: [], projected: null })} claimed={true} />,
    );
    expect(html).not.toContain('What we found');
    expect(html).not.toContain('Prioritised fixes');
    expect(html).toContain('Executive summary'); // summary + methodology always render
    expect(html).toContain('Methodology');
  });
});

// SPEC 05 §10 (A13) — the AI-readiness section mounts in SPEC 04's reserved slot: ADDITIVE for reports
// that carry the field, and a strict no-op for every report minted before SPEC 05.
describe('ReportBody — SPEC 05 AI-readiness slot (A13)', () => {
  const ai = {
    score: 62,
    band: 'partial' as const,
    components: {
      access: { score: 0.8, weight: 25 as const },
      contentWithoutJs: { score: 0.55, weight: 40 as const },
      machineLegibility: { score: 0.6, weight: 20 as const },
      retrievalPath: { score: 0.7, weight: 15 as const },
    },
    confidence: 'high' as const,
    isEstimate: false,
    basis: { pagesAnalyzed: 42, siteJsRendered: false, retrievalPathBasis: 'full' as const },
    findings: [
      { id: 'f1', kind: 'js_blind_page' as const, severity: 'high' as const, targetUrl: 'https://ex.com/x', targetTitle: 'X', plainLanguage: 'AI_PLAIN_LANGUAGE_MARKER', evidence: 'strong' as const },
    ],
    accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
    llmsTxt: { present: false, parseable: false, note: 'LLMS_NOTE_MARKER' },
    asOf: '2026-07-01',
  };

  it('renders IDENTICAL markup to pre-SPEC-05 for a report minted without the field', () => {
    const before = renderToStaticMarkup(<ReportBody snapshot={snap()} claimed={false} />);
    // `snap()` has no aiReadiness key at all — the pre-SPEC-05 shape.
    expect('aiReadiness' in snap()).toBe(false);
    expect(before).not.toContain('AI &amp; agent readiness');
    expect(before).not.toContain('agent readiness');
  });

  it('mounts the section when the snapshot carries aiReadiness', () => {
    const html = renderToStaticMarkup(<ReportBody snapshot={snap({ aiReadiness: ai })} claimed={false} />);
    expect(html).toContain('agent readiness');
    expect(html).toContain('AI_PLAIN_LANGUAGE_MARKER');
    expect(html).toContain('LLMS_NOTE_MARKER');
  });

  it('places the AI section AFTER methodology and BEFORE the footer (reserved slot order)', () => {
    const html = renderToStaticMarkup(<ReportBody snapshot={snap({ aiReadiness: ai })} claimed={false} />);
    const method = html.indexOf('Methodology');
    const aiIdx = html.indexOf('agent readiness');
    const footer = html.indexOf('report-footer');
    expect(method).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(method);
    expect(footer).toBeGreaterThan(aiIdx);
  });

  it('leaks no cure/prescription content through the AI section (V8 still holds)', () => {
    const html = renderToStaticMarkup(<ReportBody snapshot={snap({ aiReadiness: ai })} claimed={false} />);
    expect(html).not.toContain('actionPacket');
    expect(html).not.toContain('suggestedLinks');
    expect(html).not.toContain('Copy packet');
    expect(html).not.toContain('What AI Sees');
  });
});
