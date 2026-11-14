/**
 * CC-38 D3: a server event about an internal account carries `internal: true`. CC-33's
 * `captureServerEvent` derives it from the event's subject: its distinct id when that is
 * `account:<id>`, `seat:<id>` or a bare id, and its `accountId` when the caller passes one
 * (`subjectsOf`, lib/v2/ops/internal-marker.ts on CC-33's tree). So the property this file checks is
 * the subject, call by call: each call that can fire about an account or a user names one in a form
 * `subjectsOf` reads.
 *
 * The reading is `helpers/server-event-subjects.ts` (its header states the rules). In short: a
 * reference to `captureServerEvent` is accepted as a call, an import, a `typeof`, or the value of a
 * binding typed `typeof captureServerEvent` whose own references are read the same way; any other
 * reference (a structural alias, `.call`, `.bind`, an argument) is refused, because a call made
 * through it is not seen. The calls are then read for their subject.
 *
 * What it cannot see: whether a nullable `accountId` is filled when it could be; a sender other than
 * `captureServerEvent` (`lib/security/refusal-event.ts` is the other one, and names no account).
 *
 * The property needs CC-33's derivation, and fails on this tree without it (the check events name
 * `check:<ref>` and the ServerEvent type has no `accountId`); it runs once
 * lib/v2/ops/internal-marker.ts exists. The enumeration, the reference rule and the fixtures run on
 * any tree.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enumerate,
  hasCc33,
  webProgram,
  webTree,
  type Call,
  type Tree,
} from './helpers/server-event-subjects';

const WEB = resolve(__dirname, '..');
const REPO = resolve(WEB, '../..');
const CC33 = hasCc33(WEB);

describe('CC-38 D3: the server events name the subject internal is derived from', () => {
  let calls: Call[] = [];
  beforeAll(() => {
    const tree = webTree(WEB);
    calls = enumerate(webProgram(tree), tree);
  }, 180_000);

  it('finds the direct calls a text search finds, and the calls through a typed alias', () => {
    const grep = execFileSync(
      'git',
      [
        'grep',
        '-n',
        'captureServerEvent(',
        '--',
        'apps/web',
        'inngest',
        ':!*.test.ts',
        ':!*.test.tsx',
      ],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // The declaration, and the doc comments that name the function with a parenthesis.
      .filter((l) => !/export async function captureServerEvent\(|^\S+:\d+:\s*(\/\*\*|\*)/.test(l))
      .map((l) => l.split(':').slice(0, 2).join(':'));
    const found = new Set(calls.flatMap((c) => [c.at, c.via]));
    expect(grep.length).toBeGreaterThan(0);
    for (const at of grep) expect(found.has(at), at).toBe(true);
    // Through `capture: typeof captureServerEvent = captureServerEvent`.
    expect(calls.some((c) => c.at.startsWith('apps/web/lib/v2/pricing/events.ts:'))).toBe(true);
    expect(calls.some((c) => c.at.startsWith('apps/web/lib/v2/account/account-events.ts:'))).toBe(
      true,
    );
    // Through a wrapper: persist.ts sends fix_closed through account/events.ts's Sender.
    expect(calls.some((c) => c.at.startsWith('apps/web/lib/v2/pipeline/persist.ts:'))).toBe(true);
  });

  it('finds no reference to captureServerEvent other than a call, an import, a typeof or a typed binding', () => {
    expect(calls.filter((c) => c.subject.startsWith('escape:'))).toEqual([]);
  });

  it.runIf(CC33)('accepts no call whose subject internal cannot be derived from', () => {
    const refused = calls.filter((c) => !c.ok).map((c) => `${c.at} ${c.subject}`);
    expect(refused).toEqual([]);
  });

  it.skipIf(CC33)(
    'is waiting for CC-33: without it the check events name no account (the property runs once lib/v2/ops/internal-marker.ts exists)',
    () => {
      expect(calls.some((c) => !c.ok)).toBe(true);
    },
  );
});

/**
 * Fixture programs, written to a temporary directory: a sender with CC-33's event shape, and probes
 * of the reading's rules. Each probe file but the last names one way to send without a readable
 * subject; `accepted.ts` holds the forms the reading accepts.
 */
const FIXTURE_SENDER = `
export interface ServerEvent {
  event: string;
  distinctId: string;
  accountId?: string | null;
  properties?: Record<string, unknown>;
}
export async function captureServerEvent(cookie: string | null, e: ServerEvent): Promise<void> {
  void cookie;
  void e;
}
`;

const PROBES: Record<string, string> = {
  // The review's alias probe: a binding typed by the function's shape, not by `typeof`.
  'structural-alias.ts': `
import { captureServerEvent, type ServerEvent } from './lib/analytics-server';
const send: (cookie: string | null, e: ServerEvent) => Promise<void> = captureServerEvent;
export const viewed = (slug: string) => send(null, { event: 'report_viewed', distinctId: \`report:\${slug}\` });
`,
  'call.ts': `
import { captureServerEvent } from './lib/analytics-server';
export const viewed = (slug: string) =>
  captureServerEvent.call(undefined, null, { event: 'report_viewed', distinctId: \`report:\${slug}\` });
`,
  'bind.ts': `
import { captureServerEvent } from './lib/analytics-server';
const anonymous = captureServerEvent.bind(undefined, null);
export const viewed = (slug: string) => anonymous({ event: 'report_viewed', distinctId: \`report:\${slug}\` });
`,
  'argument.ts': `
import { captureServerEvent, type ServerEvent } from './lib/analytics-server';
const run = (f: (c: string | null, e: ServerEvent) => Promise<void>, slug: string) =>
  f(null, { event: 'report_viewed', distinctId: \`report:\${slug}\` });
export const viewed = (slug: string) => run(captureServerEvent, slug);
`,
  'renamed-property.ts': `
import { captureServerEvent as cse } from './lib/analytics-server';
export const senders = { cse };
`,
  'namespace-bind.ts': `
import * as analytics from './lib/analytics-server';
export const anonymous = analytics.captureServerEvent.bind(undefined, null);
`,
  'typed-binding-escapes.ts': `
import { captureServerEvent } from './lib/analytics-server';
export function viewed(slug: string, capture: typeof captureServerEvent = captureServerEvent) {
  const later = capture.bind(undefined, null);
  return later({ event: 'report_viewed', distinctId: \`report:\${slug}\` });
}
`,
  're-export.ts': `
export { captureServerEvent as send } from './lib/analytics-server';
`,
  'accepted.ts': `
import { captureServerEvent } from './lib/analytics-server';
import * as analytics from './lib/analytics-server';
export const direct = (id: string) =>
  captureServerEvent(null, { event: 'x', distinctId: \`account:\${id}\` });
export const viaNamespace = (id: string) =>
  analytics.captureServerEvent(null, { event: 'x', distinctId: \`seat:\${id}\` });
export function typed(id: string, capture: typeof captureServerEvent = captureServerEvent) {
  return capture(null, { event: 'x', distinctId: \`account:\${id}\` });
}
export const kept = (ref: string, accountId: string | null) =>
  captureServerEvent(null, { event: 'x', distinctId: \`check:\${ref}\`, accountId });
export const named = (ref: string, id: string) =>
  captureServerEvent(null, { event: 'x', distinctId: \`check:\${ref}\`, accountId: id });
`,
};

describe('CC-38 D3: the reading refuses a send it cannot follow (fixture programs)', () => {
  let dir = '';
  let calls: Call[] = [];
  const at = (file: string) => calls.filter((c) => c.at.startsWith(`${file}:`));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc38-d3-'));
    const sender = join(dir, 'lib/analytics-server.ts');
    mkdirSync(join(dir, 'lib'));
    writeFileSync(sender, FIXTURE_SENDER);
    for (const [name, text] of Object.entries(PROBES)) writeFileSync(join(dir, name), text);
    const tree: Tree = { web: dir, repo: dir, sender, isSource: (f) => f.startsWith(`${dir}/`) };
    const program = ts.createProgram([sender, ...Object.keys(PROBES).map((n) => join(dir, n))], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    });
    // The probes are valid programs: a refusal is the reading's, not a type error's.
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
    calls = enumerate(program, tree);
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['structural-alias.ts', 3],
    ['call.ts', 4],
    ['bind.ts', 3],
    ['argument.ts', 5],
    ['renamed-property.ts', 3],
    ['namespace-bind.ts', 3],
    ['typed-binding-escapes.ts', 4],
    ['re-export.ts', 2],
  ])('%s: the escaping reference is refused at line %i', (file, line) => {
    const refused = at(file).filter((c) => !c.ok && c.subject.startsWith('escape:'));
    expect(refused.map((c) => c.at)).toEqual([`${file}:${line}`]);
  });

  it('accepted.ts: a direct call, a namespace call, a typed binding and an accountId pass', () => {
    expect(at('accepted.ts')).toEqual([
      { at: 'accepted.ts:5', ok: true, subject: '`account:…`' },
      { at: 'accepted.ts:7', ok: true, subject: '`seat:…`' },
      { at: 'accepted.ts:9', ok: true, subject: '`account:…`' },
      { at: 'accepted.ts:12', ok: true, subject: 'accountId' },
      { at: 'accepted.ts:14', ok: true, subject: 'accountId' },
    ]);
  });
});
