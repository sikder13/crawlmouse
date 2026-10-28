'use client';

import { Button } from '../../Button';
import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Glyph } from '../../StatusPill';
import { VerdictCell } from '../../VerdictCell';
import { LOG_IN } from '../../footer-links';
import { LiveMap } from '../../map/LiveMap';
import type { Point } from '../../../../lib/v2/map-layout';
import { MOTION } from '../../../../lib/v2/motion';
import type { Playable } from '../../../../lib/v2/player';
import { crawlFrame, type CrawlContext, type CrawlFrame } from '../../../../lib/v2/view/crawl';
import { EmailAsk } from './EmailAsk';
import { Enter, MotionGateProvider } from './motion-context';
import { usePlayback } from './usePlayback';
import layout from '../../layout.module.css';
import styles from './CrawlScreen.module.css';

export interface CrawlScreenProps {
  recording: Playable;
  context: CrawlContext;
  /** Where the replay starts, in milliseconds since the check started. */
  startAt: number;
  autoplay: boolean;
  /** The map at `startAt`, laid out on the server. */
  initialMap: Record<string, Point>;
  /** The grade cards' sentences, written when grading lands. */
  gradeSummaries: [string, string];
  resultHref: string;
}

/**
 * Crawl in progress (Final-Crawl): the replayed stream drives every element. Steps tick, counters
 * count real events, the map grows and settles, the fetch log runs, findings and crawler verdicts
 * land as they are detected, and the grades are revealed once at the end. Then nothing moves.
 */
export function CrawlScreen(props: CrawlScreenProps) {
  return (
    <MotionGateProvider>
      <Crawl {...props} />
    </MotionGateProvider>
  );
}

function Crawl({
  recording,
  context,
  startAt,
  autoplay,
  initialMap,
  gradeSummaries,
  resultHref,
}: CrawlScreenProps) {
  const state = usePlayback(recording, startAt, autoplay);
  const frame = crawlFrame(state, context);
  const testing = state.steps.some((s) => s.phase === 'crawler_tests' && s.state !== 'next');

  return (
    <PageShell
      header="app"
      actions={
        <>
          <Button variant="quiet" size="sm" href="#">
            Cancel this audit
          </Button>
          <Button variant="quiet" size="sm" href={LOG_IN.href}>
            {LOG_IN.label}
          </Button>
        </>
      }
    >
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={`${layout.row} ${styles.titleRow}`}>
          <div>
            <div className={`${layout.mut} ${styles.small}`}>Auditing</div>
            <Heading level={1} size="m">
              {context.domain}
            </Heading>
          </div>
          <div className={`${layout.mut} ${styles.small}`}>
            Usually about two minutes. You can leave this page; the result keeps building.
          </div>
        </section>

        <Card as="section" className={styles.stage}>
          <div className={styles.mapArea}>
            <LiveMap
              nodes={state.nodes}
              initial={initialMap}
              building={!frame.finished}
              className={styles.mapSvg}
            />
            <StatusPanel frame={frame} />
            <div className={`${styles.ov} ${layout.row} ${styles.legend}`}>
              <span className={layout.row}>
                <span className={styles.keyDot} />
                page reached
              </span>
              <span className={layout.row}>
                <span className={styles.keyTriangle} />
                JavaScript-only, found at the end
              </span>
              <span className={layout.row}>
                <span className={styles.keySquare} />
                orphan, found at the end
              </span>
            </div>
            <FetchLog frame={frame} />
          </div>
          {testing ? <VerdictPanel frame={frame} /> : null}
        </Card>

        {frame.grades ? (
          <Enter motion={MOTION.gradeReveal} className={styles.reveal} data-v2-addition="">
            {frame.grades.map((g, i) => (
              <Card key={g.label} className={styles.revealCard}>
                {g.withheld ? (
                  <Grade label={g.label} withheld>
                    {gradeSummaries[i]}
                  </Grade>
                ) : (
                  <Grade label={g.label} letter={g.letter!} score={g.score!} tone={g.tone}>
                    {gradeSummaries[i]}
                  </Grade>
                )}
              </Card>
            ))}
            <Card tone="sunken" className={`${styles.revealCard} ${styles.revealNext}`}>
              <div>
                <div className={`${layout.mut} ${styles.small}`}>{frame.revealLabel}</div>
                <div className={styles.revealTitle}>{frame.outcome}</div>
              </div>
              <Button variant="primary" href={resultHref}>
                See the full result
              </Button>
            </Card>
          </Enter>
        ) : (
          <section className={styles.g2}>
            <EmailAsk />
            <Card className={styles.whileCard}>
              <div className={styles.whileTitle}>While this runs</div>
              <p className={styles.whileBody}>
                Googlebot and Bingbot render JavaScript. GPTBot, ClaudeBot and PerplexityBot
                don&apos;t — they read the raw HTML your server sends. If your product pages are
                built in the browser, those bots get an empty shell. The next step measures exactly
                how much is left.
              </p>
              <Button variant="quiet" size="sm" href="#" className={styles.whileButton}>
                How the grade is calculated
              </Button>
            </Card>
          </section>
        )}
      </main>
    </PageShell>
  );
}

function StatusPanel({ frame }: { frame: CrawlFrame }) {
  const shown = frame.findings.slice(0, FINDINGS_SHOWN);
  const more = frame.findings.length - shown.length;
  return (
    <div className={`${styles.ov} ${styles.status}`}>
      <div className={`${layout.row} ${styles.between}`}>
        <span className={styles.heading}>{frame.heading}</span>
        <span className={`${layout.mono} ${layout.mut}`}>{frame.elapsed}</span>
      </div>
      {frame.bar ? (
        <div
          className={styles.track}
          role="progressbar"
          aria-valuenow={frame.bar.value}
          aria-valuemin={0}
          aria-valuemax={frame.bar.max}
          aria-valuetext={frame.bar.text}
          aria-label="Pages crawled"
        >
          <div
            className={styles.fill}
            style={{ transform: `scaleX(${frame.bar.value / frame.bar.max})` }}
          />
        </div>
      ) : (
        <div className={styles.track} aria-hidden="true">
          <div className={styles.fill} style={{ transform: 'scaleX(1)' }} />
        </div>
      )}
      <div className={`${layout.row} ${styles.between} ${styles.counts}`}>
        <span className={layout.mut}>{frame.pagesText}</span>
        <span className={layout.mut}>{frame.linksText}</span>
      </div>
      <div className={styles.steps} role="list" aria-live="polite">
        {frame.steps.map((s) => (
          <div
            key={s.key}
            className={`${styles.step} ${styles[s.state]}`}
            role="listitem"
            {...(s.state === 'now' ? { 'aria-current': 'step' as const, 'aria-atomic': true } : {})}
          >
            <span className={styles.stw}>
              {s.state === 'done' ? (
                <>
                  <Glyph state="ok" className={styles.stepGlyph} /> done
                </>
              ) : (
                s.state
              )}
            </span>
            {s.label}
          </div>
        ))}
      </div>
      <div className={styles.found} data-v2-addition="">
        <div className={`${layout.row} ${styles.between}`}>
          <span className={styles.foundTitle}>Found so far</span>
          <span className={`${layout.mono} ${layout.mut}`}>{frame.findings.length}</span>
        </div>
        {shown.length ? (
          <ul className={styles.foundList}>
            {shown.map((f) => (
              <Enter key={f.key} as="li" motion={MOTION.finding} className={styles.foundItem}>
                <span className={styles.foundText}>{f.title}</span>
                <span className={`${layout.mono} ${layout.mut}`}>{f.at}</span>
              </Enter>
            ))}
          </ul>
        ) : (
          <div className={`${layout.mut} ${styles.foundEmpty}`}>Nothing yet.</div>
        )}
        {more > 0 ? (
          <div className={`${layout.mut} ${styles.foundEmpty}`}>
            and {more} earlier, all in the result
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The newest findings the strip shows; the count above it says how many there are in all. */
const FINDINGS_SHOWN = 2;

function FetchLog({ frame }: { frame: CrawlFrame }) {
  return (
    <div className={`${styles.ov} ${styles.logPanel}`}>
      <div className={`${layout.mut} ${styles.logHead}`}>{frame.log.heading}</div>
      <div className={styles.log}>
        {frame.log.lines.map((l) => (
          <Enter key={l.key} motion={MOTION.logLine} logLine className={styles.logLine}>
            <span className={styles.logPath}>{l.request}</span>
            <span className={styles.logTail}>
              {l.answer} <span data-v2-addition="">{l.time}</span>
            </span>
          </Enter>
        ))}
      </div>
    </div>
  );
}

function VerdictPanel({ frame }: { frame: CrawlFrame }) {
  return (
    <Enter motion={MOTION.verdict} className={styles.verdicts} data-v2-addition="">
      <div className={`${layout.mut} ${styles.logHead}`}>What each AI crawler gets</div>
      <div role="list">
        {frame.verdicts.map((v) => (
          <div key={v.ua} role="listitem" className={styles.verdictRow}>
            <span className={styles.verdictUa}>
              {v.ua}
              <span className={`${layout.mut} ${styles.scored}`}>
                {v.scored ? 'scored' : 'not scored'}
              </span>
            </span>
            {v.verdict && v.evidence ? (
              <Enter key={v.verdict} as="span" motion={MOTION.verdict}>
                <VerdictCell verdict={v.verdict} evidence={v.evidence} />
              </Enter>
            ) : (
              <span className={`${layout.mut} ${styles.pending}`}>not tested yet</span>
            )}
          </div>
        ))}
      </div>
    </Enter>
  );
}
