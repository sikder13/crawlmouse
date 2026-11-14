import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_POLICIES } from '../../lib/security/route-policy';
import {
  REPO_DIR,
  adminCallSites,
  allEntries,
  callsMarker,
  dataReadingEntries,
  declaresTest,
  importClosure,
  importersOf,
  markerCalls,
  passesLiteral,
  routes,
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
      expect(callsMarker(check.file, check.marker), `${check.marker} called in ${check.file}`).toBe(
        true,
      );
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

  it('a caller row names each file that imports it, and each is a row', () => {
    // The `callers` list is held to the disk in the row's own case above. Here each caller must be
    // a file with a row of its own, or a module only a row's file reaches (a route's `_lib`), so a
    // module that trusts its callers ends at a gated row.
    const files = new Set(ACCESS_ROWS.map(fileOf));
    const reached = new Set<string>();
    for (const r of ACCESS_ROWS) {
      if (r.gate === 'caller') continue;
      for (const f of importClosure(resolve(REPO_DIR, fileOf(r))))
        reached.add(f.slice(REPO_DIR.length + 1));
    }
    const loose = ACCESS_ROWS.flatMap((r) =>
      (r.callers ?? [])
        .filter((c) => !files.has(c) && !reached.has(c))
        .map((c) => `${r.path} <- ${c}`),
    );
    expect(rowsOf('service-client').some((r) => r.gate === 'caller')).toBe(true);
    expect(loose).toEqual([]);
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

describe('each row is proved by a test that exists', () => {
  it.each(ACCESS_ROWS.map((r) => [label(r), r] as const))('%s', (_, r) => {
    expect(declaresTest(r.proof.file, r.proof.test), `${r.proof.file} › ${r.proof.test}`).toBe(
      true,
    );
  });
});

describe('holes', () => {
  it('a row marked open names a hole in KNOWN_OPEN, and each open hole has a row', () => {
    const marked = new Set(ACCESS_ROWS.flatMap((r) => (r.hole ? [r.hole] : [])));
    expect([...marked].filter((h) => !KNOWN_OPEN.includes(h))).toEqual([]);
    expect(KNOWN_OPEN.filter((h) => !marked.has(h))).toEqual([]);
  });
});

describe('the check finder reads calls, not text', () => {
  const sf = parseSource(
    [
      '// is_member_for_site is checked by the caller',
      "import { seat_may } from './guard';",
      "type T = 'is_member';",
      "await sb.rpc('is_member_for_site', { p_site });",
      'await requireOperator(user);',
      'guard.verifyWebhook(req);',
    ].join('\n'),
    'probe.ts',
  );
  it.each([
    ['is_member_for_site', 1],
    ['requireOperator', 1],
    ['verifyWebhook', 1],
    ['seat_may', 0],
    ['is_member', 0],
  ] as const)('%s: %i call', (marker, n) => {
    expect(markerCalls(sf, marker)).toBe(n);
  });
});

describe('docs/ops/access-matrix.md', () => {
  it('is the render of the rows', () => {
    expect(readFileSync(DOC_PATH, 'utf8')).toBe(render());
  });
});
