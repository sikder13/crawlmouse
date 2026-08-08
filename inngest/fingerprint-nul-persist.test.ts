import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { templateKeyFor } from '@crawlmouse/engine';
import { boundFingerprintForPersist, safeFingerprintForPersist } from './persist-helpers';
import type { CrawlFingerprint } from '@crawlmouse/types';

/**
 * A CRAWLED `%00` MUST NOT DESTROY A SUCCESSFUL AUDIT.
 *
 * `templateKeyFor` percent-DECODES each path segment, so an ordinary anchor on any page we crawl —
 * `<a href="/%00section/some-slug">` — produces a stratum key containing a RAW NUL. Postgres rejects
 * that in `jsonb` (`unsupported Unicode escape sequence`), so `persistAuditResults`' completion
 * `update` throws and `onFailure` marks the audit FAILED. A crawl that succeeded is destroyed, from
 * one link, with no cooperation from the crawled server.
 *
 * It was unreachable only because `analyzeCrawl` dropped the fingerprint entirely (0 of 231 audits
 * carried one). Threading it is what made it live, which is why this test ships with that change.
 *
 * THE ASSERTION IS AGAINST REAL POSTGRES, not a mock. The failure mode is a server-side parse error;
 * a stub would have agreed with whatever we did — which is exactly how the defect reached production
 * in the first place.
 *
 * ⚠ THE SANITIZATION IS AT THE PERSIST BOUNDARY ONLY. `templateKeyFor` is unchanged and must stay so:
 * the in-memory key is the SELECTION IDENTITY that decides which URLs are sampled, so normalising it
 * at the source would move grades to fix a storage problem.
 */

const NUL_HREF = 'https://example.com/%00section/some-slug-here';

function fingerprintFrom(key: string): CrawlFingerprint {
  return {
    version: 1,
    discoveredCount: 1,
    selectedCount: 1,
    digest: 'deadbeef',
    strata: [{ templateKey: key, discovered: 1, selected: 1 }],
    seed: 'cm-frontier-v1',
    strataTotal: 1,
    strataWithheld: 0,
  } as CrawlFingerprint;
}

/** The exact write `persistAuditResults` performs: a jsonb column set from JSON.stringify'd input. */
async function insertFingerprint(db: PGlite, fp: CrawlFingerprint): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.query('insert into fp (v) values ($1::jsonb)', [JSON.stringify(fp)]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

describe('a crawled %00 link cannot fail the audit', () => {
  it('templateKeyFor really does emit a raw NUL — the premise, not an assumption', () => {
    const key = templateKeyFor(NUL_HREF);
    expect(key.split('').some((c) => c.charCodeAt(0) === 0), 'no NUL: the premise changed').toBe(true);
  });

  it('ANTI-VACUITY: the unsanitized key is rejected by real Postgres', async () => {
    // If this ever stops failing, the test below proves nothing.
    const db = new PGlite();
    await db.exec('create table fp (id serial primary key, v jsonb)');
    const res = await insertFingerprint(db, fingerprintFrom(templateKeyFor(NUL_HREF)));
    expect(res.ok, 'raw NUL was accepted — the hazard this guards has changed').toBe(false);
    expect(res.error ?? '').toMatch(/unicode|escape|invalid/i);
  }, 60_000);

  it('the persist boundary sanitizes it, and the row INSERTS', async () => {
    const db = new PGlite();
    await db.exec('create table fp (id serial primary key, v jsonb)');
    const bounded = boundFingerprintForPersist(fingerprintFrom(templateKeyFor(NUL_HREF)));

    expect(bounded.strata[0]!.templateKey.split('').some((c) => c.charCodeAt(0) === 0)).toBe(false);
    const res = await insertFingerprint(db, bounded);
    expect(res.ok, `insert failed: ${res.error}`).toBe(true);

    // …and the fingerprint is still there and still useful — sanitizing must not empty it.
    const { rows } = await db.query<{ v: CrawlFingerprint }>('select v from fp');
    expect(rows[0]!.v.strata[0]!.templateKey).toContain('section');
    expect(rows[0]!.v.strata[0]!.templateKey).toContain('{slug}');
    expect(rows[0]!.v.discoveredCount).toBe(1);
  }, 60_000);

  it('every control character survives the round trip, not just NUL', () => {
    // §10's matcher-class rule: the attribute the sanitizer keys on is the CHARACTER, so vary it.
    // 0x01-0x1f do not trip 22P05 but do inflate the row; NUL is the one that throws.
    for (const code of [0x00, 0x01, 0x07, 0x1f, 0x7f]) {
      const key = `/a${String.fromCharCode(code)}b/{slug}`;
      const out = boundFingerprintForPersist(fingerprintFrom(key)).strata[0]!.templateKey;
      expect(out.charCodeAt(1), `0x${code.toString(16)} survived into the persisted key`).not.toBe(code);
      expect(JSON.stringify(out)).not.toContain('\\u0000');
    }
  });

  it('bounds a pathological key rather than writing 200 KB into one row', () => {
    // Intermediate segments stay literal, so a crawled URL can carry ~2 KB of them. 100 strata of
    // that is ~200 KB in one `audits.fingerprint`.
    const huge = `/${'x'.repeat(1500)}/{slug}`;
    const out = boundFingerprintForPersist(fingerprintFrom(huge)).strata[0]!.templateKey;
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(256);
    expect(out.startsWith('/xxx')).toBe(true);
  });

  it('A TRUNCATED KEY SAYS SO, AND TWO LONG SECTIONS DO NOT COLLIDE', () => {
    // Cutting at a byte budget alone is a silent, lossy rename. These are DIFFERENT sections of a
    // site; before the tag they persisted as the same 256-byte key, and naming which section moved is
    // the fingerprint's entire job. Nothing recorded that a cut had happened, either (§10).
    const a = boundFingerprintForPersist(fingerprintFrom(`/${'x'.repeat(1500)}/{slug}`)).strata[0]!.templateKey;
    const b = boundFingerprintForPersist(fingerprintFrom(`/${'x'.repeat(1500)}y/{slug}`)).strata[0]!.templateKey;

    expect(a, 'the cut must be self-declaring').toMatch(/~[0-9a-f]{8}$/);
    expect(b).toMatch(/~[0-9a-f]{8}$/);
    expect(a, 'two distinct sections must not share a persisted name').not.toBe(b);
    expect(Buffer.byteLength(a, 'utf8')).toBeLessThanOrEqual(256);
    expect(Buffer.byteLength(b, 'utf8')).toBeLessThanOrEqual(256);
  });

  it('the tag is DETERMINISTIC — the same section keeps its name across two crawls', () => {
    // A fingerprint whose names changed run to run would report every section as having moved.
    const key = `/${'z'.repeat(900)}/{slug}`;
    const first = boundFingerprintForPersist(fingerprintFrom(key)).strata[0]!.templateKey;
    const second = boundFingerprintForPersist(fingerprintFrom(key)).strata[0]!.templateKey;
    expect(first).toBe(second);
  });

  it('an UNCUT key is never tagged — the common case is untouched', () => {
    const out = boundFingerprintForPersist(fingerprintFrom('/event/{slug}')).strata[0]!.templateKey;
    expect(out).toBe('/event/{slug}');
    expect(out).not.toContain('~');
  });

  it('THE WALK IS STRUCTURAL: a field nobody listed is sanitized anyway', async () => {
    // ⚠ THIS IS THE GATE FINDING. The previous implementation was a hand-written three-field allowlist
    // under a comment claiming "EVERY crawled string in the fingerprint goes through the sanitizer… a
    // future field that forgets is the failure mode this is here to stop". A reviewer added one string
    // field to the fingerprint and one to a stratum: `...fp` and `{...s}` passed both through raw, and
    // both threw `unsupported Unicode escape sequence` at real Postgres. The comment asserted a
    // class-level guarantee that held only for the fields somebody had already looked at.
    //
    // This test IS the guarantee. It adds fields that deliberately do NOT exist in `CrawlFingerprint`
    // today, because the failure mode is the field added tomorrow.
    const db = new PGlite();
    await db.exec('create table fp (id serial primary key, v jsonb)');
    const NUL = String.fromCharCode(0);

    const withFuture = {
      ...fingerprintFrom('/ok/{slug}'),
      futureField: `/a${NUL}b`,
      nested: { deeper: [`/c${NUL}d`] },
      strata: [{ templateKey: '/ok/{slug}', discovered: 1, selected: 1, note: `/e${NUL}f` }],
    } as unknown as CrawlFingerprint;

    const bounded = boundFingerprintForPersist(withFuture);
    expect(JSON.stringify(bounded), 'a NUL survived the walk').not.toContain('\\u0000');

    const res = await insertFingerprint(db, bounded);
    expect(res.ok, `insert failed: ${res.error}`).toBe(true);

    // …and the walk preserved the data rather than emptying it.
    const { rows } = await db.query<{ v: unknown }>('select v from fp');
    const stored = JSON.stringify(rows[0]!.v);
    expect(stored).toContain('/ab');
    expect(stored).toContain('/cd');
    expect(stored).toContain('/ef');
  }, 60_000);

  it('A CONTROL-STRIP IS ALSO A LOSSY RENAME — the %00 collision R1 proved', () => {
    // The tag was applied only on the LENGTH path, so these two DIFFERENT sections of a site persisted
    // under one name, untagged: 1 distinct key of 2, via the same crawled `%00` as the original
    // blocker. The docstring called the tag "collision-resistant between distinct originals" — true of
    // the length path only. Hashing the RAW string rather than the sanitized one is what fixes it.
    const withNul = templateKeyFor('https://x.test/%00section/some-slug-here');
    const without = templateKeyFor('https://x.test/section/some-slug-here');
    expect(withNul, 'the premise: they differ in memory').not.toBe(without);

    const a = boundFingerprintForPersist(fingerprintFrom(withNul)).strata[0]!.templateKey;
    const b = boundFingerprintForPersist(fingerprintFrom(without)).strata[0]!.templateKey;

    expect(a, 'a stripped control character must declare itself').toMatch(/~[0-9a-f]{8}$/);
    expect(b, 'the untouched key must NOT be tagged').toBe(without);
    expect(a, 'two distinct sections must not share a persisted name').not.toBe(b);
  });

  it('N all-control keys do not all collapse onto the empty string', () => {
    const keys = ['', '', ''];
    const out = keys.map((k) => boundFingerprintForPersist(fingerprintFrom(k)).strata[0]!.templateKey);
    expect(new Set(out).size, `collapsed: ${JSON.stringify(out)}`).toBe(keys.length);
    for (const o of out) expect(o).toMatch(/^~[0-9a-f]{8}$/);
  });

  it('KEYS are sanitized, not only values', async () => {
    // ⚠ FOUND INDEPENDENTLY BY TWO REVIEWERS. `Object.entries` yields [k, v] and only `v` was walked,
    // so a crawled string in KEY position reached Postgres raw and threw the original crash verbatim.
    // `Record<templateKey, count>` is the obvious shape for this artifact — one refactor away.
    const db = new PGlite();
    await db.exec('create table fp (id serial primary key, v jsonb)');
    const NUL = String.fromCharCode(0);

    const keyed = {
      ...fingerprintFrom('/ok/{slug}'),
      byTemplate: { [`/a${NUL}b`]: 3 },
    } as unknown as CrawlFingerprint;

    const bounded = boundFingerprintForPersist(keyed);
    expect(JSON.stringify(bounded), 'a NUL survived in KEY position').not.toContain('\\u0000');

    const res = await insertFingerprint(db, bounded);
    expect(res.ok, `insert failed: ${res.error}`).toBe(true);
  }, 60_000);

  it('AN AUDIT NEVER FAILS FOR FINGERPRINT BOOKKEEPING — the consequence is closed, not just the cause', () => {
    // Every specific cause has been closed on its merits, and each gate then found the class one
    // radius smaller. This closes the CONSEQUENCE: whatever throws, the audit keeps its grade and
    // loses only its metadata. A cycle is the cheapest way to make the walk throw; it is not
    // producer-reachable, which is exactly why it is a good probe for the guard rather than for the walk.
    const cyclic = { ...fingerprintFrom('/a/{slug}') } as unknown as Record<string, unknown>;
    cyclic.self = cyclic;

    expect(() => boundFingerprintForPersist(cyclic as unknown as CrawlFingerprint)).toThrow();

    const errors: unknown[] = [];
    const out = safeFingerprintForPersist(cyclic as unknown as CrawlFingerprint, (e) => errors.push(e));
    expect(out, 'the fingerprint is dropped').toBeNull();
    expect(errors, 'and the drop is reported, not swallowed silently').toHaveLength(1);
  });

  it('the guard is transparent on the happy path', () => {
    // It must not become a reason the fingerprint goes missing when nothing is wrong.
    const fp = fingerprintFrom('/event/{slug}');
    expect(safeFingerprintForPersist(fp)).toEqual(boundFingerprintForPersist(fp));
  });

  it('non-string leaves are carried through unchanged', () => {
    // The walk must not coerce numbers, booleans or nulls while it is busy sanitizing strings.
    const fp = { ...fingerprintFrom('/a/{slug}'), discoveredCount: 41, selectedCount: 0 };
    const out = boundFingerprintForPersist(fp);
    expect(out.discoveredCount).toBe(41);
    expect(out.selectedCount).toBe(0);
    expect(out.version).toBe(1);
    expect(out.strata[0]!.discovered).toBe(1);
  });

  it('leaves an ordinary key untouched', () => {
    const out = boundFingerprintForPersist(fingerprintFrom('/event/{slug}'));
    expect(out.strata[0]!.templateKey).toBe('/event/{slug}');
    expect(out.seed).toBe('cm-frontier-v1');
    expect(out.digest).toBe('deadbeef');
  });
});
