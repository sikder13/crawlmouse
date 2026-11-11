/**
 * A site's second check, as recheck.test.ts and watermark.test.ts build it over the recorded site:
 * the recorded crawl renamed to the second check, with one more link (from the homepage to the
 * planted orphan, so its orphan fix resolves), robots.txt's added lines and four empty titles; its
 * access batches left out, so it ends partial and its crawler-access fix is indeterminate.
 * recheck.test.ts's header says what each change exercises.
 */
import type { BuildInput, BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, Fix, FixEvent } from '@crawlmouse/types/v2';
import { recordedBuild } from '../../../../../../packages/engine/fixtures/v2/build/recorded';

export const FIRST = recordedBuild().check.id;
export const SECOND = 'b0000000-0000-4000-8000-0000000000c2';
export const HOME = 'https://built-site.test';
export const ORPHAN = `${HOME}/products/forgotten-lantern`;
/** The recorded edge flagged js_only on the second check. */
export const JS_ONLY_TO = `${HOME}/collections/camp-lighting`;
/** The lines robots.txt gains on the second check. */
export const ROBOTS_ADDED = ['User-agent: ExampleBot', 'Disallow: /'];
/**
 * The pages whose title is empty on the second check. A 200 HTML page with an empty title is a
 * crawlability defect (`lacksTitle`, packages/engine/src/v2/grade/technical-seo.ts).
 */
export const UNTITLED = [1, 2, 3, 4].map((n) => `${HOME}/products/sleeping-bags-item-${n}`);

/**
 * The recorded crawl renamed to the second check, with the homepage's new link, robots.txt's new
 * lines and the empty titles.
 */
export function secondCrawl(): BatchResult[] {
  const renamed = JSON.parse(
    JSON.stringify(recordedBuild().batches).replaceAll(FIRST, SECOND),
  ) as BatchResult[];
  return renamed.flatMap((b): BatchResult[] => {
    if (b.kind !== 'crawl') return [];
    const robots = b.robots.map((r) => {
      if (r.body === null) return r;
      const body = `${r.body}${ROBOTS_ADDED.join('\n')}\n`;
      return { ...r, body, body_excerpt: body };
    });
    const pages = b.pages.map((p) => {
      if (p.url === HOME) {
        // The homepage's links were read in full, so its count can grow by the link added.
        if (!p.links_read) throw new Error('second-check: the homepage links must be read');
        return { ...p, links_out: (p.links_out ?? 0) + 1 };
      }
      if (UNTITLED.includes(p.url)) return { ...p, title: { text: '', chars: 0, cut: false } };
      return p;
    });
    if (!b.pages.some((p) => p.url === HOME)) return [{ ...b, robots, pages }];
    return [
      {
        ...b,
        robots,
        pages,
        link_edges: [
          ...b.link_edges.map((e) =>
            e.from_url === HOME && e.to_url === JS_ONLY_TO ? { ...e, js_only: true } : e,
          ),
          {
            check_id: SECOND,
            from_url: HOME,
            to_url: ORPHAN,
            anchor_text: 'click here',
            is_generic_anchor: true,
            js_only: false,
          },
        ],
      },
    ];
  });
}

/** The second check's times: the recorded ones by default. */
export interface SecondTimes {
  queued_at: string;
  started_at: string;
  finished_at: string;
  expires_at: string;
}

const RECORDED_TIMES: SecondTimes = {
  queued_at: '2026-11-06T10:00:00Z',
  started_at: '2026-11-06T10:00:02Z',
  finished_at: '2026-11-06T10:11:00Z',
  expires_at: '2026-12-06T10:00:00Z',
};

/**
 * The second check's build input: `previous` is the first check with its diff inputs, and the fixes
 * and events are the first check's unless `read` gives the ones the build reads.
 */
export function secondInput(
  first: BuiltCheck,
  times: SecondTimes = RECORDED_TIMES,
  read: { fixes: Fix[]; events: FixEvent[] } = { fixes: first.fixes, events: first.fix_events },
): BuildInput {
  const input = recordedBuild();
  return {
    ...input,
    check: {
      ...input.check,
      id: SECOND,
      previous_check_id: FIRST,
      trigger: 'fix_recheck',
      ...times,
    },
    previous: { check: first.check, ...first.diff_inputs },
    fixes: read.fixes,
    events: read.events,
    batches: secondCrawl(),
    render: null,
    now: times.finished_at,
  };
}
