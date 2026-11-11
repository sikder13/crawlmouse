/**
 * What /settings and /settings/delete say after a form comes back (CC-27b review, item 6): the
 * success lines, and a sentence for each refusal code the routes behind them can answer. The codes
 * are read from the routes' and modules' sources, so a code added there without a sentence here
 * turns this red.
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
 * The codes a SQL body names: the code column of `erase_person_refusals`' rows (`select <n>, <key>,
 * '<code>'`), and `'<code>'` returned from a `then` or an `else`.
 */
function sqlCodesIn(body: string): string[] {
  const out = new Set<string>();
  for (const re of [
    /select \d+(?: as o)?, [^,]+?(?: as k)?, '([a-z][a-z0-9_]*)'/g,
    /\b(?:then|else) '([a-z][a-z0-9_]*)'/g,
  ])
    for (const m of body.matchAll(re)) out.add(m[1]!);
  return [...out];
}

const sqlCodes = (() => {
  const sql = read(MIGRATION);
  return [...new Set(SQL_FUNCTIONS.flatMap((f) => sqlCodesIn(sqlBody(sql, f))))].sort();
})();

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
