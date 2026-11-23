import { describe, expect, it } from 'vitest';
import { CheckSchema, type Check, type Verdict } from '@crawlmouse/types/v2';
import { FIXTURE_NAMES, findCheck, fixture, type ViewDataset } from '../fixtures';
import { CHECKS } from '../recordings';
import { VERDICTS } from '../../../components/v2/verdicts';
import { isAi, keptOutClauses, servedExtent } from '../sentences';
import { accessPill, resultView } from './result';
import { accessView } from './segment/access';
import { buildPublicSnapshot } from '../reports/build-snapshot';

/** The sentences a reader meets first, on every graded check of every fixture. */
const graded = FIXTURE_NAMES.flatMap((name) => {
  const d = fixture(name) as ViewDataset;
  return (
    d.checks
      .filter((c) => c.status === 'finished' || c.status === 'partial')
      // The Result page needs both grades and the structure; a partial fixture row can hold none.
      .filter((c) => c.structure && c.technical_seo && c.ai_readability)
      .map((c) => ({ name, d, c }))
  );
});

const primaryText = (d: ViewDataset, c: Check) => {
  const r = resultView(d, c.id, { map: null, asFirstSeen: true });
  const a = accessView(d, c.id);
  return JSON.stringify({
    first: r.first,
    grades: r.grades.map((g) => g.summary),
    access: r.doors[0],
    headline: a.headline,
    method: a.method,
  });
};

/** A check whose AI crawlers hold these verdicts, in order; the rest stay as they were. */
function withVerdicts(verdicts: Verdict[]): Check {
  const c = structuredClone(findCheck(fixture('clean-site'), CHECKS.cleanFirstAudit));
  c.crawlers.filter(isAi).forEach((x, i) => {
    x.verdict = verdicts[i] ?? 'allowed';
    x.cause = null;
  });
  return c;
}

/** The clean-site dataset with this check in the place of its own. */
const fixtureOf = (c: Check): ViewDataset => {
  const d = structuredClone(fixture('clean-site')) as ViewDataset;
  d.checks = d.checks.map((x) => (x.id === c.id ? c : x));
  return d;
};

describe('a request in a crawler’s name is reported as that request', () => {
  it('reads every graded fixture check (the sweep is live)', () => {
    expect(graded.length).toBeGreaterThan(5);
  });

  it.each(graded.map((g) => [`${g.name} ${g.c.id.slice(-6)}`, g] as const))(
    '%s claims no crawler-level fact and no published address',
    (_label, { d, c }) => {
      expect(primaryText(d, c)).not.toMatch(
        /\bgets? in\b|admitted only|published IPs|in Settings and we test/,
      );
    },
  );

  it('keeps the three states apart in the pill, each with its count', () => {
    const label = accessPill(
      withVerdicts(['allowed', 'blocked_by_ua_rule', 'refused_unverified', 'refused_unverified']),
    ).label;
    expect(label).toBe('1 refused by user agent · 2 refused, unverified');
  });

  it('counts a challenge apart from a refusal to every crawler name', () => {
    const label = accessPill(withVerdicts(['challenged_ua', 'refused_unverified'])).label;
    expect(label).toBe('1 refused, unverified · 1 challenged');
  });

  it('says a served check was served to our requests, in numbers', () => {
    const c = withVerdicts([]);
    const n = c.crawlers.filter(isAi).length;
    expect(accessPill(c).label).toBe(`${n} of ${n} served`);
  });

  it('says what a refusal with a witness shows, and no more', () => {
    const c = withVerdicts(['blocked_by_ua_rule']);
    const [clause] = keptOutClauses(c.crawlers.filter((x) => x.verdict === 'blocked_by_ua_rule'));
    expect(clause).toMatch(
      /was refused when we sent its user agent, while another crawler name was served$/,
    );
  });

  it('says what a refusal with no witness shows, and does not name a cause as fact', () => {
    const c = withVerdicts(['refused_unverified']);
    const [clause] = keptOutClauses(c.crawlers.filter((x) => x.verdict === 'refused_unverified'));
    expect(clause).toMatch(
      /was refused on pages where no other crawler name was served; this may be IP verification$/,
    );
  });
});

describe('each verdict in the matrix says how sure it is, and what a 404 was', () => {
  /** The bad site's Access view, after `edit` to a copy of its first audit. */
  const access = (edit: (c: Check) => void = () => {}) => {
    const d = structuredClone(fixture('bad-site')) as ViewDataset;
    const c = findCheck(d, CHECKS.badFirstAudit);
    edit(c);
    return accessView(d, c.id);
  };
  const rowOf = (v: ReturnType<typeof accessView>, ua: string) =>
    v.groups.flatMap((g) => g.rows).find((r) => r.ua === ua)!;

  it.each(['confirmed', 'likely', 'inconclusive'] as const)('shows %s from the check', (level) => {
    const v = access((c) => {
      c.crawlers.find((x) => x.ua === 'GPTBot')!.confidence = level;
    });
    expect(rowOf(v, 'GPTBot').confidence).toBe(level);
  });

  it.each([404, 410])('says a refusal verdict with a %i answered that status', (status) => {
    const v = access((c) => {
      const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
      gpt.verdict = 'blocked_by_ua_rule';
      gpt.by_template.forEach((t) => Object.assign(t, { verdict: 'blocked_by_ua_rule', status }));
    });
    const cell = rowOf(v, 'GPTBot').cells[0]!;
    expect(cell.verdict).toBe('blocked_by_ua_rule');
    expect(cell.qualifier).toBe(`(answered ${status} to our request)`);
  });

  it('leaves a 403 refusal as it was', () => {
    const v = access((c) => {
      const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
      gpt.verdict = 'blocked_by_ua_rule';
      gpt.by_template.forEach((t) =>
        Object.assign(t, { verdict: 'blocked_by_ua_rule', status: 403 }),
      );
    });
    expect(rowOf(v, 'GPTBot').cells[0]!.qualifier ?? '').not.toContain('answered');
  });

  it('does not say it of a 404 on a verdict that is not a refusal', () => {
    const v = access((c) => {
      const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
      gpt.verdict = 'allowed';
      gpt.by_template.forEach((t) => Object.assign(t, { verdict: 'allowed', status: 404 }));
    });
    expect(rowOf(v, 'GPTBot').cells[0]!.qualifier ?? '').not.toContain('answered');
  });
});

describe('how many pages a served verdict rests on', () => {
  /** The clean site with its AI crawlers measured on these numbers of its sampled pages. */
  function measuredOn(pages: number[]) {
    const d = structuredClone(fixture('clean-site')) as ViewDataset;
    const c = findCheck(d, CHECKS.cleanFirstAudit);
    c.coverage!.pages_sampled = 25;
    c.crawlers.filter(isAi).forEach((x, i) => {
      x.pages_measured = pages[i % pages.length]!;
      x.pages_served = pages[i % pages.length]!;
    });
    return { d, c };
  }

  it('says the range when crawlers were measured on some of the sample', () => {
    const { d, c } = measuredOn([1, 4]);
    expect(servedExtent(c)).toBe(', on 1 to 4 of the 25 sampled pages');
    expect(accessPill(c)).toEqual({
      state: 'unverified',
      label: '6 of 6 served, on 1 to 4 of 25 pages',
    });
    const a = accessView(d, c.id);
    expect(a.headline.title).toBe(
      'Requests with all six AI crawlers’ user agents were served, on 1 to 4 of the 25 sampled pages.',
    );
    expect(resultView(d, c.id, { map: null }).doors[0]!.body).toContain(
      'were served, on 1 to 4 of the 25 sampled pages.',
    );
  });

  it('says one number when they all rest on the same count', () => {
    expect(servedExtent(measuredOn([3]).c)).toBe(', on 3 of the 25 sampled pages');
  });

  it('says nothing extra when each was measured on the whole sample', () => {
    const { c } = measuredOn([25]);
    expect(servedExtent(c)).toBe('');
    expect(accessPill(c)).toEqual({ state: 'ok', label: '6 of 6 served' });
  });

  it('reads a count above the sample as the whole sample', () => {
    expect(servedExtent(measuredOn([25, 214]).c)).toBe('');
    expect(servedExtent(measuredOn([3, 214]).c)).toBe(', on 3 to 25 of the 25 sampled pages');
  });

  it('counts only the crawlers that were served', () => {
    const { c } = measuredOn([25]);
    Object.assign(c.crawlers.filter(isAi)[0]!, {
      verdict: 'blocked_by_ua_rule',
      pages_measured: 1,
      pages_served: 1,
    });
    expect(servedExtent(c)).toBe('');
  });
});

describe('the method line, on the Access screen', () => {
  const { d, c } = graded.find((g) => g.name === 'bad-site')!;
  const method = accessView(d, c.id).method;

  it('says what we sent and from where', () => {
    expect(method).toContain('from Crawlmouse’s own address, not the operator’s');
  });

  it('says what the test cannot prove, in both directions', () => {
    expect(method).toContain('A rule matching the exact string will not fire on it');
    expect(method).toContain('may refuse it while serving the real crawler');
  });

  it('promises no exact-string mode, which does not exist', () => {
    expect(method).not.toMatch(/Settings|exact strings/);
  });
});

describe('what the crawler sentences may claim (review of PR 2a)', () => {
  it('takes the extent of the crawlers the sentence names', () => {
    const c = withVerdicts([]);
    c.coverage!.pages_sampled = 5;
    for (const x of c.crawlers.filter(isAi)) {
      x.verdict = 'allowed';
      x.evidence_class = 'simulated';
      x.pages_measured = x.scored ? 5 : 2;
      x.pages_served = x.scored ? 5 : 2;
    }
    expect(c.crawlers.some((x) => isAi(x) && !x.scored)).toBe(true);
    expect(
      servedExtent(
        c,
        false,
        c.crawlers.filter((x) => x.scored),
      ),
    ).toBe('');
    expect(servedExtent(c)).toBe(', on 2 to 5 of the 5 sampled pages');
  });

  it('does not say every other crawler name was refused: only that none was served', () => {
    const c = withVerdicts(['refused_unverified', 'challenged_ua', 'rate_limited']);
    const said = [
      ...keptOutClauses(c.crawlers.filter(isAi)),
      JSON.stringify(accessView(fixtureOf(c), c.id).headline),
    ];
    expect(said.join(' ')).not.toMatch(/as was every|refused to every/);
    expect(keptOutClauses(c.crawlers.filter(isAi)).join(' ')).toContain(
      'on pages where no other crawler name was served',
    );
    expect(VERDICTS.refused_unverified.label).not.toMatch(/every/);
  });

  it('does not say the crawler requests were not sent, or count an unmeasured crawler as served', () => {
    const c = withVerdicts(['edge_blocks_automation']);
    const headline = JSON.stringify(accessView(fixtureOf(c), c.id).headline);
    expect(headline).not.toContain('were not sent');
    expect(headline).toContain('no crawler request was measured where it did');
    expect(headline).toMatch(/the other \w+ AI crawlers/);
    expect(headline).not.toMatch(/Requests with all /);
  });
});

describe('how many pages a crawler was served on (pages_served)', () => {
  const OLD_ROW = ', on at least half of the pages that answered';
  const served = (measured: number, count: number | undefined) => {
    const c = withVerdicts([]);
    c.coverage!.pages_sampled = measured;
    for (const x of c.crawlers.filter(isAi)) {
      x.verdict = 'allowed';
      x.evidence_class = 'simulated';
      x.pages_measured = measured;
      if (count === undefined) delete x.pages_served;
      else x.pages_served = count;
    }
    return c;
  };

  it('counts the pages served, not the pages measured', () => {
    expect(servedExtent(served(5, 3))).toBe(', on 3 of the 5 sampled pages');
  });

  it('says nothing more when each was served on the whole sample', () => {
    const c = served(5, 5);
    expect(servedExtent(c)).toBe('');
    const n = c.crawlers.filter(isAi).length;
    expect(accessPill(c)).toEqual({ state: 'ok', label: `${n} of ${n} served` });
  });

  it('renders a new row with its exact count', () => {
    const c = served(5, 3);
    const n = c.crawlers.filter(isAi).length;
    expect(CheckSchema.parse(c).crawlers[0]).toHaveProperty('pages_served');
    expect(accessPill(c)).toEqual({
      state: 'unverified',
      label: `${n} of ${n} served, on 3 of 5 pages`,
    });
    expect(JSON.stringify(accessView(fixtureOf(c), c.id).headline)).toContain(
      'on 3 of the 5 sampled pages',
    );
  });

  it('renders a row stored before the count existed with only what its verdict proves', () => {
    const c = served(5, undefined);
    const n = c.crawlers.filter(isAi).length;
    expect(CheckSchema.parse(c).crawlers.filter(isAi)[0]).not.toHaveProperty('pages_served');
    expect(servedExtent(c)).toBe(OLD_ROW);
    expect(JSON.stringify(accessView(fixtureOf(c), c.id).headline)).toContain(OLD_ROW);
    const pill = accessPill(c);
    expect(pill).toEqual({
      state: 'unverified',
      label: 'Served on at least half of pages answered',
    });
    expect(pill!.label).not.toContain(`${n} of ${n} served`);
  });

  it('treats a check with one old row as old', () => {
    const c = served(5, 5);
    delete c.crawlers.filter(isAi)[0]!.pages_served;
    expect(servedExtent(c)).toBe(OLD_ROW);
    expect(accessPill(c)).toEqual({
      state: 'unverified',
      label: 'Served on at least half of pages answered',
    });
  });

  it('does not ask a row that was not served for its count', () => {
    const c = served(5, 5);
    const out = c.crawlers.filter(isAi)[0]!;
    out.verdict = 'blocked_by_ua_rule';
    delete out.pages_served;
    expect(servedExtent(c)).toBe('');
  });
});

describe('every crawler sentence says what our request got (review 2 of PR 2a)', () => {
  const edged = (served: number) => {
    const c = withVerdicts([]);
    c.crawlers.filter(isAi).forEach((x, i) => {
      x.verdict = i < served ? 'allowed' : 'edge_blocks_automation';
      x.evidence_class = 'simulated';
      x.pages_served = i < served ? x.pages_measured : 0;
    });
    return c;
  };

  it('states each refusal as what our request got, not as a fact about the crawler', () => {
    const c = withVerdicts([
      'challenged_ua',
      'rate_limited',
      'payment_required',
      'redirected_away',
    ]);
    const said = keptOutClauses(c.crawlers.filter(isAi)).join('; ');
    expect(said).toContain('was challenged when we sent its user agent');
    expect(said).toContain('was rate limited when we sent its user agent');
    expect(said).toContain('was asked to pay (402) when we sent its user agent');
    expect(said).toContain('was sent to another host when we sent its user agent');
    expect(said).not.toMatch(/gets a challenge|is rate limited|is asked to pay|is sent to/);
  });

  it('does not say the site blocks all automation while crawler requests were served', () => {
    const c = edged(5);
    expect(accessPill(c)).toEqual({ state: 'unverified', label: '5 of 6 served · 1 not measured' });
    const body = JSON.stringify(resultView(fixtureOf(c), c.id, { map: null }).doors);
    expect(body).toContain('Requests with the other five AI crawlers’ user agents were served');
  });

  it('says what an edge that refused every request did, in what our test saw', () => {
    const c = edged(0);
    expect(accessPill(c)).toEqual({ state: 'bad', label: 'refused or challenged our tests' });
    expect(VERDICTS.edge_blocks_automation.label).toBe('refused or challenged our tests');
  });

  it('does not say crawler requests were sent where none was', () => {
    const c = edged(0);
    const v = accessView(fixtureOf(c), c.id);
    expect(v.method).not.toMatch(/^Sampled pages were requested/);
    expect(v.method).toContain('No crawler request was sent');
    const tile = v.tiles.find((t) => t.label === 'Pages sampled per crawler')!;
    expect(tile.value).toBe(`0 of ${c.coverage!.pages_discovered.toLocaleString('en-US')}`);
  });

  it('limits the method line to pages our control was served on, when an edge refused some', () => {
    const c = edged(5);
    expect(accessView(fixtureOf(c), c.id).method).toMatch(/^Sampled pages were requested/);
  });

  it('mints a headline with the served wording and its extent, and no search engine', () => {
    const c = withVerdicts([]);
    c.coverage!.pages_sampled = 5;
    for (const x of c.crawlers.filter(isAi)) {
      x.verdict = 'allowed';
      x.evidence_class = 'simulated';
      x.pages_measured = 5;
      x.pages_served = 1;
      x.text_share = 1;
    }
    const { headline } = buildPublicSnapshot(fixtureOf(c), c.id, '2026-11-23T12:00:00.000Z');
    expect(headline).toBe(
      'Requests with all six AI crawlers’ user agents were served, on 1 of the 5 sampled pages.',
    );
    expect(headline).not.toMatch(/Every crawler|Googlebot|Bingbot/);
  });
});

describe('claims the third review of PR 2a found', () => {
  it('does not say we sent a request for a row read from the site’s own logs', () => {
    const c = withVerdicts(['challenged_ua']);
    c.crawlers.filter(isAi)[0]!.evidence_class = 'observed';
    const [clause] = keptOutClauses(c.crawlers.filter(isAi));
    expect(clause).toContain('was challenged, in the site’s own logs');
    expect(clause).not.toContain('when we sent');
  });

  it('claims only that some pages of a refusal had no other crawler name served', () => {
    const c = withVerdicts(['refused_unverified']);
    expect(keptOutClauses(c.crawlers.filter(isAi)).join(' ')).toContain(
      'was refused on pages where no other crawler name was served',
    );
    expect(VERDICTS.refused_unverified.label).toBe('refused, unverified');
    expect(JSON.stringify(accessView(fixtureOf(c), c.id).headline)).not.toContain('on the same');
  });

  it('says a crawler behind an edge could not be tested, not that it met the edge', () => {
    const c = withVerdicts(['edge_blocks_automation']);
    const [clause] = keptOutClauses(c.crawlers.filter(isAi));
    expect(clause).toContain(
      'could not be tested: the site’s edge refused or challenged our control request',
    );
    expect(clause).not.toContain('met an edge');
  });

  it('names rendering requests only on a check that holds a render', () => {
    const none = withVerdicts([]);
    none.without_js = null;
    expect(accessView(fixtureOf(none), none.id).method).not.toContain('Rendering requests');
    const rendered = withVerdicts([]);
    rendered.without_js = rendered.without_js ?? ({} as never);
    expect(accessView(fixtureOf(rendered), rendered.id).method).toContain('Rendering requests');
  });

  it('keeps a later refusal a statement about our request when robots.txt comes first', () => {
    const c = withVerdicts(['disallowed_by_robots', 'blocked_by_ua_rule']);
    expect(JSON.stringify(accessView(fixtureOf(c), c.id).headline)).toContain(
      'requests as one were refused by user agent',
    );
  });
});
