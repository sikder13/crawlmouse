'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { PageShell } from '../../PageShell';
import { Glyph } from '../../StatusPill';
import { VerdictCell } from '../../VerdictCell';
import { VisuallyHidden } from '../../VisuallyHidden';
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
  const { state, playing } = usePlayback(recording, startAt, autoplay);
  const frame = crawlFrame(state, context);
  // Whether focus was in the email ask: if the reveal replaces it, focus moves to the reveal.
  const askHadFocus = useRef(false);
  // Once the grades are in, the verdicts and the fetch log leave the map for a row under the reveal.
  const revealed = frame.grades !== null;

  return (
    <PageShell
      header="app"
      actions={
        <>
          {/* Once it has ended there is nothing to cancel, and the result is a long way down a phone. */}
          {frame.cancellable ? (
            <Button variant="quiet" size="sm" href="#">
              Cancel this audit
            </Button>
          ) : (
            <Button variant="quiet" size="sm" href={resultHref}>
              See the result
            </Button>
          )}
          <Button variant="quiet" size="sm" href={LOG_IN.href}>
            {LOG_IN.label}
          </Button>
        </>
      }
    >
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={`${layout.row} ${styles.titleRow}`}>
          <div>
            <div className={`${layout.mut} ${styles.small}`}>{frame.title.eyebrow}</div>
            <Heading level={1} size="m">
              {context.domain}
            </Heading>
          </div>
          <div className={`${layout.mut} ${styles.small}`}>{frame.title.note}</div>
        </section>

        <Card as="section" className={styles.stage}>
          {/* Whether the replay is moving: tests wait on it, the reader sees nothing of it. */}
          <div className={styles.mapArea} data-v2-replay={playing ? 'playing' : 'still'}>
            <LiveMap
              nodes={state.nodes}
              initial={initialMap}
              building={!frame.finished}
              className={styles.mapSvg}
            />
            <StatusPanel frame={frame} />
            <div className={`${styles.ov} ${layout.row} ${styles.legend}`} data-v2-overlay="">
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
            {revealed ? null : <FetchLog frame={frame} placement="over" />}
          </div>
          {revealed ? null : <VerdictPanel frame={frame} placement="over" />}
        </Card>
        {/* The reveal, said once as it lands: it replaces the email ask, which no live region holds. */}
        <span role="status" className={layout.srOnly} data-v2-sr-only="" data-v2-announce="">
          {frame.announcement}
        </span>

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
                <TakesFocus when={askHadFocus} className={`${layout.mut} ${styles.small}`}>
                  {frame.revealLabel}
                </TakesFocus>
                <div className={styles.revealTitle}>{frame.outcome}</div>
              </div>
              <Button variant="primary" href={resultHref}>
                See the full result
              </Button>
            </Card>
          </Enter>
        ) : (
          <section
            className={styles.g2}
            onFocus={() => {
              askHadFocus.current = true;
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) askHadFocus.current = false;
            }}
          >
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

        {/*
          Under the stage: the verdicts on a narrow screen from the start, after the email ask so
          the ask stays near the top; and once the grades are in, the verdicts and the fetch log at
          every width, so nothing is drawn over the finished map.
        */}
        <section
          className={`${styles.after} ${revealed ? styles.afterRevealed : styles.afterRunning}`}
        >
          <VerdictPanel frame={frame} placement="after" />
          {revealed ? <FetchLog frame={frame} placement="after" /> : null}
        </section>
      </main>
    </PageShell>
  );
}

function StatusPanel({ frame }: { frame: CrawlFrame }) {
  const shown = frame.findings.slice(0, FINDINGS_SHOWN);
  const more = frame.findings.length - shown.length;
  return (
    <div className={`${styles.ov} ${styles.status}`} data-v2-overlay="">
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
        // Its place is kept, so nothing below moves when the estimate lands.
        <div className={`${styles.track} ${styles.trackUnknown}`} aria-hidden="true" />
      )}
      <div className={`${layout.row} ${styles.between} ${styles.counts}`}>
        <span className={layout.mut}>{frame.pagesText}</span>
        <span className={layout.mut}>{frame.linksText}</span>
      </div>
      <div className={styles.steps} role="list" aria-live="polite">
        {frame.steps.map((s) => (
          <div
            key={s.key}
            className={s.state === 'next' ? styles.step : `${styles.step} ${styles[s.state]}`}
            role="listitem"
            {...(s.state === 'now' ? { 'aria-current': 'step' as const, 'aria-atomic': true } : {})}
          >
            <span className={styles.stw}>
              <Enter key={s.state} as="span" motion={MOTION.step} className={styles.stwWord}>
                {s.state === 'done' ? (
                  <>
                    <Glyph state="ok" className={styles.stepGlyph} /> done
                  </>
                ) : (
                  s.state
                )}
              </Enter>
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
        <div className={styles.foundBody}>
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
    </div>
  );
}

/**
 * The newest finding: the count above it says how many there are in all, and the line under it how
 * many came before. One keeps the panel short enough to sit above the legend.
 */
const FINDINGS_SHOWN = 1;

/** Where a panel is drawn: over the map, or in the row under the stage. */
type Placement = 'over' | 'after';

function FetchLog({ frame, placement }: { frame: CrawlFrame; placement: Placement }) {
  return (
    <div
      className={placement === 'over' ? `${styles.ov} ${styles.logPanel}` : styles.logAfter}
      {...(placement === 'over' ? { 'data-v2-overlay': '' } : {})}
    >
      <div className={`${layout.mut} ${styles.logHead}`}>{frame.log.heading}</div>
      {/*
        Five fixed slots whose text moves up a slot as a request lands: the boxes never move, so
        the log causes no layout shift. Only the newest line's text fades in.
      */}
      <ScrollRegion label={frame.log.heading} className={styles.log}>
        {frame.log.lines.map((l, slot) => {
          // One visible text node: an element inside the line would move sideways as the path
          // changes. A shortened path is read out whole.
          const shown = `${l.request} ${l.answer} ${l.time}`;
          const text =
            l.request === l.full ? (
              shown
            ) : (
              <>
                <span aria-hidden="true">{shown}</span>
                <VisuallyHidden>{`${l.full} ${l.answer} ${l.time}`}</VisuallyHidden>
              </>
            );
          return (
            <div key={slot} className={styles.logLine}>
              {slot === frame.log.lines.length - 1 ? (
                <Enter
                  key={l.key}
                  as="span"
                  motion={MOTION.logLine}
                  logLine
                  className={styles.logText}
                >
                  {text}
                </Enter>
              ) : (
                <span className={styles.logText}>{text}</span>
              )}
            </div>
          );
        })}
      </ScrollRegion>
    </div>
  );
}

/**
 * The six AI crawlers' verdicts, drawn in one of two places, each shown at its own widths. Over the
 * map's top right from 1024px while the crawl runs (D4), hidden there until the tests begin. Under
 * the stage below 1024px, present from the start with each crawler not yet tested, so nothing
 * below it moves when the tests begin; and there at every width once the grades are in.
 */
function VerdictPanel({ frame, placement }: { frame: CrawlFrame; placement: Placement }) {
  const over = placement === 'over';
  return (
    <div
      className={`${styles.verdicts} ${over ? styles.verdictsOver : styles.verdictsAfter}`}
      data-v2-addition=""
      {...(over ? { 'data-v2-overlay': '' } : {})}
      {...(over && !frame.testsStarted ? { 'data-v2-waiting': '' } : {})}
    >
      <div className={`${layout.mut} ${styles.logHead}`}>What each AI crawler gets</div>
      <div role="list" aria-live="polite">
        {frame.verdicts.map((v) => (
          // A landed verdict is read with its crawler's name, not the pill alone.
          <div key={v.ua} role="listitem" aria-atomic="true" className={styles.verdictRow}>
            <span className={styles.verdictUa}>
              {v.ua}
              <span className={`${layout.mut} ${styles.scored}`}>
                {v.scored ? ' · scored' : ' · not scored'}
              </span>
            </span>
            {v.verdict && v.evidence ? (
              <Enter key={v.verdict} as="span" motion={MOTION.verdict}>
                <VerdictCell verdict={v.verdict} evidence={v.evidence} />
              </Enter>
            ) : (
              <span className={`${layout.mut} ${styles.pending}`}>
                {v.testing ? 'testing' : 'not tested yet'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Text that takes focus as it mounts, if `when` is set then: where focus goes when its place is gone. */
function TakesFocus({
  when,
  className,
  children,
}: {
  when: RefObject<boolean>;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (when.current) ref.current?.focus();
    // Only on mount: it takes focus as it arrives, never later.
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className={className}>
      {children}
    </div>
  );
}
