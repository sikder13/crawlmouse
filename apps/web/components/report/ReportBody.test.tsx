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
