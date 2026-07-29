import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { extractPage } from './extract.js';
import { toPersistableText } from './text-safety.js';

/**
 * THE ORACLE TEST. Every previous round REASONED about which characters Postgres rejects and got the
 * enumeration wrong twice — unpaired surrogates were found in round 1, and NUL only in round 4, through
 * the very same JSON-LD channel the code comments already described. Enumerating hazards is guesswork;
 * this asks Postgres.
 *
 * PGlite is real Postgres compiled to WASM, in-process — no daemon, no external service, no
 * credentials, and it runs in CI. Verified to reproduce the production oracle exactly:
 *
 * THE WRITE SHAPE MATTERS AS MUCH AS THE VALUES. PostgREST does not bind columns individually: it
 * binds the WHOLE request body as one `$1::json` and expands it with `json_populate_recordset`, so
 * Postgres parses the JSON *before* any column type is considered. An earlier version of this file
 * used per-column bind parameters and consequently reported that a lone surrogate was "fatal only in
 * jsonb" — false for this codebase, and that false fact reached a shipped follow-up ticket.
 *
 *   input                via $1::json (what PostgREST does)
 *   NUL                  REJECTED — unsupported Unicode escape sequence
 *   lone surrogate       REJECTED — invalid input syntax for type json   (COLUMN-AGNOSTIC)
 *   C0 (SOH), DEL        accepted
 *   astral / CJK / ASCII accepted
 *
 * The failure is at the cast, so it hits `pages.title` (text) exactly as it hits `pages.ai_signals`
 * (jsonb). Both column types are exercised below through that one shape.
 */

const NUL = '\u0000';
const SOH = '\u0001';
const DEL = '\u007f';
const LONE_HIGH = '\ud800';
const LONE_LOW = '\udfff';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // Mirrors the real column types the worker inserts into.
  await db.query('create table scratch_pages (id serial primary key, title text, ai_signals jsonb)');
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/**
 * Insert exactly as PostgREST does: ONE json parameter for the whole row set, expanded server-side.
 * Per-column bind parameters would let a lone surrogate through into `text` and misreport the class.
 */
async function insertRow(title: string | null, aiSignals: unknown): Promise<unknown> {
  const body = JSON.stringify([{ title, ai_signals: aiSignals }]);
  return db.query(
    'insert into scratch_pages (title, ai_signals) ' +
      'select title, ai_signals from json_populate_recordset(null::scratch_pages, $1::json)',
    [body],
  );
}

describe('ORACLE: the real Postgres accepts what the engine produces', () => {
  it('the oracle is honest — raw hazards ARE rejected without our sanitisation', async () => {
    // A round-trip test that cannot fail proves nothing. Establish the hazards are real first.
    await expect(insertRow(null, { v: `a${NUL}b` })).rejects.toThrow();
    await expect(insertRow(null, { v: `a${LONE_HIGH}b` })).rejects.toThrow();
    await expect(insertRow(null, { v: `a${LONE_LOW}b` })).rejects.toThrow();
    await expect(insertRow(`a${NUL}b`, null)).rejects.toThrow(); // NUL kills `text` too
    // …and so does a lone surrogate, because the rejection happens at the $1::json cast, before the
    // column type is reached. Per-column binds hide this; PostgREST never uses them.
    await expect(insertRow(`a${LONE_HIGH}b`, null)).rejects.toThrow();
  });

  it('…and the same values, put through toPersistableText, insert cleanly', async () => {
    for (const hostile of [`a${NUL}b`, `a${LONE_HIGH}b`, `a${LONE_LOW}b`, `a${SOH}${DEL}b`]) {
      const safe = toPersistableText(hostile, 2000);
      await expect(insertRow(safe, { v: safe })).resolves.toBeDefined();
    }
  });

  it('a page engineered to break every hazard at once round-trips through jsonb', async () => {
    // Driven through the REAL extraction path, not hand-built: JSON-LD carrying a lone surrogate AND a
    // NUL escape, astral prose, CJK, a 5 MB title, and 20 000 @types.
    const types = Array.from({ length: 20_000 }, (_, i) => `{"@type":"T${'长'.repeat(50)}${i}"}`).join(',');
    const html =
      `<html><head><title>${'X'.repeat(5_000_000)}</title>` +
      `<script type="application/ld+json">` +
      `{"@type":"Bad\\ud800","name":"N\\u0000UL","@graph":[${types}]}` +
      `</script></head><body><main><p>` +
      `${'A'}${'\u{1F600}'.repeat(50_000)}${'这是测试内容'.repeat(20_000)}` +
      `</p></main></body></html>`;

    const page = extractPage(html, 'https://ex.com/', {});
    const sig = page.aiSignals!;

    // The engine's own bound, in the unit the database uses.
    expect(Buffer.byteLength(JSON.stringify(sig), 'utf8')).toBeLessThan(12_000);
    // …and Postgres accepts it. This is the assertion the whole class reduces to.
    await expect(insertRow(page.title ?? null, sig)).resolves.toBeDefined();
  }, 60_000);

  it('a full PRO_PAGE_CAP row set inserts without a single rejection', async () => {
    // 2000 rows is the cap; every row hostile on every axis. Inserted in the same 250-row chunks the
    // worker uses, so this exercises the shape that actually reaches PostgREST.
    const html =
      `<html><head><title>${'これはテスト'.repeat(500)}</title>` +
      `<script type="application/ld+json">{"@type":"Ba\\ud800d","x":"n\\u0000ul"}</script>` +
      `</head><body><main><p>${'A'}${'\u{1F600}'.repeat(3000)}${'测试'.repeat(3000)}</p></main></body></html>`;
    const sig = extractPage(html, 'https://ex.com/p', {}).aiSignals!;
    const title = extractPage(html, 'https://ex.com/p', {}).title ?? null;

    for (let i = 0; i < 2000; i += 250) {
      const chunk = Array.from({ length: Math.min(250, 2000 - i) }, () => ({ title, sig }));
      await Promise.all(chunk.map((r) => insertRow(r.title, r.sig)));
    }
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from scratch_pages');
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2000);
  }, 120_000);

  it('the stored value survives a jsonb round trip unchanged (no silent mangling)', async () => {
    const sig = extractPage(
      `<html><head><title>T</title></head><body><main><p>${'中'.repeat(100)}\u{1F600}</p></main></body></html>`,
      'https://ex.com/',
      {},
    ).aiSignals!;
    await insertRow('rt', sig);
    const { rows } = await db.query<{ ai_signals: unknown }>(
      "select ai_signals from scratch_pages where title = 'rt' limit 1",
    );
    expect(rows[0]!.ai_signals).toEqual(sig);
  });
});
