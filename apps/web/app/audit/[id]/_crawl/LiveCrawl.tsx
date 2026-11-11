'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LiveCrawlScreen } from '../../../../components/v2/screens/crawl/CrawlScreen';
import type { EmailOutcome } from '../../../../components/v2/screens/crawl/EmailAsk';
import { liveNotices, type CrawlContext } from '../../../../lib/v2/view/crawl';
import { createLiveSource } from './live-source';

/**
 * The crawl screen of a real check: it follows `GET /api/checks/[id]/stream` and draws what the
 * stream says. Nothing is replayed or estimated: while the server refuses the stream the screen
 * keeps the last state it was sent and says so (LiveCrawl.dom.test.tsx, "a retry the server refuses
 * again leaves the last counts on the screen").
 */
export interface LiveCrawlProps {
  checkId: string;
  /** The site's host, as the check's site row holds it. */
  host: string;
  /**
   * The AI crawlers to list while the check runs. The stream carries no verdict, so without them
   * the screen shows no crawler panel.
   */
  crawlers?: CrawlContext['crawlers'];
}

/** What the email ask says of the address on a real check: where it goes in this step. */
export const LIVE_EMAIL_DOES = 'We use that address to send you this result, and for nothing else.';

/** How long after the server refuses a connection the next is tried: doubling, to a minute. */
export const retryDelayMs = (refusals: number): number =>
  Math.min(60_000, 5000 * 2 ** Math.max(0, refusals - 1));

const NO_CRAWLERS: CrawlContext['crawlers'] = [];

export function LiveCrawl({ checkId, host, crawlers = NO_CRAWLERS }: LiveCrawlProps) {
  const router = useRouter();
  // The page is asked again through the latest router, without the stream reopening when it changes.
  const refresh = useRef(() => router.refresh());
  useEffect(() => {
    refresh.current = () => router.refresh();
  }, [router]);
  const source = useMemo(() => createLiveSource({ now: () => performance.now() }), []);
  const [reachable, setReachable] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  const state = useSyncExternalStore(source.subscribe, source.getState, source.getState);

  useEffect(() => {
    let stream: EventSource | null = null;
    let retry: number | undefined;
    let refusals = 0;
    let stopped = false;

    const connect = () => {
      const es = new EventSource(`/api/checks/${checkId}/stream`);
      stream = es;
      // A new EventSource sends no Last-Event-ID, so once the server accepts it the run is sent
      // from its beginning and the screen starts over. Until then, and when the server refuses,
      // what is drawn stays. A later open of the same EventSource is the browser's own reconnect,
      // which sends the last id.
      let first = true;
      es.onopen = () => {
        if (first) source.reset();
        first = false;
        setReachable(true);
      };
      es.onmessage = (e: MessageEvent<string>) => {
        refusals = 0;
        source.receive(e.data, e.lastEventId);
        if (source.getState().ended === null) return;
        // The check is over: the page now answers this URL with the result, or how it failed.
        es.close();
        refresh.current();
      };
      es.onerror = () => {
        source.interrupted();
        // Still connecting: the browser is reconnecting by itself, with its last event id.
        if (es.readyState !== EventSource.CLOSED) return;
        // The server refused. The page is asked again once (the check may be kept, over or gone),
        // and the stream is tried again after a wait.
        es.close();
        if (stopped) return;
        setReachable(false);
        refusals++;
        if (refusals === 1) refresh.current();
        retry = window.setTimeout(connect, retryDelayMs(refusals));
      };
    };
    connect();
    const clock = window.setInterval(() => source.tick(), 1000);
    return () => {
      stopped = true;
      stream?.close();
      window.clearTimeout(retry);
      window.clearInterval(clock);
    };
  }, [checkId, source]);

  const onCancel = useCallback(() => {
    setCancelling(true);
    setCancelFailed(false);
    fetch(`/api/checks/${checkId}/cancel`, { method: 'POST' })
      .then((res) => {
        // 409: it ended before the cancel arrived. Either way the page has something new to show.
        if (res.ok || res.status === 409) refresh.current();
        else setCancelFailed(true);
      })
      .catch(() => setCancelFailed(true))
      .finally(() => setCancelling(false));
  }, [checkId]);

  const sendEmail = useCallback(
    async (email: string): Promise<EmailOutcome> => {
      const res = await fetch(`/api/checks/${checkId}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) return 'stored';
      if (res.status === 409) return 'ended';
      if (res.status === 429) return 'limited';
      return 'failed';
    },
    [checkId],
  );

  const context = useMemo(() => ({ domain: host, crawlers }), [host, crawlers]);
  return (
    <LiveCrawlScreen
      source={source}
      context={context}
      resultHref={`/audit/${checkId}`}
      live={{
        onCancel,
        cancelling,
        sendEmail,
        emailDoes: LIVE_EMAIL_DOES,
        notices: liveNotices(state, { reachable, cancelFailed }),
      }}
    />
  );
}
