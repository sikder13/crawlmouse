/**
 * The audit pages on a measured check (CC-22b D3, D4, D6, D11): the engine's build of the recorded
 * site and of its re-check, persisted into PGlite with every migration and read back through
 * `loadCheckFor`, then rendered as the routes render them. Every preview state has its real-data
 * case here, and so do the states no preview shows.
 */
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
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
import { AI_WAITING } from '../../../../lib/v2/view/effect-headline';
import { FREE_FIXES } from '../../../../lib/v2/view/free-fixes';
import { FOUND_ABOVE, noPacketLine } from '../../../../lib/v2/view/no-packet';
import { noPacketReason } from '../../../../lib/v2/view/packet-reason';
import type { SectionFixesView } from '../../../../lib/v2/view/segment/fixes';
import { everyPacketString, withBodies } from '../../../../lib/v2/view/test-support/multi-body';
import { SEGMENT_KEYS, type SegmentKey } from '../../../../lib/v2/view/segment/frame';
import { datasetOfBuilds } from '../../../../lib/v2/view/test-support/built-dataset';
import {
  TESTED_UAS,
  inputOf,
  type SiteShape,
} from '../../../../lib/v2/view/test-support/generated-check';
import {
  AuditEvent,
  AuditPageProvider,
  type AuditPage,
} from '../../../../components/v2/screens/result/AuditPage';
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

  it('the first-fix card says the steps are open exactly when the fix it names has a packet', () => {
    const fix = fixesAsOf(one.dataset, one.dataset.checks[0]!)[0]!;
    const STEPS = /The steps and the evidence are open, free\./;
    // As built, and with the packet of each fix forced to each shape.
    const packet = fixture('bad-site').fixes.find((f) => f.packet !== null)!.packet!;
    const shaped = (to: typeof packet | null): ReadyCheck => ({
      ...one,
      dataset: { ...one.dataset, fixes: one.dataset.fixes.map((f) => ({ ...f, packet: to })) },
    });
    for (const [read, has] of [
      [one, fix.packet !== null],
      [shaped(null), false],
      [shaped(packet), true],
    ] as const) {
      const data = resultOf(read);
      expect(data.first).toMatchObject({ kind: 'fix', title: fix.title });
      expect(STEPS.test(data.first.body)).toBe(has);
      expect(STEPS.test(html(<CheckPage read={read} />).replace(/&#x27;/g, "'"))).toBe(has);
    }
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

  it('says a share link is kept only where the page has one', () => {
    const until = resultOf(one).keptUntil!;
    const markup = html(<CheckPage read={one} />);
    expect(markup).toContain(`this result is kept until ${until}`);
    expect(markup).not.toContain('share link');
    // The preview, which shows Share, says both are kept.
    expect(html(resultScreenAlone(one))).toContain(
      `this result and its share link are kept until ${until}`,
    );
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
    expect(markup).toContain('This audit did not finish');
    expect(markup).not.toContain('before it could grade');
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
    expect(crawled.title).toBe('This result has expired');
    expect(crawled.lines[0]).toMatch(/^It was crawled on 6 Nov 2026.* visible until 7 Nov 2026/);
    // No finish time: the check ended ungraded or never ran, so the page names no crawl and no result.
    const never = noticeOf({ ...expired, finishedAt: null });
    expect(never.title).toBe('This audit has expired');
    expect(never.lines[0]).toMatch(/^Nobody kept this audit, so it was visible until 7 Nov 2026/);
    expect([never.title, ...never.lines].join(' ')).not.toMatch(/crawled on|result/);
    const markup = html(<CheckPage read={{ ...expired, finishedAt: null }} />);
    expect(markup).toContain('This audit has expired');
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

  it('the re-check, whose record has no page measured without JavaScript, says so from its rows', () => {
    const check = two.dataset.checks.find((c) => c.id === SECOND)!;
    expect(check.without_js).toBeNull();
    const rows = two.dataset.page_results.filter((p) => p.check_id === SECOND);
    expect(rows.filter((p) => p.without_js)).toEqual([]);
    const markup = html(<SegmentBody read={two} segment="nojs" />);
    expect(markup).toContain('Text without JavaScript was not measured in this audit.');
    expect(markup).toContain(
      'No page in this audit’s record has its text measured without JavaScript, so there is no share to show.',
    );
    expect(markup).toContain(`>0 of ${check.coverage!.pages_discovered}<`);
    expect(markup).not.toMatch(/\d+% site-wide/);
    // What the data does not hold is not said: whether a browser rendered a page, and that no
    // other section uses the measurement.
    expect(markup).not.toMatch(/rendered in a browser|do not depend/);
    // AI readability waits on this measurement on this check, and the page says so from the grade.
    expect(check.ai_readability!.withheld_reasons).toContain('readable_unmeasured');
    expect(markup).toContain(`${AI_WAITING.readable_unmeasured}.`);
    const door = resultOf(two).doors.find((x) => x.title === 'Readable without JavaScript')!;
    expect(door.pill.label).toBe('not measured');
    expect(JSON.stringify(door)).not.toMatch(/rendered/);
  });

  it('pages that were measured, with no site-wide share recorded, are counted and not denied', () => {
    const rows = two.dataset.page_results.filter((p) => p.check_id === SECOND);
    const measured = {
      raw_words: 40,
      rendered_words: 400,
      text_share: 0.1,
      state: 'empty_shell' as const,
    };
    const [a, b] = rows;
    const withRows = (urls: string[], reasons: 'readable_unmeasured'[]): ReadyCheck => ({
      ...two,
      dataset: {
        ...two.dataset,
        page_results: two.dataset.page_results.map((p) =>
          p.check_id === SECOND && urls.includes(p.url) ? { ...p, without_js: measured } : p,
        ),
        checks: two.dataset.checks.map((c) =>
          c.id === SECOND
            ? {
                ...c,
                ai_readability: {
                  ...c.ai_readability!,
                  withheld_reasons: reasons,
                },
              }
            : c,
        ),
      },
    });
    const oneRow = html(<SegmentBody read={withRows([a!.url], [])} segment="nojs" />);
    expect(oneRow).toContain(
      'One page in this audit’s record has its text measured without JavaScript, but the audit recorded no site-wide share, so there is none to show.',
    );
    expect(oneRow).toContain('>1 of ');
    expect(oneRow).not.toContain('No page');
    // With that reason gone from the grade, the sentence about AI readability goes too.
    expect(oneRow).not.toContain(AI_WAITING.readable_unmeasured);
    const twoRows = html(
      <SegmentBody read={withRows([a!.url, b!.url], ['readable_unmeasured'])} segment="nojs" />,
    );
    expect(twoRows).toContain('Two pages in this audit’s record have their text measured');
    expect(twoRows).toContain(`${AI_WAITING.readable_unmeasured}.`);
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
  /** `read` with each fix's packet set by `to`: the two shapes a stored fix has, whatever the engine wrote. */
  const shaped = (read: ReadyCheck, to: (f: { number: number }) => typeof PACKET | null) => ({
    ...read,
    dataset: {
      ...read.dataset,
      fixes: read.dataset.fixes.map((f) => ({ ...f, packet: to(f) })),
    },
  });
  const withPackets = (read: ReadyCheck): ReadyCheck => shaped(read, () => PACKET);
  const withoutPackets = (read: ReadyCheck): ReadyCheck => shaped(read, () => null);
  /** Every other fix with a packet, the rest without. */
  const mixed = (read: ReadyCheck): ReadyCheck =>
    shaped(read, (f) => (f.number % 2 === 0 ? PACKET : null));
  /** The open fixes a segment's view holds. */
  const openOn = (read: ReadyCheck, key: SegmentKey) =>
    (segmentScreen(read, key) as ReactElement<{ data: { fixes?: SectionFixesView } }>).props.data
      .fixes?.open ?? [];
  /** The stored fix an open fix's view was built from. */
  const stored = (read: ReadyCheck, id: string) => read.dataset.fixes.find((f) => f.id === id)!;
  /** How many times the not-written sentence is said (each ends the same way). */
  const said = (markup: string) => markup.split(escaped(FOUND_ABOVE)).length - 1;
  /** The segments whose page has a fixes card. Changes has none; Signals lists no fix of its own. */
  const PAGES = SEGMENT_KEYS.filter((k) => k !== 'changes');
  /** Those where the measured check, read with every fix open (a paid plan), has an open fix. */
  const withOpen = (read: ReadyCheck) => PAGES.filter((k) => openOn(read, k).length > 0);

  it('the measured check has open fixes on more than one segment page, each with a packet block exactly when the engine wrote its packet', () => {
    expect(withOpen(paid()).length).toBeGreaterThan(1);
    const shown = PAGES.flatMap((k) => openOn(paid(), k));
    expect(shown.length).toBeGreaterThan(FREE_FIXES);
    for (const f of shown) {
      const fix = stored(one, f.id);
      expect(f.packet === null, f.title).toBe(fix.packet === null);
      expect(f.notWritten, f.title).toBe(
        fix.packet === null ? noPacketLine(noPacketReason(fix.type)) : null,
      );
    }
  });

  describe.each([
    ['as the engine built it', (r: ReadyCheck) => r],
    ['every fix without a packet', withoutPackets],
    ['every other fix with a packet', mixed],
    ['every fix with a packet', withPackets],
  ])('the not-written sentence, %s', (_shape, shape) => {
    it.each(PAGES)(
      '%s: said once for each open fix with no packet, and a fix with a packet shows its block, handoff and copy button',
      (key) => {
        const read = shape(paid());
        const open = openOn(read, key);
        expect(withOpen(read)).toEqual(withOpen(paid()));
        const bare = open.filter((f) => stored(read, f.id).packet === null);
        const written = open.filter((f) => stored(read, f.id).packet !== null);
        const markup = html(<SegmentBody read={read} segment={key} />);
        expect(said(markup)).toBe(bare.length);
        for (const f of open) {
          expect(markup).toContain(escaped(f.title));
          expect(markup).toContain(escaped(f.unit));
        }
        for (const f of bare) {
          expect(f).toMatchObject({ paragraph: [], packet: null, handoff: null, prompt: null });
          expect(f.notWritten).toBe(noPacketLine(noPacketReason(stored(read, f.id).type)));
          expect(markup).toContain(escaped(f.notWritten!));
        }
        for (const f of written) {
          expect(f.notWritten).toBeNull();
          expect(markup).toContain(escaped(f.packet!));
        }
        expect(markup.split(HANDOFF)).toHaveLength(written.length + 1);
        expect(markup.split(COPY)).toHaveLength(written.length + 1);
        expect(markup).not.toMatch(/<pre[^>]*>\s*<\/pre>/);
        // One orange element: the first copy button, or the page's next step where there is none.
        expect(primaries(markup)).toHaveLength(1);
        expect(dead(markup)).toEqual([]);
      },
    );
  });

  it('the shapes above were both met: a page with a fix that has a packet beside one that has none', () => {
    const both = PAGES.filter((key) => {
      const open = openOn(mixed(paid()), key);
      const packets = new Set(open.map((f) => f.packet === null));
      return packets.size === 2;
    });
    expect(both.length).toBeGreaterThan(0);
  });

  it('the sentence is absent for a locked fix: a visitor sees it on the Free fixes that have no packet only', () => {
    for (const read of [one, withoutPackets(one)]) {
      const live = fixesAsOf(read.dataset, read.dataset.checks[0]!);
      const free = live.slice(0, FREE_FIXES);
      let lines = 0;
      let lockedOnly = 0;
      for (const key of PAGES) {
        const open = openOn(read, key);
        expect(open.every((f) => free.some((x) => x.id === f.id))).toBe(true);
        const markup = html(<SegmentBody read={read} segment={key} />);
        expect(said(markup), key).toBe(open.filter((f) => f.packet === null).length);
        lines += said(markup);
        if (open.length === 0 && markup.includes('See this fix with Pro')) lockedOnly += 1;
      }
      expect(lines).toBe(free.filter((f) => f.packet === null).length);
      // A page that lists locked fixes and no open one was met, and it did not say the sentence.
      expect(lockedOnly).toBeGreaterThan(0);
    }
    // With no packet stored, each of the Free fixes says it.
    const bare = withoutPackets(one);
    expect(
      PAGES.reduce((n, key) => n + said(html(<SegmentBody read={bare} segment={key} />)), 0),
    ).toBe(FREE_FIXES);
  });
});

describe('/audit/[id]/fix/[fixId]', () => {
  const live = () => fixesAsOf(one.dataset, one.dataset.checks[0]!);
  /** A packet the contract accepts: the bad-site fixture's first. */
  const PACKET = fixture('bad-site').fixes.find((f) => f.packet !== null)!.packet!;
  /** The check with `packet` on each of its fixes. */
  const withPacket = (packet: typeof PACKET | null): ReadyCheck => ({
    ...one,
    dataset: { ...one.dataset, fixes: one.dataset.fixes.map((f) => ({ ...f, packet })) },
  });
  const withPackets = () => withPacket(PACKET);
  const said = (markup: string) => markup.split(escaped(FOUND_ABOVE)).length - 1;

  it('an open fix of the measured check shows its packet, or one sentence saying why it has none', () => {
    for (const read of [one, withPacket(null), withPackets()]) {
      const fix = read.dataset.fixes.find((f) => f.id === live()[0]!.id)!;
      const found = fixOf(read, fix.id)!;
      const markup = html(<FixBody read={read} found={found} />);
      expect(dead(markup)).toEqual([]);
      expect(markup).toContain(escaped(fix.title));
      if (fix.packet === null) {
        const why = noPacketLine(noPacketReason(fix.type));
        expect(found.view).toMatchObject({ kind: 'open', packet: null, notWritten: why });
        // The page says so once, and shows what the audit does hold of the fix.
        expect(markup.split(escaped(why))).toHaveLength(2);
        expect(said(markup)).toBe(1);
        expect(markup).not.toContain('<pre');
      } else {
        expect(found.view).toMatchObject({ kind: 'open', notWritten: null });
        expect(said(markup)).toBe(0);
        expect(markup).toContain(escaped(fix.packet.change[0]!));
        expect(markup).toContain(escaped(fix.packet.verify.command));
      }
    }
  });

  it('the sentence gives the engine’s reason for a fix type it writes no packet for, and names the last check otherwise', () => {
    const read = withPacket(null);
    const reasons = new Set(
      live().map((f) => {
        const found = fixOf({ ...read, plan: 'pro' }, f.id)!;
        if (found.view.kind !== 'open') throw new Error(found.view.kind);
        const reason = noPacketReason(f.type);
        expect(found.view.notWritten).toBe(noPacketLine(reason));
        if (reason !== null) expect(found.view.notWritten).toContain(reason);
        return reason;
      }),
    );
    expect(reasons.size).toBeGreaterThan(0);
  });

  it('a page with no way to mark a fix done leaves out the card that describes it', () => {
    const SHIPPED = 'When you&#x27;ve shipped it';
    for (const read of [one, withPackets()]) {
      const found = fixOf(read, live()[0]!.id)!;
      expect(found.view).toMatchObject({ kind: 'open', shipped: null });
      const markup = html(<FixBody read={read} found={found} />);
      expect(markup).not.toContain(SHIPPED);
      expect(markup).not.toContain('Mark done and re-check now');
      expect(markup).not.toContain('replaces this audit');
    }
    // The preview, which passes no page options, shows the card for the same fix.
    const preview = fixView(one.dataset, FIRST, live()[0]!.id);
    expect(preview).toMatchObject({ kind: 'open', shipped: { heading: "When you've shipped it" } });
    expect(html(fixScreen(preview))).toContain(SHIPPED);
  });

  it('the no-steps line is absent when the fix has a packet, and on a locked fix', () => {
    const read = withPackets();
    const open = fixOf(read, live()[0]!.id)!;
    expect(open.view).toMatchObject({ kind: 'open' });
    expect(said(html(<FixBody read={read} found={open} />))).toBe(0);
    // Locked, with no packet stored: the wall stands where the line would be.
    const bare = withPacket(null);
    const locked = fixOf(bare, live()[FREE_FIXES]!.id)!;
    expect(locked.view.kind).toBe('locked');
    expect(said(html(<FixBody read={bare} found={locked} />))).toBe(0);
    // Opened by a paid plan, still with no packet: the line is there.
    const paid = fixOf({ ...bare, plan: 'pro' }, live()[FREE_FIXES]!.id)!;
    expect(said(html(<FixBody read={{ ...bare, plan: 'pro' }} found={paid} />))).toBe(1);
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

  it("no body of a locked fix's packet is in the view or the page, and each is in the view once a plan opens it", () => {
    const several = withBodies(PACKET, ['wordpress', 'nextjs']);
    const read = withPacket(several);
    const fix = read.dataset.fixes.find((f) => f.id === live()[FREE_FIXES]!.id)!;
    const secret = everyPacketString(fix.packet!);
    // The packet's own body and two more, each with its context, change, keep, command and expectation.
    expect(secret.length).toBe(everyPacketString(PACKET).length + 2 * 6);
    const found = fixOf(read, fix.id)!;
    expect(found.view.kind).toBe('locked');
    const payload = JSON.stringify(found.view);
    const markup = html(<FixBody read={read} found={found} />);
    for (const line of secret) {
      expect(payload, line).not.toContain(JSON.stringify(line).slice(1, -1));
      expect(markup, line).not.toContain(escaped(line));
    }
    // The control: on a paid plan the view holds each body, and the page opens on the packet's own.
    const paid = { ...read, plan: 'pro' as const };
    const open = fixOf(paid, fix.id)!;
    expect(open.view.kind).toBe('open');
    const opened = JSON.stringify(open.view);
    for (const line of secret) expect(opened, line).toContain(JSON.stringify(line).slice(1, -1));
    const page = html(<FixBody read={paid} found={open} />);
    for (const line of several.change) expect(page).toContain(escaped(line));
    expect(page).toContain('>WordPress<');
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

  type Provider = ReactElement<{ page: AuditPage; children: unknown }>;
  const pageOf = (node: unknown) => {
    const el = node as Provider;
    expect(el.type).toBe(AuditPageProvider);
    return el.props.page;
  };

  it('each page tells its screens which page it is, which is what keep_clicked reports as `from`', () => {
    const fix = fixesAsOf(one.dataset, one.dataset.checks[0]!)[0]!;
    const from = {
      result: pageOf(CheckPage({ read: one })),
      segment: pageOf(SegmentBody({ read: one, segment: 'access' })),
      fix: pageOf(FixBody({ read: one, found: fixOf(one, fix.id)! })),
      map: pageOf(MapBody({ read: one, scope: 'hubs' })),
    };
    for (const [name, page] of Object.entries(from)) {
      expect(page, name).toEqual({
        checkId: FIRST,
        checkRef: checkRef(FIRST),
        from: name,
        links: {},
      });
    }
  });

  it('a fix page sends fix_opened with the fix’s type and whether it is one of the Free three', () => {
    const live = fixesAsOf(one.dataset, one.dataset.checks[0]!);
    const sent = (fixId: string) => {
      const body = FixBody({ read: one, found: fixOf(one, fixId)! }) as Provider;
      const [event] = body.props.children as ReactElement<{ event: string; props: object }>[];
      expect(event!.type).toBe(AuditEvent);
      return event!.props;
    };
    const free = live[0]!;
    const locked = live[FREE_FIXES]!;
    expect(sent(free.id)).toEqual({
      event: 'fix_opened',
      props: { type: free.type, free: true, check_ref: checkRef(FIRST) },
    });
    expect(sent(locked.id)).toEqual({
      event: 'fix_opened',
      props: { type: locked.type, free: false, check_ref: checkRef(FIRST) },
    });
    // The two differ in what they send, so swapping `type` and `free` or dropping one is seen.
    expect(typeof free.type).toBe('string');
    expect(JSON.stringify([sent(free.id), sent(locked.id)])).not.toContain(FIRST);
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
import { fixView, type FixView } from '../../../../lib/v2/view/fix';

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
  const SERVED = 'the same page asked for with a browser identity';
  /** One crawler challenged; `control` is what becomes of the control fetch's rows after the build. */
  const site = (control: 'served' | 'no response' | 'no row') => {
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
    const built = buildCheck(input);
    const dataset = datasetOfBuilds(input.site, [built]);
    const isControl = (t: { identity_role: string }) => t.identity_role === 'control';
    expect(dataset.access_tests.filter(isControl).length).toBeGreaterThan(0);
    const read: ReadyCheck = {
      state: 'ready',
      checkId: built.check.id,
      host: input.site.host,
      kept: false,
      plan: 'free',
      dataset: {
        ...dataset,
        access_tests:
          control === 'served'
            ? dataset.access_tests
            : control === 'no row'
              ? dataset.access_tests.filter((t) => !isControl(t))
              : dataset.access_tests.map((t) =>
                  isControl(t)
                    ? { ...t, verdict: 'not_measured' as const, cause: null, raw_status: null }
                    : t,
                ),
      },
      map: null,
    };
    return { read, built, markup: html(<SegmentBody read={read} segment="access" />) };
  };

  it('with the control fetch served, the page says so and does not say all automation is challenged', () => {
    const { markup, built } = site('served');
    const challenged = built.check.crawlers.find((c) => c.verdict === 'challenged_ua')!;
    expect(challenged).toMatchObject({ ua: TESTED_UAS[0], cause: 'automation_challenge' });
    expect(markup).toContain('edge challenge of this crawler');
    expect(markup).toContain(`${SERVED}, untagged, was served (status 200)`);
    expect(markup).not.toContain('on all automation');
    expect(markup).not.toContain('with or without a crawler user agent');
    expect(markup).toContain(challenged.ua);
  });

  // The worker pairs a challenged crawler with a served control (packages/worker verdict table:
  // any other control makes the verdict edge_blocks_automation or not_measured). The view does not
  // rest on that: of a control row that was not served, or of none, it says nothing.
  it.each(['no response', 'no row'] as const)(
    'with %s for the control fetch, the page says only that the crawler was challenged',
    (control) => {
      const { markup } = site(control);
      expect(markup).toContain('the edge challenged the request made as this crawler');
      expect(markup).not.toContain(SERVED);
      expect(markup).not.toContain('was served');
    },
  );
});
