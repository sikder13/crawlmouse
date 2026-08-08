import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { templateKeyFor } from '@crawlmouse/engine';
import { boundFingerprintForPersist } from './persist-helpers';
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
    // that is ~200 KB against a migration note documenting "~6.5 kB worst case, bounded".
    const huge = `/${'x'.repeat(1500)}/{slug}`;
    const out = boundFingerprintForPersist(fingerprintFrom(huge)).strata[0]!.templateKey;
    expect(out.length).toBeLessThanOrEqual(256);
    expect(out.startsWith('/xxx')).toBe(true);
  });

  it('leaves an ordinary key untouched', () => {
    const out = boundFingerprintForPersist(fingerprintFrom('/event/{slug}'));
    expect(out.strata[0]!.templateKey).toBe('/event/{slug}');
    expect(out.seed).toBe('cm-frontier-v1');
    expect(out.digest).toBe('deadbeef');
  });
});
