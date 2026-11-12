import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { VERDICTS } from '../../../components/v2/verdicts';
import { footerLine, REPORT_DOC_COPY } from '../copy/report-doc';
import { fixture, type ViewDataset } from '../fixtures';
import { secondInput } from '../pipeline/test-support/public-checks';
import { fixView } from '../view/fix';
import { partialNotice, resultView } from '../view/result';
import { accessView } from '../view/segment/access';
import { changesView } from '../view/segment/changes';
import { contentView } from '../view/segment/content';
import { nojsView } from '../view/segment/nojs';
import { signalsView } from '../view/segment/signals';
import { structureView } from '../view/segment/structure';
import { datasetOfBuilds } from '../view/test-support/built-dataset';
import { inputOf, recheckInputOf, siteShape } from '../view/test-support/generated-check';
import { docStrings, type DocBlock, type ReportDoc } from './generate';
import { auditDoc, baselineDoc, compareDoc, fixProofDoc } from './generate-doc';

const HOME = 'https://crawlmouse.com/';
const OPTIONS = { home: HOME };

/** Every string in a value, and every number as its digits: what a screen prints of a view. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

const graded = (d: ViewDataset) =>
  d.checks.filter((c) => c.status === 'finished' || c.status === 'partial');

/**
 * What the audit pages of `checkId` say, as a paid plan reads them: each string and number of the
 * overview and the six segments, the Changes page of each graded check the records hold, and the
 * partial notice. Built here from the view functions, apart from the builder under test.
 */
function pageStrings(d: ViewDataset, checkId: string): string[] {
  const plan = { plan: 'pro' } as const;
  return leaves([
    resultView(d, checkId, { map: null, plan: 'pro' }),
    accessView(d, checkId, plan),
    nojsView(d, checkId, plan),
    structureView(d, checkId, plan, null),
    contentView(d, checkId, plan),
    signalsView(d, checkId, plan),
    graded(d).map((c) => changesView(d, c.id, { ...plan, rerun: false })),
    partialNotice(d, checkId),
  ]);
}

const LISTED: readonly string[] = Object.values(REPORT_DOC_COPY);
/** The words the screens print for a verdict (components/v2/verdicts.ts). */
const VERDICT_WORDS = Object.values(VERDICTS).map((v) => v.label);

/**
 * Holds `doc` to its sources: each string is one a page said (`said`), a listed word, or a verdict's
 * word; the footer is the listed line with the date `checkedAt`, linking `HOME`.
 */
function expectSaidByThePages(doc: ReportDoc, said: readonly string[], checkedAt: string) {
  const allowed = new Set([...said, ...LISTED, ...VERDICT_WORDS]);
  const { footer, ...body } = doc;
  const strings = docStrings({ ...body, footer: { text: '', href: '' } }).filter((s) => s !== '');
  expect(strings.filter((s) => !allowed.has(s))).toEqual([]);
  expect(strings.length).toBeGreaterThan(5);
  expect(footer).toEqual({ text: footerLine(checkedAt), href: HOME });
}

const tables = (doc: ReportDoc) =>
  doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === 'table');
const tableOf = (doc: ReportDoc, caption: string) => {
  const t = tables(doc).find((b) => b.caption === caption);
  if (!t) throw new Error(`no table captioned ${caption}`);
  return t;
};
const pairs = (doc: ReportDoc) =>
  doc.sections
    .flatMap((s) => s.blocks)
    .filter((b): b is Extract<DocBlock, { type: 'pair' }> => b.type === 'pair');

const BAD = fixture('bad-site');
const BAD_FIRST = 'c0000000-0000-4000-8000-000000000001';
const BAD_FOURTH = 'c0000000-0000-4000-8000-000000000004';
const BAD_FIFTH = 'c0000000-0000-4000-8000-000000000005';
const BAD_SIXTH = 'c0000000-0000-4000-8000-000000000006';
const CHALLENGED = fixture('challenged-site');
const CHALLENGED_RECHECK = 'c0000000-0000-4000-8000-0000000000ca';
const CLEAN = fixture('clean-site');
const CLEAN_CHECK = 'c0000000-0000-4000-8000-000000000065';

describe('auditDoc on the contract fixtures', () => {
  const doc = auditDoc({ dataset: BAD, checkId: BAD_FIRST }, OPTIONS);

  it('is titled, names the site and when it was checked, and ends with the footer line', () => {
    expect(doc.title).toBe('Audit report');
    expect(doc.lines).toEqual([
      'example-outfitter.com',
      '25 Oct 2026, 02:34 UTC',
      'All 214 pages crawled',
    ]);
    expect(doc.footer).toEqual({
      text: 'Checked with Crawlmouse · 25 Oct 2026, 02:34 UTC',
      href: HOME,
    });
  });

  it('gives both grades as the overview shows them', () => {
    expect(tableOf(doc, 'Letter, score and what each rests on')).toMatchObject({
      columns: ['Grade', 'Letter', 'Score of 100', 'What it rests on'],
      rows: [
        [
          'Technical SEO',
          'B',
          '79',
          'Sound structure; seven pages nobody links to. Two fixes take it to A-; both are open now.',
        ],
        [
          'AI readability',
          'D',
          '41',
          'PerplexityBot gets a challenge page; product pages are empty to the other three.',
        ],
      ],
    });
  });

  it('gives the crawler table by group, each verdict in the screens’ words', () => {
    expect(tableOf(doc, 'AI training')).toMatchObject({
      columns: ['Crawler', 'Verdict', 'Text read', 'What is in the way'],
      rows: [
        ['GPTBot', 'blocked by a rule', '0%', 'Cloudflare firewall rule (error 1020)'],
        ['ClaudeBot', 'allowed, thin', '31%', 'client-rendered template'],
      ],
    });
    expect(tableOf(doc, 'Search engines').rows.map((r) => r[0])).toEqual(['Googlebot', 'Bingbot']);
    const access = doc.sections.find((s) => s.heading === 'Crawler access')!;
    expect(access.blocks).toContainEqual({ type: 'text', text: 'by robots.txt, not fetched' });
    expect(access.blocks[0]).toEqual({
      type: 'text',
      text: 'One of six AI crawlers is blocked, and one is challenged.',
    });
  });

  it('lists each open fix with its effect, in the audit’s order', () => {
    const fixes = tableOf(doc, 'Open fixes, effects estimated');
    expect(fixes.columns).toEqual(['Fix', 'Pages', 'Estimated effect', 'Effort', 'Kind']);
    expect(fixes.rows).toHaveLength(13);
    expect(fixes.rows.slice(0, 2)).toEqual([
      [
        'Let GPTBot and PerplexityBot through Cloudflare',
        '—',
        '+24 AI',
        'about 10 minutes',
        'confirmed defect',
      ],
      [
        'Server-render the product template',
        '158 pages',
        '+22 AI',
        'one template, one deploy',
        'documented platform requirement',
      ],
    ]);
  });

  it('heads the structure and content sections as their pages do', () => {
    const heading = (name: string) => doc.sections.find((s) => s.heading === name)!.blocks[0];
    expect(heading('Site structure')).toEqual({
      type: 'text',
      text: 'Seven pages have no links pointing at them.',
    });
    expect(heading('Content an answer engine can quote')).toEqual({
      type: 'text',
      text: 'Answer engines can quote your blog. Not your collections and products.',
    });
    expect(doc.sections.map((s) => s.heading)).toEqual([
      'Grades',
      'Crawler access',
      'Readable without JavaScript',
      'Site structure',
      'Content an answer engine can quote',
      'Agent-readiness signals',
      'Open fixes, effects estimated',
    ]);
  });

  it('says what the check did not measure, in the pages’ sentences', () => {
    expect(doc.notMeasured).toEqual(['Tested 6 of 7 signals']);
    const partial = auditDoc({ dataset: CHALLENGED, checkId: CHALLENGED_RECHECK }, OPTIONS);
    expect(partial.notMeasured.slice(0, 2)).toEqual([
      'This audit is partial: 44 of the 140 pages found were not crawled.',
      'The site’s edge blocks all automation, so only one of the four scored crawlers could be measured. Access is somewhere between 0 and 30 of 40.',
    ]);
    expect(tableOf(partial, 'Letter, score and what each rests on').rows[1]).toEqual([
      'AI readability',
      'withheld',
      'withheld',
      'The site’s edge blocks all automation, so only one of the four scored crawlers could be measured. Access is somewhere between 0 and 30 of 40.',
    ]);
    expect(partial.lines[2]).toBe('96 of 140 pages crawled');
  });

  it('has no fixes section for a check with nothing to fix', () => {
    const clean = auditDoc({ dataset: CLEAN, checkId: CLEAN_CHECK }, OPTIONS);
    expect(clean.sections.map((s) => s.heading)).not.toContain('Open fixes, effects estimated');
  });

  it.each([
    ['bad-site, its first audit', BAD, BAD_FIRST],
    ['bad-site, its sixth check', BAD, BAD_SIXTH],
    ['challenged-site, partial and withheld', CHALLENGED, CHALLENGED_RECHECK],
    ['clean-site', CLEAN, CLEAN_CHECK],
  ])('%s: each string is one its pages say', (_name, d, checkId) => {
    const audit = auditDoc({ dataset: d, checkId }, OPTIONS);
    const checkedAt = resultView(d, checkId, { map: null }).crawledAt;
    expectSaidByThePages(audit, pageStrings(d, checkId), checkedAt);
    expectSaidByThePages(
      baselineDoc({ dataset: d, checkId }, OPTIONS),
      pageStrings(d, checkId),
      checkedAt,
    );
  });
});

describe('baselineDoc', () => {
  const doc = baselineDoc({ dataset: CLEAN, checkId: CLEAN_CHECK }, OPTIONS);

  it('says what was checked, when, and what the access page heads with', () => {
    expect(doc.title).toBe('Baseline');
    expect(doc.lines).toEqual([
      'trailhead.example',
      '27 Oct 2026, 15:31 UTC',
      'All 38 pages crawled',
    ]);
    expect(doc.sections.map((s) => s.heading)).toEqual([
      'Grades',
      'Crawler access',
      'Readable without JavaScript',
    ]);
    expect(doc.sections[1]!.blocks[0]).toEqual({
      type: 'text',
      text: 'All six AI crawlers get in.',
    });
    expect(doc.sections[2]!.blocks[0]).toEqual({
      type: 'text',
      text: 'Every template ships its text without JavaScript.',
    });
    expect(doc.footer.text).toBe('Checked with Crawlmouse · 27 Oct 2026, 15:31 UTC');
  });

  it('says what blocks a site that is not clear, in the access page’s words', () => {
    const blocked = baselineDoc({ dataset: BAD, checkId: BAD_FIRST }, OPTIONS);
    expect(blocked.sections[1]!.blocks[0]).toEqual({
      type: 'text',
      text: 'One of six AI crawlers is blocked, and one is challenged.',
    });
  });
});

describe('compareDoc', () => {
  const doc = compareDoc(
    { dataset: BAD, checkId: BAD_FIFTH },
    { dataset: BAD, checkId: BAD_SIXTH },
    OPTIONS,
  );

  it('names the site and both checks’ dates, and is footed with the later check’s', () => {
    expect(doc.title).toBe('Before and after');
    expect(doc.lines).toEqual([
      'example-outfitter.com',
      '29 Oct 2026, 12:42 UTC',
      '30 Oct 2026, 10:02 UTC',
    ]);
    expect(doc.footer.text).toBe('Checked with Crawlmouse · 30 Oct 2026, 10:02 UTC');
  });

  it('pairs each grade: the letter, the score and the summary of each check, with its date', () => {
    const [seo, ai] = pairs(doc);
    expect(seo!.title).toBe('Technical SEO');
    expect(ai).toMatchObject({
      title: 'AI readability',
      before: { label: 'Before', date: '29 Oct 2026, 12:42 UTC', value: 'D' },
      after: { label: 'After', date: '30 Oct 2026, 10:02 UTC', value: 'F' },
    });
    expect(ai!.before.evidence[0]).toBe('41');
    expect(ai!.after.evidence[0]).toBe('22');
    expect(seo!.before.evidence[0]).toBe('80');
    expect(seo!.after.evidence[0]).toBe('79');
  });

  it('pairs each change the later check found, with its cause and the lines that changed', () => {
    const moved = doc.sections.find((s) => s.heading === 'What moved')!;
    expect(moved.blocks[0]).toEqual({
      type: 'text',
      text: 'Four changes found at the Fri 06:02 check.',
    });
    const changes = moved.blocks.filter((b) => b.type === 'pair');
    expect(changes).toHaveLength(4);
    expect(changes[0]).toEqual({
      type: 'pair',
      title: 'Claude-SearchBot is now blocked on example-outfitter.com',
      before: { label: 'Before', date: '29 Oct 2026, 12:42 UTC', value: '—', evidence: [] },
      after: {
        label: 'After',
        date: '30 Oct 2026, 10:02 UTC',
        value: 'opened',
        evidence: [
          'First observed after robots.txt changed Thu 19:40: a group for "User-agent: ClaudeBot" and "User-agent: Claude-SearchBot" with "Disallow: /" was added.',
          'User-agent: ClaudeBot',
          'User-agent: Claude-SearchBot',
          'Disallow: /',
        ],
      },
    });
    expect(moved.blocks[2]).toEqual({
      type: 'facts',
      rows: [
        { label: 'Where', value: 'robots.txt' },
        { label: 'Pages', value: '214 pages' },
        { label: 'Effect on the grades', value: 'none' },
      ],
    });
    expect(moved.blocks.filter((b) => b.type === 'facts')).toContainEqual({
      type: 'facts',
      rows: [
        { label: 'Where', value: 'all pages' },
        { label: 'Pages', value: '214 pages' },
        { label: 'Effect on the grades', value: 'AI readability 41 → 22' },
      ],
    });
  });

  it('covers each check between the two, in order, each change dated by the check that found it', () => {
    // The fixture's fifth check found no change: give it one, a copy of the sixth's content change.
    const content = BAD.changes.find((c) => c.check_id === BAD_SIXTH && c.subject === 'content')!;
    const atFifth = {
      ...content,
      id: '90000000-0000-4000-8000-0000000000f5',
      check_id: BAD_FIFTH,
      previous_check_id: BAD_FOURTH,
      summary: 'Nine pages changed content',
    };
    const records = { ...BAD, changes: [...BAD.changes, atFifth] };
    const fromFourth = compareDoc(
      { dataset: records, checkId: BAD_FOURTH },
      { dataset: records, checkId: BAD_SIXTH },
      OPTIONS,
    );
    const moved = fromFourth.sections.find((s) => s.heading === 'What moved')!;
    const found = moved.blocks.filter((b) => b.type === 'pair');
    expect(found.map((b) => b.title)).toEqual([
      'Nine pages changed content',
      ...BAD.changes.filter((c) => c.check_id === BAD_SIXTH).map((c) => c.summary),
    ]);
    expect([found[0]!.before.date, found[0]!.after.date]).toEqual([
      '28 Oct 2026, 20:04 UTC',
      '29 Oct 2026, 12:42 UTC',
    ]);
    expect([found[1]!.before.date, found[1]!.after.date]).toEqual([
      '29 Oct 2026, 12:42 UTC',
      '30 Oct 2026, 10:02 UTC',
    ]);
    // From the fifth, the fifth's own change is before the window.
    const fromFifth = compareDoc(
      { dataset: records, checkId: BAD_FIFTH },
      { dataset: records, checkId: BAD_SIXTH },
      OPTIONS,
    );
    expect(pairs(fromFifth).map((b) => b.title)).not.toContain('Nine pages changed content');
  });

  it('each string is one the two checks’ pages say', () => {
    expectSaidByThePages(
      doc,
      [...pageStrings(BAD, BAD_FIFTH), ...pageStrings(BAD, BAD_SIXTH)],
      '30 Oct 2026, 10:02 UTC',
    );
  });

  it('refuses two checks out of order, one check twice, and checks of two sites', () => {
    const at = (checkId: string) => ({ dataset: BAD, checkId });
    expect(() => compareDoc(at(BAD_SIXTH), at(BAD_FIFTH), OPTIONS)).toThrow(/earlier/);
    expect(() => compareDoc(at(BAD_SIXTH), at(BAD_SIXTH), OPTIONS)).toThrow(/earlier/);
    expect(() =>
      compareDoc(at('c0000000-0000-4000-8000-00000000000b'), at(BAD_SIXTH), OPTIONS),
    ).toThrow(/one site/);
  });
});

/** The recorded site and its re-check, built by the engine, as the pipeline's reader gives them. */
function recordedPair() {
  const input = recordedBuild();
  const first = buildCheck(input);
  const second = buildCheck(secondInput(first));
  return {
    first,
    second,
    before: { dataset: datasetOfBuilds(input.site, [first]), checkId: first.check.id },
    after: { dataset: datasetOfBuilds(input.site, [first, second]), checkId: second.check.id },
  };
}

const verifiedIn = (build: BuiltCheck) =>
  build.fix_events.filter((e) => e.kind === 'verified' && e.check_id === build.check.id);

describe('fixProofDoc', () => {
  const { second, before, after } = recordedPair();
  const [verified] = verifiedIn(second);

  it('the recorded re-check verifies a fix', () => {
    expect(verified).toBeDefined();
  });

  it('pairs the fix as the check that held it open and the check that verified it show it', () => {
    const fixId = verified!.fix_id;
    const doc = fixProofDoc(before, after, fixId, OPTIONS);
    const open = fixView(before.dataset, before.checkId, fixId, { plan: 'pro', rerun: false });
    const resolved = fixView(after.dataset, after.checkId, fixId, { plan: 'pro', rerun: false });
    if (resolved.kind !== 'resolved') throw new Error('the fixture’s fix is not resolved');
    const when = (id: string) =>
      changesView(after.dataset, after.checkId).history.find((h) => h.key === id)!.when;
    expect(doc.title).toBe('Fix verified');
    expect(doc.lines).toEqual([open.frame.domain, open.head.title]);
    expect(pairs(doc)[0]).toEqual({
      type: 'pair',
      title: open.head.title,
      before: {
        label: 'Before',
        date: when(before.checkId),
        value: open.frame.position,
        evidence: open.head.lede,
      },
      after: {
        label: 'After',
        date: when(after.checkId),
        value: resolved.frame.position,
        evidence: [resolved.resolved],
      },
    });
    expect(resolved.frame.position).toMatch(/^Fix \d+, resolved$/);
    expect(resolved.resolved).toMatch(/^Verified resolved by the check of /);
    expect(pairs(doc).map((p) => p.title)).toEqual([
      open.head.title,
      'Technical SEO',
      'AI readability',
    ]);
    expectSaidByThePages(
      doc,
      [
        ...pageStrings(before.dataset, before.checkId),
        ...pageStrings(after.dataset, after.checkId),
        ...leaves([open, resolved]),
      ],
      resultView(after.dataset, after.checkId, { map: null }).crawledAt,
    );
  });

  it('refuses a fix the later check did not verify', () => {
    const stillOpen = after.dataset.fixes.find(
      (f) => f.status !== 'verified_resolved' && f.first_seen_check_id === before.checkId,
    )!;
    expect(() => fixProofDoc(before, after, stillOpen.id, OPTIONS)).toThrow(/did not verify/);
  });
});

describe('property: no document holds a string its pages do not say', () => {
  const met = new Map<string, number>();
  const note = (name: string, when = true) => {
    if (when) met.set(name, (met.get(name) ?? 0) + 1);
  };

  it('a generated site as a first audit, its re-check, the two compared, and each fix its re-check verified', () => {
    fc.assert(
      fc.property(siteShape, siteShape, (a, b) => {
        const input = inputOf(a);
        const first = buildCheck(input);
        const second = buildCheck(recheckInputOf(b, first));
        const before = { dataset: datasetOfBuilds(input.site, [first]), checkId: first.check.id };
        const after = {
          dataset: datasetOfBuilds(input.site, [first, second]),
          checkId: second.check.id,
        };
        const saidBefore = pageStrings(before.dataset, before.checkId);
        const saidAfter = pageStrings(after.dataset, after.checkId);
        const at = (r: typeof before) => resultView(r.dataset, r.checkId, { map: null }).crawledAt;

        const audit = auditDoc(before, OPTIONS);
        expectSaidByThePages(audit, saidBefore, at(before));
        expectSaidByThePages(auditDoc(after, OPTIONS), saidAfter, at(after));
        expectSaidByThePages(baselineDoc(before, OPTIONS), saidBefore, at(before));
        const compared = compareDoc(before, after, OPTIONS);
        expectSaidByThePages(compared, [...saidBefore, ...saidAfter], at(after));
        expect(pairs(compared).length).toBe(2 + after.dataset.changes.length);

        for (const e of verifiedIn(second)) {
          const fix = (r: typeof before) =>
            fixView(r.dataset, r.checkId, e.fix_id, { plan: 'pro', rerun: false });
          expectSaidByThePages(
            fixProofDoc(before, after, e.fix_id, OPTIONS),
            [...saidBefore, ...saidAfter, ...leaves([fix(before), fix(after)])],
            at(after),
          );
        }
        note('partial', first.check.status === 'partial');
        note('finished', first.check.status === 'finished');
        note('AI readability withheld', first.check.ai_readability!.withheld);
        note('Technical SEO not graded', first.check.technical_seo!.grade === null);
        note('Technical SEO graded', first.check.technical_seo!.grade !== null);
        note('text without JavaScript not measured', first.check.without_js === null);
        note('fixes', (audit.sections.at(-1)?.heading ?? '') === REPORT_DOC_COPY.fixes);
        note('no fix', (audit.sections.at(-1)?.heading ?? '') !== REPORT_DOC_COPY.fixes);
        note('a re-check with changes', after.dataset.changes.length > 0);
        note('something not measured', audit.notMeasured.length > 0);
      }),
      { numRuns: 150 },
    );
  }, 240_000);

  it('the recorded site and its re-check', () => {
    const { before, after } = recordedPair();
    const saidBefore = pageStrings(before.dataset, before.checkId);
    const saidAfter = pageStrings(after.dataset, after.checkId);
    const at = (r: typeof before) => resultView(r.dataset, r.checkId, { map: null }).crawledAt;
    expectSaidByThePages(auditDoc(before, OPTIONS), saidBefore, at(before));
    expectSaidByThePages(auditDoc(after, OPTIONS), saidAfter, at(after));
    expectSaidByThePages(
      compareDoc(before, after, OPTIONS),
      [...saidBefore, ...saidAfter],
      at(after),
    );
  });

  it('the generated sites met each shape the documents branch on', () => {
    for (const shape of [
      'partial',
      'finished',
      'AI readability withheld',
      'Technical SEO not graded',
      'Technical SEO graded',
      'text without JavaScript not measured',
      'fixes',
      'no fix',
      'a re-check with changes',
      'something not measured',
    ]) {
      expect(met.get(shape) ?? 0, shape).toBeGreaterThan(0);
    }
  });
});
