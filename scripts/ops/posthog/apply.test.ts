import { describe, expect, it } from 'vitest';
import { applySpec, formatPlan, runApply, type PlanRow } from './apply';
import { POSTHOG_HOST, postHogClient, type Fetch, type Kind, type Remote } from './client';
import { PREFIX, SPEC, type PostHogSpec } from './spec';

/**
 * A PostHog stand-in: one project's API in memory, answered through an injected `fetch`. Lists are
 * paged three to a page, so the client's paging is exercised. No request leaves the process.
 */
const PROJECT = '448922';
const BASE = `${POSTHOG_HOST}/api/projects/${PROJECT}/`;
const SEGMENTS: Record<string, Kind> = {
  actions: 'action',
  cohorts: 'cohort',
  feature_flags: 'feature_flag',
  surveys: 'survey',
  dashboards: 'dashboard',
  insights: 'insight',
};

interface Request {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function fakePostHog(
  opts: { project?: Record<string, unknown>; seed?: Partial<Record<Kind, Remote[]>> } = {},
) {
  const project: Record<string, unknown> = opts.project ?? { id: 448922, test_account_filters: [] };
  const store = new Map<Kind, Remote[]>(
    Object.values(SEGMENTS).map((k) => [k, structuredClone(opts.seed?.[k] ?? [])]),
  );
  const requests: Request[] = [];
  let nextId = 1000;

  const json = (body: unknown, status = 200) =>
    new Response(body === null ? null : JSON.stringify(body), { status });

  const fetch: Fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method, url, ...(body ? { body } : {}) });
    const auth = new Headers(init.headers).get('authorization');
    if (auth !== 'Bearer phx_test') return json({ detail: 'unauthorized' }, 401);
    if (!url.startsWith(BASE)) return json({ detail: 'not found' }, 404);
    const u = new URL(url);
    const parts = u.pathname.slice(new URL(BASE).pathname.length).split('/').filter(Boolean);
    if (parts.length === 0) {
      if (method === 'GET') return json(project);
      if (method === 'PATCH') return json(Object.assign(project, body));
    }
    const kind = SEGMENTS[parts[0] ?? ''];
    if (!kind) return json({ detail: 'not found' }, 404);
    const rows = store.get(kind)!;
    if (parts.length === 1 && method === 'GET') {
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const live = rows.filter((r) => r.deleted !== true);
      const next =
        offset + 3 < live.length ? `${BASE}${parts[0]}/?limit=200&offset=${offset + 3}` : null;
      return json({ results: live.slice(offset, offset + 3), next });
    }
    if (parts.length === 1 && method === 'POST') {
      const row = { ...body, id: nextId++ } as Remote;
      rows.push(row);
      return json(row, 201);
    }
    const row = rows.find((r) => String(r.id) === parts[1]);
    if (!row) return json({ detail: 'not found' }, 404);
    if (method === 'PATCH') return json(Object.assign(row, body));
    if (method === 'DELETE') {
      rows.splice(rows.indexOf(row), 1);
      return json(null, 204);
    }
    return json({ detail: 'method' }, 405);
  };

  const writes = () => requests.filter((r) => r.method !== 'GET');
  return { fetch, requests, writes, store, project };
}

const NOW = () => new Date('2026-11-16T12:00:00Z');
const clientOf = (fetch: Fetch) => postHogClient({ key: 'phx_test', projectId: PROJECT, fetch });
const ops = (rows: PlanRow[]) => rows.map((r) => r.op);
const allOf = (kind: Kind, f: ReturnType<typeof fakePostHog>) => f.store.get(kind)!;

describe('applySpec', () => {
  it('creates the spec on an empty project, and a second apply plans and sends no change', async () => {
    const f = fakePostHog();
    const first = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(ops(first)).not.toContain('unchanged');
    expect(ops(first).filter((o) => o === 'create')).toHaveLength(first.length - 1);

    const writesBefore = f.writes().length;
    const second = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(second.length).toBe(first.length);
    expect(new Set(ops(second))).toEqual(new Set(['unchanged']));
    expect(f.writes()).toHaveLength(writesBefore);
  });

  it('creates exactly the objects the spec lists, once each', async () => {
    const f = fakePostHog();
    await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    const names = (kind: Kind) =>
      allOf(kind, f)
        .map((r) => r.name)
        .sort();
    expect(names('action')).toEqual(SPEC.actions.map((a) => a.name).sort());
    expect(names('cohort')).toEqual(SPEC.cohorts.map((c) => c.name).sort());
    expect(names('feature_flag')).toEqual(SPEC.flags.map((x) => x.name).sort());
    expect(names('survey')).toEqual(SPEC.surveys.map((s) => s.name).sort());
    expect(names('dashboard')).toEqual(SPEC.dashboards.map((d) => d.name).sort());
    expect(names('insight')).toEqual(
      SPEC.dashboards.flatMap((d) => d.insights.map((i) => i.name)).sort(),
    );
    expect(f.project.test_account_filters).toHaveLength(SPEC.testAccountFilters.length);
  });

  it('links each survey to the flag, and each insight to its dashboard and actions, by their ids', async () => {
    const f = fakePostHog();
    await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    const idOf = (kind: Kind, name: string) => allOf(kind, f).find((r) => r.name === name)!.id;
    const flagId = idOf('feature_flag', SPEC.flags[0]!.name);
    for (const s of allOf('survey', f)) expect(s.linked_flag_id).toBe(flagId);

    for (const d of SPEC.dashboards) {
      for (const i of d.insights) {
        const row = allOf('insight', f).find((r) => r.name === i.name)!;
        expect(row.dashboards).toEqual([idOf('dashboard', d.name)]);
      }
    }
    const funnel = allOf('insight', f).find((r) => r.name === `${PREFIX}Home to sign-up`)!;
    const series = (funnel.query as { source: { series: { kind: string; id?: unknown }[] } }).source
      .series;
    const actionIds = series.filter((s) => s.kind === 'ActionsNode').map((s) => s.id);
    expect(actionIds).toEqual([
      idOf('action', `${PREFIX}Activation`),
      idOf('action', `${PREFIX}Sign-up`),
    ]);
  });

  it('starts a survey it creates, and leaves the start date of one it updates alone', async () => {
    const f = fakePostHog();
    await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    for (const s of allOf('survey', f)) expect(s.start_date).toBe(NOW().toISOString());
    const survey = allOf('survey', f)[0]!;
    survey.description = 'edited by hand';
    await applySpec(SPEC, clientOf(f.fetch), {
      dryRun: false,
      now: () => new Date('2027-01-01T00:00:00Z'),
    });
    const patch = f.writes().find((w) => w.url.endsWith(`/surveys/${survey.id}/`))!;
    expect(patch.method).toBe('PATCH');
    expect(patch.body).not.toHaveProperty('start_date');
    expect(survey.start_date).toBe(NOW().toISOString());
  });

  it('updates an object of ours whose definition differs, and puts it back as the spec has it', async () => {
    const f = fakePostHog();
    await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    const action = allOf('action', f)[0]!;
    action.steps = [{ event: 'home_viewed', properties: [] }];
    const rows = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(rows.filter((r) => r.op === 'update')).toEqual([
      { op: 'update', kind: 'action', name: action.name },
    ]);
    const second = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(new Set(ops(second))).toEqual(new Set(['unchanged']));
  });

  it('never updates or deletes an object whose name does not start with the prefix', async () => {
    const theirs: Partial<Record<Kind, Remote[]>> = {
      action: [
        { id: 1, name: 'Sign-up', steps: [] },
        { id: 2, name: 'cm Paid', steps: [] },
        { id: 3, name: ' [cm] Paid', steps: [] },
      ],
      survey: [{ id: 4, name: 'NPS', type: 'popover' }],
      dashboard: [{ id: 5, name: '[CM] Revenue' }],
      insight: [{ id: 6, name: 'Signups by week', dashboards: [5] }],
      feature_flag: [{ id: 7, name: 'survey-eligible', key: 'x' }],
      cohort: [{ id: 8, name: 'Trialists' }],
    };
    const f = fakePostHog({ seed: theirs });
    const rows = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(rows.filter((r) => r.op === 'delete')).toEqual([]);
    const theirIds = Object.values(theirs).flatMap((list) => list!.map((r) => String(r.id)));
    const touched = f
      .writes()
      .filter((w) => theirIds.some((id) => w.url.match(new RegExp(`/${id}/$`))));
    expect(touched).toEqual([]);
    for (const [kind, list] of Object.entries(theirs) as [Kind, Remote[]][]) {
      for (const r of list) expect(allOf(kind, f)).toContainEqual(r);
    }
  });

  it('deletes an object of ours the spec no longer lists: a survey outright, the others softly', async () => {
    const f = fakePostHog({
      seed: {
        action: [{ id: 11, name: `${PREFIX}Old action`, steps: [] }],
        survey: [{ id: 12, name: `${PREFIX}Old survey`, type: 'popover' }],
        insight: [{ id: 13, name: `${PREFIX}Old insight`, dashboards: [] }],
      },
    });
    const rows = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(rows.filter((r) => r.op === 'delete')).toEqual([
      { op: 'delete', kind: 'action', name: `${PREFIX}Old action` },
      { op: 'delete', kind: 'survey', name: `${PREFIX}Old survey` },
      { op: 'delete', kind: 'insight', name: `${PREFIX}Old insight` },
    ]);
    expect(f.writes()).toContainEqual({
      method: 'PATCH',
      url: `${BASE}actions/11/`,
      body: { deleted: true },
    });
    expect(f.writes()).toContainEqual({ method: 'DELETE', url: `${BASE}surveys/12/` });
    expect(f.writes()).toContainEqual({
      method: 'PATCH',
      url: `${BASE}insights/13/`,
      body: { deleted: true },
    });
  });

  it('in a dry run sends no write, and plans what a real run would do', async () => {
    const f = fakePostHog({
      seed: { action: [{ id: 11, name: `${PREFIX}Old action`, steps: [] }] },
    });
    const dry = await applySpec(SPEC, clientOf(f.fetch), { dryRun: true, now: NOW });
    expect(f.requests.length).toBeGreaterThan(0);
    expect(f.writes()).toEqual([]);

    const real = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(dry).toEqual(real);
  });

  it('refuses, before any write and before listing anything, when the project has no test_account_filters field', async () => {
    const f = fakePostHog({ project: { id: 448922, name: 'Crawlmouse' } });
    for (const dryRun of [true, false]) {
      await expect(applySpec(SPEC, clientOf(f.fetch), { dryRun, now: NOW })).rejects.toThrow(
        /test_account_filters/,
      );
    }
    expect(f.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${BASE}`, `GET ${BASE}`]);
  });

  it('sets the test-account filter when it differs, and leaves it when it matches', async () => {
    const f = fakePostHog({ project: { id: 448922, test_account_filters: [{ key: 'email' }] } });
    const rows = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(rows[0]).toEqual({ op: 'update', kind: 'project', name: 'test account filter' });
    const again = await applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW });
    expect(again[0]).toEqual({ op: 'unchanged', kind: 'project', name: 'test account filter' });
  });

  it('refuses when two objects of ours share a name, and writes nothing', async () => {
    const f = fakePostHog({
      seed: {
        action: [
          { id: 21, name: `${PREFIX}Paid`, steps: [] },
          { id: 22, name: `${PREFIX}Paid`, steps: [] },
        ],
      },
    });
    await expect(applySpec(SPEC, clientOf(f.fetch), { dryRun: false, now: NOW })).rejects.toThrow(
      /\[cm\] Paid/,
    );
    expect(f.writes()).toEqual([]);
  });

  it('refuses a spec whose object is not named with the prefix, before any request', async () => {
    const f = fakePostHog();
    const bad: PostHogSpec = {
      ...SPEC,
      cohorts: [...SPEC.cohorts, { name: 'Unprefixed', description: '', groups: [] }],
    };
    await expect(applySpec(bad, clientOf(f.fetch), { dryRun: true, now: NOW })).rejects.toThrow(
      /Unprefixed/,
    );
    expect(f.requests).toEqual([]);
  });
});

describe('the client', () => {
  it('pages through a list, and will not follow a next link off the project', async () => {
    const seed = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `a${i}` }));
    const f = fakePostHog({ seed: { action: seed } });
    expect(await clientOf(f.fetch).list('action')).toEqual(seed);

    const off: Fetch = async () =>
      new Response(JSON.stringify({ results: [], next: 'https://elsewhere.example/api/x' }));
    await expect(clientOf(off).list('action')).rejects.toThrow(/next link/);
  });

  it('carries no key in an error', async () => {
    const f: Fetch = async () => new Response('nope', { status: 403 });
    const err = await clientOf(f)
      .getProject()
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/403/);
    expect(String(err)).not.toContain('phx_test');
  });
});

describe('runApply', () => {
  const quiet = () => {};
  const env = { POSTHOG_PERSONAL_API_KEY: 'phx_test', POSTHOG_PROJECT_ID: PROJECT };

  it.each([
    ['no key', { POSTHOG_PROJECT_ID: PROJECT }],
    ['no project id', { POSTHOG_PERSONAL_API_KEY: 'phx_test' }],
    ['a project id that is not a number', { ...env, POSTHOG_PROJECT_ID: '448922/../1' }],
  ])('refuses with %s, before any request', async (_, e) => {
    const f = fakePostHog();
    await expect(
      runApply(['--dry-run'], { env: e, read: () => '', fetch: f.fetch, print: quiet, now: NOW }),
    ).rejects.toThrow(/POSTHOG_/);
    expect(f.requests).toEqual([]);
  });

  it('reads the key and project id from scripts/.env.local when the environment has none', async () => {
    const f = fakePostHog();
    const read = () =>
      `# ops\nPOSTHOG_PERSONAL_API_KEY="phx_test"\nPOSTHOG_PROJECT_ID=${PROJECT}\n`;
    await runApply(['--dry-run'], { env: {}, read, fetch: f.fetch, print: quiet, now: NOW });
    expect(f.requests.length).toBeGreaterThan(0);
  });

  it('refuses an argument it does not know, before any request', async () => {
    const f = fakePostHog();
    await expect(
      runApply(['--dryrun'], { env, read: () => '', fetch: f.fetch, print: quiet, now: NOW }),
    ).rejects.toThrow(/usage/);
    expect(f.requests).toEqual([]);
  });

  it('prints the plan table, and never the key', async () => {
    const f = fakePostHog();
    const lines: string[] = [];
    await runApply(['--dry-run'], {
      env,
      read: () => '',
      fetch: f.fetch,
      print: (l) => lines.push(l),
      now: NOW,
    });
    const out = lines.join('\n');
    expect(out).toContain('dry run');
    expect(out).toMatch(/create\s+\|\s+insight\s+\|\s+\[cm\] Home to sign-up/);
    expect(out).not.toContain('phx_test');
  });
});

describe('formatPlan', () => {
  it('lists every row and counts each op', () => {
    const rows: PlanRow[] = [
      { op: 'create', kind: 'action', name: '[cm] A' },
      { op: 'unchanged', kind: 'cohort', name: '[cm] B' },
      { op: 'delete', kind: 'survey', name: '[cm] C' },
    ];
    const out = formatPlan(rows, false);
    for (const r of rows) expect(out).toContain(r.name);
    expect(out).toContain('create 1, update 0, delete 1, unchanged 1');
  });
});
