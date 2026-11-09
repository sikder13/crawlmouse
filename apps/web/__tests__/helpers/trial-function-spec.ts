import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { format, resolveConfig } from 'prettier';
import { TRIAL_OUTCOMES } from '../../lib/auth/first-login';
import {
  EMAIL_MONTHS,
  LEDGER_KINDS,
  MIN_PEPPER_LENGTH,
  RECENT_DAYS,
  RECENT_TRIALS_REFUSED_AT,
} from '../../lib/auth/ledger';
import { REPO_ROOT } from './accounts-spec-catalog';
import { V, code, sha256, table } from './check-tables-spec';
import { MIGRATIONS_DIR, ROLLBACKS_DIR, applyAllMigrations, freshDb } from './pglite-migrations';
import { constraints } from './v2-check-tables';
import { NESTED, RULE_CHECKS, RULES_AT_WRITE } from './v2-contract-storage';

/**
 * Renders docs/specs/v2/06c-trial-function.md. The functions' settings and grants, the CHECKs 006c
 * writes, the write-time rules, the trial outcomes and the ledger rule's numbers are read from a
 * PGlite database with every migration applied and from the code. The prose holds decisions and the
 * dated production measurement, each with the command that checks it.
 */

export const SPEC_06C_PATH = resolve(REPO_ROOT, 'docs/specs/v2/06c-trial-function.md');
export const MIGRATION_006C = '20261108000001_v2_006c_trial_function_and_checks.sql';
const REVERT_006C = MIGRATION_006C.replace(/\.sql$/, '.revert.sql');
const FUNCTIONS = ['start_trial_with_ledger', 'trial_ledger_lock', 'trial_ledger_refusals'];
const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const EFFECT_RULES = Object.entries(RULE_CHECKS).filter(
  ([, c]) =>
    c.constraint.startsWith('site_fixes_effect_') && c.constraint !== 'site_fixes_effect_pending',
);

async function functionsTable(db: PGlite): Promise<string> {
  const { rows } = await db.query<{
    sig: string;
    definer: boolean;
    volatility: string;
    config: string[] | null;
    owner: string;
    grantees: string[];
  }>(
    `select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as sig,
            p.prosecdef as definer, p.provolatile as volatility, p.proconfig as config,
            pg_get_userbyid(p.proowner) as owner,
            array(select r.role from unnest($2::text[]) as r(role)
                   where (r.role = 'PUBLIC' and exists (
                            select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                             where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                      or (r.role <> 'PUBLIC' and has_function_privilege(r.role, p.oid, 'EXECUTE'))
                   order by r.role) as grantees
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1) order by p.proname`,
    [FUNCTIONS, ROLES],
  );
  const vol: Record<string, string> = { v: 'volatile', s: 'stable', i: 'immutable' };
  return table(
    [
      'Function',
      'Security',
      'Volatility',
      'Settings',
      'Owner',
      'Who may execute (of PUBLIC, anon, authenticated, service_role)',
    ],
    rows.map((r) => [
      code(`public.${r.sig}`),
      r.definer ? 'definer' : 'invoker',
      vol[r.volatility] ?? r.volatility,
      (r.config ?? []).map(code).join(', '),
      code(r.owner),
      r.grantees.length ? r.grantees.map(code).join(', ') : 'none',
    ]),
  );
}

/**
 * SECURITY DEFINER functions in our schemas, other than 006c's, whose search_path setting leaves
 * pg_temp implicit (searched first for types) rather than naming it last, with that setting.
 */
async function otherDefiners(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ sig: string; path: string | null; callers: string[] }>(
    `select format('%s.%s', n.nspname, p.proname) as sig,
            (select c from unnest(p.proconfig) c where c like 'search_path=%') as path,
            array(select r from unnest(array['anon', 'authenticated', 'crawl_worker']) r
                   where has_function_privilege(r, p.oid, 'EXECUTE') order by r) as callers
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'research', 'partitions') and p.prosecdef
        and p.proname <> all($1)
      order by 1`,
    [FUNCTIONS],
  );
  const leaves = rows.filter((r) => !/pg_temp"?$/.test(r.path ?? ''));
  if (leaves.length === 0) return 'none';
  return leaves
    .map((r) => {
      const callers = r.callers.length ? `; ${r.callers.map(code).join(', ')} may call it` : '';
      return `${code(r.sig)} (${r.path ? code(r.path) : 'no setting'}${callers})`;
    })
    .join(', ');
}

/** How many arguments `apply_entitlement_transition` takes. */
async function argCount(db: PGlite): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select p.pronargs::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = 'apply_entitlement_transition'`,
  );
  if (rows.length !== 1) throw new Error('expected one apply_entitlement_transition');
  return rows[0]!.n;
}

/** The lock_timeout `start_trial_with_ledger` sets, read from its settings. */
async function lockTimeout(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ v: string | null }>(
    `select (select split_part(c, '=', 2) from unnest(p.proconfig) c where c like 'lock_timeout=%') as v
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'start_trial_with_ledger'`,
  );
  const v = rows[0]?.v;
  if (!v) throw new Error('start_trial_with_ledger sets no lock_timeout');
  return v;
}

async function checksTable(db: PGlite): Promise<string> {
  const names = new Set(['site_fixes_type_check', ...EFFECT_RULES.map(([, c]) => c.constraint)]);
  const rows = (await constraints(db, 'site_fixes')).filter((c) => names.has(c.name));
  return table(
    ['Constraint', 'Definition'],
    rows.map((c) => [code(c.name), code(c.def)]),
  );
}

/**
 * RULES_AT_WRITE says which of its entries are value shapes, and which are rules of an access_tests
 * row (006d), in the reason it gives; the rest read inside jsonb under owner ruling 1.
 */
const isValueShape = (why: string) => why.startsWith('a value shape');
const isAccessRow = (why: string) => why.startsWith('an access_tests row');
const rulesWhere = (pick: (why: string) => boolean) =>
  Object.entries(RULES_AT_WRITE)
    .filter(([, why]) => pick(why))
    .map(([r]) => code(r))
    .join(', ');

function writeTimeTable(): string {
  return table(
    ['Rule', 'Where it is checked', 'Why'],
    [
      ...EFFECT_RULES.map(([r, c]) => [
        code(r),
        `CHECK ${code(c.constraint)}, since 006c`,
        'a predicate on the row’s own `effect`; CC-17’s rule, made a CHECK by the owner’s ruling (2026-11-08)',
      ]),
      ...Object.entries(RULES_AT_WRITE).map(([r, why]) => [
        code(r),
        isValueShape(why)
          ? 'the writer: a value shape'
          : isAccessRow(why)
            ? 'the writer: persist_built_check (006d)'
            : 'the writer (owner ruling 1)',
        why,
      ]),
    ],
  );
}

function nestedTable(): string {
  return table(
    ['Enum', 'Inside'],
    Object.entries(NESTED).map(([e, at]) => [code(e), at.map(code).join(', ')]),
  );
}

const D8_QUERY = `-- Run through scripts/db/target.ts openTarget({ projectRef: 'ezspnfeyzwsisymytssm', yesProduction: true }),
-- the Management API's read-only endpoint (supabase_read_only_user). Counts and catalog only.
select count(*)::int as n from public.site_fixes;
select conname, pg_get_constraintdef(oid) as def, convalidated
  from pg_constraint
 where conrelid = 'public.site_fixes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%type%';
select count(*)::int as n from public.site_fixes where not (type in (<the 16 values of FixTypeSchema>));
select count(*)::int as n from public.site_fixes
 where not ((coalesce(effect -> 'technical_seo', 'null') = 'null')
            = (jsonb_array_length(coalesce(effect -> 'technical_seo_pending_on', '[]')) > 0));
select count(*)::int as n from public.site_fixes
 where coalesce(effect -> 'absorbed_by', 'null') <> 'null'
   and coalesce((effect ->> 'technical_seo')::numeric, 0) + coalesce((effect ->> 'ai_readability')::numeric, 0) > 0;
select (select count(*)::int from public.accounts) as accounts, (select count(*)::int from public.trial_ledger) as trial_ledger;
select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('start_trial_with_ledger', 'trial_ledger_refusals');
select version from supabase_migrations.schema_migrations order by version desc limit 3;`;

const RACE_TEST = '`pnpm --filter @crawlmouse/scripts exec vitest run db/trial-race.test.ts`';

export async function buildTrialFunctionSpec(): Promise<string> {
  const db = await freshDb();
  try {
    await applyAllMigrations(db);
    const timeout = await lockTimeout(db);
    const md = [
      `# SPEC 06c: the trial in one transaction, and the fix-type CHECK (CC-06c)

> Generated by \`pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-06c-trial-function-spec.ts\`. Do not edit it by hand: \`apps/web/__tests__/v2-06c-trial-function-spec.test.ts\` fails when this file differs from what the generator writes. The tables are read from a PGlite database with every migration applied, and from the code.

One migration, \`infra/supabase/migrations/${MIGRATION_006C}\`, with its revert \`infra/supabase/rollbacks/${REVERT_006C}\`:

${table(
  ['File', 'sha256'],
  [
    [
      code(`infra/supabase/migrations/${MIGRATION_006C}`),
      code(sha256(resolve(MIGRATIONS_DIR, MIGRATION_006C))),
    ],
    [
      code(`infra/supabase/rollbacks/${REVERT_006C}`),
      code(sha256(resolve(ROLLBACKS_DIR, REVERT_006C))),
    ],
  ],
)}

It adds \`public.start_trial_with_ledger\` and two helpers, replaces the CHECK on \`site_fixes.type\` with the contract's \`FixTypeSchema\`, and adds two CHECKs on \`site_fixes.effect\`. Verify the migration: ${V('v2-006c-trial-function.test.ts')}; two real transactions: ${RACE_TEST} (CI's \`db-cli-files\` job).

## The trial function

\`start_trial_with_ledger(p_account_id uuid, p_hashes jsonb, p_transition jsonb) returns jsonb\` is the first-login hook's one database call (\`apps/web/lib/auth/first-login.ts\`). In one transaction it:

1. refuses to run outside READ COMMITTED (\`0A000\`; READ UNCOMMITTED, which Postgres runs as READ COMMITTED, is accepted): the ledger is read in a statement after the locks, and READ COMMITTED gives that statement a snapshot taken after them;
2. validates the input, before any lock: anything malformed raises \`22023\`;
3. locks the account \`for update\` (a missing or deleted account raises \`P0002\`);
4. returns \`{"outcome": "not_eligible", "hits": []}\` unless the account is Free with \`trial_used_at\` null;
5. takes one transaction-scoped advisory lock per hash (\`trial_ledger_lock\`);
6. reads the ledger rule (\`trial_ledger_refusals\`, at \`now()\`), and returns \`{"outcome": "refused", "hits": [...]}\` with the kinds that refused, in the order ${LEDGER_KINDS.map(code).join(', ')}, writing nothing;
7. otherwise calls \`public.apply_entitlement_transition\` with \`p_transition\`'s values, inserts one \`trial_ledger\` row per hash with \`account_id\` and \`trial_kind = 'pro'\`, and returns \`{"outcome": "started", "hits": []}\`.

A stale \`p_expected_version\` raises \`40001\` from \`apply_entitlement_transition\`. Any error aborts the whole call, so a trial and its rows are written together or not at all (${V('v2-006c-trial-function.test.ts', 'atomicity')}).

**\`p_hashes\`** is an array of 1 to 3 objects, each with the keys \`kind\` and \`value_hash\` and no other; \`kind\` is one of ${LEDGER_KINDS.map(code).join(', ')}, one row per kind, an \`email\` row required; \`value_hash\` is 64 lowercase hex. The hook computes them with \`hashLedgerValue\` (HMAC-SHA256 under \`TRIAL_LEDGER_PEPPER\`); the pepper stays in the app.

**\`p_transition\`** is what the hook computes with \`next()\` for \`trial_started {variant: 'no_card'}\` and \`toTransitionParams\`, plus \`"event": "trial_started"\`: the ${await argCount(db)} arguments of \`apply_entitlement_transition\` and the event. The function requires the event, this account's id, \`p_state = 'pro_trial'\`, \`p_tier = 'pro'\`, \`p_trial_variant = 'no_card'\`, a trial end, a trial-used date and \`p_at\` written as ISO 8601 with an offset (no \`infinity\`, \`epoch\` or \`now\`), the trial end after \`p_at\`, integer version and limits, and \`p_subscription_id\`, \`p_past_due_tier\`, \`p_past_due_since\` and \`p_disputed_at\` null. It checks the shape and copies none of the state machine: the limits and dates are \`next()\`'s. Each rejected shape: ${V('v2-006c-trial-function.test.ts', 'input validation')}.

**Lock timeout (\`TRIAL_LOCK_TIMEOUT\`): ${timeout}**, set on the function (\`set lock_timeout\`), so a stuck account row or hash lock ends the call with \`55P03\` rather than hanging a sign-in.

### Who may call what

${await functionsTable(db)}

**Temporary objects.** With \`pg_temp\` left out of \`search_path\`, an empty setting included, Postgres searches it first for type names (never for functions or operators), so a caller's temp domain could stand in for a type a body names without its schema, and its CHECK would run as \`postgres\`. 006c wrote \`search_path = ''\` on these functions; migration 20261108000002 (CC-SEC, \`docs/specs/v2/sec-baseline.md\`) names \`pg_temp\` last on \`start_trial_with_ledger\`, which the table above shows. The helpers keep \`''\`. They are invoker functions, and they run as \`postgres\` when \`start_trial_with_ledger\` calls them, so what keeps them safe is their bodies: those write \`jsonb\`, \`text\` and \`timestamptz\` as \`pg_catalog.*\`, and \`integer\`, \`numeric\`, \`bit\` and \`interval\` are keywords the grammar resolves to \`pg_catalog\`. Verify, a temp domain of each name, on the refused path (which runs both helpers and stops before \`apply_entitlement_transition\`): ${V('v2-006c-trial-function.test.ts', 'temporary objects')}.

PUBLIC's EXECUTE is revoked explicitly on each, and so is service_role's on the helpers, which no role but their owner runs: \`start_trial_with_ledger\` is SECURITY DEFINER and runs them as \`postgres\`. Check 06 (\`infra/supabase/checks/06-client-functions.sql\`) finds nothing. Verify: ${V('v2-006c-trial-function.test.ts', 'grants')}.

### The ledger rule

\`trial_ledger_refusals(p_hashes, p_now)\` is the rule's one implementation. A trial is refused when \`trial_ledger\` holds, under the same kind and hash:

- \`email\`: a row created after \`p_now\` less ${EMAIL_MONTHS} calendar months, counted in UTC (Postgres clamps 29 February to 28 February);
- \`device\`: ${RECENT_TRIALS_REFUSED_AT} or more rows created after \`p_now\` less ${RECENT_DAYS * 24} hours (${RECENT_DAYS} days of 24 hours, so a session time zone with a DST change does not move it);
- \`ip24\`: ${RECENT_TRIALS_REFUSED_AT} or more rows in that window, and a row of the device hash sent in the same window. With no device hash sent, the network refuses nothing.

A row exactly at a window's start is outside it; a row dated after \`p_now\` is inside. Rows of other kinds (CC-04's \`hostname\` and \`card_fingerprint\`) are not read. The numbers are the ones \`apps/web/lib/auth/ledger.ts\` names for spec 25, and vectors built from them run through the SQL. A pepper shorter than ${MIN_PEPPER_LENGTH} characters reads as none: the hook then calls nothing. Verify the edges by hand-written vectors and a property over generated ledgers: ${V('v2-006c-trial-function.test.ts', 'the ledger rule')}.

### Locks and concurrency

The function locks the caller's account row first, then the hash keys in ascending order. A hash's key is its first 32 bits under the class 1728 (0x06C0), in the two-key form, which shares no key with the one-key lock \`scripts/db\` takes. Two calls sharing hashes take the shared keys in the same order, and neither holds the other's account row unless both are for one account, when the second waits on that row before taking any key; so no cycle of waits forms between two calls (the races below run both shapes). Two hashes that share a key only wait for each other.

PGlite has one backend, so its tests show the locks held (one advisory lock per hash, and the account row's \`xmax\` set, which any row lock does) and taken in ascending order, and each race's sequential outcome. Two real transactions are ${RACE_TEST}: on one device hash the second waits, then is refused; on one account the second waits, then is \`not_eligible\`; each ends with one trial and the right rows; and while a call that refuses is open, a third session's \`FOR KEY SHARE NOWAIT\` on the account fails, which only \`FOR UPDATE\` (or stronger) gives. The file also builds a database from this migration with the advisory-lock call removed, where the device race must start two trials, and one with \`for update\` weakened to \`for key share\`, where that third session must get in: it shows it can fail on every run of the file, which CI's \`db-cli-files\` job makes with \`TRIAL_RACE_REQUIRED=1\` and \`--passWithNoTests=false\`.

## What the hook does with the answer

${table(
  ['Outcome', 'Meaning'],
  Object.entries(TRIAL_OUTCOMES).map(([k, v]) => [code(k), v]),
)}

A call that fails is reported to Sentry as \`auth.trial-decision-failed\` with a \`reason\`: \`lock_timeout\` (\`55P03\`), \`malformed_result\` (an answer that is not \`{outcome, hits}\`), or \`rpc_error\` with its SQLSTATE in \`code\` (a revoked grant is \`42501\`, a missing function \`PGRST202\`). \`40001\` is a lost race, read as \`not_first\` and not reported. Verify: ${V('v2/account-door-first-login.test.ts', 'D10')}.

**Login CSRF (D9).** When \`cm_auth_for\` is set and is not the verified address's binding, the link is another address's opened in this browser: the hook sends no device hash, the verify route skips v1's anonymous-audit claim, and this browser's own door request (\`cm_auth_for\`, \`cm_auth_signup\`, \`post_login_next\`) is left to expire rather than cleared, so the owner's own link still finds it and a second foreign link is recognised too. Verify, end to end over PGlite: \`pnpm --filter @crawlmouse/web exec vitest run app/login/verify/route.csrf.test.ts\`.

## The site_fixes CHECKs

${await checksTable(db)}

The type CHECK is found by the catalog, not by name: 003 wrote it inline, and Postgres named it \`site_fixes_type_check\`. The migration drops each CHECK on \`type\` alone, adds the contract's list under that name, and raises unless that one remains. Each is added \`NOT VALID\` and then validated. The contract guard compares the CHECK with \`FixTypeSchema\`, and a test narrows it by one value and sees the guard report it: ${V('v2-contract-guard.test.ts', 'missing one contract value')}. Each effect CHECK is broken on its own, both ways where the rule is two-way: ${V('v2-003-check-tables.test.ts', 'site_fixes_effect')}; and compared with the contract's rule over generated values: ${V('v2-003-rule-agreement.test.ts', 'effect_')}.

### Write-time rules: which became CHECKs (D7)

A rule becomes a CHECK here only where it is a predicate on the row's own columns and the owner ruled it one (2026-11-08): CC-17's two effect rules. The others stay with the writer, which parses the row with the contract schema: those reading inside a jsonb document of a table only the server writes under owner ruling 1 (2026-11-02); ${rulesWhere(isValueShape)} because they are value shapes a CHECK does not hold as the contract does; and, since 006d, ${rulesWhere(isAccessRow)}, rules of an \`access_tests\` row, which only \`persist_built_check\` writes, after the pipeline parses the row with \`AccessTestSchema\`. The list is \`RULES_AT_WRITE\` and \`RULE_CHECKS\` in \`apps/web/__tests__/helpers/v2-contract-storage.ts\`:

${writeTimeTable()}

Enums inside jsonb columns, enforced by the same writer (\`NESTED\`):

${nestedTable()}

## Production, measured before approval (D8)

Measured on 2026-11-08, read-only, before this migration existed. A dated reading, not a standing property:

| What | Result |
| --- | --- |
| \`site_fixes\` rows | 0 |
| CHECKs on \`site_fixes\` mentioning \`type\` | one, \`site_fixes_type_check\`, validated, the 14 values of 003 |
| rows the new \`site_fixes_type_check\` would refuse | 0 |
| rows \`site_fixes_effect_seo_pending\` would refuse | 0 |
| rows \`site_fixes_effect_absorbed\` would refuse | 0 |
| \`accounts\` / \`trial_ledger\` rows | 1 / 0 |
| functions named \`start_trial_with_ledger\` or \`trial_ledger_refusals\` | 0 |
| newest migrations recorded | \`20261106000002\`, \`20261106000001\`, \`20261103000001\` |
| \`V2_ACCOUNT_DOOR\` in Production | off: \`curl -s -o /dev/null -w '%{http_code}' https://crawlmouse.com/signup\` answered 404 |

<details><summary>The queries</summary>

\`\`\`sql
${D8_QUERY}
\`\`\`

</details>

## Apply path

1. The pull request's DB dry run (\`db-dry-run.yml\`, \`docs/ops/db-migrations.md\` §1) applies the file to a branch made from production, runs it again, runs the checks, and runs the revert.
2. Merge. The code reaches Vercel at once; with \`V2_ACCOUNT_DOOR\` unset in Production the first-login hook does not run there.
3. The owner approves the \`production\` environment and \`db-apply-prod.yml\` applies the file.
4. **After the apply**, the owner verifies: \`pnpm --filter @crawlmouse/scripts exec tsx db/check.ts --project-ref ezspnfeyzwsisymytssm --yes-production\` passes, and the read-only query \`select proname, prosecdef, proconfig from pg_proc where proname in ('start_trial_with_ledger', 'trial_ledger_lock', 'trial_ledger_refusals')\` returns the three rows of the table above. The table is the state with every migration applied: until 20261108000002 (CC-SEC) is applied too, production shows \`search_path=""\` on \`start_trial_with_ledger\`, and check 09 fails there.

**Precondition.** \`V2_ACCOUNT_DOOR\` stays unset in Production until step 4 is done: the hook calls \`start_trial_with_ledger\` and has no other path, so without it a first login fails and stays Free, and is not retried. Before any rollback of this migration, the door goes off in Production first. Spec 25's owner setup carries the same precondition.

**Rollback.** \`db-rollback-prod.yml\` with \`${REVERT_006C}\`. It drops the three functions and the two effect CHECKs and puts back 003's type CHECK; that CHECK refuses while a fix holds a content fix type, and the revert then changes nothing. Ledger rows the function wrote stay.

## Known gaps

- **A failed decision is not retried** (D11). First login is detected once (\`isFirstLogin\`); a sign-up whose call failed stays Free, and Sentry has \`auth.trial-decision-failed\`.
- **The ${timeout} lock timeout can cost a trial.** A first login that waits longer than that, for instance on a busy shared network's \`ip24\` lock, fails and is not retried.
- **A browser with no \`cm_auth_for\` sends its device.** A link opened where no door request was made (another device, or a browser that never asked) cannot be told apart from someone else's link, so D9 does not apply there.
- **Two clocks.** \`next()\` dates the trial with the app's clock; the ledger windows and the rows' \`created_at\` use the database's \`now()\`.
- **The race test runs only in CI's \`db-cli-files\` job**; \`pnpm test\` skips it, because no local Postgres server is assumed. It refuses a \`TRIAL_RACE_DB_URL\` that is not on this machine.
- **Definer functions outside this migration.** Read from \`pg_proc\`, those whose \`search_path\` does not name \`pg_temp\` last, with the client roles that may call each: ${await otherDefiners(db)}. Migration 20261108000002 (CC-SEC, \`docs/specs/v2/sec-baseline.md\`) set it last on the rest, and the catalog check \`09-definer-search-path.sql\` fails on one that does not.
`,
    ].join('\n');
    const config = (await resolveConfig(SPEC_06C_PATH)) ?? {};
    return format(md, { ...config, filepath: SPEC_06C_PATH });
  } finally {
    await db.close();
  }
}
