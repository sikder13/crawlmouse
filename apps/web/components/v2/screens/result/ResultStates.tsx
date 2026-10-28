import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import type { ResultPageView } from '../../../../lib/v2/view/result';
import { ResultShell } from './ResultScreen';
import layout from '../../layout.module.css';
import styles from './ResultScreen.module.css';

type State = Exclude<ResultPageView, { state: 'result' }>;

/**
 * What the Result page shows when there is no finished result to show: while it loads, for an
 * audit that has not run, one that failed, and one that expired. The last three have one orange
 * element, the reader's way forward; loading has none, and no shimmer (rule 10).
 */
export function ResultState({ data }: { data: State }) {
  if (data.state === 'loading') {
    return (
      <ResultShell>
        <section aria-busy="true">
          <p role="status" className={styles.stateLead}>
            Loading the audit…
          </p>
          <div className={styles.g31} aria-hidden="true">
            <Card className={`${styles.gradeCard} ${styles.placeholder}`}>{null}</Card>
            <Card className={`${styles.gradeCard} ${styles.placeholder}`}>{null}</Card>
            <Card tone="sunken" className={`${styles.gradeCard} ${styles.placeholder}`}>
              {null}
            </Card>
          </div>
          <div className={`${styles.g3} ${styles.placeholderDoors}`} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i} className={`${styles.door} ${styles.placeholder}`}>
                {null}
              </Card>
            ))}
          </div>
        </section>
      </ResultShell>
    );
  }
  const body =
    data.state === 'empty'
      ? {
          title: 'This audit has not started yet',
          lines: [
            `It was queued on ${data.queuedAt}. The result appears here once the crawl finishes, usually about two minutes after it starts.`,
          ],
          action: { label: 'Watch the crawl', href: '/v2-preview/screens/crawl' },
        }
      : data.state === 'error'
        ? {
            title: 'This audit stopped before it could grade the site',
            lines: [`What happened: ${data.reason}.`, `It stopped on ${data.failedAt}.`],
            action: { label: 'Re-run, free', href: '#' },
          }
        : {
            title: 'This result has expired',
            lines: [
              `It was crawled on ${data.crawledAt} and nobody kept it, so it was visible until ${data.expiredAt}.`,
              'Re-running it is free and takes about two minutes. One email keeps the next one.',
            ],
            action: { label: 'Re-run, free', href: '#' },
          };
  return (
    // A failed or expired audit can be run again, from the button in its body.
    <ResultShell>
      <section className={styles.state}>
        <div className={`${layout.mono} ${layout.mut}`}>{data.domain}</div>
        <Heading level={1} size="m">
          {body.title}
        </Heading>
        {body.lines.map((l) => (
          <p key={l} className={styles.stateLine}>
            {l}
          </p>
        ))}
        <div>
          <Button variant="primary" href={body.action.href}>
            {body.action.label}
          </Button>
        </div>
      </section>
    </ResultShell>
  );
}
