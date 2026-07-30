import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadinessClient, AiReadinessScore, WhatAiSeesPage } from '@crawlmouse/types';
import { AiReadinessSection } from './AiReadinessSection';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

const score: AiReadinessScore = {
  score: 55,
  band: 'partial',
  components: {
    access: { score: 1, weight: 25 },
    contentWithoutJs: { score: 0.5, weight: 40 },
    machineLegibility: { score: 0.6, weight: 20 },
    retrievalPath: { score: 0.5, weight: 15 },
  },
  confidence: 'high',
  isEstimate: false,
  basis: { pagesAnalyzed: 3, siteJsRendered: false, retrievalPathBasis: 'full' },
  findings: [
    { id: 'f1', kind: 'js_blind_page', severity: 'high', targetUrl: 'https://ex.com/app', targetTitle: 'App', plainLanguage: 'FINDING_PLAIN this page renders with JavaScript.', evidence: 'strong' },
  ],
  accessMatrix: {
    bots: [{ token: 'PerplexityBot', operator: 'Perplexity', botClass: 'retrieval', allowedPageRatio: 0.5, fullyBlocked: false, note: 'BOT_NOTE indexes pages' }],
    robotsTxtFound: true,
    wafDetected: true,
    wafNote: 'WAF_NOTE edge blocking may override robots',
  },
  llmsTxt: { present: false, parseable: false, note: 'LLMS_NOTE read by coding agents' },
  asOf: '2026-07-01',
};
const homepageView: WhatAiSeesPage = { url: 'https://ex.com/', title: 'Home', pageClass: 'readable', excerpt: 'HOMEPAGE_WOW welcome', mainTextChars: 800 };

const free: AiReadinessClient = { score, homepageView, whatAiSees: null, aiPackets: null, hasMoreAiPackets: true, totalFindings: score.findings.length, whatAiSeesTotalPages: 3 };
const pro: AiReadinessClient = {
  ...free,
  whatAiSees: [{ url: 'https://ex.com/app', title: 'App', pageClass: 'js_blind', excerpt: 'SIMULATOR_EXCERPT app shell', mainTextChars: 5 }],
  aiPackets: [{ fixId: 'f1', format: 'markdown', body: 'PACKET_BODY_TEXT System: rewrite', copyLabel: 'Copy AI prompt' }],
};

const render = (c: AiReadinessClient) => renderToStaticMarkup(<AiReadinessSection aiReadiness={c} auditId="aud-1" />);

describe('AiReadinessSection — FREE surface', () => {
  it('renders the score, band, four component bars, findings, disclosures, homepage view, and llms.txt status', () => {
    const html = render(free);
    expect(html).toContain('55'); // the score
    expect(html).toContain('Partly ready'); // band
    expect(html).toContain('AI crawler access'); // bar labels (LOCKED weights)
    expect(html).toContain('Content without JavaScript');
    expect(html).toContain('Machine legibility');
    expect(html).toContain('Retrieval path');
    expect(html).toContain('FINDING_PLAIN'); // the findings ledger (free)
    expect(html).toContain('WAF_NOTE'); // §2 disclosure
    expect(html).toContain('2026-07-01'); // asOf evidence date
    expect(html).toContain('HOMEPAGE_WOW'); // the homepage view (free)
    expect(html).toContain('LLMS_NOTE'); // llms.txt status note
  });

  it('SECURITY (render gate): a FREE viewer sees NONE of the Pro artifacts', () => {
    const html = render(free);
    expect(html).not.toContain('SIMULATOR_EXCERPT'); // whole-site simulator absent
    expect(html).not.toContain('PACKET_BODY_TEXT'); // packet bodies absent
    expect(html).not.toContain('Generate llms.txt'); // generator absent
    expect(html).not.toContain('across your site'); // simulator header absent
  });

  it('makes no ranking/citation promise (A16)', () => {
    const html = render(free).toLowerCase();
    expect(html).not.toMatch(/ai ranking|guaranteed|will be cited|ranks? higher/);
  });
});

describe('AiReadinessSection — PRO surface (data-presence gated, never a client flag)', () => {
  it('renders the whole-site simulator, the AI packets, and the llms.txt generator when the fields are present', () => {
    const html = render(pro);
    expect(html).toContain('SIMULATOR_EXCERPT'); // simulator present
    expect(html).toContain('PACKET_BODY_TEXT'); // packets present
    expect(html).toContain('Generate llms.txt'); // generator present
  });
});

describe('AiReadinessSection — A14 escaping', () => {
  it('escapes EVERY attacker-controlled field — findings, urls, titles, bot notes, WAF/llms notes, excerpts, packet body', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const c: AiReadinessClient = {
      ...pro,
      score: {
        ...score,
        findings: [{ ...score.findings[0]!, plainLanguage: evil, targetUrl: `https://ex.com/${evil}`, targetTitle: evil }],
        accessMatrix: { bots: [{ token: evil, operator: evil, botClass: 'retrieval', allowedPageRatio: 0.5, fullyBlocked: false, note: evil }], robotsTxtFound: true, wafDetected: true, wafNote: evil },
        llmsTxt: { present: false, parseable: false, note: evil },
      },
      homepageView: { ...homepageView, excerpt: evil, title: evil },
      whatAiSees: [{ url: `https://ex.com/${evil}`, title: evil, pageClass: 'js_blind', excerpt: evil, mainTextChars: 3 }],
      aiPackets: [{ fixId: 'f1', format: 'markdown', body: evil, copyLabel: 'Copy AI prompt' }],
    };
    const html = render(c);
    expect(html).toContain('&lt;script&gt;'); // escaped text is present
    expect(html).not.toContain('<script>alert(1)'); // ...but never a live script tag
    expect(html).not.toContain('<img src=x'); // ...nor a live img
    expect(html).not.toContain('onerror=alert(2)>'); // ...nor a live attribute (the raw ">" is escaped)
  });
});

describe('AiReadinessSection — a prototype severity cannot forge a Badge tone', () => {
  it('falls back to a real BadgeTone for every Object.prototype member', () => {
    // `severity` is read back from the deliberately unvalidated `audits.ai_readiness` jsonb, and
    // `SEVERITY_TONE[severity]` resolves `__proto__`/`constructor`/`toString`/`valueOf` THROUGH the
    // prototype chain to an object or a function, which reaches `TONES[tone]` in Badge as `undefined`
    // and emits a malformed className.
    //
    // This guard was added in the same commit as its sibling in the report renderer, and only the
    // sibling was tested — the third time this branch shipped "all sites pinned" with one unpinned.
    // ITERATED over Object.getOwnPropertyNames(Object.prototype), not a hand-picked four.
    for (const evil of Object.getOwnPropertyNames(Object.prototype)) {
      const c: AiReadinessClient = {
        ...free,
        score: { ...score, findings: [{ ...score.findings[0]!, severity: evil as never }] },
      };
      const html = render(c);
      // NOT `toContain('bg-oat text-ink')` — that was vacuous twice over: Badge maps BOTH `oat` and
      // `neutral` to that same class string, and each fixture already renders an unrelated `oat`
      // badge, so it passed with the guard removed AND with every tone forced to `peach`. The
      // discriminating assertion is the absence of a broken className, which mutation-kills.
      expect(html, `${evil}: no undefined className`).not.toContain('rounded-full undefined');
    }
  });
});

describe('AiReadinessSection — the simulator receives the HONEST page total', () => {
  it('passes whatAiSeesTotalPages through, not the capped row count', () => {
    // The prop was wired and NOTHING mounted the simulator in a test: the section suite only used the
    // `free` fixture (whatAiSees: null), so reverting `totalPages={whatAiSeesTotalPages}` to
    // `whatAiSees.length` left 1257 tests green while restoring exactly the "across your whole site
    // over a capped list" dishonesty the field exists to prevent. A helper nobody calls, one layer up.
    const capped: AiReadinessClient = { ...pro, whatAiSeesTotalPages: 2000 };
    const html = renderToStaticMarkup(<AiReadinessSection aiReadiness={capped} auditId="a1" />);
    expect(html).toContain('2,000');                       // the pre-cap total reached the DOM
    expect(html).not.toContain('across your whole site');  // …and the whole-site claim is withdrawn
  });

  it('keeps the whole-site wording when nothing was capped', () => {
    const uncapped: AiReadinessClient = { ...pro, whatAiSeesTotalPages: pro.whatAiSees!.length };
    const html = renderToStaticMarkup(<AiReadinessSection aiReadiness={uncapped} auditId="a1" />);
    expect(html).toContain('across your whole site');
  });
});
