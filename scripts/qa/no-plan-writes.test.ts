import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CC-38 D1: the QA scripts never write a plan. The plan reaches an account through Stripe and the
 * webhook only, so no file under scripts/qa may touch `subscriptions`, write `accounts` or a
 * `stripe_*` table, or call the webhook's apply function. Test files are left out: they set up
 * worlds, and ship nothing.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/no-plan-writes.test.ts
 *
 * What the scan reads: `.from(<quoted name>)`, with any quote and any whitespace or line breaks
 * between the tokens (Prettier splits a chain), followed for `accounts` and for a `stripe_` table
 * by `.update`, `.insert`, `.upsert` or `.delete`; and `.rpc(<quoted apply_stripe_event>)`. What it
 * cannot see: a table name held in a variable, or SQL sent as text.
 */

const QUOTED = (name: string) => String.raw`\(\s*(['"\x60])${name}\1\s*\)`;
const RULES: readonly [string, RegExp][] = [
  ['reads or writes subscriptions', new RegExp(String.raw`\.from${QUOTED('subscriptions')}`)],
  [
    'writes accounts',
    new RegExp(String.raw`\.from${QUOTED('accounts')}\s*\.\s*(update|insert|upsert|delete)\s*\(`),
  ],
  ['applies a Stripe event', new RegExp(String.raw`\.rpc\s*\(\s*(['"\x60])apply_stripe_event\1`)],
  [
    'writes a stripe_ table',
    new RegExp(
      String.raw`\.from\s*\(\s*(['"\x60])stripe_[a-z0-9_]*\1\s*\)\s*\.\s*(update|insert|upsert|delete)\s*\(`,
    ),
  ],
];

function violations(source: string): string[] {
  return RULES.filter(([, re]) => re.test(source)).map(([what]) => what);
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const shipped = readdirSync(HERE).filter(
  (f) => /\.(ts|mjs)$/.test(f) && !f.endsWith('.test.ts') && f !== 'test-support.ts',
);

describe('scripts/qa writes no plan', () => {
  it('the scan finds each shape it is for, however it is spelled', () => {
    const cases: [string, string][] = [
      [`sb.from('subscriptions').select('*')`, 'reads or writes subscriptions'],
      [`sb.from("subscriptions")`, 'reads or writes subscriptions'],
      ['sb.from(`subscriptions` )', 'reads or writes subscriptions'],
      [`sb.from('accounts').update({ tier: 'pro' })`, 'writes accounts'],
      [`sb\n  .from( "accounts" )\n  .upsert(row)`, 'writes accounts'],
      [`sb.from('accounts')\n    .insert(row)`, 'writes accounts'],
      [`sb.from(\`accounts\`).delete()`, 'writes accounts'],
      [`sb.rpc( 'apply_stripe_event', p)`, 'applies a Stripe event'],
      [`sb.from('stripe_events').insert(row)`, 'writes a stripe_ table'],
      [`sb\n  .from( "stripe_customers" )\n  .upsert(row)`, 'writes a stripe_ table'],
      ['sb.from(`stripe_x`).delete()', 'writes a stripe_ table'],
      [`sb.from('stripe_events')\n    .update({ a: 1 })`, 'writes a stripe_ table'],
    ];
    for (const [source, what] of cases) expect(violations(source)).toEqual([what]);
    // A read of accounts, and another table's write, are not plan writes.
    expect(violations(`sb.from('accounts').select('internal').eq('id', x)`)).toEqual([]);
    expect(violations(`sb.from('qa_accounts').insert(row)`)).toEqual([]);
    expect(violations(`sb.from('accounts_view').update(x)`)).toEqual([]);
    expect(violations(`sb.from('stripe_events').select('id')`)).toEqual([]);
    expect(violations(`sb.from('not_stripe_events').insert(row)`)).toEqual([]);
  });

  it('scans the shipped files', () => {
    for (const f of ['seed.ts', 'store.ts', 'billing.ts', 'reset.ts', 'wiring.ts', 'cli.ts']) {
      expect(shipped).toContain(f);
    }
  });

  for (const f of shipped) {
    it(`${f} writes no plan`, () => {
      expect(violations(readFileSync(join(HERE, f), 'utf8'))).toEqual([]);
    });
  }
});
