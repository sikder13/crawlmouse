import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-text guard for the SHIPPED (no-longer-draft) legal documents. These pages are static copy,
// so — like load-harness-guard.test.ts and replay-privacy.test.ts — we pin the load-bearing legal
// content directly from the source. The point is twofold:
//   (1) the DraftBanner is GONE from every legal page (the docs are now real, not founder drafts), and
//   (2) the industry-standard clauses the research established as required are actually PRESENT, so a
//       future edit that quietly deletes (say) the liability-cap floor, the DMCA section, the CCPA
//       "do not sell or share" line, or the conspicuous warranty disclaimer fails LOUDLY here.
// __dirname is apps/web/__tests__; pages live one level up under apps/web/.
function read(rel: string): string {
  const abs = resolve(__dirname, '..', rel);
  // readFileSync (not existsSync+read) closes the TOCTOU window and throws ENOENT loudly on a
  // missing/renamed page rather than silently skipping. We collapse whitespace runs to single
  // spaces so assertions match the RENDERED prose regardless of JSX line-wrapping/indentation —
  // this tolerates source reflow, NOT removal: a deleted phrase still fails loudly.
  return readFileSync(abs, 'utf8').replace(/\s+/g, ' ');
}

const PRIVACY = 'app/privacy/page.tsx';
const TERMS = 'app/terms/page.tsx';
const AUP = 'app/aup/page.tsx';
const SUBPROC = 'app/subprocessors/page.tsx';
const LEGAL_PAGES = [PRIVACY, TERMS, AUP, SUBPROC] as const;

describe('legal docs are shipped (DraftBanner removed)', () => {
  it('the DraftBanner component file no longer exists', () => {
    const abs = resolve(__dirname, '..', 'components/legal/DraftBanner.tsx');
    expect(existsSync(abs), 'components/legal/DraftBanner.tsx should be deleted').toBe(false);
  });

  for (const rel of LEGAL_PAGES) {
    it(`${rel} does not import or render DraftBanner`, () => {
      const src = read(rel);
      expect(src, `${rel} still references DraftBanner`).not.toContain('DraftBanner');
    });

    it(`${rel} carries the launch effective date + version`, () => {
      const src = read(rel);
      expect(src).toContain('2026-06-07');
      expect(src.toLowerCase()).toContain('version 1.0');
    });
  }
});

describe('Privacy Policy — required disclosures', () => {
  const src = read(PRIVACY);
  const lower = src.toLowerCase();

  it('names the controlling entity and its US location', () => {
    expect(src).toContain('Nahl Technologies Inc');
    expect(src).toContain('Delaware');
    expect(src).toContain('Indiana');
  });

  it('has correct DSAR timelines (GDPR one month, CCPA 45 days) — not the old "30-day" claim', () => {
    expect(lower).toContain('one month');
    expect(lower).toContain('45 days');
  });

  it('has the CCPA "do not sell or share" statement and consumer-rights language', () => {
    expect(lower).toContain('do not sell or share');
    expect(lower).toContain('non-discrimination');
    expect(lower).toContain('authorized agent');
  });

  it('describes transfers via BOTH the Data Privacy Framework and SCCs', () => {
    expect(src).toContain('Data Privacy Framework');
    expect(src).toContain('Standard Contractual Clauses');
  });

  it('names which subprocessors rely on SCCs (the two not DPF-certified)', () => {
    expect(src).toContain('Supabase');
    expect(src).toContain('Inngest');
  });

  it('states the GDPR Article 22 automated-decision carve-out for the grade', () => {
    expect(src).toContain('Article 22');
  });

  it('has an Article 32 security section and a breach-notification posture', () => {
    expect(src).toContain('Article 32');
    expect(lower).toContain('breach');
  });

  it('gives the Article 77 right to complain to a supervisory authority (UK ICO named)', () => {
    expect(lower).toContain('supervisory authority');
    expect(lower).toContain('ico.org.uk');
  });

  it('lists IP address as a data category and warns submitted URLs may contain personal data', () => {
    expect(src).toContain('IP address');
    expect(lower).toContain('may contain personal data');
  });

  it('sets the children floor at 16 with a US COPPA under-13 reference', () => {
    // Phrase-adjacency (not bare "16"/"13") so a rewrite of the children paragraph cannot satisfy
    // these incidentally via an unrelated year or count.
    expect(lower).toContain('under 16');
    expect(lower).toContain('under 13');
    expect(src).toContain('COPPA');
  });

  it('states billing-record retention in years', () => {
    expect(lower).toContain('years');
  });
});

describe('Terms of Service — required clauses', () => {
  const src = read(TERMS);
  const lower = src.toLowerCase();

  it('names the entity and Delaware governing law + venue', () => {
    expect(src).toContain('Nahl Technologies Inc');
    expect(src).toContain('Delaware');
    expect(lower).toContain('venue');
  });

  it('eligibility is 18+ (anchored to the clause, not the "18. Termination" heading)', () => {
    // A bare toContain('18') is satisfied by the Section 18 heading, so a regression of the
    // eligibility age would slip through. Anchor to the eligibility sentence itself.
    expect(src).toMatch(/at least <strong[^>]*>18<\/strong> years old/);
  });

  it('disclaims warranties CONSPICUOUSLY, naming the UCC magic words and AS-IS safe harbor', () => {
    expect(src).toContain('AS IS');
    expect(src).toContain('MERCHANTABILITY');
    expect(src).toContain('FITNESS FOR A PARTICULAR PURPOSE');
    expect(src).toContain('NON-INFRINGEMENT');
  });

  it('caps liability with a $100 floor (not $0 for free users) plus carve-outs', () => {
    expect(src).toContain('$100');
    expect(lower).toContain('greater of');
    expect(lower).toContain('gross negligence');
  });

  it('has the crawl-authority representation shifting URL risk to the user', () => {
    expect(lower).toContain('represent and warrant');
    expect(lower).toContain('authorized');
  });

  it('uses dispute resolution WITHOUT mandatory arbitration: informal-first + waivers + 1-year limit', () => {
    expect(lower).toContain('informal');
    expect(lower).toContain('class action');
    expect(lower).toContain('jury');
    expect(lower).toContain('one year');
    // No binding arbitration at launch (decision of record) — guard against it creeping in.
    expect(lower).not.toContain('binding arbitration');
  });

  it('has a DMCA notice-and-takedown section with a designated agent', () => {
    expect(src).toContain('DMCA');
    expect(lower).toContain('designated agent');
  });

  it('has the standard boilerplate block', () => {
    expect(lower).toContain('feedback');
    expect(lower).toContain('severab');
    expect(lower).toContain('entire agreement');
    expect(lower).toContain('force majeure');
    expect(lower).toContain('assign');
    expect(lower).toContain('electronic communications');
  });
});

describe('Acceptable Use Policy — crawler bright lines', () => {
  const src = read(AUP);
  const lower = src.toLowerCase();

  it('requires the user to own or be authorized to crawl each target', () => {
    expect(lower).toContain('authorized');
  });

  it('prohibits access-restricted targets and circumvention (the CFAA/hiQ line)', () => {
    expect(lower).toContain('login');
    expect(lower).toContain('circumvent');
  });

  it('commits to respecting robots.txt and gates public reports to verified owners', () => {
    expect(src).toContain('robots.txt');
    expect(lower).toContain('verified');
  });

  it('reserves enforcement (suspend/terminate)', () => {
    expect(lower).toContain('suspend');
  });
});

describe('Subprocessors — disclosure intact', () => {
  const src = read(SUBPROC);
  it('still lists all eight vetted vendors', () => {
    for (const v of ['Supabase', 'Stripe', 'Resend', 'PostHog', 'Sentry', 'Cloudflare', 'Vercel', 'Inngest']) {
      expect(src, `subprocessors page missing ${v}`).toContain(v);
    }
  });
});
