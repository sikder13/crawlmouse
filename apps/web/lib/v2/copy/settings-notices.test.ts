/**
 * What /settings and /settings/delete say after a form comes back (CC-27b review, item 6): the
 * success lines, and a sentence for each refusal code the routes behind them can answer. The codes
 * are read from the TypeScript sources below, in the forms `codesIn` matches, and from three SQL
 * functions in the forms `sqlCodesIn` matches: a code added in one of those forms without a sentence
 * here turns this red; a code written in another form, or in another function, is not seen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFUSAL_SENTENCES, SETTINGS_NOTICES, settingsNotice } from './settings-notices';

const WEB = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

/** Every quoted code passed as a refusal in the sources a form on these pages reaches. */
function codesIn(src: string): string[] {
  const out = new Set<string>();
  for (const re of [
    /(?:refuse|refused|no)\(\s*\d{3},\s*'([a-z][a-z0-9_]*)'/g,
    /code: '([a-z][a-z0-9_]*)'/g,
    /^\s{2}([a-z][a-z0-9_]*): \d{3},$/gm,
  ])
    for (const m of src.matchAll(re)) out.add(m[1]!);
  return [...out];
}

const SOURCES = [
  'app/api/account/route.ts',
  'lib/v2/account/profile.ts',
  'lib/v2/account/email-change.ts',
  'lib/v2/account/deletion.ts',
  'app/api/alert-rules/route.ts',
  'lib/v2/account/alert-rules.ts',
];

/** The SQL functions whose codes reach the delete step through `account_deletion_blocked`. */
const SQL_FUNCTIONS = ['account_deletion_blocked', 'deletion_refusal', 'erase_person_refusals'];
const MIGRATION = '../../infra/supabase/migrations/20261112000002_v2_027b_account.sql';

/** The body of `name`'s definition in the migration: from its `create` to the next `$$;`. */
function sqlBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name} in the migration`);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
}

/**
 * The codes a SQL body names in two forms: a refusal row of `erase_person_refusals`
 * (`select <n>, <key>, '<code>'`, on one line or across lines), and a literal `'<code>'` after a
 * `then` or an `else`. A code a body names in any other form is not read.
 */
function sqlCodesIn(body: string): string[] {
  const out = new Set<string>();
  for (const re of [
    /select\s+\d+(?:\s+as\s+o)?,\s+[^,]+?(?:\s+as\s+k)?,\s+'([a-z][a-z0-9_]*)'/g,
    /\b(?:then|else) '([a-z][a-z0-9_]*)'/g,
  ])
    for (const m of body.matchAll(re)) out.add(m[1]!);
  return [...out];
}

const sqlCodes = (() => {
  const sql = read(MIGRATION);
  return [...new Set(SQL_FUNCTIONS.flatMap((f) => sqlCodesIn(sqlBody(sql, f))))].sort();
})();

describe('sqlCodesIn', () => {
  it('reads a refusal row on one line, one written across lines, and a then/else literal', () => {
    const body = [
      "select 1 as o, s.account_id::text as k, 'one_line' as code, 'm' as message",
      'union all',
      'select 3,',
      "       sb.id, 'two_lines',",
      "       'subscription ' || sb.id",
      "select case when x then 'from_then' else 'from_else' end",
    ].join('\n');
    expect(sqlCodesIn(body).sort()).toEqual(['from_else', 'from_then', 'one_line', 'two_lines']);
  });
});

describe('the refusal sentences', () => {
  const codes = [...new Set([...SOURCES.flatMap((p) => codesIn(read(p))), ...sqlCodes])].sort();

  it('the migration’s functions name the codes the delete step can show, so the scan reads them', () => {
    expect(sqlCodes).toEqual(
      expect.arrayContaining(['email_change_pending', 'others_seated', 'v1_subscription']),
    );
  });

  it('the sources answer the codes the coordinator listed, so the scan reads them', () => {
    for (const c of [
      'deletion_pending',
      'rate_limited',
      'email_change_pending',
      'role_refused',
      'email_change_owner_only',
      'invalid',
      'not_owner',
      'hostname_mismatch',
      'others_seated',
      'v1_subscription',
    ])
      expect(codes).toContain(c);
  });

  it('each code the routes can answer has its own sentence, not the generic one', () => {
    const missing = codes.filter((c) => !Object.hasOwn(REFUSAL_SENTENCES, c));
    expect(missing).toEqual([]);
    for (const c of codes) expect(REFUSAL_SENTENCES[c]).not.toBe(SETTINGS_NOTICES.unknown);
  });
});

describe('settingsNotice', () => {
  it('reads the success lines each page is sent back with', () => {
    expect(settingsNotice({ saved: '1' }, 'settings')).toEqual({
      tone: 'ok',
      text: SETTINGS_NOTICES.saved,
    });
    expect(settingsNotice({ email: 'sent' }, 'settings')).toEqual({
      tone: 'ok',
      text: SETTINGS_NOTICES.emailSent,
    });
    expect(settingsNotice({ sent: '1' }, 'delete')).toEqual({
      tone: 'ok',
      text: SETTINGS_NOTICES.deleteSent,
    });
    // Each page reads its own success line only.
    expect(settingsNotice({ sent: '1' }, 'settings')).toBeNull();
    expect(settingsNotice({ saved: '1' }, 'delete')).toBeNull();
  });

  it('reads an error code on either page, ahead of a success line', () => {
    expect(settingsNotice({ error: 'deletion_pending', saved: '1' }, 'settings')).toEqual({
      tone: 'error',
      text: REFUSAL_SENTENCES.deletion_pending,
    });
    expect(settingsNotice({ error: 'others_seated' }, 'delete')).toEqual({
      tone: 'error',
      text: REFUSAL_SENTENCES.others_seated,
    });
  });

  it('an unknown code, a prototype key or a repeated one gets the generic sentence', () => {
    for (const error of ['no_such_code', '__proto__', 'constructor', ['invalid', 'invalid']])
      expect(settingsNotice({ error }, 'settings')).toEqual({
        tone: 'error',
        text: SETTINGS_NOTICES.unknown,
      });
  });

  it('nothing in the query: no line', () => {
    expect(settingsNotice({}, 'settings')).toBeNull();
    expect(settingsNotice({ saved: '0', email: 'x' }, 'settings')).toBeNull();
  });
});

describe('the live_subscription sentence (fix round 3, item 2)', () => {
  it('claims nothing about the confirm, which sets only an active or trialing plan to end', () => {
    expect(REFUSAL_SENTENCES.live_subscription).not.toMatch(/confirm/i);
    expect(REFUSAL_SENTENCES.live_subscription).toMatch(/erased/);
  });
});
