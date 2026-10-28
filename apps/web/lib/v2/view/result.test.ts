import { describe, expect, it } from 'vitest';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, type FixtureName } from '../fixtures';
import { CHECKS } from '../recordings';
import { resultView, type DoorView, type ResultView } from './result';

const NO_MAP = { nodes: [], positions: {} };

const CHECK_OF: Record<FixtureName, string> = {
  'bad-site': CHECKS.badFirstAudit,
  'clean-site': CHECKS.cleanFirstAudit,
  'challenged-site': CHECKS.challengedFirstAudit,
};

/** The Result view of a fixture's first audit, after `edit` is applied to a copy of its check. */
function view(name: FixtureName, edit: (c: Check, d: FixtureDataset) => void = () => {}) {
  const d = structuredClone(fixture(name));
  edit(findCheck(d, CHECK_OF[name]), d);
  return resultView(d, CHECK_OF[name], { map: NO_MAP, asFirstSeen: name === 'bad-site' });
}

const door = (v: ResultView, title: string): DoorView => v.doors.find((x) => x.title === title)!;

/** Every sentence and label the view hands the screen, as one string. */
const allText = (v: ResultView) =>
  JSON.stringify({ grades: v.grades, first: v.first, doors: v.doors, crawlers: v.crawlers });

describe('the edge that blocks all automation', () => {
  it('is said in one wording, the access pill’s, wherever the challenged result mentions it', () => {
    const v = view('challenged-site');
    expect(door(v, 'Crawler access').pill.label).toBe('blocks all automation');
    expect(door(v, 'Crawler access').body).toMatch(/^The site’s edge blocks all automation/);
    expect(v.grades[1].summary).toMatch(/^The site’s edge blocks all automation/);
    expect(allText(v)).not.toMatch(/\brefused\b|lets through|challenges every|whoever we said/);
  });

  it('is named as the reason content was not measured only when a crawler met it', () => {
    const content = 'Content an answer engine can quote';
    expect(door(view('challenged-site'), content).body).toBe(
      'The site’s edge blocks all automation, so whether the pages open with a quotable answer could not be measured.',
    );
    const unmeasured = view('clean-site', (c) => (c.content = null));
    expect(door(unmeasured, content).body).toBe(
      'Whether the pages open with a quotable answer was not measured in this audit.',
    );
    expect(door(unmeasured, content).body).not.toMatch(/edge/);
  });
});

describe('the content door’s sentences', () => {
  const CONTENT = 'Content an answer engine can quote';
  type Rows = Record<string, [passing: number, total: number] | undefined>;
  /** The bad-site check with one content check's rows replaced, by template key. */
  const withRows = (name: string, rows: Rows) =>
    door(
      view('bad-site', (c) => {
        const check = c.content!.checks.find((x) => x.check === name)!;
        check.by_template = Object.entries(rows)
          .filter((e): e is [string, [number, number]] => e[1] !== undefined)
          .map(([template_key, [passing, total]]) => ({ template_key, passing, total }));
      }),
      CONTENT,
    ).body;
  const T = {
    home: '/',
    col: '/collections/{slug}',
    prod: '/products/{slug}',
    blog: '/blog/{slug}',
  };
  /** The answer sentence: the body's first sentence. */
  const answers = (rows: Rows) => withRows('direct_answer_150', rows).split('. ')[0] + '.';

  it('keeps the locked wording on the bad site', () => {
    expect(door(view('bad-site'), CONTENT).body).toBe(
      "The homepage and blog posts answer their titles in the first paragraph; collection pages and product pages don't. Few headings are phrased as questions. Schema is present on every template.",
    );
  });

  it('says which templates answer, which do on some pages and which do not, from 75% and from 25%', () => {
    expect(answers({ [T.home]: [1, 1], [T.col]: [3, 4], [T.prod]: [1, 4], [T.blog]: [0, 4] })).toBe(
      "The homepage and collection pages answer their titles in the first paragraph; product pages do on some pages; blog posts don't.",
    );
  });

  it('leads with whichever group there is, with the verb agreeing', () => {
    expect(answers({ [T.home]: [0, 1], [T.col]: [2, 4], [T.prod]: [2, 4], [T.blog]: [2, 4] })).toBe(
      "Collection pages, product pages and blog posts answer their titles in the first paragraph on some pages; the homepage doesn't.",
    );
    expect(answers({ [T.home]: [0, 1], [T.col]: [0, 4], [T.prod]: [0, 4], [T.blog]: [0, 4] })).toBe(
      "The homepage, collection pages, product pages and blog posts don't answer their titles in the first paragraph.",
    );
    expect(answers({ [T.home]: [1, 1], [T.col]: [0, 4], [T.prod]: [0, 4], [T.blog]: [0, 4] })).toBe(
      "The homepage answers its title in the first paragraph; collection pages, product pages and blog posts don't.",
    );
  });

  it('says "every template" only when every template was measured, and leaves out a template with no pages read', () => {
    expect(answers({ [T.home]: [1, 1], [T.col]: [4, 4], [T.prod]: [4, 4], [T.blog]: [4, 4] })).toBe(
      'Every template answers its title in the first paragraph.',
    );
    expect(answers({ [T.home]: [1, 1], [T.col]: [4, 4], [T.prod]: [4, 4], [T.blog]: [0, 0] })).toBe(
      'The homepage, collection pages and product pages answer their titles in the first paragraph.',
    );
    expect(answers({ [T.home]: [1, 1], [T.col]: [4, 4], [T.prod]: [4, 4] })).toBe(
      'The homepage, collection pages and product pages answer their titles in the first paragraph.',
    );
  });

  it('says where schema is, where it is partly, and where it is not', () => {
    const schema = (rows: Rows) => withRows('schema_with_description', rows).split('. ').at(-1);
    expect(
      schema({ [T.home]: [1, 1], [T.col]: [0, 42], [T.prod]: [100, 158], [T.blog]: [13, 13] }),
    ).toBe(
      'Schema is present on the homepage and blog posts, and partly on product pages; not on collection pages.',
    );
    expect(
      schema({ [T.home]: [0, 1], [T.col]: [0, 42], [T.prod]: [100, 158], [T.blog]: [0, 13] }),
    ).toBe(
      'Schema is present partly on product pages; not on the homepage, collection pages and blog posts.',
    );
    expect(
      schema({ [T.home]: [0, 1], [T.col]: [0, 42], [T.prod]: [0, 158], [T.blog]: [0, 13] }),
    ).toBe('No page we checked has schema.');
    for (const blog of [undefined, [0, 0] as [number, number]]) {
      expect(
        schema({ [T.home]: [1, 1], [T.col]: [42, 42], [T.prod]: [158, 158], [T.blog]: blog }),
      ).toBe('Schema is present on the homepage, collection pages and product pages.');
    }
  });

  it('words question headings as few below 25%, some from 25% and most from 75%, and says nothing with none read', () => {
    const questions = (rows: Rows) => withRows('question_headings', rows).split('. ')[1];
    expect(questions({ [T.col]: [1, 4] })).toBe('Some headings are phrased as questions');
    expect(questions({ [T.col]: [3, 4] })).toBe('Most headings are phrased as questions');
    expect(questions({ [T.col]: [0, 4], [T.prod]: [0, 0] })).toBe(
      'Few headings are phrased as questions',
    );
    expect(withRows('question_headings', { [T.col]: [0, 0] })).not.toMatch(/headings/);
  });

  it('counts the pages and groups the content checks read, leaving out a template none read', () => {
    const v = view('bad-site', (c) => {
      for (const x of c.content!.checks) {
        x.by_template = x.by_template.filter((r) => r.template_key !== '/blog/{slug}');
      }
    });
    expect(door(v, CONTENT).coverage).toEqual({ tested: 1 + 42 + 158, total: 214, groups: 3 });
  });
});

describe('the clean bill’s all-clear card', () => {
  const allClear = (v: ResultView) => {
    if (v.first.kind !== 'all-clear') throw new Error('Not a clean bill');
    return v.first;
  };
  const TAIL = 'What changes that is a deploy, a plugin or a new firewall rule;';

  it('says what the verdicts and templates show, and offers to start watching', () => {
    const first = allClear(view('clean-site'));
    expect(first.body).toBe(
      `All six AI crawlers get in and every template ships its text. ${TAIL} kept, this audit is re-run monthly and you hear when one lands.`,
    );
    expect(first.action).toEqual({ label: 'Watch this site', href: '#keep' });
  });

  it('names a crawler kept out and a thin template rather than calling them in', () => {
    const first = allClear(
      view('clean-site', (c) => {
        const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
        Object.assign(gpt, { verdict: 'disallowed_by_robots', cause: 'robots_txt_disallow' });
        gpt.by_template.forEach((t) => (t.verdict = 'disallowed_by_robots'));
        for (const x of c.crawlers.filter((x) => x.group !== 'search_engine' && x !== gpt)) {
          x.by_template.find((t) => t.template_key === '/products/{slug}')!.verdict =
            'allowed_thin';
        }
      }),
    );
    expect(first.body).toMatch(
      /^GPTBot is blocked by robots\.txt; the other five AI crawlers get in, and product pages are empty without JavaScript\. /,
    );
  });

  it('says how a kept site is watched, and offers nothing to start', () => {
    const kept = (cadence: 'weekly' | null) =>
      allClear(
        view('clean-site', (c, d) => {
          const site = d.sites.find((s) => s.id === c.site_id)!;
          site.account_id = 'a0000000-0000-4000-8000-0000000000aa';
          site.schedule = cadence ? { cadence, iso_weekday: 5, hour_local: 6 } : null;
        }),
      );
    expect(kept('weekly').body).toMatch(new RegExp(`${TAIL} it is re-checked weekly`));
    expect(kept(null).body).toMatch(new RegExp(`${TAIL} no re-check is scheduled\\.$`));
    expect(kept('weekly').action).toBeNull();
  });
});
