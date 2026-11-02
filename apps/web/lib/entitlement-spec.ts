/**
 * Renders docs/specs/v2/01-accounts.md. Every table and list that states a fact about the schema,
 * the gates, the transitions or the v1 readers is built by iterating the data it describes: the
 * catalog of a database with the migrations applied, `GATES`, `next()` run over the fixtures below,
 * `STRIPE_EVENTS`, and a scan of the repository. The sentences around them are fixed text.
 *
 * Written by `apps/web/__tests__/helpers/write-01-accounts-spec.ts`; checked by
 * `apps/web/__tests__/v2-01-accounts-spec.test.ts`.
 */
import { GATES, type TierGates } from './entitlement-v2';
import {
  FREE_START,
  STRIPE_EVENTS,
  next,
  type EntitlementEvent,
  type EntitlementSnapshot,
} from './billing/state-machine';

// ─── Inputs ───────────────────────────────────────────────────────────────────────────────────────

export interface SpecColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface SpecTable {
  name: string;
  rls: boolean;
  columns: SpecColumn[];
  constraints: { name: string; def: string }[];
  indexes: { name: string; def: string }[];
  policies: { name: string; command: string; roles: string; using: string | null }[];
  grants: {
    public: string[];
    anon: string[];
    authenticated: string[];
    /** Columns `authenticated` may select when SELECT is granted per column; null otherwise. */
    authenticatedColumns: string[] | null;
    hiddenColumns: string[];
    serviceRole: string[];
  };
}

export interface SpecCatalog {
  tables: SpecTable[];
  usersColumns: SpecColumn[];
  functions: {
    name: string;
    args: string;
    definer: boolean;
    searchPath: string | null;
    execute: string[];
  }[];
}

export interface SpecInputs {
  catalog: SpecCatalog;
  /** Tracked non-test files matching `readerPattern`. */
  v1Readers: string[];
  readerPattern: string;
}

// ─── Follow-ups: where each v1 entitlement reader goes ────────────────────────────────────────────

const AT_SWITCH =
  'Reads move to `gatesFor()` at the switch-over (ARCH-2 §6.1 row 008, `V2_READS`); deleted in 009.';
const DUAL_WRITE =
  'CC-03 adds the v2 write beside it (dual-write, ARCH-2 §6.1); the `pro_until` write is deleted in 009.';
const RECONCILE =
  'CC-03 extends reconcile to `accounts.state` (ARCH-2 §3.3); the `pro_until` repair is deleted in 009.';
const DROP_009 = 'Deleted in 009, with `users.pro_until`.';

/**
 * The plan for every file that reads or writes v1 entitlement. The spec test fails when the scan
 * finds a file missing from this map, or the map names a file the scan no longer finds, so the two
 * sources cannot coexist without a stated end.
 */
export const V1_READER_PLAN: Readonly<Record<string, string>> = Object.freeze({
  'apps/web/app/api/audits/[id]/export/route.ts': AT_SWITCH,
  'apps/web/app/api/audits/[id]/llms-txt/route.ts': AT_SWITCH,
  'apps/web/app/api/audits/[id]/reaudit/route.ts': AT_SWITCH,
  'apps/web/app/api/audits/[id]/stream/route.ts': AT_SWITCH,
  'apps/web/app/api/audits/start/route.ts': AT_SWITCH,
  'apps/web/app/api/billing/status/route.ts': AT_SWITCH,
  'apps/web/app/api/reports/[slug]/logo/route.ts': AT_SWITCH,
  'apps/web/app/api/reports/[slug]/mine/route.ts': AT_SWITCH,
  'apps/web/app/api/reports/[slug]/white-label/route.ts': AT_SWITCH,
  'apps/web/app/dashboard/page.tsx': AT_SWITCH,
  'apps/web/components/audit/__fixtures__/client-audit-v2.ts': DROP_009,
  'apps/web/components/billing/PlanStatusCard.tsx': AT_SWITCH,
  'apps/web/lib/billing/apply-stripe-event.ts': DUAL_WRITE,
  'apps/web/lib/billing/plan-card.ts': AT_SWITCH,
  'apps/web/lib/billing/pro-until.ts': DUAL_WRITE,
  'apps/web/lib/entitlement.ts': AT_SWITCH,
  'apps/web/lib/pro.ts': AT_SWITCH,
  'inngest/billing-helpers.ts': RECONCILE,
  'inngest/billing.ts': RECONCILE,
  'packages/types/src/audit.ts': DROP_009,
  'packages/types/src/billing.ts': DROP_009,
  'scripts/p5/reconcile-dryrun.ts': RECONCILE,
});

// ─── Gates ────────────────────────────────────────────────────────────────────────────────────────

const GATE_ROWS: Readonly<Record<keyof TierGates, { label: string; source: string }>> = {
  sites: { label: 'Primary sites in the plan', source: 'ARCH-2 §3.1' },
  maxSites: { label: 'Primary sites with paid extras', source: 'ARCH-2 §3.1' },
  seats: { label: 'Seats in the plan (Agency adds $12 seats)', source: 'ARCH-2 §3.1' },
  schedule: { label: 'Scheduled checks', source: 'ARCH-2 §3.1' },
  fixesVisible: { label: 'Fixes visible', source: 'ARCH-2 §3.1' },
  packets: { label: 'Fix packets', source: 'ARCH-2 §3.1' },
  competitorsPerSite: { label: 'Competitors per site', source: 'ARCH-2 §3.1' },
  exports: { label: 'Exports (PDF, CSV, JSON)', source: 'ARCH-2 §3.1' },
  slack: { label: 'Slack', source: 'ARCH-2 §3.1' },
  stagingAndDeployHooks: { label: 'Staging and deploy hooks', source: 'ARCH-2 §3.1' },
  agencyBranding: {
    label: 'Brand, sender domain, client report page, scheduled client reports',
    source: 'ARCH-2 §3.1',
  },
  pagesPerCheck: { label: 'Pages per check', source: 'ARCH-2 §3.1; paid value pending CC-39' },
  fullRendersPerMonth: { label: 'Full renders per month', source: 'ARCH-2 §3.1' },
  readOnlyApi: { label: 'Read-only API', source: 'ARCH-2 §3.1' },
  searchConsole: { label: 'Search Console overlay', source: 'ARCH-2 §3.1' },
  observedCrawlerActivity: { label: 'Observed crawler activity', source: 'ARCH-2 §3.1' },
  checksPerSiteDay: {
    label: 'Checks per site per day, per eTLD+1 across accounts',
    source: 'DECISION-LOG J9',
  },
};

// ─── Transition fixtures ──────────────────────────────────────────────────────────────────────────

const T0 = new Date('2026-11-01T00:00:00.000Z');
const LATER = new Date(T0.getTime() + 14 * 86_400_000);

const SPEC_STATES: readonly { label: string; snapshot: EntitlementSnapshot }[] = [
  { label: 'free', snapshot: FREE_START },
  {
    label: 'free, trial used',
    snapshot: { ...FREE_START, trialUsedAt: T0, trialVariant: 'no_card' },
  },
  {
    label: 'pro_trial (no card)',
    snapshot: {
      ...FREE_START,
      state: 'pro_trial',
      tier: 'pro',
      trialVariant: 'no_card',
      trialEndsAt: LATER,
      trialUsedAt: T0,
    },
  },
  {
    label: 'pro_trial (card)',
    snapshot: {
      ...FREE_START,
      state: 'pro_trial',
      tier: 'pro',
      trialVariant: 'card_required',
      trialEndsAt: LATER,
      trialUsedAt: T0,
    },
  },
  { label: 'pro', snapshot: { ...FREE_START, state: 'pro', tier: 'pro' } },
  {
    label: 'agency_trial',
    snapshot: {
      ...FREE_START,
      state: 'agency_trial',
      tier: 'agency',
      trialEndsAt: LATER,
      trialUsedAt: T0,
    },
  },
  { label: 'agency', snapshot: { ...FREE_START, state: 'agency', tier: 'agency' } },
  {
    label: 'past_due',
    snapshot: {
      ...FREE_START,
      state: 'past_due',
      tier: 'pro',
      pastDueTier: 'pro',
      pastDueSince: T0,
    },
  },
];

const sub = (
  status: 'active' | 'past_due' | 'canceled',
  plan: 'pro' | 'agency',
  more: Partial<{ cancel: boolean; seats: number }> = {},
) =>
  ({
    type: 'subscription_updated',
    at: LATER,
    status,
    plan,
    cancelAtPeriodEnd: more.cancel ?? false,
    extras: { seats: more.seats ?? 0, sites: 0 },
  }) as const;

const SPEC_EVENTS: readonly { label: string; event: EntitlementEvent }[] = [
  {
    label: 'trial_started (no card)',
    event: { type: 'trial_started', at: LATER, variant: 'no_card' },
  },
  {
    label: 'trial_started (card)',
    event: {
      type: 'trial_started',
      at: LATER,
      variant: 'card_required',
      trialEnd: new Date(LATER.getTime() + 14 * 86_400_000),
    },
  },
  {
    label: 'agency_trial_started',
    event: {
      type: 'agency_trial_started',
      at: LATER,
      trialEnd: new Date(LATER.getTime() + 14 * 86_400_000),
    },
  },
  { label: 'trial_reminder_due', event: { type: 'trial_reminder_due', at: LATER } },
  { label: 'trial_will_end', event: { type: 'trial_will_end', at: LATER } },
  { label: 'trial_expired', event: { type: 'trial_expired', at: LATER } },
  {
    label: 'checkout_completed (pro)',
    event: { type: 'checkout_completed', at: LATER, plan: 'pro' },
  },
  {
    label: 'checkout_completed (agency)',
    event: { type: 'checkout_completed', at: LATER, plan: 'agency' },
  },
  { label: 'subscription_updated active, pro', event: sub('active', 'pro') },
  { label: 'subscription_updated active, agency', event: sub('active', 'agency') },
  {
    label: 'subscription_updated active, agency, 2 extra seats',
    event: sub('active', 'agency', { seats: 2 }),
  },
  {
    label: 'subscription_updated active, pro, cancel_at_period_end',
    event: sub('active', 'pro', { cancel: true }),
  },
  { label: 'subscription_updated past_due', event: sub('past_due', 'pro') },
  { label: 'subscription_updated canceled', event: sub('canceled', 'pro') },
  { label: 'subscription_deleted', event: { type: 'subscription_deleted', at: LATER } },
  { label: 'invoice_paid', event: { type: 'invoice_paid', at: LATER } },
  { label: 'invoice_payment_failed', event: { type: 'invoice_payment_failed', at: LATER } },
  { label: 'dispute_created', event: { type: 'dispute_created', at: LATER } },
  { label: 'past_due_lapsed', event: { type: 'past_due_lapsed', at: LATER } },
  {
    label: 'recorded_only',
    event: { type: 'recorded_only', at: LATER, stripeType: 'charge.refunded' },
  },
];

// ─── Formatting ───────────────────────────────────────────────────────────────────────────────────

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (text: string): string => `\`${text}\``;

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

function privileges(list: string[]): string {
  const all = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  if (list.length === 0) return 'none';
  if (all.every((p) => list.includes(p))) return 'all';
  return list.join(', ');
}

function gateValue(value: TierGates[keyof TierGates]): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function columnsTable(columns: SpecColumn[]): string {
  return table(
    ['Column', 'Type', 'Null', 'Default'],
    columns.map((c) => [
      code(c.name),
      c.type,
      c.nullable ? 'yes' : 'no',
      c.default === null ? '' : code(c.default),
    ]),
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────────────────────────

function tablesSection(catalog: SpecCatalog): string {
  const parts = ['## Tables', ''];
  for (const t of catalog.tables) {
    parts.push(`### \`${t.name}\``, '', columnsTable(t.columns), '');
    parts.push(
      'Constraints:',
      '',
      ...t.constraints.map((c) => `- ${code(c.name)}: ${code(c.def)}`),
      '',
    );
    parts.push('Indexes:', '', ...t.indexes.map((i) => `- ${code(i.def)}`), '');
  }
  parts.push('### `users`: the new columns', '', columnsTable(catalog.usersColumns), '');
  return parts.join('\n');
}

function grantsSection(catalog: SpecCatalog): string {
  const rows = catalog.tables.map((t) => [
    code(t.name),
    t.rls ? 'on' : 'off',
    privileges(t.grants.public),
    privileges(t.grants.anon),
    t.grants.authenticatedColumns !== null
      ? t.grants.hiddenColumns.length === 0
        ? 'SELECT, granted per column on every column'
        : `SELECT, granted per column, on every column except ${t.grants.hiddenColumns.map(code).join(', ')}`
      : privileges(t.grants.authenticated),
    privileges(t.grants.serviceRole),
    t.policies.length === 0
      ? 'none'
      : t.policies
          .map((p) => `${code(p.name)}: ${p.command} to ${p.roles} using ${code(p.using ?? '')}`)
          .join('; '),
  ]);
  const fnRows = catalog.functions.map((f) => [
    code(`${f.name}(${f.args})`),
    f.definer ? 'definer' : 'invoker',
    f.searchPath === null ? 'not pinned' : code(f.searchPath),
    f.execute.length === 0 ? 'no client role, no service_role' : f.execute.join(', '),
  ]);
  return [
    '## Grants and policies',
    '',
    'Read from the catalog after every migration is applied. `postgres`, the owner, is not listed.',
    '',
    table(['Table', 'RLS', 'PUBLIC', 'anon', 'authenticated', 'service_role', 'Policies'], rows),
    '',
    '### Functions',
    '',
    table(
      ['Function', 'Security', 'search_path', 'EXECUTE (anon, authenticated, service_role)'],
      fnRows,
    ),
    '',
  ].join('\n');
}

function transitionsSection(): string {
  const results = SPEC_EVENTS.map(({ label, event }) => ({
    label,
    cells: SPEC_STATES.map(({ snapshot }) => next(snapshot, event)),
  }));
  const edges = new Map<string, string[]>();
  results.forEach(({ label, cells }) => {
    cells.forEach((t, i) => {
      const from = SPEC_STATES[i]!.snapshot.state;
      if (t.outcome !== 'applied' || t.state.state === from) return;
      const key = `${from} --> ${t.state.state}`;
      edges.set(key, [...(edges.get(key) ?? []), label.split(' ')[0]!]);
    });
  });
  const diagram = [
    '```mermaid',
    'stateDiagram-v2',
    '  [*] --> free: handle_new_user',
    ...[...edges.entries()].map(
      ([edge, labels]) => `  ${edge}: ${[...new Set(labels)].join(', ')}`,
    ),
    '```',
  ].join('\n');
  const matrix = table(
    ['Event', ...SPEC_STATES.map((s) => s.label)],
    results.map(({ label, cells }) => [
      label,
      ...cells.map((t) => (t.outcome === 'ignored' ? '-' : t.state.state)),
    ]),
  );
  const stripe = table(
    ['Stripe event', 'Normalised event'],
    Object.entries(STRIPE_EVENTS).map(([stripeEvent, event]) => [code(stripeEvent), code(event)]),
  );
  return [
    '## States and transitions',
    '',
    '`next(snapshot, event)` in `apps/web/lib/billing/state-machine.ts` is pure. The diagram and the',
    'table are its output for one fixture per state, each event stamped 14 days after the fixture',
    'started. A cell holds the next state; `-` means the event is ignored in that state.',
    '`apps/web/lib/billing/state-machine.test.ts` checks the transitions row by row against a',
    'hand-written table, and `state-machine.property.test.ts` checks properties over generated',
    'event sequences.',
    '',
    diagram,
    '',
    matrix,
    '',
    'Effects. `relimit` when the limits change, and it removes the newest non-owner seats beyond the',
    'seat limit. `pause_others` on a move from a paid tier to Free: the oldest primary site keeps a',
    'monthly check and the others pause. `pause_over_limit` or `resume` when the site limit falls or',
    'rises otherwise. `entitlement.changed` when the state or the limits change. Event-specific:',
    '`trial.started` and `trial.converted` for the no-card trial, the trial reminder email, and a',
    'founder alert on a dispute.',
    '',
    '### Stripe events (ARCH-2 §3.3)',
    '',
    'CC-03 parses each webhook into the normalised event; this module does not read Stripe payloads.',
    '',
    stripe,
    '',
  ].join('\n');
}

function gatesSection(): string {
  const keys = Object.keys(GATE_ROWS) as (keyof TierGates)[];
  return [
    '## Gates',
    '',
    '`GATES` in `apps/web/lib/entitlement-v2.ts`. `gatesFor(account, now)` reads them for the tier',
    '`effectiveTier()` returns: the `tier` column, except that a `past_due` account keeps',
    '`past_due_tier` for 7 days from `past_due_since` and is Free from then on.',
    '',
    table(
      ['Gate', 'free', 'pro (incl. trial)', 'agency (incl. trial)', 'Source'],
      keys.map((k) => [
        GATE_ROWS[k].label,
        gateValue(GATES.free[k]),
        gateValue(GATES.pro[k]),
        gateValue(GATES.agency[k]),
        GATE_ROWS[k].source,
      ]),
    ),
    '',
  ].join('\n');
}

function readersSection(inputs: SpecInputs): string {
  return [
    '### v1 entitlement readers, and when each moves to the gates',
    '',
    `Tracked non-test files matching ${code(inputs.readerPattern)}, found by \`git grep\`. The spec`,
    'test fails when this list and `V1_READER_PLAN` in `apps/web/lib/entitlement-spec.ts` disagree.',
    '',
    table(
      ['File', 'Plan'],
      inputs.v1Readers.map((f) => [
        code(f),
        V1_READER_PLAN[f] ?? 'NO PLAN: add it to V1_READER_PLAN',
      ]),
    ),
    '',
  ].join('\n');
}

const HEADER = `# SPEC 01: accounts, seats and entitlement (CC-01, CC-02)

> Generated by \`pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-01-accounts-spec.ts\`. Do not edit it by hand: \`apps/web/__tests__/v2-01-accounts-spec.test.ts\` fails when this file differs from what the generator writes.

Migration 001 (\`infra/supabase/migrations/20261101000001_v2_001_entitlement_tables.sql\`) adds the
entitlement tables of ARCH-2 §2.4 and extends the sign-up trigger. \`apps/web/lib/entitlement-v2.ts\`
holds the gates and \`apps/web/lib/billing/state-machine.ts\` the transitions. None of it is read by
a live route yet: v1 entitlement (\`users.pro_until\`, \`lib/pro.ts\`, \`lib/entitlement.ts\`) is
unchanged.

## Sign-up

\`handle_new_user\` runs on every \`auth.users\` insert. It inserts the \`users\` row as v1 does, then, in
the same transaction and only when that row has no default account: a personal account in state
\`free\` with the Free limits and a one-entry history, the active \`owner\` seat for the user, and
\`users.default_account_id\`. If any of these fails, the sign-up fails. The account starts \`free\`;
a trial is the \`trial_started\` event, applied once CC-04's ledger rules allow it. Both are tested in
\`apps/web/__tests__/v2-001-entitlement-tables.test.ts\` (\`handle_new_user: …\`).
`;

const DIFFERENCES = `## Where this differs from the design documents

The contract (\`packages/types/src/v2\`) wins where it and a document disagree.

- Seat roles are \`owner\`, \`account_manager\`, \`developer\` (contract \`SeatRole\`); ARCH-2 §2.4 says \`manager\`.
- Membership is \`is_member()\` (ARCH-2 §2.2, security definer, keyed on \`status = 'active'\`), not SECURITY-DESIGN's security-invoker \`member_of()\`: an invoker helper would recurse through \`seats\`' own policy. It also requires the account not to be soft-deleted.
- Columns the contract needs and ARCH-2 lacks: \`accounts.state_history\`, \`card_last4\`, \`email_change_notes\`, \`email_trial_reminder\`; \`seats.name\`, \`alert_channels\`, \`theme\`; \`agency_brands.open_tracking_default\` (default \`false\`; no document sets one), the DNS, certificate and SPF/DKIM/DMARC results. Brand columns use the contract's names \`agency_name\` and \`accent_hex\`.
- \`accounts.entitlement_version\` is new: \`apply_entitlement_transition\` refuses a write based on a stale read.
- \`trial_ledger.account_id\` is \`on delete set null\`, so deleting an account keeps its trial history.
- \`users.email_normalized\` is nullable: CC-04 defines the normaliser and CC-05 backfills and sets \`not null\`.
- No client \`UPDATE\` on \`users.default_account_id\` (ARCH-2 §2.3 grants one): migration \`20260602000013\` revoked client \`UPDATE\` on \`users\`, and a route handler sets it.
- Not in this migration, though ARCH-2 §6.1 lists them in 001: \`seat_sites\` (it references \`sites\`, created in 003), \`consent_log\` and \`account_events\` (with the step that writes them, CC-03 and CC-04).
- Transitions ARCH-2 §3.2 leaves open: a card-required Pro trial whose payment fails goes to \`past_due\`, as J3 rules for \`agency_trial\`; a dispute in any state marks the account and makes it Free; \`invoice.payment_failed\` and a \`past_due\` subscription update both enter \`past_due\`, and the second is ignored; a Free account starts the one-click trial of DECISION-LOG H5 with \`trial_started\`.
- Site effects are planned by \`planSites\` and returned by \`applyEntitlementTransition\`; the RPC applies them once \`sites\` exists (003).
`;

const FOLLOW_UPS = `## Follow-ups

### Contract follow-ups

- \`accounts.state_history\` keeps the latest 200 entries (a CHECK bounds it; the RPC drops the oldest). \`account_events\` (CC-03/CC-04) becomes the full history, and \`state_history\` stays the recent tail the contract's \`Account\` carries.
- The trigger test asserts every sign-up starts \`free\`, including one whose email is already in \`trial_ledger\`. When CC-04 defines the ledger rule, the same test asserts such a sign-up gets no second trial.
`;

const RUNBOOK = `## Runbook (owner-applied, OPERATING-RULES §7)

The migration changes \`handle_new_user\`, which runs inside every live sign-up. Each step below is the owner's.

1. **Dump.** \`pg_dump\` of \`public\` from \`ezspnfeyzwsisymytssm\` (ARCH-2 §6.1).
2. **Dry run on a Supabase branch.** Create a branch, apply the migration file, then run the checks in step 5 on the branch. Apply the file a second time: it must succeed and change nothing. Run the revert file, check a sign-up still creates only a \`users\` row, and apply the migration again.
3. **Test sign-up on the branch.** Sign up with a test address through the branch's auth, then run the sign-up query in step 5: exactly one row.
4. **Apply window.** Apply in one transaction at a quiet hour. \`alter table public.users add column\` takes a brief exclusive lock on \`users\`, so a sign-up in that moment waits for it.
5. **Verify on production.**
   - \`get_advisors\` (security): no new finding on the five tables or the three functions.
   - Grants:
     \`\`\`sql
     select c.relname, c.relrowsecurity, c.relacl::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('accounts', 'subscriptions', 'seats', 'agency_brands', 'trial_ledger');
     select table_name, column_name, grantee, privilege_type
       from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
        and table_name in ('accounts', 'subscriptions', 'seats', 'agency_brands', 'trial_ledger')
      order by 1, 2;
     select tablename, policyname, cmd, roles, qual from pg_policies
      where schemaname = 'public'
        and tablename in ('accounts', 'subscriptions', 'seats', 'agency_brands', 'trial_ledger');
     \`\`\`
     Expect the grants and policies of the table above: no \`anon\` entry anywhere, and \`authenticated\` holding only SELECT.
   - The name-free routine check of the stage-6 runbook (\`docs/deploy/spec51a-stage6-frontier-functions-runbook.md\`) now returns exactly two rows, \`is_member\` and \`member_role\`, each with \`anon = false\` and \`authed = true\`. Any other row is a finding.
   - A real test sign-up on production, then:
     \`\`\`sql
     select u.id, u.email, a.kind, a.state, a.tier, a.seat_limit, a.site_limit, s.role, s.status
       from public.users u
       join public.accounts a on a.id = u.default_account_id
       join public.seats s on s.account_id = a.id and s.user_id = u.id
      where u.email = '<test address>';
     \`\`\`
     Expect one row: \`personal\`, \`free\`, \`free\`, 1, 1, \`owner\`, \`active\`. And no user created since the apply without an account:
     \`\`\`sql
     select count(*) from public.users where default_account_id is null and created_at > '<apply time>';
     \`\`\`
     Expect 0.
6. **Revert, if needed.** \`infra/supabase/rollbacks/20261101000001_v2_001_entitlement_tables.revert.sql\`, tested on PGlite and in step 2. It drops the five tables with their rows (before CC-05 these are only the accounts made by sign-ups since the apply) and restores \`handle_new_user\` to its v1 body; the test \`the revert returns the catalog to the state before 001\` compares the whole catalog. Take the dump first.
`;

export function renderAccountsSpec(inputs: SpecInputs): string {
  return [
    HEADER,
    tablesSection(inputs.catalog),
    grantsSection(inputs.catalog),
    transitionsSection(),
    gatesSection(),
    DIFFERENCES,
    FOLLOW_UPS,
    readersSection(inputs),
    RUNBOOK,
  ].join('\n');
}
