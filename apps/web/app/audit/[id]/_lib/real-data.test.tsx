/**
 * The audit pages on a measured check (CC-22b D3, D4, D6, D11): the engine's build of the recorded
 * site and of its re-check, persisted into PGlite with every migration and read back through
 * `loadCheckFor`, then rendered as the routes render them. Every preview state has its real-data
 * case here, and so do the states no preview shows.
 */
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult } from '@crawlmouse/types/v2';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { FAILURE_REASONS } from '../../../../../../inngest/check-events';
import { accountOf, doorDb, signUp } from '../../../../__tests__/v2/_lib/door-pglite';
import { loadCheckFor } from '../../../../lib/v2/pipeline/load-for';
import { checkRef, type CheckRead } from '../../../../lib/v2/pipeline/public';
import {
  FIRST,
  SECOND,
  keepSite,
  persistBuild,
  publicDeps,
  secondInput,
  type TestDeps,
} from '../../../../lib/v2/pipeline/test-support/public-checks';
import { fixesAsOf, fixture } from '../../../../lib/v2/fixtures';
import { FREE_FIXES } from '../../../../lib/v2/view/free-fixes';
import { NO_PACKET } from '../../../../lib/v2/view/no-packet';
import type { SectionFixesView } from '../../../../lib/v2/view/segment/fixes';
import { SEGMENT_KEYS, type SegmentKey } from '../../../../lib/v2/view/segment/frame';
import { datasetOfBuilds } from '../../../../lib/v2/view/test-support/built-dataset';
import {
  TESTED_UAS,
  inputOf,
  type SiteShape,
} from '../../../../lib/v2/view/test-support/generated-check';
import { LiveCrawl } from '../_crawl/LiveCrawl';
import { CheckPage, noticeOf, resultOf } from './CheckPage';
import { FAILURE_COPY } from './failure-copy';
import { auditHrefs } from './hrefs';
import type { ReadyCheck } from './page-data';

vi.mock('server-only', () => ({}));
// ReadyPage's request-bound reader is not called here: the tests pass the check they loaded.
const { FixBody, MapBody, SegmentBody, fixOf, mapOf, segmentScreen } = await import('./ReadyPage');

const NOW = Date.parse('2026-11-07T00:00:00Z');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Timestamps as instants: the database writes them in its own spelling. */
function instants(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) return Date.parse(v);
  if (Array.isArray(v)) return v.map(instants);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, instants(x)]));
  return v;
}
const html = (node: unknown) => renderToStaticMarkup(node as ReactElement);
/** Links that go nowhere: `href="#"` exactly (an anchor such as `#keep` is a place on the page). */
const dead = (markup: string) => markup.match(/href="#"/g) ?? [];
const primaries = (markup: string) => markup.match(/data-v2-primary=""/g) ?? [];

let db: PGlite;
let deps: TestDeps;
let first: BuiltCheck;
let second: BuiltCheck;
let one: ReadyCheck;
/** The first check as it read before the re-check was persisted (a fix row holds its latest state). */
let oneAlone: ReadyCheck;
let two: ReadyCheck;

async function ready(id: string, viewer = { userId: null as string | null }, from = deps) {
  const read = await loadCheckFor(from, id, viewer);
  if (read?.state !== 'ready') throw new Error(`expected ready, got ${read?.state}`);
  return read;
}

beforeAll(async () => {
  db = await doorDb();
  deps = publicDeps(db, () => NOW);
  first = await persistBuild(db, deps.evidence, recordedBuild());
  oneAlone = await ready(FIRST);
  second = await persistBuild(db, deps.evidence, secondInput(first), {
    siteSeeded: true,
    map: false,
  });
  one = await ready(FIRST);
  two = await ready(SECOND);
}, 180_000);

describe('what the property test builds in memory is what the database reads back', () => {
  it.each([
    ['the first check', () => [oneAlone, [first]] as const],
    ['the re-check', () => [two, [first, second]] as const],
  ])('%s', (_name, get) => {
    const [read, builds] = get();
    const built = datasetOfBuilds(recordedBuild().site, builds);
    // Compared apart: the metadata and the lineage rows differ by design, and changes by order.
    const rest = (d: object) =>
      Object.fromEntries(
        Object.entries(d).filter(
          ([k]) => !['as_of', 'description', 'lineages', 'changes'].includes(k),
        ),
      );
    expect(instants(rest(built))).toEqual(instants(rest(read.dataset)));
    const byId = (rows: readonly { id: string }[]) =>
      [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(instants(byId(built.changes))).toEqual(instants(byId(read.dataset.changes)));
  });
});

describe('/audit/[id]: the result of a measured check, read by a visitor', () => {
  it('shows the site, the Free fixes open with their pages, the rest locked, and links that lead somewhere', () => {
    const markup = html(<CheckPage read={one} />);
    const hrefs = auditHrefs(FIRST);
    const live = fixesAsOf(one.dataset, one.dataset.checks[0]!);
    expect(live.length).toBeGreaterThan(FREE_FIXES);
    expect(markup).toContain('built-site.test');
    for (const f of live.slice(0, FREE_FIXES))
      expect(markup).toContain(`href="${hrefs.fix(f.id)}"`);
    for (const f of live.slice(FREE_FIXES)) expect(markup).not.toContain(hrefs.fix(f.id));
    expect(markup).toContain(`${FREE_FIXES} open now`);
    expect(markup).toContain(`${live.length - FREE_FIXES} on Pro`);
    for (const key of SEGMENT_KEYS.filter((k) => k !== 'changes'))
      expect(markup).toContain(`href="${hrefs.segment(key)}"`);
    expect(markup).toContain(`href="${hrefs.map.hubs}"`);
    expect(dead(markup)).toEqual([]);
    expect(primaries(markup)).toHaveLength(1);
  });

  it('the first-fix card does not say steps are open: the fix it names has no packet', () => {
    const data = resultOf(one);
    const fix = fixesAsOf(one.dataset, one.dataset.checks[0]!)[0]!;
    expect(data.first).toMatchObject({ kind: 'fix', title: fix.title });
    expect(fix.packet).toBeNull();
    expect(data.first.body).toMatch(/ The evidence is open, free\.$/);
    expect(html(<CheckPage read={one} />)).not.toMatch(/The steps\b/);
  });

  it('renders no control that has no route in this step', () => {
    const markup = html(<CheckPage read={one} />);
    for (const label of ['Share', 'Re-run, free', 'Email this fix', 'What Pro includes'])
      expect(markup).not.toContain(`>${label}`);
    // The preview, which is given no page, still shows them.
    const preview = html(resultScreenAlone(one));
    for (const label of ['Share', 'Re-run, free', 'Email this fix', 'What Pro includes'])
      expect(preview).toContain(`>${label}`);
  });

  it('asks to keep the audit with the check it shows, and for no email to read it', () => {
    const data = resultOf(one);
    expect(data.keptUntil).not.toBeNull();
    const markup = html(<CheckPage read={one} />);
    expect(markup).toContain('aria-label="Keep this audit"');
    expect(markup).not.toMatch(/<input[^>]*type="email"/);
  });

  it('a partial check says what was not measured, from its own figures', () => {
    const check = two.dataset.checks.find((c) => c.id === SECOND)!;
    expect(check.status).toBe('partial');
    const unmeasured = check.crawlers.filter(
      (c) => c.group !== 'search_engine' && c.verdict === 'not_measured',
    );
    expect(unmeasured.length).toBeGreaterThan(0);
    const markup = html(<CheckPage read={two} />);
    expect(markup).toContain('This audit is partial: ');
    for (const c of unmeasured) expect(markup).toContain(c.ua);
    expect(markup).toContain('text without JavaScript was not measured');
    expect(html(<CheckPage read={one} />)).not.toContain('This audit is partial');
  });

  it('a withheld grade shows no letter', () => {
    const data = resultOf(one);
    const ai = one.dataset.checks[0]!.ai_readability!;
    expect(ai.withheld).toBe(true);
    expect(data.grades[1]).toMatchObject({ withheld: true, letter: null, score: null });
    expect(data.variant).toBe('withheld');
  });

  it("a re-check's changes door counts its own change rows by kind and opens the changes page", () => {
    const door = resultOf(two).doors.at(-1)!;
    const kinds = second.changes.map((c) => c.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(door.pill.label).toBe(`${kinds.length} ${kinds.length === 1 ? 'change' : 'changes'}`);
    expect(kinds).toContain('resolved');
    expect(door.body).toMatch(/resolved/);
    for (const word of ['opened', 'changed'] as const)
      expect(door.body.includes(` ${word}`)).toBe(kinds.includes(word));
    expect(door.href).toBe(auditHrefs(SECOND).segment('changes'));
    expect(door.keep).toBeUndefined();
  });

  it('with no stored drawing, the map door has no thumbnail and says so', () => {
    expect(two.map).toBeNull();
    const markup = html(<CheckPage read={two} />);
    expect(markup).toContain('No drawing was stored with this audit');
    expect(html(<CheckPage read={one} />)).not.toContain('No drawing was stored');
  });
});

/** The result screen with no audit page around it, as a preview renders one. */
function resultScreenAlone(read: ReadyCheck) {
  const page = CheckPage({ read }) as ReactElement<{ children: ReactElement[] }>;
  return page.props.children[1];
}

describe('/audit/[id]: the states around a result', () => {
  const base = { checkId: FIRST, host: 'built-site.test' };

  it('a queued, running or deferred check renders the live crawl with its id and host', () => {
    for (const status of ['queued', 'running', 'deferred'] as const) {
      const read: CheckRead = {
        ...base,
        state: 'waiting',
        status,
        queuedAt: '2026-11-06T10:00:00Z',
        startedAt: null,
        progress: null,
        kept: false,
      };
      const node = CheckPage({ read });
      expect(isValidElement(node) && node.type).toBe(LiveCrawl);
      expect((node as ReactElement).props).toEqual({ checkId: FIRST, host: 'built-site.test' });
    }
  });

  it.each(FAILURE_REASONS)('a check failed as %s says why in plain words', (reason) => {
    const read: CheckRead = {
      ...base,
      state: 'failed',
      failedAt: '2026-11-06T12:00:00Z',
      reason,
      kept: false,
    };
    const markup = html(<CheckPage read={read} />);
    expect(markup).toContain(`What happened: ${FAILURE_COPY[reason]}.`);
    expect(markup).toContain('6 Nov 2026');
    // The stored word is not shown: no reason word that is not also plain English appears.
    if (reason.includes('_')) expect(markup).not.toContain(reason);
    expect(markup).toContain('href="/"');
    expect(dead(markup)).toEqual([]);
    expect(primaries(markup)).toHaveLength(1);
  });

  it('each reason has its own sentence', () => {
    expect(Object.keys(FAILURE_COPY).sort()).toEqual([...FAILURE_REASONS].sort());
    expect(new Set(Object.values(FAILURE_COPY)).size).toBe(FAILURE_REASONS.length);
  });

  it('an expired check says until when it was visible, and when it was crawled if it was', () => {
    const expired = { ...base, state: 'expired' as const, expiredAt: '2026-11-07T10:00:00Z' };
    const crawled = noticeOf({ ...expired, finishedAt: '2026-11-06T10:11:00Z' });
    expect(crawled.lines[0]).toMatch(/^It was crawled on 6 Nov 2026.* visible until 7 Nov 2026/);
    const never = noticeOf({ ...expired, finishedAt: null });
    expect(never.lines[0]).toMatch(/^Nobody kept this audit, so it was visible until 7 Nov 2026/);
    expect(never.lines.join(' ')).not.toContain('crawled on');
    const markup = html(<CheckPage read={{ ...expired, finishedAt: null }} />);
    expect(markup).toContain('This result has expired');
    expect(dead(markup)).toEqual([]);
  });
});

describe('the six segment pages on a measured check', () => {
  it.each(SEGMENT_KEYS.flatMap((k) => [[k, 'first'] as const, [k, 're-check'] as const]))(
    '%s of the %s renders, with one heading and links that lead somewhere',
    (key, which) => {
      const read = which === 'first' ? one : two;
      const markup = html(<SegmentBody read={read} segment={key} />);
      expect(markup.match(/<h1/g)).toHaveLength(1);
      expect(dead(markup)).toEqual([]);
      expect(markup).toContain(`href="${auditHrefs(read.checkId).overview}"`);
      expect(markup).not.toContain('Re-run, free');
    },
  );

  it('the re-check, which rendered no page, says text without JavaScript was not measured', () => {
    expect(two.dataset.checks.find((c) => c.id === SECOND)!.without_js).toBeNull();
    const markup = html(<SegmentBody read={two} segment="nojs" />);
    expect(markup).toContain('Text without JavaScript was not measured in this audit.');
    expect(markup).not.toMatch(/\d+% site-wide/);
  });

  it("the re-check's changes page lists each of its change rows and names the check before it", () => {
    const markup = html(<SegmentBody read={two} segment="changes" />);
    expect(markup).toContain('Compared with the check of 5 Nov 2026');
    expect(markup.match(/UTC/g)!.length).toBeGreaterThan(0);
    expect(markup).toContain(`>${second.changes.length}<`);
  });

  it('the structure page draws the stored drawing, and none when none was stored', () => {
    expect(html(segmentScreen(one, 'structure'))).toContain('<svg');
    expect(one.map!.nodes.length).toBeGreaterThan(0);
    const without = html(segmentScreen(two, 'structure'));
    expect(without).not.toContain('The map below shows');
  });
});

describe('an open fix on a segment page whose steps the audit did not write (ruling 0.2)', () => {
  /** A packet the contract accepts: the bad-site fixture's first. */
  const PACKET = fixture('bad-site').fixes.find((f) => f.packet !== null)!.packet!;
  const HANDOFF = 'The packet contains the steps above';
  const COPY = 'Copy as a prompt for your coding tool';
  const paid = (): ReadyCheck => ({ ...one, plan: 'pro' });
  const withPackets = (read: ReadyCheck): ReadyCheck => ({
    ...read,
    dataset: {
      ...read.dataset,
      fixes: read.dataset.fixes.map((f) => ({ ...f, packet: PACKET })),
    },
  });
  /** The open fixes a segment's view holds. */
  const openOn = (read: ReadyCheck, key: SegmentKey) =>
    (segmentScreen(read, key) as ReactElement<{ data: { fixes?: SectionFixesView } }>).props.data
      .fixes?.open ?? [];
  /** The segments whose page has a fixes card. Changes has none; Signals lists no fix of its own. */
  const PAGES = SEGMENT_KEYS.filter((k) => k !== 'changes');
  /** Those where the measured check, read with every fix open (a paid plan), has an open fix. */
  const withOpen = (read: ReadyCheck) => PAGES.filter((k) => openOn(read, k).length > 0);

  it('the measured check has an open fix with no packet on more than one segment page', () => {
    expect(first.fixes.map((f) => f.packet)).toEqual(first.fixes.map(() => null));
    expect(withOpen(paid()).length).toBeGreaterThan(1);
    const shown = PAGES.flatMap((k) => openOn(paid(), k));
    expect(shown.length).toBeGreaterThan(FREE_FIXES);
    expect(shown.map((f) => f.packet)).toEqual(shown.map(() => null));
  });

  it.each(PAGES)(
    '%s: says the one line once for each open fix, under its title and effect, with no packet block, handoff or copy button',
    (key) => {
      const open = openOn(paid(), key);
      const markup = html(<SegmentBody read={paid()} segment={key} />);
      expect(markup.split(escaped(NO_PACKET))).toHaveLength(open.length + 1);
      for (const f of open) {
        expect(markup).toContain(escaped(f.title));
        expect(markup).toContain(escaped(f.unit));
        expect(f).toMatchObject({ paragraph: [], packet: null, handoff: null, prompt: null });
      }
      expect(markup).not.toContain(HANDOFF);
      expect(markup).not.toContain(COPY);
      expect(markup).not.toContain('Mark done and re-check now');
      expect(markup).not.toMatch(/<pre[^>]*>\s*<\/pre>/);
      // No copy button to hold the orange: the page's one orange element is its next step.
      expect(primaries(markup)).toHaveLength(1);
      expect(dead(markup)).toEqual([]);
    },
  );

  it.each(PAGES)('%s: the line is absent when the fix has a packet', (key) => {
    const read = withPackets(paid());
    const open = openOn(read, key);
    expect(withOpen(read)).toEqual(withOpen(paid()));
    const markup = html(<SegmentBody read={read} segment={key} />);
    expect(markup).not.toContain(escaped(NO_PACKET));
    expect(markup.split(HANDOFF)).toHaveLength(open.length + 1);
    expect(markup.split(COPY)).toHaveLength(open.length + 1);
    expect(primaries(markup)).toHaveLength(1);
  });

  it('the line is absent for a locked fix: a visitor sees it on the Free three only', () => {
    const live = fixesAsOf(one.dataset, one.dataset.checks[0]!);
    const free = new Set(live.slice(0, FREE_FIXES).map((f) => f.id));
    let lines = 0;
    let lockedOnly = 0;
    for (const key of PAGES) {
      const open = openOn(one, key);
      expect(open.every((f) => free.has(f.id))).toBe(true);
      const markup = html(<SegmentBody read={one} segment={key} />);
      const said = markup.split(escaped(NO_PACKET)).length - 1;
      expect(said, key).toBe(open.length);
      lines += said;
      if (open.length === 0 && markup.includes('See this fix with Pro')) lockedOnly += 1;
    }
    expect(lines).toBe(FREE_FIXES);
    // A page that lists locked fixes and no open one was met, and it did not say the line.
    expect(lockedOnly).toBeGreaterThan(0);
  });
});

describe('/audit/[id]/fix/[fixId]', () => {
  const live = () => fixesAsOf(one.dataset, one.dataset.checks[0]!);
  /** A packet the contract accepts: the bad-site fixture's first. */
  const PACKET = fixture('bad-site').fixes.find((f) => f.packet !== null)!.packet!;
  /** The check with that packet on each of its fixes. */
  const withPackets = (): ReadyCheck => ({
    ...one,
    dataset: {
      ...one.dataset,
      fixes: one.dataset.fixes.map((f) => ({ ...f, packet: PACKET })),
    },
  });

  it('the engine writes no packet yet, so an open fix of a measured check shows none', () => {
    expect(first.fixes.map((f) => f.packet)).toEqual(first.fixes.map(() => null));
    const found = fixOf(one, live()[0]!.id)!;
    expect(found.view).toMatchObject({ kind: 'open', packet: null });
    const markup = html(<FixBody read={one} found={found} />);
    expect(dead(markup)).toEqual([]);
    // The page says so, in one line, and shows what the audit does hold of the fix.
    expect(markup.split(NO_PACKET)).toHaveLength(2);
    expect(markup).toContain(escaped(live()[0]!.title));
  });

  it('the no-steps line is absent when the fix has a packet, and on a locked fix', () => {
    const read = withPackets();
    const open = fixOf(read, live()[0]!.id)!;
    expect(open.view).toMatchObject({ kind: 'open' });
    expect(html(<FixBody read={read} found={open} />)).not.toContain(NO_PACKET);
    // Locked, with no packet stored: the wall stands where the line would be.
    const locked = fixOf(one, live()[FREE_FIXES]!.id)!;
    expect(locked.view.kind).toBe('locked');
    expect(html(<FixBody read={one} found={locked} />)).not.toContain(NO_PACKET);
    // Opened by a paid plan, still with no packet: the line is there.
    const paid = fixOf({ ...one, plan: 'pro' }, live()[FREE_FIXES]!.id)!;
    expect(html(<FixBody read={{ ...one, plan: 'pro' }} found={paid} />)).toContain(NO_PACKET);
  });

  it('a Free fix opens in full, with its packet', () => {
    const read = withPackets();
    const fix = read.dataset.fixes.find((f) => f.id === live()[0]!.id)!;
    const found = fixOf(read, fix.id)!;
    expect(found.view.kind).toBe('open');
    expect(found.free).toBe(true);
    expect(found.type).toBe(fix.type);
    const markup = html(<FixBody read={read} found={found} />);
    expect(fix.packet).not.toBeNull();
    expect(markup).toContain(escaped(fix.packet!.change[0]!));
    expect(dead(markup)).toEqual([]);
  });

  it("a locked fix's packet is in neither the view nor the page, opened directly by a visitor", () => {
    const read = withPackets();
    const fix = read.dataset.fixes.find((f) => f.id === live()[FREE_FIXES]!.id)!;
    expect(fix.packet).not.toBeNull();
    const found = fixOf(read, fix.id)!;
    expect(found.view.kind).toBe('locked');
    expect(found.free).toBe(false);
    const payload = JSON.stringify(found.view);
    const markup = html(<FixBody read={read} found={found} />);
    const secret = [...fix.packet!.change, ...fix.packet!.keep, fix.packet!.verify.command];
    expect(secret.length).toBeGreaterThan(1);
    for (const line of secret.filter((l) => l.trim().length > 12)) {
      expect(payload).not.toContain(JSON.stringify(line).slice(1, -1));
      expect(markup).not.toContain(escaped(line));
    }
    expect(markup).toContain('The packet');
  });

  it('on a paid plan the same fix opens', () => {
    const fix = live()[FREE_FIXES]!;
    expect(fixOf({ ...one, plan: 'pro' }, fix.id)!.view.kind).toBe('open');
    const result = resultOf({ ...one, plan: 'pro' });
    expect(result.fixes).toMatchObject({ open: live().length, pro: 0 });
  });

  it('a fix the earlier check resolved is shown as resolved at the re-check', () => {
    const orphan = first.fixes.find((f) => f.type === 'orphan_pages')!;
    expect(fixOf(two, orphan.id)!.view.kind).toBe('resolved');
    expect(fixOf(one, orphan.id)!.view.kind).not.toBe('resolved');
  });

  it('an id that names no fix of this check is not found', () => {
    expect(fixOf(one, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(fixOf(one, 'not-a-uuid')).toBeNull();
  });
});

describe('/audit/[id]/map', () => {
  it('the hubs scope draws the stored drawing as stored', () => {
    // Moved by a known amount, so a drawing laid out again here would not match it.
    const [node] = one.map!.nodes;
    const at = one.map!.positions[node!.id]!;
    const moved = {
      ...one.map!,
      positions: { ...one.map!.positions, [node!.id]: { x: at.x + 7, y: at.y + 3 } },
    };
    const view = mapOf({ ...one, map: moved }, 'hubs');
    expect(view.nodes).toHaveLength(one.map!.nodes.length);
    const drawn = view.nodes.find((n) => n.path === new URL(node!.id).pathname)!;
    const round = (n: number) => Math.round(n * 10) / 10;
    expect([drawn.x, drawn.y]).toEqual([round(at.x + 7), round(at.y + 3)]);
    expect(view.explore?.href).toBe(auditHrefs(FIRST).map.all);
  });

  it('with no stored drawing the hubs are laid out from the record', () => {
    expect(mapOf(two, 'hubs').nodes.length).toBeGreaterThan(0);
  });

  it('the all scope lays out the record: each drawn page is one of the check, at most once', () => {
    const view = mapOf(one, 'all');
    const paths = new Set(
      one.dataset.page_results.map((p) => new URL(p.url).pathname + new URL(p.url).search),
    );
    expect(view.nodes.length).toBeGreaterThan(mapOf(one, 'hubs').nodes.length);
    expect(view.nodes.every((n) => paths.has(n.path))).toBe(true);
    expect(new Set(view.nodes.map((n) => n.path)).size).toBe(view.nodes.length);
    expect(view.caption).toContain(`of ${one.dataset.page_results.length}`);
    const markup = html(<MapBody read={one} scope="all" />);
    expect(dead(markup)).toEqual([]);
  });

  it('a check with no page to draw shows a notice, with the way back', () => {
    const empty: ReadyCheck = {
      ...one,
      dataset: { ...one.dataset, page_results: [], link_edges: [], access_tests: [] },
      map: null,
    };
    const markup = html(<MapBody read={empty} scope="hubs" />);
    expect(markup).toContain('This audit has no page to draw');
    expect(markup).toContain(`href="${auditHrefs(FIRST).overview}"`);
  });
});

describe('nothing internal goes on the wire for a kept check (D3)', () => {
  it('no account id, seat id, email, site id or evidence path in a view model or a page', async () => {
    const kept = (await db.clone()) as PGlite;
    const keptDeps = { ...publicDeps(kept, () => NOW), evidence: deps.evidence };
    const owner = await signUp(kept, 'owner@agency.example');
    const account = await accountOf(kept, owner);
    await keepSite(kept, first.check.site_id, account.id);
    await kept.query(
      `update public.sites set client_contact_email = 'client@customer.example',
              client_contact_name = 'Casey Client' where id = $1`,
      [first.check.site_id],
    );
    const { rows: seats } = await kept.query<{ id: string }>(
      `select id from public.seats where user_id = $1`,
      [owner],
    );
    const read = await ready(FIRST, { userId: owner }, keptDeps);
    expect(read.kept).toBe(true);
    const fix = fixesAsOf(read.dataset, read.dataset.checks[0]!)[0]!;
    const views = [
      resultOf(read),
      ...SEGMENT_KEYS.map((k) => (segmentScreen(read, k) as ReactElement).props),
      fixOf(read, fix.id)!.view,
      mapOf(read, 'hubs'),
      mapOf(read, 'all'),
    ];
    const pages = [
      html(<CheckPage read={read} />),
      ...SEGMENT_KEYS.map((k) => html(segmentScreen(read, k))),
      html(<>{fixScreen(fixOf(read, fix.id)!.view)}</>),
    ];
    const internal = [
      account.id,
      ...seats.map((s) => s.id),
      owner,
      'owner@agency.example',
      'client@customer.example',
      'Casey Client',
      first.check.site_id,
      'map.json.gz',
      'anon/',
    ];
    expect(seats.length).toBeGreaterThan(0);
    for (const text of [...views.map((v) => JSON.stringify(v)), ...pages])
      for (const secret of internal) expect(text.includes(secret), secret).toBe(false);
    // Anti-vacuity: the dataset the views were built from does hold them.
    const source = JSON.stringify(read.dataset);
    expect(source).toContain(account.id);
    expect(source).toContain('client@customer.example');
    await kept.close();
  });

  it('events name the check by a reference that is not its id', () => {
    const page = CheckPage({ read: one }) as ReactElement<{ page: { checkRef: string } }>;
    expect(page.props.page.checkRef).toBe(checkRef(FIRST));
    expect(page.props.page.checkRef).not.toContain(FIRST);
    const event = (
      page as unknown as ReactElement<{
        children: ReactElement<{ props: object; event: string }>[];
      }>
    ).props.children[0]!;
    expect(event.props).toMatchObject({
      event: 'result_viewed',
      props: { variant: 'withheld', check_ref: checkRef(FIRST) },
    });
    expect(JSON.stringify(event.props)).not.toContain(FIRST);
  });
});

import { FixScreen } from '../../../../components/v2/screens/fix/FixScreen';
import type { FixView } from '../../../../lib/v2/view/fix';

const fixScreen = (view: FixView) => <FixScreen data={view} />;
/** A string as React writes it into markup. */
const escaped = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

describe('a challenged crawler is said as the rows hold it (D11)', () => {
  const site = (control: 'allowed' | 'challenged_ua') => {
    const shape: SiteShape = {
      home: 'ok',
      pages: [0, 1, 2].map((family) => ({ family, answer: 'ok', features: 'server' })),
      links: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
      capped: false,
      access: TESTED_UAS.map((_, i) => (i === 0 ? 'challenged_ua' : 'allowed')),
    };
    const input = inputOf(shape);
    // The generated control fetch is served; the second case challenges it as well.
    const batches = (input.batches as BatchResult[]).map((b) =>
      b.kind !== 'access' || control === 'allowed'
        ? b
        : {
            ...b,
            access_tests: b.access_tests.map((t) =>
              t.identity_role === 'control'
                ? {
                    ...t,
                    verdict: 'challenged_ua' as const,
                    cause: 'automation_challenge' as const,
                    raw_status: 403,
                  }
                : t,
            ),
          },
    );
    const built = buildCheck({ ...input, batches });
    const read: ReadyCheck = {
      state: 'ready',
      checkId: built.check.id,
      host: input.site.host,
      kept: false,
      plan: 'free',
      dataset: datasetOfBuilds(input.site, [built]),
      map: null,
    };
    return { read, built, markup: html(<SegmentBody read={read} segment="access" />) };
  };

  it('with the control fetch served, the page says so and does not say all automation is challenged', () => {
    const { markup, built } = site('allowed');
    const challenged = built.check.crawlers.find((c) => c.verdict === 'challenged_ua')!;
    expect(challenged).toMatchObject({ ua: TESTED_UAS[0], cause: 'automation_challenge' });
    expect(markup).toContain('edge challenge of this crawler');
    expect(markup).toContain(
      'the same page asked for with a browser identity, untagged, was served (status 200)',
    );
    expect(markup).not.toContain('on all automation');
    expect(markup).not.toContain('with or without a crawler user agent');
    expect(markup).toContain(challenged.ua);
  });

  it('with the control fetch challenged too, the page says both were', () => {
    const { markup } = site('challenged_ua');
    expect(markup).toContain(
      'and the same page asked for with a browser identity, untagged (status 403)',
    );
    expect(markup).not.toContain('was served');
  });
});
