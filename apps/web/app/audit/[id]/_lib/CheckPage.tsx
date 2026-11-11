import '../../../../styles/v2/tokens.css';
import { AuditEvent, AuditPageProvider } from '../../../../components/v2/screens/result/AuditPage';
import { ResultScreen } from '../../../../components/v2/screens/result/ResultScreen';
import { AuditNotice } from '../../../../components/v2/screens/result/ResultStates';
import { dateTimeUtc } from '../../../../lib/v2/format';
import type { CheckRead } from '../../../../lib/v2/pipeline/public';
import { partialNotice, resultView } from '../../../../lib/v2/view/result';
import { LiveCrawl } from '../_crawl/LiveCrawl';
import { FAILURE_COPY } from './failure-copy';
import { auditPage, viewOptions, type ReadyCheck } from './page-data';

/** Where a reader of an audit that cannot be read any more starts another. */
const NEW_AUDIT = { label: 'Start a new audit', href: '/' };

/** The result of a ready check, as its overview shows it. */
export function resultOf(read: ReadyCheck) {
  const { hrefs, plan } = viewOptions(read);
  return resultView(read.dataset, read.checkId, {
    map: read.map,
    plan,
    segmentHref: hrefs.segment,
    fixHref: hrefs.fix,
    mapHref: hrefs.map.hubs,
  });
}

/** The lines of the page that stands in for a failed or an expired check. */
export function noticeOf(read: Extract<CheckRead, { state: 'failed' | 'expired' }>) {
  if (read.state === 'failed') {
    return {
      title: 'This audit stopped before it could grade the site',
      lines: [
        `What happened: ${FAILURE_COPY[read.reason]}.`,
        `It stopped on ${dateTimeUtc(read.failedAt)}.`,
      ],
    };
  }
  const until = dateTimeUtc(read.expiredAt);
  return {
    title: 'This result has expired',
    lines: [
      read.finishedAt
        ? `It was crawled on ${dateTimeUtc(read.finishedAt)} and nobody kept it, so it was visible until ${until}.`
        : `Nobody kept this audit, so it was visible until ${until}.`,
      'A new audit is free and takes about two minutes. One email keeps the next one.',
    ],
  };
}

/**
 * A v2 check's overview (CC-22b D4), at `/audit/[id]/overview`: the crawl while it waits or runs,
 * the result once it is graded, and a notice for one that failed or expired.
 */
export function CheckPage({ read }: { read: CheckRead }) {
  if (read.state === 'waiting') return <LiveCrawl checkId={read.checkId} host={read.host} />;
  if (read.state !== 'ready') {
    return <AuditNotice domain={read.host} {...noticeOf(read)} action={NEW_AUDIT} />;
  }
  const data = resultOf(read);
  const page = auditPage(read.checkId, 'result');
  return (
    <AuditPageProvider page={page}>
      <AuditEvent
        event="result_viewed"
        props={{ variant: data.variant, check_ref: page.checkRef }}
      />
      <ResultScreen data={data} notice={partialNotice(read.dataset, read.checkId)} />
    </AuditPageProvider>
  );
}
