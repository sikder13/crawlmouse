import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_POLICIES } from '../../lib/security/route-policy';
import {
  REPO_DIR,
  adminCallSites,
  adminCalls,
  callerChainEnds,
  allEntries,
  callsMarker,
  dataReadingEntries,
  dataSourcesOf,
  declaresIn,
  declaresTest,
  entryFiles,
  importClosure,
  importersOf,
  markerCalls,
  passesLiteral,
  readsData,
  routes,
  sourceFiles,
  testsTitled,
} from './access-surface';
import { ACCESS_ROWS, KNOWN_OPEN } from './access-matrix.data';
import { DOC_PATH, render } from './access-matrix.render';
import type { AccessRow } from './access-matrix.types';
import { parseSource, routeFile } from './route-source';

// CC-37 D1: every route handler, every server entry file that reads data and every file that opens a
// service-role client has a row saying whom it acts for, the check that gates it and the test that
// proves it. Each property below is checked against the disk and the code, not against the rows.

const rowsOf = (kind: AccessRow['kind']) => ACCESS_ROWS.filter((r) => r.kind === kind);
const byPolicy = new Map(ROUTE_POLICIES.map((p) => [p.route, p]));

/** The file a row is about, repo-relative. */
function fileOf(r: AccessRow): string {
  return r.kind === 'route' ? resolve(routeFile(r.path)).slice(REPO_DIR.length + 1) : r.path;
}

const label = (r: AccessRow) => `${r.kind} ${r.path}`;

/** The title of the caller check below, which `caller` rows name as their proof. */
const CALLER_CHECK_TITLE = 'every chain of importers from a caller row ends at a gated row';

describe('the matrix lists the surface on disk', () => {
  it('reads the surface from disk (anti-vacuity)', () => {
    expect(routes().length).toBeGreaterThan(80);
    expect(dataReadingEntries()).toContain('apps/web/app/r/[slug]/opengraph-image.tsx');
    expect(allEntries().length).toBeGreaterThan(dataReadingEntries().length);
    expect(adminCallSites().size).toBeGreaterThan(100);
    // The Inngest functions build their own service-role client; it is counted.
    expect(adminCallSites().get('apps/web/lib/v2/mail/functions.ts')).toBe(2);
  });

  it('one row per route folder', () => {
    expect(
      rowsOf('route')
        .map((r) => r.path)
        .sort(),
    ).toEqual(routes());
  });

  it('one row per server entry file that reads data', () => {
    expect(
      rowsOf('entry')
        .map((r) => r.path)
        .sort(),
    ).toEqual(dataReadingEntries());
  });

  it('one row per file that opens a service-role client, with its count', () => {
    expect(Object.fromEntries(rowsOf('service-client').map((r) => [r.path, r.calls ?? 0]))).toEqual(
      Object.fromEntries(adminCallSites()),
    );
  });

  it('no row is listed twice', () => {
    const keys = ACCESS_ROWS.map(label);
    expect(keys.length).toBe(new Set(keys).size);
  });
});

describe('each row names a gate that is in the code', () => {
  it.each(ACCESS_ROWS.map((r) => [label(r), r] as const))('%s', (_, r) => {
    expect(r.identity.trim(), 'identity').not.toBe('');
    expect(r.detail.trim(), 'detail').not.toBe('');
    if (r.gate === 'public' || r.gate === 'caller') {
      expect(r.check, 'a public or caller row names no check').toBeUndefined();
    } else {
      expect(r.check, 'check').toBeDefined();
      const check = r.check!;
      expect(existsSync(resolve(REPO_DIR, check.file)), check.file).toBe(true);
      expect(
        callsMarker(check.file, check.marker, check.arg),
        `${check.marker}${check.arg ? `('${check.arg}')` : ''} called, its result used, in ${check.file}`,
      ).toBe(true);
      const closure = importClosure(resolve(REPO_DIR, fileOf(r)));
      expect(closure.has(resolve(REPO_DIR, check.file)), `${fileOf(r)} reaches ${check.file}`).toBe(
        true,
      );
    }
    if (r.gate === 'seat_may') {
      expect(r.action, 'action').toBeTruthy();
      expect(
        passesLiteral(r.check!.file, r.action!),
        `'${r.action}' asked in ${r.check!.file}`,
      ).toBe(true);
    } else {
      expect(r.action).toBeUndefined();
    }
    if (r.gate === 'caller') {
      expect(r.callers?.length, 'callers').toBeGreaterThan(0);
      expect([...r.callers!].sort()).toEqual(importersOf(r.path));
    } else {
      expect(r.callers).toBeUndefined();
    }
  });

  it('every chain of importers from a caller row ends at a gated row', () => {
    // The `callers` list is held to the disk in the row's own case above. Here each chain of
    // importers is followed (callerChainEnds): through a `caller` row by its `callers`, through a
    // file with no row by its importers on disk, until a row whose gate is neither `caller` nor
    // `public`. A public row, a file nothing imports, or a cycle fails the row.
    const gates = new Map<string, Set<string>>();
    for (const r of ACCESS_ROWS) {
      const f = fileOf(r);
      gates.set(f, (gates.get(f) ?? new Set()).add(r.gate));
    }
    const mixed = [...gates].filter(([, g]) => g.size > 1).map(([f, g]) => `${f}: ${[...g]}`);
    expect(mixed, 'one gate per file').toEqual([]);
    const byFile = new Map(ACCESS_ROWS.map((r) => [fileOf(r), r] as const));
    const gateOf = (f: string) => byFile.get(f)?.gate;
    const callersOf = (f: string) => byFile.get(f)?.callers ?? importersOf(f);
    const callerRows = ACCESS_ROWS.filter((r) => r.gate === 'caller');
    expect(callerRows.length).toBeGreaterThan(0);
    const loose = callerRows
      .filter((r) => !callerChainEnds(fileOf(r), gateOf, callersOf, r.publicCallers !== undefined))
      .map((r) => r.path);
    expect(loose).toEqual([]);
    // A stated reason for public callers is needed: without it the row would fail.
    const needless = callerRows
      .filter((r) => r.publicCallers !== undefined && callerChainEnds(fileOf(r), gateOf, callersOf))
      .map((r) => r.path);
    expect(needless).toEqual([]);
    expect(ACCESS_ROWS.filter((r) => r.publicCallers !== undefined && r.gate !== 'caller')).toEqual(
      [],
    );
  });

  it('a route row agrees with the route policy', () => {
    const wrong = rowsOf('route').flatMap((r) => {
      const cls = byPolicy.get(r.path)?.class;
      const ok =
        cls === 'public'
          ? true
          : cls === 'service' || cls === 'webhook'
            ? r.gate === 'signature' || r.gate === 'operator'
            : r.gate !== 'public';
      return ok ? [] : [`${r.path}: ${cls} with gate ${r.gate}`];
    });
    expect(wrong).toEqual([]);
  });
});

describe('each row is proved by one running test that reaches its file', () => {
  it.each(ACCESS_ROWS.map((r) => [label(r), r] as const))('%s', (_, r) => {
    expect(
      declaresTest(r.proof.file, r.proof.test),
      `${r.proof.file} › ${r.proof.test}: exactly one running it/test of that title`,
    ).toBe(true);
    if (r.proof.via === 'caller-check') {
      // The matrix's caller check proves a caller row and nothing else.
      expect(r.gate, 'a caller-check proof is for a caller row').toBe('caller');
      expect([r.proof.file, r.proof.test]).toEqual([
        `apps/web/${'__tests__/security/access-matrix.test.ts'}`,
        CALLER_CHECK_TITLE,
      ]);
      return;
    }
    const closure = importClosure(resolve(REPO_DIR, r.proof.file));
    const targets = [fileOf(r), ...(r.check ? [r.check.file] : [])];
    expect(
      targets.some((t) => closure.has(resolve(REPO_DIR, t))),
      `${r.proof.file} imports ${targets.join(' or ')}`,
    ).toBe(true);
  });
});

describe('holes', () => {
  it('no hole is open', () => expect(KNOWN_OPEN).toEqual([]));

  it('a row marked open names a hole in KNOWN_OPEN, and each open hole has a row', () => {
    const marked = new Set(ACCESS_ROWS.flatMap((r) => (r.hole ? [r.hole] : [])));
    expect([...marked].filter((h) => !KNOWN_OPEN.includes(h))).toEqual([]);
    expect(KNOWN_OPEN.filter((h) => !marked.has(h))).toEqual([]);
  });
});

describe('the check finder reads calls, not text', () => {
  // Each probe is a separate source, so a count is about that shape alone. Names and spellings vary
  // (the binding, the quotes, a template literal, `sb['rpc']`), because the matcher must not key on one.
  const count = (lines: string[], marker: string, arg?: string) =>
    markerCalls(parseSource(lines.join('\n'), 'probe.ts'), marker, arg);

  it.each([
    [
      'a comment, an import and a type',
      [
        '// is_member_for_site is checked',
        "import { seat_may } from './g';",
        "type T = 'is_member';",
      ],
      'is_member_for_site',
      undefined,
      0,
    ],
    [
      'an rpc whose result is read',
      [
        "const { data: member } = await sb.rpc('is_member_for_site', { p });",
        'if (member !== true) return notFound();',
      ],
      'is_member_for_site',
      undefined,
      1,
    ],
    [
      'an rpc in double quotes, chained, under another name',
      [
        'const { data: zone } = await supabase.rpc("seat_may", { a }).single();',
        'if (!zone) return deny();',
      ],
      'seat_may',
      undefined,
      1,
    ],
    [
      'an rpc through an element access, in a template literal',
      ["const frontier = await db['rpc'](`member_role`);", 'return frontier;'],
      'member_role',
      undefined,
      1,
    ],
    [
      'a call in a condition',
      ['if (!(await requireOperator(user))) return deny();'],
      'requireOperator',
      undefined,
      1,
    ],
    ['a returned method call', ['return guard.verifyWebhook(req);'], 'verifyWebhook', undefined, 1],
    [
      'an awaited rpc as a bare statement',
      ["await sb.rpc('is_member_for_site', { p });"],
      'is_member_for_site',
      undefined,
      0,
    ],
    [
      'an rpc as a bare statement',
      ["sb.rpc('is_member_for_fix');"],
      'is_member_for_fix',
      undefined,
      0,
    ],
    [
      'an rpc under void',
      ["void sb.rpc('is_member_for_site');"],
      'is_member_for_site',
      undefined,
      0,
    ],
    [
      'a method call as a bare statement',
      ['guard.verifyWebhook(req);'],
      'verifyWebhook',
      undefined,
      0,
    ],
    ['a binding never read', ['const unused = await isOperator(u);'], 'isOperator', undefined, 0],
    [
      'a destructured binding read only under void',
      ["const { data } = await sb.rpc('seat_may', { a });", 'void data;'],
      'seat_may',
      undefined,
      0,
    ],
    ['the left of a comma', ['(await isOperator(u), next());'], 'isOperator', undefined, 0],
    // The answer is the data, not the error: reading only `error` (under any name, by destructuring,
    // a property or an element access, directly or through a second binding) is not using the check.
    [
      'a destructured answer never read, its error read (the refusal deleted)',
      [
        "const { data: allowed, error } = await sb.rpc('seat_may', { a });",
        'if (error) throw error;',
      ],
      'seat_may',
      undefined,
      0,
    ],
    [
      'a destructured answer never read, its error renamed and read',
      [
        "const { data: zone_v, error: guardError } = await sb.rpc('is_member_for_site', { p });",
        'if (guardError) return fail(guardError);',
      ],
      'is_member_for_site',
      undefined,
      0,
    ],
    [
      'only the error destructured',
      ["const { error } = await sb.rpc('member_role');", 'if (error) throw error;'],
      'member_role',
      undefined,
      0,
    ],
    [
      'a destructured answer read, its error read too',
      [
        "const { data: allowed, error: guardError } = await sb.rpc('seat_may', { a });",
        'if (guardError) throw guardError;',
        'if (allowed !== true) return deny();',
      ],
      'seat_may',
      undefined,
      1,
    ],
    [
      'a whole result read only for .error',
      [
        "const frontier_v = await sb.rpc('seat_may', { a });",
        'if (frontier_v.error) throw frontier_v.error;',
      ],
      'seat_may',
      undefined,
      0,
    ],
    [
      'a whole result read only for [`error`]',
      ["const res = await sb.rpc('seat_may');", "if (res['error']) throw res[`error`];"],
      'seat_may',
      undefined,
      0,
    ],
    [
      'a whole result read for .data as well',
      [
        "const res = await sb.rpc('seat_may');",
        'if (res.error) throw res.error;',
        'if (!res.data) return deny();',
      ],
      'seat_may',
      undefined,
      1,
    ],
    [
      'a whole result re-destructured, only its error read',
      [
        "const res = await sb.rpc('seat_may');",
        'const { data: ok, error } = res;',
        'if (error) throw error;',
      ],
      'seat_may',
      undefined,
      0,
    ],
    [
      'a whole result re-destructured, its answer read',
      [
        "const res = await sb.rpc('seat_may');",
        'const { data: ok, error } = res;',
        'if (error) throw error;',
        'if (!ok) return deny();',
      ],
      'seat_may',
      undefined,
      1,
    ],
    [
      'the error of a call read in a condition',
      ["if ((await sb.rpc('seat_may', { a })).error) return fail();"],
      'seat_may',
      undefined,
      0,
    ],
    [
      'the data of a call read in a condition',
      ["if (!(await sb.rpc('seat_may', { a })).data) return deny();"],
      'seat_may',
      undefined,
      1,
    ],
    [
      'the marker as the first argument of a call that is not rpc',
      ["console.log('seat_may');", 'const r = log(`is_member`); use(r);'],
      'seat_may',
      undefined,
      0,
    ],
    [
      'a column name in a select',
      ["const { data } = await sb.from('t').select('id');", 'if (!data) return 404;'],
      'id',
      undefined,
      0,
    ],
    [
      'a filter on the capability column, read',
      [
        "const { data } = await sb.from('r').update(x).eq('audit_id', id).select('slug').maybeSingle();",
        'if (!data) return 404;',
      ],
      'eq',
      'audit_id',
      1,
    ],
    [
      'a filter on another column',
      ["const { data } = await sb.from('r').select().eq('user_id', id);", 'use(data);'],
      'eq',
      'audit_id',
      0,
    ],
    [
      'another filter on the column',
      ["const { data } = await sb.from('r').select().neq('audit_id', id);", 'use(data);'],
      'eq',
      'audit_id',
      0,
    ],
    [
      'a filter on the column as a bare statement',
      ["await sb.from('r').delete().eq('audit_id', id);"],
      'eq',
      'audit_id',
      0,
    ],
  ] as const)('%s: %s', (_, lines, marker, arg, n) => {
    expect(count([...lines], marker, arg)).toBe(n);
  });
});

describe('a proof is one test that runs, by its whole title', () => {
  const count = (lines: string[], title: string) =>
    testsTitled(parseSource(lines.join('\n'), 'probe.test.ts'), title);
  const fn = '() => {}';

  it.each([
    ['it with a body', [`it('a gate', ${fn});`], 'a gate', 1],
    ['test in double quotes, async', ['test("a gate", async () => { await x(); });'], 'a gate', 1],
    [
      'it.concurrent with options',
      [`it.concurrent('a gate', { timeout: 5 }, ${fn});`],
      'a gate',
      1,
    ],
    ['a template title', ['it(`as ${role}`, fn);'], 'as owner', 1],
    ['it.each with %s', [`it.each(rows)('%s refuses', ${fn});`], 'manager refuses', 1],
    ['it.each with $role', [`test.each(rows)('$role: refuses', ${fn});`], 'owner: refuses', 1],
    [
      'it.each whose literal text differs',
      [`it.each(rows)('%s refuses', ${fn});`],
      'manager accepts',
      0,
    ],
    [
      'it.each over a literal table, a row of it',
      [`it.each(['owner', 'manager'])('%s refuses', ${fn});`],
      'manager refuses',
      1,
    ],
    [
      'it.each over a literal table, not a row of it',
      [`it.each(['owner', 'manager'])('%s refuses', ${fn});`],
      'developer refuses',
      0,
    ],
    [
      'it.each over objects, a row of it',
      [`it.each([{ role: 'owner' }, { role: 'frontier_v' }])('$role: refuses', ${fn});`],
      'frontier_v: refuses',
      1,
    ],
    [
      'it.each over objects, not a row of it',
      [`it.each([{ role: 'owner' }])('$role: refuses', ${fn});`],
      'zone_v: refuses',
      0,
    ],
    [
      'it.each over tuples with a number',
      [`it.each([['a', 1]])('%s gets %i', ${fn});`],
      'a gets 7',
      1,
    ],
    [
      'it.each whose title is placeholders only',
      [`it.each(rows)('%s', ${fn});`],
      'any title at all',
      0,
    ],
    [
      'it.each whose title is placeholders and punctuation',
      [`it.each(rows)('%s: %i', ${fn});`],
      'x: 1',
      0,
    ],
    ['it.todo', ["it.todo('a gate');"], 'a gate', 0],
    ['it.skip', [`it.skip('a gate', ${fn});`], 'a gate', 0],
    ['test.fails', [`test.fails('a gate', ${fn});`], 'a gate', 0],
    ['it.only', [`it.only('a gate', ${fn});`], 'a gate', 0],
    ['test.skipIf', [`test.skipIf(ci)('a gate', ${fn});`], 'a gate', 0],
    ['it.each.skip', [`it.skip.each(rows)('%s', ${fn});`], 'a gate', 0],
    ['describe', [`describe('a gate', ${fn});`], 'a gate', 0],
    ['it with no body', ["it('a gate');"], 'a gate', 0],
    ['a longer title', [`it('a gate that is longer', ${fn});`], 'a gate', 0],
    ['a shorter title', [`it('gate', ${fn});`], 'a gate', 0],
    ['two tests of that title', [`it('a gate', ${fn});`, `test('a gate', ${fn});`], 'a gate', 2],
  ] as const)('%s: %s', (_, lines, title, n) => {
    expect(count([...lines], title)).toBe(n);
  });

  it('a title declared twice is no proof, and once is', () => {
    const twice = parseSource(`it('zone_v', ${fn});\ntest('zone_v', ${fn});`, 'p.test.ts');
    const once = parseSource(`it('frontier_v', ${fn});\ntest('zone_v', ${fn});`, 'p.test.ts');
    expect(declaresIn(twice, 'zone_v')).toBe(false);
    expect(declaresIn(once, 'zone_v')).toBe(true);
  });
});

describe('a caller chain ends at a gated row', () => {
  // `callerChainEnds(start, gateOf, callersOf)`: gateOf names a row's gate (undefined: not a row);
  // callersOf the files importing a file. Names vary so the walk does not key on one.
  const run = (start: string, gates: Record<string, string>, callers: Record<string, string[]>) =>
    callerChainEnds(
      start,
      (f) => (Object.hasOwn(gates, f) ? gates[f] : undefined),
      (f) => (Object.hasOwn(callers, f) ? callers[f]! : []),
    );

  it.each([
    [
      'a caller of a gated route',
      'lib/a.ts',
      { 'lib/a.ts': 'caller', 'app/r.ts': 'member' },
      { 'lib/a.ts': ['app/r.ts'] },
      true,
    ],
    [
      'through a caller row',
      'lib/zone.ts',
      { 'lib/zone.ts': 'caller', 'lib/frontier.ts': 'caller', 'app/p.tsx': 'seat_may' },
      { 'lib/zone.ts': ['lib/frontier.ts'], 'lib/frontier.ts': ['app/p.tsx'] },
      true,
    ],
    [
      'through a module with no row',
      'lib/b.ts',
      { 'lib/b.ts': 'caller', 'app/q.ts': 'operator' },
      { 'lib/b.ts': ['app/_lib/x.ts'], 'app/_lib/x.ts': ['app/q.ts'] },
      true,
    ],
    [
      'a two-row cycle',
      'lib/zone_v.ts',
      { 'lib/zone_v.ts': 'caller', 'lib/frontier_v.ts': 'caller' },
      { 'lib/zone_v.ts': ['lib/frontier_v.ts'], 'lib/frontier_v.ts': ['lib/zone_v.ts'] },
      false,
    ],
    ['a self-cycle', 'lib/c.ts', { 'lib/c.ts': 'caller' }, { 'lib/c.ts': ['lib/c.ts'] }, false],
    [
      'a cycle through a module with no row',
      'lib/d.ts',
      { 'lib/d.ts': 'caller' },
      { 'lib/d.ts': ['lib/m.ts'], 'lib/m.ts': ['lib/d.ts'] },
      false,
    ],
    [
      'a public row',
      'lib/e.ts',
      { 'lib/e.ts': 'caller', 'app/pub.tsx': 'public' },
      { 'lib/e.ts': ['app/pub.tsx'] },
      false,
    ],
    [
      'one gated and one public caller',
      'lib/f.ts',
      { 'lib/f.ts': 'caller', 'app/g.ts': 'member', 'app/pub.ts': 'public' },
      { 'lib/f.ts': ['app/g.ts', 'app/pub.ts'] },
      false,
    ],
    [
      'a module with no row and no importer',
      'lib/h.ts',
      { 'lib/h.ts': 'caller' },
      { 'lib/h.ts': ['lib/orphan.ts'] },
      false,
    ],
    ['a caller row with no callers', 'lib/i.ts', { 'lib/i.ts': 'caller' }, {}, false],
  ] as const)('%s: %s', (_, start, gates, callers, ok) => {
    expect(run(start, gates, callers as Record<string, string[]>)).toBe(ok);
  });

  it('a stated public caller ends a chain, and a cycle still does not', () => {
    const gates = { 'lib/zone.ts': 'caller', 'app/pub.ts': 'public', 'lib/frontier.ts': 'caller' };
    const ok = (f: string) =>
      Object.hasOwn(gates, f) ? gates[f as keyof typeof gates] : undefined;
    expect(callerChainEnds('lib/zone.ts', ok, () => ['app/pub.ts'], true)).toBe(true);
    expect(callerChainEnds('lib/zone.ts', ok, () => ['app/pub.ts'], false)).toBe(false);
    const cyc = (f: string) => (f === 'lib/zone.ts' ? ['lib/frontier.ts'] : ['lib/zone.ts']);
    expect(callerChainEnds('lib/zone.ts', ok, cyc, true)).toBe(false);
  });
});

describe('the service-role enumeration counts bindings, not one spelling', () => {
  const probe = (lines: string[], name = 'lib/v2/probe.ts') =>
    adminCalls(parseSource(lines.join('\n'), resolve(REPO_DIR, 'apps/web', name)));
  const KEY = 'SUPABASE_SERVICE_ROLE_KEY';

  it.each([
    [
      'the plain call',
      ["import { supabaseAdmin } from '@/lib/supabase/admin';", 'const sb = supabaseAdmin();'],
      1,
    ],
    [
      'an alias',
      ["import { supabaseAdmin as sa } from '@/lib/supabase/admin';", 'const zone = sa();'],
      1,
    ],
    [
      'a relative path and a namespace',
      ["import * as admin from '../supabase/admin';", 'const frontier = admin.supabaseAdmin();'],
      1,
    ],
    [
      'an alias reassigned',
      [
        "import { supabaseAdmin as zone_v } from '@/lib/supabase/admin';",
        'const make = zone_v;',
        'make();',
      ],
      1,
    ],
    [
      'the key in a variable',
      [
        "import { createClient } from '@supabase/supabase-js';",
        `const key = process.env.${KEY}!;`,
        'createClient(url, key);',
      ],
      1,
    ],
    [
      'the key destructured',
      [
        "import { createClient } from '@supabase/supabase-js';",
        `const { ${KEY}: k } = process.env;`,
        'createClient(url, k);',
      ],
      1,
    ],
    [
      'the key by element access',
      [
        "import { createClient } from '@supabase/supabase-js';",
        `createClient(url, process.env['${KEY}']!);`,
      ],
      1,
    ],
    [
      'createClient aliased',
      [
        "import { createClient as mk } from '@supabase/supabase-js';",
        `mk(url, process.env.${KEY}!);`,
      ],
      1,
    ],
    [
      'createClient through a namespace',
      [
        "import * as supa from '@supabase/supabase-js';",
        `const k2 = process.env.${KEY};`,
        'supa.createClient(url, k2);',
      ],
      1,
    ],
    [
      'the anon key',
      [
        "import { createClient } from '@supabase/supabase-js';",
        'createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);',
      ],
      0,
    ],
    ['a comment and a string', ['// supabaseAdmin()', `const s = 'supabaseAdmin() ${KEY}';`], 0],
    [
      'the key named in a string passed to createClient',
      ["import { createClient } from '@supabase/supabase-js';", `createClient(url, '${KEY}');`],
      0,
    ],
    [
      'another module of the same name',
      ["import { supabaseAdmin as frontier_v } from '@/lib/other';", 'frontier_v();'],
      0,
    ],
  ] as const)('%s: %s', (_, lines, n) => {
    expect(probe([...lines])).toBe(n);
  });

  it('walks .js and .jsx, an app segment named tests but not __tests__, and counts a module’s own client as a data source', () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-surface-'));
    try {
      const put = (rel: string, text: string) => {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
      };
      put('app/tests/page.jsx', 'export default function P() { return null; }');
      put('app/zone/route.js', 'export function GET() {}');
      put('app/__tests__/page.tsx', 'export default function P() { return null; }');
      put('lib/x.jsx', 'export const x = 1;');
      put('lib/tests/y.ts', 'export const y = 1;');
      const rel = (fs: string[]) => fs.map((f) => f.slice(root.length + 1)).sort();
      expect(rel(sourceFiles(join(root, 'app'), 'app'))).toEqual([
        'app/tests/page.jsx',
        'app/zone/route.js',
      ]);
      expect(rel(sourceFiles(join(root, 'lib'), 'lib'))).toEqual(['lib/x.jsx']);
      expect(rel(entryFiles(join(root, 'app')))).toEqual(['app/tests/page.jsx']);
      // A page reaching a module that opens its own service-role client reads data; one reaching a
      // module that opens none does not.
      put(
        'lib/zone_v.ts',
        `import { createClient } from '@supabase/supabase-js';\nexport const db = () => createClient(u, process.env.${KEY}!);`,
      );
      put('lib/frontier_v.ts', 'export const nothing = 1;');
      put(
        'app/a/page.tsx',
        "import { db } from '../../lib/zone_v';\nexport default function P() { db(); return null; }",
      );
      put(
        'app/b/page.tsx',
        "import { nothing } from '../../lib/frontier_v';\nexport default function P() { return nothing; }",
      );
      const sites = sourceFiles(join(root, 'lib'), 'lib').filter(
        (f) => adminCalls(parseSource(readFileSync(f, 'utf8'), f)) > 0,
      );
      expect(rel(sites)).toEqual(['lib/zone_v.ts']);
      expect(readsData(join(root, 'app/a/page.tsx'), dataSourcesOf(sites))).toBe(true);
      expect(readsData(join(root, 'app/b/page.tsx'), dataSourcesOf(sites))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('docs/ops/access-matrix.md', () => {
  it('is the render of the rows', () => {
    expect(readFileSync(DOC_PATH, 'utf8')).toBe(render());
  });
});
