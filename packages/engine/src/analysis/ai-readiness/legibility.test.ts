import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { analyzeLegibility, detectFrameworkMarker } from './legibility.js';
import { JSON_LD_MAX_TYPES, JSON_LD_TYPE_MAX_BYTES } from './constants.js';
import { createHash } from 'node:crypto';
import { SCHEMA_ORG_ORGANIZATION_TYPES } from './schema-org-types.js';

/**
 * Digest of the generated closure, joined with '\n'. Recomputed and updated ONLY when the list is
 * regenerated from a new Schema.org release — never edited to make a failing test pass.
 */
const SCHEMA_ORG_CLOSURE_SHA256 = '5559767dbd3222e5d45d492044224f3c4f7126d2a1617e34e4495725a8b86ffc';

describe('analyzeLegibility (§5)', () => {
  it('detects title + meta-description presence', () => {
    const l = analyzeLegibility(
      cheerio.load('<head><title>Hi</title><meta name="description" content="A page"></head><body></body>'),
    );
    expect(l.hasTitle).toBe(true);
    expect(l.hasMetaDescription).toBe(true);
  });

  it('treats a missing title and a whitespace-only description as absent', () => {
    const l = analyzeLegibility(cheerio.load('<head><meta name="description" content="   "></head><body></body>'));
    expect(l.hasTitle).toBe(false);
    expect(l.hasMetaDescription).toBe(false);
  });

  it('counts H1s', () => {
    expect(analyzeLegibility(cheerio.load('<body><h1>a</h1><h1>b</h1></body>')).h1Count).toBe(2);
  });

  it('flags a skipped heading level (h1 then h3)', () => {
    expect(analyzeLegibility(cheerio.load('<body><h1>a</h1><h3>c</h3></body>')).headingLevelsSkipped).toBe(true);
  });

  it('does not flag a well-ordered outline', () => {
    expect(
      analyzeLegibility(cheerio.load('<body><h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2></body>')).headingLevelsSkipped,
    ).toBe(false);
  });

  it('detects a main landmark (<main>, <article>, or role=main)', () => {
    expect(analyzeLegibility(cheerio.load('<body><main>x</main></body>')).hasMainLandmark).toBe(true);
    expect(analyzeLegibility(cheerio.load('<body><div role="main">x</div></body>')).hasMainLandmark).toBe(true);
    expect(analyzeLegibility(cheerio.load('<body><div>x</div></body>')).hasMainLandmark).toBe(false);
  });

  it('parses valid JSON-LD and collects @type', () => {
    const j = analyzeLegibility(
      cheerio.load(
        '<head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"X"}</script></head><body></body>',
      ),
    ).jsonLd;
    expect(j).toEqual({ present: true, valid: true, types: ['Organization'], hasEntityType: true });
  });

  it('flags malformed JSON-LD as invalid but present', () => {
    const j = analyzeLegibility(
      cheerio.load('<head><script type="application/ld+json">{ not json }</script></head><body></body>'),
    ).jsonLd;
    expect(j.present).toBe(true);
    expect(j.valid).toBe(false);
  });

  it('reports absent JSON-LD', () => {
    expect(analyzeLegibility(cheerio.load('<body></body>')).jsonLd).toEqual({ present: false, valid: false, types: [], hasEntityType: false });
  });

  it('collects @type from an @graph array (deduped)', () => {
    const j = analyzeLegibility(
      cheerio.load(
        '<head><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Organization","LocalBusiness"]}]}</script></head><body></body>',
      ),
    ).jsonLd;
    expect(j.valid).toBe(true);
    expect([...j.types].sort()).toEqual(['LocalBusiness', 'Organization', 'WebSite']);
  });

  it('collects @type in deterministic FIRST-OCCURRENCE order (not sorted), deduped', () => {
    const j = analyzeLegibility(
      cheerio.load(
        '<head><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Organization"},{"@type":"WebSite"}]}</script></head><body></body>',
      ),
    ).jsonLd;
    expect(j.types).toEqual(['WebSite', 'Organization']); // document order preserved, dup dropped — NOT ['Organization','WebSite']
  });
});

describe('detectFrameworkMarker (§4 — explanation, never a verdict)', () => {
  it('nextjs via __NEXT_DATA__', () => {
    expect(
      detectFrameworkMarker(cheerio.load('<body><div id="__next"></div><script id="__NEXT_DATA__">{}</script></body>')),
    ).toBe('nextjs');
  });
  it('nuxt via #__nuxt', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><div id="__nuxt"></div></body>'))).toBe('nuxt');
  });
  it('gatsby via #___gatsby', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><div id="___gatsby"></div></body>'))).toBe('gatsby');
  });
  it('react via [data-reactroot]', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><div data-reactroot></div></body>'))).toBe('react');
  });
  it('null for a plain static page', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><main><p>hi</p></main></body>'))).toBe(null);
  });
});

// ── §5 JSON-LD bounds (B2/B3) ────────────────────────────────────────────────────
// Fixtures are WORST-case on purpose. The defect that shipped here survived a green suite because
// every existing JSON-LD fixture was a handful of short, well-formed types — too small to exercise
// either the size axis or the surrogate axis of the property the code is responsible for.
describe('analyzeJsonLd — bounds and UTF-16 well-formedness', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  const hasLone = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = s.charCodeAt(i + 1);
        if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  };

  it('B2: a lone surrogate arriving through JSON.parse is repaired, not persisted', () => {
    // 40 bytes of valid JSON. JSON.parse ACCEPTS the unpaired escape; Postgres does not, and the
    // failed pages insert fails the whole audit. No truncation is involved, so a cut-safe helper
    // alone would not catch this.
    const l = load('{"@type":"\\ud800"}');
    expect(l.jsonLd.types).toHaveLength(1);
    expect(hasLone(l.jsonLd.types[0]!)).toBe(false);
  });

  it('B2: a lone surrogate INSIDE an @type array entry is repaired too', () => {
    const l = load('{"@type":["Article","Bad\\udc00End"]}');
    expect(l.jsonLd.types.every((t) => !hasLone(t))).toBe(true);
  });

  it('B3: caps the TYPE COUNT — 20 000 @graph entries yield at most JSON_LD_MAX_TYPES', () => {
    const graph = Array.from({ length: 20_000 }, (_, i) => `{"@type":"T${i}"}`).join(',');
    const l = load(`{"@graph":[${graph}]}`);
    expect(l.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
    expect(l.jsonLd.present).toBe(true);
    expect(l.jsonLd.valid).toBe(true);
  });

  it('B3: caps PER-ITEM LENGTH — a single megabyte-long @type cannot ride into jsonb', () => {
    const l = load(`{"@type":"${'T'.repeat(1_000_000)}"}`);
    expect(Buffer.byteLength(l.jsonLd.types[0]!, 'utf8')).toBeLessThanOrEqual(JSON_LD_TYPE_MAX_BYTES);
  });

  it('B3: the SERIALIZED signal stays small on the worst case that measured 1.15 MB', () => {
    // The bound that actually matters is bytes-in-the-insert-body, so assert on the serialization
    // rather than on the field — count and length caps could both hold while the product blew up.
    const graph = Array.from({ length: 20_000 }, (_, i) => `{"@type":"${'T'.repeat(200)}${i}"}`).join(',');
    const l = load(`{"@graph":[${graph}]}`);
    expect(Buffer.byteLength(JSON.stringify(l.jsonLd), 'utf8')).toBeLessThan(4_000);
  });

  it('B3: deep @graph nesting terminates instead of recursing without bound', () => {
    let json = '{"@type":"Leaf"}';
    for (let i = 0; i < 5_000; i++) json = `{"@graph":[${json}]}`;
    expect(() => load(json)).not.toThrow();
  });

  it('the node budget is SHARED across script blocks, so N blocks cannot multiply the ceiling', () => {
    const block = `{"@graph":[${Array.from({ length: 3_000 }, (_, i) => `{"@type":"A${i}"}`).join(',')}]}`;
    const html = `<head>${Array.from({ length: 20 }, () => `<script type="application/ld+json">${block}</script>`).join('')}</head><body></body>`;
    const l = analyzeLegibility(cheerio.load(html));
    expect(l.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
  });

  it('R1: deterministic — identical input yields byte-identical types', () => {
    const json = '{"@graph":[{"@type":"Article"},{"@type":["WebPage","Thing"]},{"@type":"Article"}]}';
    expect(JSON.stringify(load(json).jsonLd)).toBe(JSON.stringify(load(json).jsonLd));
  });

  it('ordinary structured data is UNCHANGED — first-occurrence order, deduped', () => {
    const l = load('{"@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]},{"@type":"Organization"}]}');
    expect(l.jsonLd.types).toEqual(['Organization', 'WebSite', 'Thing']);
  });
});

// ── CHECK BEFORE CAP + the walk bounds, each pinned INDEPENDENTLY ────────────────────────────────
// Every bound below previously had a test named for it that could not fail: the count cap was
// asserted against its own constant (vacuous under a constant bump), the depth test only asserted
// `not.toThrow()` (and `analyzeJsonLd` try/catches, so a stack overflow was swallowed), and the
// "shared budget" test asserted a ceiling the count cap already guaranteed. These assert BEHAVIOUR:
// a value that is present with the bound and absent without it, or vice versa.
describe('analyzeJsonLd — entity signal is decided BEFORE the storage cap', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  it('recognises Organization even when it falls PAST the type cap', () => {
    // The blocking defect: the cap evicted Organization, `assemble` read the capped array, and a
    // homepage that declares an entity got a factually false `missing_entity_link` (score 94 → 91).
    const filler = Array.from({ length: 25 }, (_, i) => `{"@type":"Filler${i}"}`).join(',');
    const l = load(`{"@graph":[${filler},{"@type":"Organization"}]}`);
    expect(l.jsonLd.types).not.toContain('Organization'); // genuinely evicted from STORAGE…
    expect(l.jsonLd.types.length).toBe(JSON_LD_MAX_TYPES);
    expect(l.jsonLd.hasEntityType).toBe(true); // …and still recognised as a declared entity
  });

  it('recognises WebSite behind a hostile FIRST script block that exhausts the storage budget', () => {
    // The entity walk has its own budget precisely so a hostile page cannot starve the signal.
    const flood = Array.from({ length: 6000 }, (_, i) => `{"@type":"F${i}"}`).join(',');
    const html = `<head>
      <script type="application/ld+json">{"@graph":[${flood}]}</script>
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      </head><body></body>`;
    expect(analyzeLegibility(cheerio.load(html)).jsonLd.hasEntityType).toBe(true);
  });

  it('recognises an entity nested deeper than the storage walk collects types from', () => {
    let json = '{"@type":"Organization"}';
    for (let i = 0; i < 8; i++) json = `{"@graph":[${json}]}`;
    expect(load(json).jsonLd.hasEntityType).toBe(true);
  });

  it('recognises an entity inside a @type ARRAY, and one whose sibling types are over-long', () => {
    expect(load(`{"@type":["${'X'.repeat(500)}","Organization"]}`).jsonLd.hasEntityType).toBe(true);
  });

  it('stays FALSE when no entity is declared (the signal is not just "any JSON-LD")', () => {
    expect(load('{"@graph":[{"@type":"Article"},{"@type":"BreadcrumbList"}]}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"name":"no type at all"}').jsonLd.hasEntityType).toBe(false);
  });
});

describe('SCHEMA_ORG_ORGANIZATION_TYPES — the generated closure is pinned', () => {
  // Nothing imported this constant, so adding `CreativeWork` or deleting `Winery` shipped a +/-3.0
  // score change with both suites green — the exact failure the generated file exists to prevent.
  it('has the expected size and endpoints, so a bad regeneration cannot land silently', () => {
    // 187 is the FULL closure, verified against the live vocabulary by
    // `scripts/verify-schema-org-closure.ts` (run it when a Schema.org release lands; it diffs both
    // directions and exits non-zero on any difference). The first vendored list was 168 — a bad
    // generator, not a stale vocabulary — and nothing here would have caught it.
    expect(SCHEMA_ORG_ORGANIZATION_TYPES).toHaveLength(187);
    expect(new Set(SCHEMA_ORG_ORGANIZATION_TYPES).size).toBe(187); // no duplicates
    const sorted = [...SCHEMA_ORG_ORGANIZATION_TYPES].sort();
    expect(SCHEMA_ORG_ORGANIZATION_TYPES).toEqual(sorted); // generated in sorted order
    // CONTENT, not just shape. Length + sortedness + two membership lists are all blind to a
    // NET-NEUTRAL substitution: swapping `PawnShop` for `PawnShopp` keeps the count, keeps the sort
    // order, and touches neither the must-contain nor the must-not-contain list — so it passed every
    // assertion above. A digest pins all 187 members at once, and regeneration is then a deliberate
    // act: the digest has to be updated with the list, in the same commit, by whoever changed it.
    const digest = createHash('sha256').update(SCHEMA_ORG_ORGANIZATION_TYPES.join('\n')).digest('hex');
    expect(digest, 'closure digest — update ONLY when regenerating from a new Schema.org release').toBe(
      SCHEMA_ORG_CLOSURE_SHA256,
    );
  });

  it('contains the subtree members that hand-curated lists kept missing', () => {
    for (const t of ['Organization', 'WebSite', 'LocalBusiness', 'Store', 'Plumber', 'Bakery',
                     'Dentist', 'Attorney', 'ClothingStore', 'Winery', 'TattooParlor',
                     'Physiotherapy', 'Dermatology', 'Pediatric', 'PrimaryCare', 'Nursing']) {
      expect(SCHEMA_ORG_ORGANIZATION_TYPES, t).toContain(t);
    }
  });

  it('is DISJOINT from every non-Organization branch of the vocabulary', () => {
    for (const t of ['Person', 'Place', 'Product', 'Event', 'CreativeWork', 'Article', 'WebPage',
                     'Thing', 'Brand', 'Service', 'JobPosting', 'Review', 'Offer']) {
      expect(SCHEMA_ORG_ORGANIZATION_TYPES, t).not.toContain(t);
    }
  });
});

describe('analyzeJsonLd — the entity scan reaches entities wherever they are declared', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  it('YOAST / RANKMATH shape — Organization inside @graph', () => {
    // The shape that DID work before the recursion widened, kept so the fix cannot regress it.
    const json = `{"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","url":"https://ex.com/"},
      {"@type":"Organization","name":"Acme","url":"https://ex.com/"}
    ]}`;
    expect(load(json).jsonLd.hasEntityType).toBe(true);
  });

  it('NESTED PUBLISHER shape — Organization under an ordinary property', () => {
    // The shape that did NOT work: `@graph`-only recursion reported "this homepage declares no
    // Organization" on a homepage that declares one, costing 3 points. Plain Article markup and the
    // Squarespace/Wix output both look like this.
    expect(load('{"@type":"BlogPosting","publisher":{"@type":"Organization","name":"Acme"}}').jsonLd.hasEntityType).toBe(true);
    expect(load('{"@type":"Article","isPartOf":{"@type":"WebSite","name":"Acme"}}').jsonLd.hasEntityType).toBe(true);
    // An `author.worksFor` case used to sit here as well. It is gone, not relocated: `author` no longer
    // credits in any form (owner ruling — the reporter's employer is the wire service, not the site),
    // and this case is about PUBLISHER shapes regardless. The author axis is pinned in full below.
  });

  it('an entity inside an ARRAY under a SELF-DECLARING property is reached', () => {
    expect(load('{"@type":"WebPage","publisher":[{"@type":"Thing"},{"@type":"Organization"}]}').jsonLd.hasEntityType).toBe(true);
  });

  it('every SELF-DECLARING position is credited', () => {
    for (const key of ['publisher', 'isPartOf', 'mainEntityOfPage']) {
      expect(load(`{"@type":"WebPage","${key}":{"@type":"Organization"}}`).jsonLd.hasEntityType, key).toBe(true);
    }
  });

  it('THIRD-PARTY positions are NOT credited — a false positive is worse than a false negative', () => {
    // The finding this credit suppresses says "no structured anchor for WHO THIS SITE IS". Crediting a
    // resold brand, a hiring org, or a competitor under review is a factually wrong +3 points. The
    // first attempt at this fix descended into EVERY property and did exactly that.
    const cases: [string, string][] = [
      ['brand', '{"@type":"Product","brand":{"@type":"Organization","name":"Nike"}}'],
      ['itemReviewed', '{"@type":"Review","itemReviewed":{"@type":"Organization","name":"Competitor"}}'],
      ['hiringOrganization', '{"@type":"JobPosting","hiringOrganization":{"@type":"Organization"}}'],
      ['seller', '{"@type":"Offer","seller":{"@type":"Organization"}}'],
      ['sponsor', '{"@type":"Event","sponsor":{"@type":"Organization"}}'],
      ['funder', '{"@type":"Article","funder":{"@type":"Organization"}}'],
      ['about', '{"@type":"WebPage","about":{"@type":"Organization"}}'],
      ['author (direct)', '{"@type":"Article","author":{"@type":"Organization","name":"Reuters"}}'],
      ['provider (MIT on a course directory)', '{"@type":"Course","provider":{"@type":"EducationalOrganization","name":"MIT"}}'],
      ['mainEntity (someone else\'s restaurant on a listings page)', '{"@type":"ItemList","mainEntity":{"@type":"Restaurant"}}'],
      // Schema.org: "the Organization on whose behalf the creator was working" — the wire service on
      // syndicated content. The NAME reads like self-declaration; the definition does not.
      ['sourceOrganization (AP on syndicated content)', '{"@type":"Article","sourceOrganization":{"@type":"NewsMediaOrganization","name":"AP"}}'],
      ['organizer', '{"@type":"Event","organizer":{"@type":"Organization"}}'],
      ['non-schema blob', '{"config":{"widgets":[{"@type":"Organization"}]}}'],
    ];
    for (const [name, json] of cases) {
      expect(load(json).jsonLd.hasEntityType, name).toBe(false);
    }
  });

  it('the persisted row can never SELF-CONTRADICT on a normal document', () => {
    // The all-properties walk could report hasEntityType=false while `types` contained "Organization",
    // because the two walks used different traversal rules. On any shape `collectTypes` reaches
    // (top-level and @graph), the entity scan must agree.
    for (const json of [
      '{"@type":"Organization"}',
      '{"@graph":[{"@type":"WebPage"},{"@type":"Organization"}]}',
      '{"@type":["WebSite","Thing"]}',
    ]) {
      const j = load(json).jsonLd;
      const typesSayEntity = j.types.some((t) => t === 'Organization' || t === 'WebSite');
      expect(j.hasEntityType, json).toBe(typesSayEntity);
    }
  });

  it('still FALSE when no entity is declared anywhere, however deeply nested', () => {
    // The widened walk must not become "any JSON-LD at all" — that would trade a false negative for a
    // false positive and the finding would stop meaning anything.
    // NOTE: `publisher: NewsMediaOrganization` is now correctly TRUE — it is an Organization subtype
    // in the generated closure, reached through a self-declaring position. The point of this case is
    // that a document with no entity ANYWHERE stays false, so the fixture uses non-Organization types.
    expect(load('{"@type":"Article","author":{"@type":"Person","name":"A"},"publisher":{"@type":"Thing"}}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"@type":"Article","publisher":{"@type":"Person","name":"Solo Blogger"}}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"@type":"WebPage","about":{"nested":{"deeper":{"name":"no types here"}}}}').jsonLd.hasEntityType).toBe(false);
  });

  it('the GENERATED Organization subtree is credited — including the deep subtypes', () => {
    // Two hand-curated lists each missed the shapes the audience ships. `Plumber` is the sharpest
    // case: it is the comment's own example AND the type Google's local-business guidance tells a
    // plumber to use, and a 13-name list still missed it.
    for (const t of [
      'Organization', 'WebSite', 'LocalBusiness', 'Store', 'OnlineStore', 'Restaurant', 'Corporation',
      'NGO', 'EducationalOrganization', 'GovernmentOrganization', 'MedicalOrganization',
      'SportsOrganization', 'PerformingGroup',
      'Plumber', 'Bakery', 'Dentist', 'Attorney', 'ClothingStore', 'HomeAndConstructionBusiness',
      'ProfessionalService', 'NewsMediaOrganization', 'LodgingBusiness', 'Airline',
      // The 19 MedicalBusiness subclasses the first generator dropped: they are typed
      // `schema:MedicalSpecialty`, not `rdfs:Class`, so an @type filter removed every one while
      // their siblings MedicalClinic and Dentist kept working — which is what hid the hole.
      'Physiotherapy', 'Dermatology', 'Pediatric', 'PrimaryCare', 'Psychiatric', 'Nursing',
    ]) {
      expect(load(`{"@type":"${t}"}`).jsonLd.hasEntityType, t).toBe(true);
    }
  });

  it('FULL-IRI forms are credited, in both spellings', () => {
    for (const t of [
      'https://schema.org/Organization', 'http://schema.org/LocalBusiness',
      'https://schema.org/WebSite', 'https://schema.org/Plumber',
    ]) {
      expect(load(`{"@type":"${t}"}`).jsonLd.hasEntityType, t).toBe(true);
    }
    expect(load('{"@type":"WebPage","publisher":{"@type":"Plumber","name":"Joe Plumbing"}}').jsonLd.hasEntityType).toBe(true);
  });

  it('matching is EXACT against the closure — never substring, and never a non-Organization', () => {
    // `substring('Organization')` would match `hiringOrganization`/`sourceOrganization`, which are
    // PROPERTY names. And the closure must not have swallowed unrelated branches.
    for (const t of ['OrganizationRole', 'MyOrganization', 'WebSiteTemplate', 'Thing',
                     'Person', 'Product', 'Review', 'JobPosting', 'Event', 'Article', 'Place']) {
      expect(load(`{"@type":"${t}"}`).jsonLd.hasEntityType, t).toBe(false);
    }
  });

  it('AUTHOR NEVER credits — in any shape, including author.worksFor', () => {
    // OWNER RULING (round 8), reversing an earlier owner instruction. `author` had been traversal-only
    // so that `author.worksFor` — an employer — could still be credited. It cannot: on the syndicated
    // article that makes `author` untrustworthy in the first place, the reporter's `worksFor` IS the
    // wire service, and a guest post's author often has a day job elsewhere. The position does not
    // ONLY mean self-declaration, and the rule is that ambiguous means exclude.
    //
    // The asymmetry is the point: a false positive here SUPPRESSES a true `missing_entity_link` and
    // hands +3.0 to a site that genuinely does not declare itself. A false negative merely asks a site
    // to add markup. Every shape below must be FALSE — object, array, nested array, @type array —
    // because the previous mechanism shipped broken and was re-fixed once already on the array axis.
    const shapes = [
      // the position that used to credit, in every form JSON-LD permits
      '{"@type":"Article","author":{"@type":"Person","worksFor":{"@type":"Organization"}}}',
      '{"@type":"Article","author":[{"@type":"Person","worksFor":{"@type":"Organization"}}]}',
      '{"@type":"Article","author":[{"@type":"Person","worksFor":[{"@type":"LocalBusiness"}]}]}',
      '{"@type":"Article","author":[{"@type":"Person","worksFor":{"@type":["Thing","Organization"]}}]}',
      '{"@type":"NewsArticle","author":[{"@type":"Person","worksFor":{"@type":"NewsMediaOrganization","name":"Associated Press"}}]}',
      // …and everything beneath `author` that never credited, which must stay that way
      '{"@type":"Article","author":{"@type":"Organization","name":"Reuters"}}',
      '{"@type":"Article","author":[{"@type":"Organization","name":"Reuters"}]}',
      '{"@type":"Article","author":{"@type":"LocalBusiness"}}',
      '{"@type":"Article","author":{"@type":"Person","publisher":{"@type":"Organization"}}}',
      '{"@type":"Article","author":{"@type":"Person","isPartOf":{"@type":"WebSite"}}}',
      '{"@type":"Article","author":{"@type":"Person","worksFor":{"@type":"Person","publisher":{"@type":"Organization"}}}}',
      // nested author-under-author, which used to credit through an explicitly uncreditable subtree
      '{"@type":"Article","author":{"@type":"Person","author":{"@type":"Person","worksFor":{"@type":"Organization"}}}}',
      '{"@type":"Article","publisher":{"@type":"Thing","author":[{"@type":"Person","worksFor":{"@type":"Organization"}}]}}',
      // a root-level worksFor with no author at all
      '{"@type":"Article","worksFor":{"@type":"Organization"}}',
      // NOTE: a non-object-element case used to sit here. It was VACUOUS — `author` is no longer
      // descended at all, so `[null,"Jane",42,…]` is trivially false and exercises nothing. The real
      // non-object coverage now lives under a DESCENDED position, below.
      '{"@type":"Article","author":[null,"Jane Doe",42,{"@type":"Organization"}]}',
    ];
    for (const json of shapes) {
      expect(load(json).jsonLd.hasEntityType, json.slice(0, 80)).toBe(false);
    }
  });

  it('removing author does not disturb the positions that DO credit', () => {
    // The removal deleted a whole mechanism, so the remaining crediting surface is re-pinned here
    // rather than assumed intact — a narrowing that quietly took a legitimate position with it would be
    // the same defect in the opposite direction.
    expect(load('{"@type":"Organization"}').jsonLd.hasEntityType).toBe(true);
    expect(load('{"@graph":[{"@type":"Article"},{"@type":"LocalBusiness"}]}').jsonLd.hasEntityType).toBe(true);
    expect(load('{"@type":"Article","publisher":{"@type":"Organization"}}').jsonLd.hasEntityType).toBe(true);
    expect(load('{"@type":"WebPage","isPartOf":{"@type":"WebSite"}}').jsonLd.hasEntityType).toBe(true);
    expect(load('{"@type":"Article","mainEntityOfPage":{"@type":"Organization"}}').jsonLd.hasEntityType).toBe(true);
    // Non-object elements under a DESCENDED position must neither throw nor credit — this is where
    // that robustness is actually exercised, since `publisher` IS walked and `author` is not.
    expect(load('{"@type":"Article","publisher":[null,"Acme Inc",42,true]}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"@graph":[null,42,"x",{"@type":"Organization"}]}').jsonLd.hasEntityType).toBe(true);
    // …and a third-party Organization still does not credit.
    expect(load('{"@type":"Course","provider":{"@type":"Organization","name":"MIT"}}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"@type":"WebPage","mainEntity":{"@type":"Restaurant"}}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"@type":"Article","sourceOrganization":{"@type":"Organization"}}').jsonLd.hasEntityType).toBe(false);
  });

  it('the widened walk is still bounded by the SAME depth and node budgets', () => {
    // Widening redistributes a fixed budget over more of the document; it must not widen the ceiling.
    let json = '{"@type":"Organization"}';
    for (let i = 0; i < 200; i++) json = `{"nested":${json}}`;
    expect(load(json).jsonLd.hasEntityType).toBe(false); // past the depth bound
    const wide = Array.from({ length: 60_000 }, (_, i) => `"k${i}":{"name":"n"}`).join(',');
    expect(load(`{${wide},"last":{"@type":"Organization"}}`).jsonLd.hasEntityType).toBe(false); // past the node budget
  });
});

describe('analyzeJsonLd — each walk bound pinned by BEHAVIOUR, not by its own constant', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  it('the DEPTH bound stops collection — a type nested past it is absent, one inside it is present', () => {
    const nest = (levels: number) => {
      let json = '{"@type":"DeepMarker"}';
      for (let i = 0; i < levels; i++) json = `{"@graph":[${json}]}`;
      return json;
    };
    // Each @graph level costs 2 (object → array → object), so the reachable level count is DEPTH/2.
    expect(load(nest(4)).jsonLd.types).toContain('DeepMarker');
    expect(load(nest(40)).jsonLd.types).not.toContain('DeepMarker');
  });

  it('the NODE budget stops collection — a type behind more nodes than the budget is absent', () => {
    // Entries WITHOUT `@type` accumulate no types, so the count cap cannot end this walk: only the
    // node budget can. That is what makes this a test of the budget specifically.
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `{"name":"n${i}"}`).join(',');
    expect(load(`{"@graph":[${filler(100)},{"@type":"LateMarker"}]}`).jsonLd.types).toContain('LateMarker');
    expect(load(`{"@graph":[${filler(20_000)},{"@type":"LateMarker"}]}`).jsonLd.types).not.toContain('LateMarker');
  });

  it('the node budget is SHARED across script blocks (a second block cannot restart it)', () => {
    const filler = Array.from({ length: 20_000 }, (_, i) => `{"name":"n${i}"}`).join(',');
    const html = `<head>
      <script type="application/ld+json">{"@graph":[${filler}]}</script>
      <script type="application/ld+json">{"@type":"SecondBlockMarker"}</script>
      </head><body></body>`;
    expect(analyzeLegibility(cheerio.load(html)).jsonLd.types).not.toContain('SecondBlockMarker');
  });

  it('a @type ARRAY is charged per element, so it cannot walk unbounded on one node charge', () => {
    const huge = Array.from({ length: 20_000 }, (_, i) => `"T${i}"`).join(',');
    const l = load(`{"@graph":[{"@type":[${huge}]},{"@type":"AfterTheArray"}]}`);
    expect(l.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
    expect(l.jsonLd.types).not.toContain('AfterTheArray');
  });

  it('the @type-ARRAY per-element charge is observable ACROSS script blocks (storage walk)', () => {
    // The previous assertion for this leaned on the count cap, which short-circuits before the budget
    // matters — so removing the charge survived. Sharing the budget across blocks is what makes the
    // charge observable: a huge @type array in block 1 must starve block 2.
    // NUMERIC elements: `addType` is never called, so the count cap cannot end the walk and only the
    // per-element budget charge can. With string elements the cap fired first and the mutant survived.
    const huge = Array.from({ length: 6000 }, (_, i) => String(i)).join(',');
    const html = `<head>
      <script type="application/ld+json">{"@type":[${huge}]}</script>
      <script type="application/ld+json">{"@type":"SecondBlock"}</script>
      </head><body></body>`;
    expect(analyzeLegibility(cheerio.load(html)).jsonLd.types).not.toContain('SecondBlock');
  });

  it('the @type-ARRAY per-element charge is observable in the ENTITY scan too', () => {
    const huge = Array.from({ length: 60_000 }, (_, i) => `"X${i}"`).join(',');
    const html = `<head>
      <script type="application/ld+json">{"@type":[${huge}]}</script>
      <script type="application/ld+json">{"@type":"Organization"}</script>
      </head><body></body>`;
    expect(analyzeLegibility(cheerio.load(html)).jsonLd.hasEntityType).toBe(false);
  });

  it('DEDUPES ON THE RAW VALUE — distinct long types are not collapsed by truncation', () => {
    // Truncating before deduping collapsed 20 000 distinct type IRIs sharing a 100-char prefix into a
    // SINGLE entry, which also made a byte assertion pass for the wrong reason.
    const long = (i: number) => `${'T'.repeat(150)}${i}`;
    const l = load(`{"@graph":[{"@type":"${long(1)}"},{"@type":"${long(2)}"},{"@type":"${long(3)}"}]}`);
    expect(l.jsonLd.types.length).toBe(3);
  });
});
