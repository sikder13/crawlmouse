/**
 * Renders journey 8's evidence (CC-41 D7) as Markdown, from what the walk wrote: the capture stub's
 * events and the database and Stripe reads in $WALK_EVIDENCE (8-data-foundation.spec.ts). Every
 * table row and count below is built by iterating that file, not written about it.
 *
 *   pnpm exec tsx tests/e2e/harness/d7-report.ts <evidence.json> > d7-tables.md
 */
import { readFileSync } from 'node:fs';
import type { Capture } from './posthog';

interface Evidence {
  userId: string;
  accountId: string;
  anonId: string;
  landing: string;
  referrer: string;
  attribution: Record<string, unknown> | undefined;
  customers: { id: string; params: Record<string, unknown> }[];
  session: { id: string; params: Record<string, unknown> };
  stripeEvent: { id: string; created: number };
  stripeEventRow: Record<string, unknown> | null;
  replay: { status: number; serverCapturesBefore: number; serverCapturesAfter: number };
  offMachine: string[];
  requests: { method: string; path: string; encoding: string }[];
  captures: Capture[];
}

const file = process.argv[2];
if (!file) throw new Error('usage: d7-report.ts <evidence.json>');
const e = JSON.parse(readFileSync(file, 'utf8')) as Evidence;

const cell = (v: unknown) =>
  v === undefined || v === null || v === '' ? '—' : String(v).replace(/\|/g, '\\|');
const who = (id: string | null) =>
  id === e.userId
    ? '`users.id`'
    : id === e.anonId
      ? 'browser anon id'
      : id === `account:${e.accountId}`
        ? '`account:<account>`'
        : `**other** \`${cell(id)}\``;

/** The few properties that say what an event is, where present. */
const SHOWN = [
  '$anon_distinct_id',
  'account_id',
  'plan',
  'trial',
  'interval',
  'trigger',
  'source',
  '$pathname',
] as const;

const out: string[] = [];
out.push(`users.id: \`${e.userId}\`  `);
out.push(`account: \`${e.accountId}\`  `);
out.push(`browser anon id: \`${e.anonId}\``);
out.push('');
out.push(`### Captured events (${e.captures.length}, in arrival order)`);
out.push('');
out.push('| # | from | event | distinct_id | uuid | timestamp | properties |');
out.push('|---|---|---|---|---|---|---|');
e.captures.forEach((c, i) => {
  const props = SHOWN.filter((k) => c.properties[k] !== undefined)
    .map((k) =>
      k === '$anon_distinct_id'
        ? `${k}=${c.properties[k] === e.anonId ? 'browser anon id' : cell(c.properties[k])}`
        : k === 'account_id'
          ? `account_id=${c.properties[k] === e.accountId ? 'the account' : cell(c.properties[k])}`
          : `${k}=${cell(c.properties[k])}`,
    )
    .join(', ');
  out.push(
    `| ${i + 1} | ${c.source} | \`${c.event}\` | ${who(c.distinct_id)} | ${cell(c.uuid)} | ${cell(
      c.timestamp,
    )} | ${props || '—'} |`,
  );
});
out.push('');

const byKey = new Map<string, Map<string, number>>();
for (const c of e.captures) {
  const k = `${c.source} · ${who(c.distinct_id)}`;
  const m = byKey.get(k) ?? new Map<string, number>();
  m.set(c.event, (m.get(c.event) ?? 0) + 1);
  byKey.set(k, m);
}
out.push('### Events by sender and distinct id');
out.push('');
out.push('| sender · distinct id | events (count) |');
out.push('|---|---|');
for (const [k, m] of byKey) {
  out.push(`| ${k} | ${[...m].map(([ev, n]) => `\`${ev}\` ×${n}`).join(', ')} |`);
}
out.push('');

out.push('### `public.account_attribution` for the account');
out.push('');
if (e.attribution) {
  out.push('| column | value |');
  out.push('|---|---|');
  for (const [k, v] of Object.entries(e.attribution)) {
    out.push(`| ${k} | ${k === 'account_id' && v === e.accountId ? 'the account' : cell(v)} |`);
  }
} else {
  out.push('No row.');
}
out.push('');
out.push(`Landing URL: \`${e.landing}\`; referrer sent: \`${e.referrer}\`.`);
out.push('');

const meta = (m: unknown, k: string) => (m as Record<string, unknown> | undefined)?.[k];
const named = (v: unknown, id: string, label: string) => (v === id ? label : `**${cell(v)}**`);
const customer = e.customers.find((c) => c.id === e.session.params.customer);
const subMeta = (e.session.params.subscription_data as Record<string, unknown> | undefined)
  ?.metadata;
out.push('### Stripe stand-in metadata');
out.push('');
out.push('| object | posthog_person_distinct_id | account_id |');
out.push('|---|---|---|');
for (const [label, m] of [
  [`customer ${customer?.id ?? '(none)'}`, customer?.params.metadata],
  [`Checkout Session ${e.session.id} \`subscription_data.metadata\``, subMeta],
  [`Checkout Session ${e.session.id} \`metadata\``, e.session.params.metadata],
] as const) {
  out.push(
    `| ${label} | ${named(meta(m, 'posthog_person_distinct_id'), e.userId, '`users.id`')} | ${named(
      meta(m, 'account_id'),
      e.accountId,
      'the account',
    )} |`,
  );
}
out.push('');

out.push('### The Stripe event and its replay');
out.push('');
out.push(
  `Event \`${e.stripeEvent.id}\`, created ${e.stripeEvent.created} (${new Date(
    e.stripeEvent.created * 1000,
  ).toISOString()}). Ledger row: \`${JSON.stringify(e.stripeEventRow)}\`.`,
);
out.push(
  `Replay answered ${e.replay.status}; server captures before it: ${e.replay.serverCapturesBefore}, after it: ${e.replay.serverCapturesAfter}.`,
);
out.push('');

const reqs = new Map<string, number>();
for (const r of e.requests) {
  const k = `${r.method} ${r.path} (${r.encoding})`;
  reqs.set(k, (reqs.get(k) ?? 0) + 1);
}
out.push('### Requests the capture stub answered');
out.push('');
out.push('| request (body encoding) | count |');
out.push('|---|---|');
for (const [k, n] of reqs) out.push(`| ${cell(k)} | ${n} |`);
out.push('');
out.push(
  `Requests to hosts other than localhost, 127.0.0.1 and Stripe's (refused by the walk): ${
    e.offMachine.length === 0 ? 'none' : e.offMachine.map((u) => `\`${u}\``).join(', ')
  }.`,
);

process.stdout.write(`${out.join('\n')}\n`);
