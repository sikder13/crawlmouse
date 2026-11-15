import { pathToFileURL } from 'node:url';
import {
  credentials,
  postHogClient,
  type Fetch,
  type Kind,
  type PostHogClient,
  type Remote,
} from './client';
import {
  actionPayload,
  cohortPayload,
  dashboardPayload,
  flagPayload,
  insightPayload,
  propertyFilter,
  surveyPayload,
  type Ids,
} from './payload';
import { PREFIX, SPEC, type PostHogSpec } from './spec';

/**
 * Makes the PostHog project match the spec (CC-41 D6):
 *
 *   pnpm ops:posthog --dry-run    plan, and send no write
 *   pnpm ops:posthog              plan, then apply it
 *
 * Objects are matched by name. One the spec lists is created when absent and updated when it
 * differs; one whose name starts with PREFIX and that the spec no longer lists is deleted; one whose
 * name does not start with PREFIX is not written to. The project's test-account filter is set from
 * the spec. Credentials: client.ts. Prints the plan, never the key.
 */

export type Op = 'create' | 'update' | 'delete' | 'unchanged';
export interface PlanRow {
  op: Op;
  kind: Kind | 'project';
  name: string;
}

export const ours = (name: string) => name.startsWith(PREFIX);

/** Whether every field `want` sets is in `have`, with the same value (arrays: same length too). */
export function holds(want: unknown, have: unknown): boolean {
  if (Array.isArray(want)) {
    return (
      Array.isArray(have) && have.length === want.length && want.every((w, i) => holds(w, have[i]))
    );
  }
  if (want !== null && typeof want === 'object') {
    if (have === null || typeof have !== 'object' || Array.isArray(have)) return false;
    const h = have as Record<string, unknown>;
    return Object.entries(want).every(([k, v]) => Object.hasOwn(h, k) && holds(v, h[k]));
  }
  return Object.is(want, have);
}

interface Wanted {
  name: string;
  body: Record<string, unknown>;
  /** Fields sent only when the object is created. */
  onCreate?: Record<string, unknown>;
}

/** Each kind's wanted objects, built once the kinds before it are applied (their ids are known). */
function wantedOf(spec: PostHogSpec, kind: Kind, ids: Ids, now: Date): Wanted[] {
  switch (kind) {
    case 'action':
      return spec.actions.map((a) => ({ name: a.name, body: actionPayload(a) }));
    case 'cohort':
      return spec.cohorts.map((c) => ({ name: c.name, body: cohortPayload(c) }));
    case 'feature_flag':
      return spec.flags.map((f) => ({ name: f.name, body: flagPayload(f) }));
    case 'survey':
      return spec.surveys.map((s) => ({
        name: s.name,
        body: surveyPayload(s, ids),
        onCreate: { start_date: now.toISOString() },
      }));
    case 'dashboard':
      return spec.dashboards.map((d) => ({ name: d.name, body: dashboardPayload(d) }));
    case 'insight':
      return spec.dashboards.flatMap((d) =>
        d.insights.map((i) => ({ name: i.name, body: insightPayload(i, d.name, ids) })),
      );
  }
}

/** The order the kinds are applied in: each refers only to kinds before it. */
const ORDER: readonly Kind[] = [
  'action',
  'cohort',
  'feature_flag',
  'survey',
  'dashboard',
  'insight',
];

function specNames(spec: PostHogSpec): Record<Kind, string[]> {
  return {
    action: spec.actions.map((a) => a.name),
    cohort: spec.cohorts.map((c) => c.name),
    feature_flag: spec.flags.map((f) => f.name),
    survey: spec.surveys.map((s) => s.name),
    dashboard: spec.dashboards.map((d) => d.name),
    insight: spec.dashboards.flatMap((d) => d.insights.map((i) => i.name)),
  };
}

/** Refuses a spec with an object not named with PREFIX, or two of one kind with one name. */
export function checkSpec(spec: PostHogSpec): void {
  for (const [kind, names] of Object.entries(specNames(spec))) {
    for (const name of names)
      if (!ours(name)) throw new Error(`${kind} "${name}" lacks "${PREFIX}"`);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup !== undefined) throw new Error(`${kind} "${dup}" is listed twice`);
  }
}

const TEST_FILTER = 'test account filter';

/** `client` for reads; its writes send nothing, and a create answers a stand-in id. */
function planOnly(client: PostHogClient): PostHogClient {
  return {
    getProject: () => client.getProject(),
    list: (kind) => client.list(kind),
    updateProject: async () => {},
    create: async (_kind, body) => ({ id: `(new ${String(body.name)})`, name: String(body.name) }),
    update: async () => {},
    remove: async () => {},
  };
}

export async function applySpec(
  spec: PostHogSpec,
  client: PostHogClient,
  { dryRun, now }: { dryRun: boolean; now: () => Date },
): Promise<PlanRow[]> {
  checkSpec(spec);
  const project = await client.getProject();
  // Q8: the field's name is not documented; a project without it is not one this script knows.
  if (!Object.hasOwn(project, 'test_account_filters')) {
    throw new Error(
      'the project has no test_account_filters field: PostHog may have renamed it. Nothing was changed.',
    );
  }
  // Every list is read, and refused, before the first write.
  const remoteOf = new Map<Kind, Remote[]>();
  for (const kind of ORDER) {
    const mine = (await client.list(kind)).filter(
      (r) => typeof r.name === 'string' && ours(r.name),
    );
    const dup = mine.find((r, i) => mine.findIndex((o) => o.name === r.name) !== i);
    if (dup) throw new Error(`two ${kind} objects are named "${dup.name}"; remove one by hand`);
    remoteOf.set(kind, mine);
  }

  // The one place a dry run is decided: its writes go to a client that sends nothing.
  const target = dryRun ? planOnly(client) : client;
  const rows: PlanRow[] = [];
  const filters = spec.testAccountFilters.map(propertyFilter);
  const filtersHold = holds(filters, project.test_account_filters);
  rows.push({ op: filtersHold ? 'unchanged' : 'update', kind: 'project', name: TEST_FILTER });
  if (!filtersHold) await target.updateProject({ test_account_filters: filters });

  const known = new Map<string, Remote['id']>();
  const resolve = (kind: Kind) => (name: string) => {
    const id = known.get(`${kind}:${name}`);
    if (id === undefined) throw new Error(`no ${kind} "${name}" to refer to`);
    return id;
  };
  const ids: Ids = {
    action: resolve('action'),
    flag: resolve('feature_flag'),
    dashboard: resolve('dashboard'),
  };

  for (const kind of ORDER) {
    const mine = remoteOf.get(kind)!;
    const wanted = wantedOf(spec, kind, ids, now());
    const wantedNames = new Set(wanted.map((w) => w.name));
    for (const w of wanted) {
      const match = mine.find((r) => r.name === w.name);
      if (match === undefined) {
        rows.push({ op: 'create', kind, name: w.name });
        const made = await target.create(kind, { ...w.body, ...w.onCreate });
        known.set(`${kind}:${w.name}`, made.id);
        continue;
      }
      known.set(`${kind}:${w.name}`, match.id);
      if (holds(w.body, match)) {
        rows.push({ op: 'unchanged', kind, name: w.name });
      } else {
        rows.push({ op: 'update', kind, name: w.name });
        await target.update(kind, match.id, w.body);
      }
    }
    for (const r of mine.filter((m) => !wantedNames.has(m.name))) {
      rows.push({ op: 'delete', kind, name: r.name });
      await target.remove(kind, r.id);
    }
  }
  return rows;
}

export function formatPlan(rows: readonly PlanRow[], dryRun: boolean): string {
  const width = (pick: (r: PlanRow) => string, head: string) =>
    Math.max(head.length, ...rows.map((r) => pick(r).length));
  const wOp = width((r) => r.op, 'op');
  const wKind = width((r) => r.kind, 'kind');
  const line = (op: string, kind: string, name: string) =>
    `| ${op.padEnd(wOp)} | ${kind.padEnd(wKind)} | ${name}`;
  const count = (op: Op) => rows.filter((r) => r.op === op).length;
  return [
    dryRun ? 'PostHog plan (dry run: nothing was sent)' : 'PostHog plan (applied)',
    line('op', 'kind', 'name'),
    ...rows.map((r) => line(r.op, r.kind, r.name)),
    `create ${count('create')}, update ${count('update')}, delete ${count('delete')}, unchanged ${count('unchanged')}`,
  ].join('\n');
}

const USAGE = 'usage: ops:posthog [--dry-run]';

export interface RunDeps {
  env: Record<string, string | undefined>;
  /** The text of scripts/.env.local; client.ts reads the file when this is absent. */
  read?: () => string;
  fetch: Fetch;
  print: (line: string) => void;
  now: () => Date;
}

export async function runApply(args: readonly string[], deps: RunDeps): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) throw new Error(USAGE);
  const dryRun = args[0] === '--dry-run';
  const client = postHogClient({ ...credentials(deps.env, deps.read), fetch: deps.fetch });
  const rows = await applySpec(SPEC, client, { dryRun, now: deps.now });
  deps.print(formatPlan(rows, dryRun));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runApply(process.argv.slice(2), {
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    print: (l) => console.log(l),
    now: () => new Date(),
  }).catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
