/**
 * Spec 03's event × state table, rendered from the cases the webhook's end-to-end test runs
 * (apps/web/lib/billing/webhook-cases.fixture.ts), so the spec names only transitions the tests run
 * (OPERATING-RULES §10). The rest of the spec is written by hand; `buildBillingSpec` puts the table
 * between its markers and formats the file as Prettier would.
 *
 * Write: pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-03-billing-spec.ts
 * Check: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-03-billing-spec.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  SETUPS,
  WEBHOOK_CASES,
  type CaseRole,
  type Setup,
  type WebhookCase,
} from '../../lib/billing/webhook-cases.fixture';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SPEC_03_PATH = resolve(REPO_ROOT, 'docs/specs/v2/03-billing.md');

export const BEGIN = '<!-- BEGIN generated: the event × state table -->';
export const END = '<!-- END generated -->';

const SETUP_ORDER = Object.keys(SETUPS) as Setup[];

function rowKey(c: WebhookCase): string {
  const s = c.stripe;
  if (s.subscription === null) return `\`${s.type}\``;
  return `\`${s.type}\`, ${s.subscription === 'current' ? 'its' : 'another'} subscription ${s.status} on ${s.plan}`;
}

const ROLE: Record<CaseRole, string> = { current: 'its', other: 'the other' };

function cell(c: WebhookCase): string {
  const e = c.expect;
  const outcome =
    e.outcome === 'applied'
      ? `→ ${e.state}`
      : e.reason === undefined
        ? e.outcome
        : `${e.outcome}: ${e.reason}`;
  const writes = [
    ...e.cancels.map((r) => `cancels ${ROLE[r]}`),
    ...e.alerts.map((a) => `alerts ${a}`),
  ];
  return writes.length === 0 ? outcome : `${outcome} (${writes.join(', ')})`;
}

/** The table as Markdown: one row per event and Stripe state, one column per starting account. */
export function renderEventStateTable(cases: readonly WebhookCase[] = WEBHOOK_CASES): string {
  const rows = new Map<string, Map<Setup, string[]>>();
  for (const c of cases) {
    const key = rowKey(c);
    const row = rows.get(key) ?? new Map<Setup, string[]>();
    row.set(c.from, [...(row.get(c.from) ?? []), cell(c)]);
    rows.set(key, row);
  }
  const header = `| Event | ${SETUP_ORDER.map((s) => SETUPS[s]).join(' | ')} |`;
  const rule = `| --- | ${SETUP_ORDER.map(() => '---').join(' | ')} |`;
  const body = [...rows].map(
    ([key, row]) =>
      `| ${key} | ${SETUP_ORDER.map((s) => (row.get(s) ?? ['—']).join('; ')).join(' | ')} |`,
  );
  return [
    `${cases.length} cases, each run through the handler against PGlite with every migration. "→" is the`,
    'state after an applied event; "ignored" carries the machine\'s reason; "—" is a cell the cases do',
    'not run. In parentheses, what that one event plans for Stripe: "cancels its" the subscription the',
    'account followed before it, "cancels the other" the subscription the event is about, "alerts" a',
    'founder alert and its reason. A cell without parentheses plans neither.',
    '',
    header,
    rule,
    ...body,
  ].join('\n');
}

/** The spec as it should be on disk: the hand-written file with the table rendered in, formatted. */
export async function buildBillingSpec(): Promise<string> {
  const doc = readFileSync(SPEC_03_PATH, 'utf8');
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${SPEC_03_PATH} has no generated section`);
  const md = `${doc.slice(0, start + BEGIN.length)}\n\n${renderEventStateTable()}\n\n${doc.slice(end)}`;
  const config = (await resolveConfig(SPEC_03_PATH)) ?? {};
  return format(md, { ...config, filepath: SPEC_03_PATH });
}
