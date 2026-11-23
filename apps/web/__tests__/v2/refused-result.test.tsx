/**
 * The result of a check the site refused (inbox 024, QA 047 rows 4 to 8), and the Pro prompt on a
 * kept audit. Each case changes a fixture's stored fields, as a real refused row has them.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { fixture } from '../../lib/v2/fixtures';
import { AuditPageProvider } from '../../components/v2/screens/result/AuditPage';
import { auditPage } from '../../app/audit/[id]/_lib/page-data';
import { CONTROL, CRAWL, CRAWLERS } from '../../../../packages/worker/src/identities';
import { CRAWL_USER_AGENT } from '../../lib/v2/help/pinned';
import { CHECKS } from '../../lib/v2/recordings';
import { resultView, type ResultView } from '../../lib/v2/view/result';

const NO_MAP = { nodes: [], positions: {} };
const ID = CHECKS.cleanFirstAudit;

function view(
  change: (c: Check, d: FixtureDataset) => void = () => {},
  asFirstSeen = false,
): ResultView {
  const d = structuredClone(fixture('clean-site'));
  change(d.checks.find((c) => c.id === ID)!, d);
  return resultView(d, ID, { map: NO_MAP, asFirstSeen });
}

/** An account keeps the check's site. */
const keep = (c: Check, d: FixtureDataset) => {
  d.sites.find((x) => x.id === c.site_id)!.account_id = '00000000-0000-4000-8000-0000000000aa';
};

/** Nothing graded, and every page of the check answered with `code`. */
const answered = (code: number, asFirstSeen = false) =>
  view((c, d) => {
    Object.assign(c.technical_seo!, { grade: null, score: null });
    d.page_results = d.page_results
      .filter((p) => p.check_id === c.id)
      .map((p) => ({ ...p, status_code: code }));
  }, asFirstSeen);

const card = (v: ResultView) => {
  if (v.first.kind !== 'not-served') throw new Error(`got ${v.first.kind}`);
  return v.first;
};
const signals = (v: ResultView) => v.doors.find((x) => x.title === 'Agent-readiness signals')!;
/** As a real audit page renders it: with that page's links, which hold no re-run route. */
const html = (v: ResultView) =>
  renderToStaticMarkup(
    <AuditPageProvider page={auditPage(ID, 'result')}>
      <ResultScreen data={v} checkId={ID} />
    </AuditPageProvider>,
  );
const COMPETITOR = 'Is a competitor this readable?';

describe('the next step on a refused check', () => {
  it.each([401, 403, 429])('%i: names our crawl’s exact user agent, and /bot', (code) => {
    expect(card(answered(code)).letIn).toEqual({ agent: CRAWL.userAgent, href: '/bot' });
    expect(CRAWL_USER_AGENT).toBe(CRAWL.userAgent);
  });

  it('the string it tells an owner to allow is on no crawler test or control request', () => {
    const agent = card(answered(429)).letIn!.agent!;
    for (const identity of [...CRAWLERS, CONTROL]) expect(identity.userAgent).not.toContain(agent);
  });

  it('warns against a partial match', () => {
    expect(html(answered(429))).toContain('Match the whole string.');
  });

  it('gives no user agent when the edge refused our browser request too', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 403 }));
      for (const x of c.crawlers.filter((x) => x.group !== 'search_engine'))
        Object.assign(x, { verdict: 'edge_blocks_automation', status: 403 });
    });
    if (card(v).letIn!.agent === null) {
      expect(html(v)).toContain('A user agent rule will not clear this');
      expect(html(v)).not.toContain('Match the whole string.');
    } else {
      throw new Error('the fixture did not reach the edge state');
    }
  });

  it.each([404, 500, 301])('%i is not a refusal, so it offers no way in', (code) => {
    expect(card(answered(code)).letIn).toBeUndefined();
    expect(html(answered(code))).not.toContain('How our crawler identifies itself');
  });

  it('draws the token, the link and Run this audit again', () => {
    const out = html(answered(429));
    expect(out).toContain(CRAWL.userAgent);
    expect(out).toMatch(/<a href="\/bot">How our crawler identifies itself<\/a>/);
    expect(out).toMatch(
      /<a [^>]*href="\/"[^>]*data-v2-primary[^>]*>Run a new audit<|<a [^>]*data-v2-primary[^>]*href="\/"[^>]*>Run a new audit</,
    );
  });

  it('offers Sites on a kept audit', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
      keep(c, d);
    });
    expect(card(v).action).toEqual({ label: 'Open Sites', href: '/dashboard' });
  });

  it('has one primary button, kept or not', () => {
    const refuse = (c: Check, d: FixtureDataset) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
    };
    const kept = view((c, d) => {
      refuse(c, d);
      keep(c, d);
    });
    expect(kept.keptUntil).toBeNull();
    expect(html(kept).match(/data-v2-primary/g)).toHaveLength(1);
    const unkept = view(refuse);
    expect(unkept.keptUntil).not.toBeNull();
    expect(html(unkept).match(/data-v2-primary/g)).toHaveLength(1);
  });
});

describe('429 in words', () => {
  it('labels only 429 when two statuses are named', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      const rows = d.page_results.filter((p) => p.check_id === c.id);
      d.page_results = rows.map((p, i) => ({ ...p, status_code: i ? 451 : 429 }));
    });
    expect(card(v).body).toContain(
      'with 429 (“too many requests”: the site is limiting requests) or 451.',
    );
  });

  it('is explained once', () => {
    expect(card(answered(429)).body.match(/too many requests/g)).toHaveLength(1);
  });

  it('is not added to another status', () => {
    expect(card(answered(403)).body).not.toContain('too many requests');
  });
});

describe('the signals card', () => {
  const refusedWithPeriods = view((c, d) => {
    Object.assign(c.technical_seo!, { grade: null, score: null });
    d.page_results = d.page_results
      .filter((p) => p.check_id === c.id)
      .map((p) => ({ ...p, status_code: 429 }));
    c.signals = [
      {
        signal: 'schema_org',
        state: 'indeterminate',
        evidence: 'No graded page to read.',
        counts_toward_grade: true,
        recommendation_class: 'best_practice',
      },
      {
        signal: 'content_signals',
        state: 'not_detected',
        evidence: 'robots.txt has no Content-Signal line.',
        counts_toward_grade: true,
        recommendation_class: 'best_practice',
      },
    ] as Check['signals'];
  });

  it('has no double full stop when the stored evidence ends in one', () => {
    expect(signals(refusedWithPeriods).body).toContain('No graded page to read.');
    expect(signals(refusedWithPeriods).body).not.toContain('..');
  });

  it('keeps a full stop when the evidence has none', () => {
    const v = view((c) => {
      const s = c.signals.find((x) => x.signal === 'llms_txt')!;
      Object.assign(s, { state: 'indeterminate', evidence: 'not requested' });
    });
    expect(signals(v).body).toContain('not requested.');
  });

  it('a check that read no page counts what it tested', () => {
    expect(signals(refusedWithPeriods).pill.label).toBe('0 found, 1 of 7 tested');
  });

  it('says Not tested when nothing was', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
      c.signals = [];
    });
    expect(signals(v).pill.label).toBe('Not tested');
  });

  it('groups evidence that differs only by its full stop', () => {
    const v = view((c) => {
      c.signals = (['llms_txt', 'mcp_server_card'] as const).map((signal, i) => ({
        signal,
        state: 'indeterminate',
        evidence: i ? 'not requested' : 'not requested.',
        counts_toward_grade: false,
        recommendation_class: 'experimental',
      })) as Check['signals'];
    });
    expect(signals(v).body.match(/not requested/g)).toHaveLength(1);
  });

  it('a check that read pages keeps its count', () => {
    expect(signals(view()).pill.label).toMatch(/^\d of 7 present$/);
  });
});

describe('the crawler table’s Status', () => {
  const statusOf = (ua: string, fields: Partial<Check['crawlers'][number]>) => {
    const v = view((c) => {
      Object.assign(c.crawlers.find((x) => x.ua === ua)!, fields);
    });
    return v.crawlers!.find((r) => r.ua === ua)!.status;
  };

  it('a crawler with no measurement says so', () => {
    expect(statusOf('GPTBot', { status: null, verdict: 'not_measured' })).toBe('not measured');
  });

  it('a verdict read from robots.txt still names it', () => {
    expect(statusOf('Googlebot', { status: null, verdict: 'allowed' })).toBe('robots.txt');
  });

  it('a measured status is shown, whatever the verdict', () => {
    expect(statusOf('GPTBot', { status: 403, verdict: 'not_measured' })).toBe('403');
  });
});

describe('the competitor card', () => {
  it('is not offered on a check where nothing was served', () => {
    expect(html(answered(429, true))).not.toContain(COMPETITOR);
    expect(html(answered(500, true))).not.toContain(COMPETITOR);
  });

  it('is not offered on an audit already kept: its button says Keep', () => {
    const v = view(keep);
    expect(v.keptUntil).toBeNull();
    expect(html(v)).not.toContain(COMPETITOR);
  });

  it('is still offered on a served audit nobody has kept', () => {
    const v = view(() => {}, true);
    expect(v.keptUntil).not.toBeNull();
    expect(html(v)).toContain(COMPETITOR);
  });
});
