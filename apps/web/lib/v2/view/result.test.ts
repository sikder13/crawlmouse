import { describe, expect, it } from 'vitest';
import type { Check, Fix, FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, type FixtureName } from '../fixtures';
import { CHECKS } from '../recordings';
import { partialNotice, resultView, type DoorView, type ResultView } from './result';
import { pagesReadableText } from './effect-headline';

const NO_MAP = { nodes: [], positions: {} };

const CHECK_OF: Record<FixtureName, string> = {
  'bad-site': CHECKS.badFirstAudit,
  'clean-site': CHECKS.cleanFirstAudit,
  'challenged-site': CHECKS.challengedFirstAudit,
  // The check builder's one check (CC-20a), read from the fixture rather than repeated here.
  'built-site': fixture('built-site').checks[0]!.id,
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
    expect(door(v, CONTENT).coverage).toEqual({
      pages: { tested: 1 + 42 + 158, total: 214, groups: 3 },
    });
  });
});

describe('the first fix’s estimated effect', () => {
  it('prints the score after it to two places', () => {
    const v = view('bad-site', (c, d) => {
      c.technical_seo!.score = 81.57;
      for (const f of d.fixes) {
        f.effect.ai_readability = 0;
        f.effect.technical_seo = 1.35;
      }
    });
    if (v.first.kind !== 'fix') throw new Error(`got ${v.first.kind}`);
    expect(v.first.body).toContain('Technical SEO 81.57 → 82.92, estimated.');
    expect(allText(v)).not.toMatch(/\d\.\d{3,}/);
  });

  it('prints the AI readability score after it to two places', () => {
    expect(40.1 + 0.2).not.toBe(40.3);
    const v = view('bad-site', (c, d) => {
      Object.assign(c.ai_readability!, {
        withheld: false,
        withheld_reasons: [],
        total: 40.1,
        grade: 'D',
      });
      for (const f of d.fixes) {
        f.effect.ai_readability = 0.2;
        f.effect.ai_readability_pending_on = [];
      }
    });
    if (v.first.kind !== 'fix') throw new Error(`got ${v.first.kind}`);
    expect(v.first.body).toContain('AI readability 40.1 → 40.3, estimated.');
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

describe('what each door rests on', () => {
  const coverage = (v: ResultView) => Object.fromEntries(v.doors.map((d) => [d.title, d.coverage]));

  it('gives every door a coverage line: the pages tested, or what a door that reads no pages read', () => {
    expect(coverage(view('bad-site'))).toEqual({
      'Crawler access': { pages: { tested: 50, total: 214, groups: 4 } },
      'Readable without JavaScript': { pages: { tested: 50, total: 214, groups: 4 } },
      'Site structure': { pages: { tested: 214, total: 214, groups: 4 } },
      // The audit's record holds 16 of the pages crawled, and says so.
      'Broken links and page basics': { read: 'Checked 16 of the 214 pages crawled' },
      'Content an answer engine can quote': { pages: { tested: 214, total: 214, groups: 4 } },
      'Agent-readiness signals': { read: 'Tested 6 of 7 signals' },
      'What changed since last time': { read: 'No earlier audit of this site to compare with' },
    });
  });

  it('counts a signal it could not determine, or did not record, as not tested', () => {
    expect(coverage(view('challenged-site'))['Agent-readiness signals']).toEqual({
      read: 'Tested 1 of 7 signals',
    });
    expect(coverage(view('clean-site'))['Agent-readiness signals']).toEqual({
      read: 'Tested 3 of 7 signals',
    });
  });

  it('pills the signals the same way whether a signal was unrecorded or undetermined', () => {
    const pill = (v: ResultView) => door(v, 'Agent-readiness signals').pill.label;
    expect(pill(view('bad-site'))).toBe('2 of 7 present');
    expect(pill(view('challenged-site'))).toBe('1 of 7 present');
    expect(pill(view('clean-site'))).toBe('3 of 7 present');
  });

  it('says no page was read when content was not measured, rather than counting zero groups', () => {
    expect(coverage(view('challenged-site'))['Content an answer engine can quote']).toEqual({
      read: 'No page was read for these checks.',
    });
  });

  it('offers every page with Pro only when the free result tested fewer than every page', () => {
    const readable = 'Readable without JavaScript';
    expect(door(view('bad-site'), readable).footer).toMatch(/^Every page measured with Pro · /);
    const clean = door(view('clean-site'), readable);
    expect(clean.coverage).toEqual({ pages: expect.objectContaining({ tested: 38, total: 38 }) });
    expect(clean.footer).not.toMatch(/with Pro/);
  });
});

describe('the crawler-access bar', () => {
  const access = (v: ResultView) => door(v, 'Crawler access');

  it('fills with what the pill counts, in the pill’s tone, like the doors beside it', () => {
    expect(access(view('bad-site')).bar).toEqual({ percent: 33, tone: 'bad' });
    expect(access(view('challenged-site')).bar).toEqual({ percent: 100, tone: 'bad' });
    // Nothing kept out: the pill counts the crawlers allowed, and the bar is full, not empty.
    const clean = access(view('clean-site'));
    expect(clean.pill).toEqual({ state: 'ok', label: '6 of 6 allowed' });
    expect(clean.bar).toEqual({ percent: 100, tone: 'neutral' });
    const challengedOnly = access(
      view('bad-site', (c) => {
        const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
        Object.assign(gpt, { verdict: 'allowed', cause: null });
      }),
    );
    expect(challengedOnly.pill).toEqual({ state: 'unverified', label: '1 challenged' });
    expect(challengedOnly.bar).toEqual({ percent: 17, tone: 'warn' });
  });

  it('counts and words the crawlers that get in at every number, and keeps "not measured" apart', () => {
    const set = (c: Check, verdict: Check['crawlers'][number]['verdict'], uas: string[]) =>
      c.crawlers
        .filter((x) => uas.includes(x.ua))
        .forEach((x) => Object.assign(x, { verdict, cause: null }));
    const AI = [
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'Claude-SearchBot',
      'GPTBot',
      'ClaudeBot',
    ];
    const none = access(view('bad-site', (c) => set(c, 'disallowed_by_robots', AI)));
    expect(none.body).not.toMatch(/The other|get in/);
    expect(none.pill.label).toBe('6 blocked');
    const one = access(
      view('bad-site', (c) => {
        set(c, 'disallowed_by_robots', AI);
        set(c, 'allowed', ['OAI-SearchBot']);
      }),
    );
    expect(one.body).toMatch(/The other AI crawler gets in;/);
    const unmeasured = access(
      view('bad-site', (c) => {
        set(c, 'allowed', AI);
        set(c, 'not_measured', ['GPTBot']);
      }),
    );
    expect(unmeasured.pill).toEqual({ state: 'unverified', label: '1 not measured' });
    expect(unmeasured.pill.label).not.toMatch(/kept out/);
    expect(unmeasured.bar).toEqual({ percent: 17, tone: 'warn' });
    expect(unmeasured.body).toMatch(/The other five AI crawlers get in;/);
  });

  /** The figure a pill states, as a share of 100; null for a pill that states none. */
  const figure = (d: DoorView): number | null => {
    const label = d.pill.label;
    const ai = Number(/^(\d+) AI crawlers/.exec(d.footer)?.[1]);
    const of = /^(\d+) of (\d+) (?:present|allowed)$/.exec(label);
    if (of) return Math.round((Number(of[1]) / Number(of[2])) * 100);
    const plain = /^(\d+)(?: \/ 100|% of text)$/.exec(label);
    if (plain) return Number(plain[1]);
    if (label === 'blocks all automation') return 100;
    const counts = [...label.matchAll(/(\d+) (?:blocked|challenged|kept out|not measured)/g)];
    if (counts.length) return Math.round((counts.reduce((n, m) => n + Number(m[1]), 0) / ai) * 100);
    return null;
  };
  const TONE = { ok: 'neutral', neutral: 'neutral', unverified: 'warn', warn: 'warn', bad: 'bad' };

  it.each(['bad-site', 'clean-site', 'challenged-site'] as const)(
    '%s: each door’s bar draws its pill’s figure in its pill’s tone',
    (name) => {
      const barred = view(name).doors.filter((d) => d.bar);
      expect(barred.length).toBeGreaterThanOrEqual(4);
      for (const d of barred) {
        expect(d.bar, d.title).toEqual({ percent: figure(d), tone: TONE[d.pill.state] });
      }
    },
  );
});

describe('the tables’ labels', () => {
  it('names a crawler’s group from its group, and whether it is scored from its flag', () => {
    const v = view('challenged-site', (c) => {
      c.crawlers.find((x) => x.ua === 'ChatGPT-User')!.scored = false;
      c.crawlers.find((x) => x.ua === 'GPTBot')!.scored = true;
    });
    const group = (ua: string) => v.crawlers!.find((r) => r.ua === ua)!.group;
    expect(group('ChatGPT-User')).toBe('AI search, not scored');
    expect(group('GPTBot')).toBe('AI training, scored');
    expect(group('OAI-SearchBot')).toBe('AI search, scored');
    expect(group('ClaudeBot')).toBe('AI training, not scored');
    expect(group('Googlebot')).toBe('Search engine');
  });

  it('gives a template fix its page count unless its title already states that count', () => {
    const SERVER = 'Server-render the product template';
    /** The scope of fix 2 (158 pages on the product template) under another title. */
    const scopeTitled = (title: string) =>
      view('bad-site', (_, d) => {
        d.fixes.find((f) => f.title === SERVER)!.title = title;
      }).fixes!.rows.find((r) => r.title === title)!.scope;
    expect(scopeTitled(SERVER)).toBe('158 pages');
    expect(scopeTitled('Server-render the 158 product pages')).toBeNull();
    expect(scopeTitled('Server-render the product template in 2 steps')).toBe('158 pages');
  });

  it('a Content section with no score yet shows "not scored yet" and no bar, not 0', () => {
    const v = view('bad-site', (c) => {
      c.content = { ...c.content!, score: null, score_withheld: 'no_check_counted' };
    });
    const d = door(v, 'Content an answer engine can quote');
    expect(d.pill).toEqual({ state: 'neutral', label: 'not scored yet' });
    expect(d.bar).toBeUndefined();
  });

  it('a fix whose Technical SEO effect is not estimated (a refused grade) shows no +0, alone or grouped', () => {
    let section: Record<string, string> = {};
    let shell: Fix | undefined;
    const v = view('bad-site', (_, d) => {
      section = Object.fromEntries(d.fixes.map((f) => [f.id, f.section]));
      shell = d.fixes.find((f) => f.type === 'client_rendered_template');
      for (const f of d.fixes) {
        f.effect.ai_readability = null;
        f.effect.ai_readability_pending_on = ['readable_unmeasured'];
        f.effect.technical_seo = null;
        f.effect.technical_seo_pending_on = ['grade_refused'];
      }
    });
    const rows = v.fixes!.rows;
    // a structure fix is headed by its Technical SEO effect, a client-rendered template fix by the
    // pages it makes readable (CC-32 Q8), the others by their waiting AI effect
    const pages = pagesReadableText(shell!.affected_pages, shell!.last_state === 'detected');
    const named = new Set(rows.map((r) => r.key));
    // the grouped row: the shell fix's pages when it is a member; with nothing that adds up and no
    // Technical SEO estimated, "SEO not estimated"
    const shellInRest = !named.has(shell!.id);
    const want = (key: string) =>
      key === 'rest'
        ? shellInRest
          ? pages
          : 'SEO not estimated'
        : key === shell!.id
          ? pages
          : section[key] === 'structure'
            ? 'SEO not estimated'
            : 'AI not yet estimated';
    expect(new Set(rows.map((r) => want(r.key)))).toContain('SEO not estimated');
    expect(new Set(rows.map((r) => want(r.key)))).toContain('AI not yet estimated');
    expect(rows.map((r) => r.points)).toEqual(rows.map((r) => want(r.key)));
  });
});

describe('the third card when there is no fix', () => {
  /** The clean site with its page rows answering `codes`, and every other row removed. */
  const answering = (codes: number[]) =>
    view('clean-site', (c, d) => {
      const template = d.page_results.find((p) => p.check_id === c.id)!;
      d.page_results = codes.map((status_code, i) => ({
        ...template,
        url: `https://example.test/${i}`,
        status_code,
      }));
      c.coverage!.pages_crawled = codes.length;
      c.coverage!.pages_discovered = codes.length;
      // As the builder leaves a check with no page served: no letter.
      Object.assign(c.technical_seo!, { grade: null, score: null });
    });

  it('says nothing to fix on a check that measured everything', () => {
    expect(view('clean-site').first.kind).toBe('all-clear');
  });

  it('does not say all-clear, or that templates ship text, when text was not measured', () => {
    const v = view('clean-site', (c) => {
      c.without_js = null;
    });
    if (v.first.kind !== 'unmeasured') throw new Error(`got ${v.first.kind}`);
    expect(v.first.title).toBe('Not everything was measured');
    expect(v.first.body).toBe(
      'We found nothing to fix in what we measured. Text without JavaScript was not measured.',
    );
    expect(JSON.stringify(v.first)).not.toMatch(/ships its text|get in|Keep it that way/);
  });

  it('names the AI crawlers that were not measured, from the check', () => {
    const v = view('clean-site', (c) => {
      for (const ua of ['GPTBot', 'ClaudeBot']) {
        c.crawlers.find((x) => x.ua === ua)!.verdict = 'not_measured';
      }
    });
    if (v.first.kind !== 'unmeasured') throw new Error(`got ${v.first.kind}`);
    expect(v.first.body).toContain('GPTBot and ClaudeBot were not measured.');
    expect(v.first.body).not.toContain('Text without JavaScript');
  });

  it('says the site refused when every page answered a refusal, with the status', () => {
    const v = answering([403, 403]);
    if (v.first.kind !== 'not-served') throw new Error(`got ${v.first.kind}`);
    expect(v.first.title).toBe('Your site refused our requests');
    expect(v.first.body).toMatch(/^2 pages answered our requests, with 403\./);
    expect(v.first.action).toEqual({ label: 'Run a new audit', href: '/' });
  });

  it('does not call a 404 a refusal', () => {
    const v = answering([404]);
    if (v.first.kind !== 'not-served') throw new Error(`got ${v.first.kind}`);
    expect(v.first.title).toBe('Your site did not serve a page');
    expect(v.first.body).toMatch(/^1 page answered our request, with 404\./);
  });

  it('takes a 200 at its word: a long page whose links were not all read is served', () => {
    const v = view('clean-site', (c, d) => {
      for (const p of d.page_results.filter((x) => x.check_id === c.id)) {
        Object.assign(p, { links_read: false, title: null, content_simhash: null });
      }
    });
    expect(v.first.kind).toBe('all-clear');
    expect(v.crawledLine).not.toContain('none served');
  });

  it('never says nothing was graded beside a letter', () => {
    const v = view('clean-site', (c, d) => {
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 403 }));
      expect(c.technical_seo!.grade).not.toBeNull();
    });
    expect(v.first.kind).not.toBe('not-served');
    expect(v.grades[0].summary).not.toContain('nothing was graded');
    expect(v.crawledLine).not.toContain('none served');
  });

  it.each([301, 302, 304, 399])('does not call a %i served', (code) => {
    expect(answering([code]).first.kind).toBe('not-served');
  });

  it('names each status, and reads only this check’s pages', () => {
    const v = view('clean-site', (c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      const template = d.page_results.find((p) => p.check_id === c.id)!;
      d.page_results = [
        ...[401, 403, 429].map((status_code, i) => ({
          ...template,
          url: `https://example.test/${i}`,
          status_code,
        })),
        { ...template, check_id: '00000000-0000-4000-8000-0000000000ff', status_code: 200 },
      ];
    });
    if (v.first.kind !== 'not-served') throw new Error(`got ${v.first.kind}`);
    expect(v.first.body).toMatch(
      /^3 pages answered our requests, with 401, 403 or 429 \(“too many requests”/,
    );
  });

  it('does not let a search engine it could not measure stop the all-clear', () => {
    const v = view('clean-site', (c) => {
      c.crawlers.find((x) => x.group === 'search_engine')!.verdict = 'not_measured';
    });
    expect(v.first.kind).toBe('all-clear');
  });

  it('says none of the AI crawlers was measured only when none was', () => {
    const none = view('clean-site', (c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 403 }));
      for (const x of c.crawlers.filter((y) => y.group !== 'search_engine'))
        x.verdict = 'not_measured';
    });
    const some = view('clean-site', (c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 403 }));
      c.crawlers.find((y) => y.ua === 'GPTBot')!.verdict = 'not_measured';
    });
    expect(none.first.kind === 'not-served' && none.first.body).toContain(
      'None of the six AI crawlers could be measured.',
    );
    expect(some.first.kind === 'not-served' && some.first.body).not.toContain('None of the');
  });

  it('does not call a check with no page served "nothing urgent", whatever its signals show', () => {
    const signals = answering([403]).doors.find((x) => x.title === 'Agent-readiness signals')!;
    expect(signals.footer).toBe('Checked by fetch');
  });

  it('gives each kind of answer its own next step', () => {
    const next = (code: number) => {
      const f = answering([code]).first;
      return f.kind === 'not-served' ? f.body : '';
    };
    expect(next(403)).toContain('look for a firewall or bot rule');
    expect(next(404)).toContain('Once the site serves its pages');
    expect(next(404)).not.toContain('firewall');
    expect(next(301)).toContain('If the site has moved, run this audit on its new address');
    expect(next(301)).not.toContain('Once the site serves');
  });

  it.each([
    [
      'a site that served no page',
      (c: Check, d: FixtureDataset) => {
        Object.assign(c.technical_seo!, { grade: null, score: null });
        d.page_results = d.page_results
          .filter((p) => p.check_id === c.id)
          .map((p) => ({ ...p, status_code: 403 }));
        c.without_js = null;
        c.content = null;
        for (const x of c.crawlers.filter((y) => y.group !== 'search_engine'))
          x.verdict = 'not_measured';
      },
    ],
    [
      'a check with the crawlers and the text unmeasured',
      (c: Check) => {
        c.without_js = null;
        c.content = null;
        for (const x of c.crawlers.filter((y) => y.group !== 'search_engine'))
          x.verdict = 'not_measured';
      },
    ],
  ])('%s: no door says there is nothing to fix in what it did not measure', (_name, edit) => {
    const v = view('clean-site', edit);
    const unmeasured = v.doors.filter((d) => d.pill.label.includes('not measured'));
    expect(unmeasured.length).toBeGreaterThanOrEqual(2);
    for (const d of unmeasured)
      expect(d.footer, d.title).not.toMatch(/nothing to fix|nothing urgent/);
  });

  it('claims nothing about structure on a check where no page was served', () => {
    const v = answering([403]);
    expect(v.crawledLine).toBe('1 page answered, none served');
    expect(v.grades[0].summary).toBe('No page was served, so nothing was graded.');
    const structure = door(v, 'Site structure');
    expect(structure.pill.label).toBe('not measured');
    expect(structure.body).not.toMatch(/orphan|linked|hub/i);
  });
});

describe('the partial notice', () => {
  const noticeOf = (edit: (c: Check, d: FixtureDataset) => void) => {
    const d = structuredClone(fixture('clean-site'));
    const c = findCheck(d, CHECK_OF['clean-site']);
    c.status = 'partial';
    edit(c, d);
    return partialNotice(d, c.id);
  };

  it('states the crawler tests that did not finish, in numbers', () => {
    const notice = noticeOf((c, d) => {
      const template = d.page_results.find((p) => p.check_id === c.id)!;
      d.page_results = [0, 1, 2].map((i) => ({
        ...template,
        url: `https://example.test/${i}`,
        sampled: true,
        crawlers_reached: i === 0 ? 6 : null,
      }));
    });
    expect(notice).toBe(
      'This audit is partial: crawler tests did not finish on 2 of the 3 sampled pages.',
    );
  });

  it('counts only this check’s sampled pages', () => {
    const notice = noticeOf((c, d) => {
      const template = d.page_results.find((p) => p.check_id === c.id)!;
      d.page_results = [
        { ...template, url: 'https://example.test/a', sampled: true, crawlers_reached: null },
        { ...template, url: 'https://example.test/b', sampled: false, crawlers_reached: null },
        {
          ...template,
          check_id: '00000000-0000-4000-8000-0000000000ff',
          url: 'https://example.test/c',
          sampled: true,
          crawlers_reached: null,
        },
      ];
    });
    expect(notice).toBe(
      'This audit is partial: crawler tests did not finish on 1 of the 1 sampled page.',
    );
  });

  it('does not give unmeasured text as the reason a check is partial', () => {
    const notice = noticeOf((c) => {
      c.without_js = null;
    });
    expect(notice).not.toContain('text without JavaScript');
  });
});

describe('the fix to do first', () => {
  it('words its effort in the singular for one minute', () => {
    const v = view('bad-site', (_, d) => {
      for (const f of d.fixes) if (f.effort?.kind === 'minutes') f.effort.minutes = 1;
    });
    expect(v.first.body).toMatch(/about one minute[.,]/);
    expect(view('bad-site').first.body).toMatch(/about ten minutes/);
  });

  const WITH_STEPS = ' The steps and the evidence are open, free.';
  const NAMES = Object.keys(CHECK_OF) as FixtureName[];
  /** The fix a fixture's card names, and whether it has a packet. */
  const firstFix = (name: FixtureName, { first }: ResultView) =>
    first.kind === 'fix' ? fixture(name).fixes.find((f) => f.title === first.title)! : null;

  it('says the steps are open when the fix it names has a packet', () => {
    let met = 0;
    for (const name of NAMES) {
      const v = view(name);
      const fix = firstFix(name, v);
      if (!fix?.packet) continue;
      met += 1;
      expect(v.first.body.endsWith(WITH_STEPS), name).toBe(true);
    }
    expect(met).toBeGreaterThan(0);
  });

  it('does not mention steps when the fix it names has no packet', () => {
    let met = 0;
    for (const name of NAMES) {
      const fix = firstFix(name, view(name));
      if (!fix) continue;
      met += 1;
      const v = view(name, (_, d) => {
        d.fixes.find((f) => f.id === fix.id)!.packet = null;
      });
      expect(v.first).toMatchObject({ kind: 'fix', title: fix.title });
      expect(v.first.body, name).not.toMatch(/steps|open, free/i);
      expect(v.first.body.endsWith('.'), name).toBe(true);
    }
    expect(met).toBeGreaterThan(0);
  });
});
