import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClientAuditV2 } from '@/lib/audit-stream-projection';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import type { AiReadinessClient, AiReadinessScore } from '@crawlmouse/types';
import { ResultView } from './ResultView';
import {
  errorFixture,
  estimateFixture,
  freeFixture,
  proOwnerFixture,
  xssFixture,
} from './__fixtures__/client-audit-v2';

const render = (audit: ClientAuditV2) =>
  renderToStaticMarkup(<ResultView audit={audit} />);

describe('ResultView — the conversion arc', () => {
  it('U1: free — reveal → gap → free fix → locked wall → share', () => {
    const html = render(freeFixture);
    expect(html).toContain('Your grade is C'); // reveal (live-region)
    expect(html).toContain('you could be a'); // gap
    expect(html).toContain('Free fix unlocked'); // the one free cure
    expect(html).toContain('cures locked'); // the wall
    expect(html).toContain('Get your free report'); // the share moment now names the artifact (§5)
  });

  it('U2: gated cure data never leaks in the free view', () => {
    const html = render(freeFixture);
    expect(html).not.toContain('since last run'); // monitoring is null → absent
    const packets = (html.match(/Action packet/g) ?? []).length;
    expect(packets).toBe(1); // only the FREE fix's packet; locked cures carry none
  });

  it('U4/U5: estimate — estimate form + the JS-rendered AI-crawler disclosure', () => {
    const html = render(estimateFixture);
    expect(html).toContain('Estimate');
    expect(html).toContain('based on 70 of ~500 pages');
    // Distinctive to the js_rendered disclosure (NOT the FreeFixCard paste line, which also says ChatGPT).
    expect(html).toContain('see exactly what Crawlmouse sees');
  });

  it('U10: a failed audit renders the classified error, not the arc', () => {
    const html = render(errorFixture);
    expect(html).toContain('Try another audit');
    expect(html).not.toContain('Free fix unlocked');
  });

  it('U12: attacker-controlled strings render escaped', () => {
    const html = render(xssFixture);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('U8: STAY beat shows for a signed-out viewer, hidden for a signed-in one', () => {
    // The contract field audit.viewerSignedIn drives it: freeFixture is signed-out (false) → STAY shows.
    expect(render(freeFixture)).toContain('Keep an eye on this grade');
    // A signed-in viewer (viewerSignedIn: true) → hidden.
    const signedIn = { ...freeFixture, viewerSignedIn: true };
    expect(
      renderToStaticMarkup(<ResultView audit={signedIn} />),
    ).not.toContain('Keep an eye on this grade');
  });
});

// SPEC 05 §9 — the sibling AI-readiness section is mounted only when the v2 engine produced it, and its
// Pro artifacts are gated purely by data presence (whatAiSees/aiPackets), never a client entitlement flag.
const aiScore: AiReadinessScore = {
  score: 55, band: 'partial',
  components: { access: { score: 1, weight: 25 }, contentWithoutJs: { score: 0.5, weight: 40 }, machineLegibility: { score: 0.6, weight: 20 }, retrievalPath: { score: 0.5, weight: 15 } },
  confidence: 'high', isEstimate: false,
  basis: { pagesAnalyzed: 3, siteJsRendered: false, retrievalPathBasis: 'full' },
  findings: [{ id: 'ai-1', kind: 'js_blind_page', severity: 'high', targetUrl: 'https://mystore.example/app', targetTitle: 'App', plainLanguage: 'renders with JavaScript', evidence: 'strong' }],
  accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
  llmsTxt: { present: false, parseable: false, note: 'llms note' }, asOf: '2026-07-01',
};
const aiFree: AiReadinessClient = {
  score: aiScore,
  homepageView: { url: 'https://mystore.example/', title: 'Home', pageClass: 'readable', excerpt: 'AI_HOMEPAGE_WOW', mainTextChars: 800 },
  whatAiSees: null, aiPackets: null, hasMoreAiPackets: true,
};
const aiPro: AiReadinessClient = {
  ...aiFree,
  whatAiSees: [{ url: 'https://mystore.example/app', title: 'App', pageClass: 'js_blind', excerpt: 'AI_SIMULATOR_EXCERPT', mainTextChars: 5 }],
  aiPackets: [{ fixId: 'ai-1', format: 'markdown', body: 'AI_PACKET_BODY', copyLabel: 'Copy AI prompt' }],
};

describe('ResultView — SPEC 05 AI-readiness section', () => {
  it('does not mount the AI section when aiReadiness is null (v1 / pre-SPEC-05 rows)', () => {
    expect(render(freeFixture)).not.toContain('agent readiness');
  });

  it('mounts the FREE AI section (score + homepage view) but none of the Pro artifacts', () => {
    const html = render({ ...freeFixture, aiReadiness: aiFree });
    expect(html).toContain('agent readiness'); // the section heading
    expect(html).toContain('AI_HOMEPAGE_WOW'); // the free homepage view
    expect(html).not.toContain('AI_SIMULATOR_EXCERPT'); // whatAiSees null → simulator absent
    expect(html).not.toContain('AI_PACKET_BODY'); // aiPackets null → packets absent
  });

  it('mounts the Pro artifacts when whatAiSees/aiPackets are present (the entitled owner)', () => {
    const html = render({ ...proOwnerFixture, aiReadiness: aiPro });
    expect(html).toContain('AI_SIMULATOR_EXCERPT');
    expect(html).toContain('AI_PACKET_BODY');
    expect(html).toContain('Generate llms.txt');
  });
});
