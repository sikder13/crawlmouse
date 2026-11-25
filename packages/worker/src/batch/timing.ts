import type { BatchTiming } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { Fetcher } from '../fetch/fetcher.js';

/**
 * Each request's time, from asking the fetcher to its answer, for the batch's `timing` (F-247). It
 * says whether a site's pages are slow to answer or held back between requests, which the stored rows
 * could not: `fetch_ms_*` are request times, and `idle_ms_total` is the batch's span from its first
 * request to its last answer less the time at least one request was in flight, so politeness waits,
 * reading and the batch's own work, between requests.
 */
export class RequestTiming {
  private readonly spans: { start: number; end: number }[] = [];

  constructor(private readonly clock: Clock) {}

  wrap(fetcher: Fetcher): Fetcher {
    return async (url, identity, limits) => {
      const start = this.clock.now();
      try {
        return await fetcher(url, identity, limits);
      } finally {
        // A wall clock stepped back during the request would give a negative time: none is under 0.
        this.spans.push({ start, end: Math.max(start, this.clock.now()) });
      }
    };
  }

  summary(): BatchTiming {
    const ms = this.spans.map((s) => s.end - s.start).sort((a, b) => a - b);
    // Nearest rank: the smallest time that at least a share q of the requests took no longer than.
    const at = (q: number) => (ms.length ? ms[Math.max(0, Math.ceil(q * ms.length) - 1)]! : 0);
    const byStart = [...this.spans].sort((a, b) => a.start - b.start);
    let busy = 0;
    let runStart = -Infinity;
    let runEnd = -Infinity;
    for (const s of byStart) {
      if (s.start > runEnd) {
        if (runEnd > runStart) busy += runEnd - runStart;
        runStart = s.start;
        runEnd = s.end;
      } else runEnd = Math.max(runEnd, s.end);
    }
    if (runEnd > runStart) busy += runEnd - runStart;
    const span = byStart.length ? Math.max(...byStart.map((s) => s.end)) - byStart[0]!.start : 0;
    return {
      requests: ms.length,
      fetch_ms_p50: Math.round(at(0.5)),
      fetch_ms_p90: Math.round(at(0.9)),
      fetch_ms_max: Math.round(ms.at(-1) ?? 0),
      fetch_ms_total: Math.round(ms.reduce((a, b) => a + b, 0)),
      idle_ms_total: Math.round(Math.max(0, span - busy)),
    };
  }
}
