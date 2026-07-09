import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CrawlActivityEvent, FixDiagnosis, FreeFix, PublicReportSnapshot } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { ActivityFeed } from '@/components/audit/ActivityFeed';
import { FreeFixCard } from '@/components/audit/FreeFixCard';
import { LockedCureCard } from '@/components/audit/LockedCureCard';
import { actionPacketClipboardText } from '@/components/audit/result-logic';
import { ReportActionList, ReportExecutiveSummary, ReportMethodology } from '@/components/report/sections';
import { freeFixture } from '@/components/audit/__fixtures__/client-audit-v2';
import { NON_ASCII_URL_SAMPLES } from '@/lib/__fixtures__/spec041-fixtures';

// SPEC 04.2 FIX 3 — the visible-"%" guard. Crawlmouse is a GLOBAL tool, so this asserts across a MATRIX of
// scripts (Bengali, Arabic + RTL, Chinese, Cyrillic, accented-Latin) × every human-facing crawled-URL
// surface (activity feed, orphan/fix cards, action-packet chips + <pre> body, and the /r/ report
// ActionList sections.tsx:78). It FAILS if ANY surface shows a literal percent-escape for ANY script — the
// leak the eye misses and ASCII-only fixtures let slip past the gate twice. Display decode only: the
// machine/pasteable payload stays a valid, percent-encoded URL, and every decoded string stays inert text.

const PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/; // a raw percent-encoding byte — must never reach a human surface

const feedEvent = (label: string): CrawlActivityEvent => ({
  kind: 'fetch_ok',
  label,
  at: '2026-01-01T00:00:00.000Z',
  seq: 1,
});

// A free fix whose target URL, one source chip, and packet body all carry the encoded URL (titles null so
// the URL — not a title — is what renders on the chips).
const freeFixFor = (encodedUrl: string): FreeFix => {
  const base = freeFixture.freeFix as FreeFix;
  return {
    ...base,
    diagnosis: { ...base.diagnosis, targetTitle: null, targetUrl: encodedUrl },
    prescription: {
      ...base.prescription,
      suggestedLinks: [{ ...base.prescription.suggestedLinks[0], fromTitle: null, fromUrl: encodedUrl }],
      actionPacket: { ...base.prescription.actionPacket, body: `Target page: ${encodedUrl}\n   URL: ${encodedUrl}` },
    },
  };
};

const diagnosisFor = (encodedUrl: string): FixDiagnosis => ({
  ...(freeFixture.freeFix as FreeFix).diagnosis,
  targetTitle: null,
  targetUrl: encodedUrl,
});

const snapshotFor = (encodedUrl: string): PublicReportSnapshot => ({
  version: 1,
  domain: 'example.com',
  grade: 'C',
  score: 62,
  cms: null,
  mintedAt: '2026-01-01T00:00:00.000Z',
  pageCount: 20,
  orphanCount: 3,
  avgDepth: 3,
  confidence: 'high',
  coveragePct: 80,
  estimatedTotal: 25,
  findings: [],
  ledger: [
    { category: 'orphan', targetUrl: encodedUrl, targetTitle: null, marginalDelta: 8, effort: 'low', rationale: 'Nothing links here.' },
  ],
  ledgerDisclaimer: 'Impacts are individual estimates, not additive.',
  projected: { grade: 'B', score: 74 },
});

describe('SPEC 04.2 FIX 3 — no percent-encoding leaks on any human-facing URL surface (all scripts)', () => {
  for (const s of NON_ASCII_URL_SAMPLES) {
    describe(s.name, () => {
      it('activity feed decodes the crawled path', () => {
        const html = renderToStaticMarkup(<ActivityFeed events={[feedEvent(s.encodedPath)]} />);
        expect(html).toContain(s.decodedPath);
        expect(html).not.toMatch(PERCENT_ESCAPE);
      });

      it('free-fix card decodes target + source chip + packet <pre> body', () => {
        const html = renderToStaticMarkup(<FreeFixCard freeFix={freeFixFor(s.encodedUrl)} />);
        expect(html).toContain(s.decodedUrl);
        expect(html).not.toMatch(PERCENT_ESCAPE);
      });

      it('locked cure card decodes the target URL', () => {
        const html = renderToStaticMarkup(<LockedCureCard diagnosis={diagnosisFor(s.encodedUrl)} />);
        expect(html).toContain(s.decodedUrl);
        expect(html).not.toMatch(PERCENT_ESCAPE);
      });

      it('report ActionList (sections §78) decodes the fix URL', () => {
        const html = renderToStaticMarkup(<ReportActionList snapshot={snapshotFor(s.encodedUrl)} />);
        expect(html).toContain(s.decodedUrl);
        expect(html).not.toMatch(PERCENT_ESCAPE);
      });
    });
  }

  it('report prose sections (exec summary + methodology) never render a percent-escape', () => {
    const snap = snapshotFor(NON_ASCII_URL_SAMPLES[0].encodedUrl);
    expect(renderToStaticMarkup(<ReportExecutiveSummary snapshot={snap} />)).not.toMatch(PERCENT_ESCAPE);
    expect(renderToStaticMarkup(<ReportMethodology snapshot={snap} />)).not.toMatch(PERCENT_ESCAPE);
  });

  it('the machine/pasteable action-packet payload stays a valid, percent-encoded URL (never decoded)', () => {
    const s = NON_ASCII_URL_SAMPLES[0];
    const ff = freeFixFor(s.encodedUrl);
    // The clipboard payload keeps the raw encoded URL (valid + resolvable) — the display decode never bleeds in.
    expect(actionPacketClipboardText(ff.prescription.actionPacket)).toContain(encodeURIComponent(s.word));
    expect(actionPacketClipboardText(ff.prescription.actionPacket)).not.toContain(s.word);
  });

  it('security: an encoded markup payload is decoded THEN escaped — never live, never innerHTML', () => {
    const evil = '%3Cscript%3Ealert(1)%3C%2Fscript%3E'; // decodes to <script>alert(1)</script>
    const html = renderToStaticMarkup(<ActivityFeed events={[feedEvent(evil)]} />);
    expect(html).toContain('&lt;script&gt;'); // React escapes the decoded string
    expect(html).not.toContain('<script>alert'); // no live tag from the payload
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('an RTL (Arabic) path renders as escaped text alongside LTR chrome without breakage', () => {
    const arabic = NON_ASCII_URL_SAMPLES.find((x) => x.name.startsWith('Arabic'))!;
    const html = renderToStaticMarkup(<ActivityFeed events={[feedEvent(arabic.encodedPath)]} />);
    expect(html).toContain(arabic.decodedPath); // RTL path present as inert text
    expect(html).toContain('Live crawl activity'); // LTR chrome intact
    expect(html).not.toMatch(PERCENT_ESCAPE);
  });
});
