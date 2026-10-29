'use client';

import { memo, useEffect, useRef, type ReactNode, type RefObject } from 'react';
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
import {
  LOG_LINES,
  crawlFrame,
  type CrawlContext,
  type CrawlFrame,
} from '../../../../lib/v2/view/crawl';
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
  // From 1024px, as grading begins and the map takes its finished layout, the step panel shrinks to
  // its head (heading, clock, bar, counts) and the log over the map is hidden: hidden, not removed
  // (CrawlScreen.module.css), so nothing moves. The verdicts over the map (from 1200px, drawn out of
  // the flow) are removed and drawn under the email ask, with the full step list and log waiting
  // hidden in their places beside them until the grades are in.
  const offMap = frame.mapComplete;

  return (
    <PageShell
      header="app"
      actions={
        <>
          {/*
            Once it has ended there is nothing to cancel, and the result is a long way down a phone.
            The button keeps one width for both, so the header does not reflow when it changes.
          */}
          <Button variant="quiet" size="sm" href={frame.cancellable ? '#' : resultHref}>
            <OneWidth
              shown={frame.cancellable ? CANCEL : SEE_RESULT}
              labels={[CANCEL, SEE_RESULT]}
            />
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
            <div className={`${layout.mut} ${styles.small}`}>{frame.title.eyebrow}</div>
            <Heading level={1} size="m">
              {context.domain}
            </Heading>
          </div>
          <div className={`${layout.mut} ${styles.small} ${styles.titleNote}`}>
            {frame.title.note}
          </div>
        </section>

        <Card as="section" className={styles.stage}>
          {/* Whether the replay is moving: tests wait on it, the reader sees nothing of it. */}
          <div className={styles.mapArea} data-v2-replay={playing ? 'playing' : 'still'}>
            <LiveMap
              nodes={state.nodes}
              initial={initialMap}
              building={!frame.finished}
              final={!playing || frame.mapComplete}
              complete={frame.mapComplete}
              className={styles.mapSvg}
            />
            <StatusPanel frame={frame} placement="over" offMap={offMap} gone={revealed} />
            <Legend />
            {/* At the end the log leaves the map where it is drawn over it; on a phone it stays. */}
            <FetchLog log={frame.log} placement="over" offMap={offMap} />
          </div>
          {offMap ? null : (
            <VerdictPanel
              verdicts={frame.verdicts}
              testsStarted={frame.testsStarted}
              placement="over"
            />
          )}
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
            <Ask />
            <WhileThisRuns />
          </section>
        )}

        {/*
          The verdicts below 1200px from the start, and from 1200px once grading begins; from 1024px
          the step list and fetch log take their places beside them then, hidden until the grades
          are in, so only the legend is drawn over the finished map. Where each is drawn relative to
          the email ask and the reveal is the stylesheet's (`order`).
        */}
        <section
          className={`${styles.after} ${
            revealed ? styles.afterRevealed : offMap ? styles.afterGrading : styles.afterRunning
          }`}
        >
          {offMap ? (
            <StatusPanel frame={frame} placement="after" offMap waiting={!revealed} />
          ) : null}
          <VerdictPanel
            verdicts={frame.verdicts}
            testsStarted={frame.testsStarted}
            placement="after"
          />
          {offMap ? (
            <FetchLog log={frame.log} placement="after" offMap waiting={!revealed} />
          ) : null}
        </section>
      </main>
    </PageShell>
  );
}

const CANCEL = 'Cancel this audit';
const SEE_RESULT = 'See the result';

/**
 * `shown`, in a box as wide as the widest of `labels`: the others are laid out in the same place,
 * invisible and hidden from assistive technology, so changing the words moves nothing beside them.
 */
function OneWidth({ shown, labels }: { shown: string; labels: readonly string[] }) {
  return (
    <span className={styles.oneWidth}>
      {labels.map((label) =>
        label === shown ? (
          <span key={label}>{label}</span>
        ) : (
          <span key={label} className={styles.widthOnly} aria-hidden="true" data-v2-width-only="">
            {label}
          </span>
        ),
      )}
    </span>
  );
}

/*
 * The parts of the screen that do not change while it plays, each built once: the screen renders
 * on every tick of the clock, and building them again each time costs frames.
 */
const Ask = memo(EmailAsk);

const Legend = memo(function Legend() {
  return (
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
  );
});

const WhileThisRuns = memo(function WhileThisRuns() {
  return (
    <Card className={styles.whileCard}>
      <div className={styles.whileTitle}>While this runs</div>
      <p className={styles.whileBody}>
        Googlebot and Bingbot render JavaScript. GPTBot, ClaudeBot and PerplexityBot don&apos;t —
        they read the raw HTML your server sends. If your product pages are built in the browser,
        those bots get an empty shell. The next step measures exactly how much is left.
      </p>
      <Button variant="quiet" size="sm" href="#" className={styles.whileButton}>
        How the grade is calculated
      </Button>
    </Card>
  );
});

/**
 * The steps, counts and findings. Over the map while the crawl runs; from 1024px, when grading
 * begins (`offMap`), only its head stays over the map, and the whole panel is drawn under the
 * reveal once the grades are in, so the finished map is drawn with nothing over it but the legend.
 * On a narrower screen it is under the map already, and stays.
 */
function StatusPanel({
  frame,
  placement,
  offMap,
  gone = false,
  waiting = false,
}: {
  frame: CrawlFrame;
  placement: Placement;
  offMap: boolean;
  /** The grades are in: over the map, its head goes too. */
  gone?: boolean;
  /** Under the stage while grades are computed: in its place, hidden, until they are in. */
  waiting?: boolean;
}) {
  const shown = frame.findings.slice(0, FINDINGS_SHOWN);
  const more = frame.findings.length - shown.length;
  const over = placement === 'over';
  const where = over
    ? `${styles.ov} ${styles.status} ${offMap ? styles.statusOverRevealed : ''} ${gone ? styles.statusGone : ''}`
    : `${styles.statusAfter} ${waiting ? styles.waiting : ''}`;
  return (
    <div className={where} {...(over && !offMap ? { 'data-v2-overlay': '' } : {})}>
      {/* The head: what the crawl is doing and how far it has got, kept over the map to the end. */}
      <div
        className={styles.statusTop}
        {...(over && offMap && !gone ? { 'data-v2-overlay': '' } : {})}
      >
        <div className={`${layout.row} ${styles.between} ${styles.statusHead}`}>
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
          {/* There from the start, so each finding is read out as it lands. */}
          <ul className={styles.foundList} aria-live="polite">
            {shown.map((f) => (
              <Enter key={f.key} as="li" motion={MOTION.finding} className={styles.foundItem}>
                <span className={styles.foundText}>{f.title}</span>
                <span className={`${layout.mono} ${layout.mut}`}>{f.at}</span>
              </Enter>
            ))}
          </ul>
          {shown.length ? null : (
            <div className={`${layout.mut} ${styles.foundEmpty}`}>Nothing yet.</div>
          )}
          {more > 0 ? (
            <div className={`${layout.mut} ${styles.foundMore}`}>
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

type Log = CrawlFrame['log'];

interface FetchLogProps {
  log: Log;
  placement: Placement;
  /** Grading has begun: over the map the log is drawn only where it is not over the map. */
  offMap: boolean;
  /** Under the stage while grades are computed: in its place, hidden, until they are in. */
  waiting?: boolean;
}

/** Two logs show the same thing: the same heading and the same lines. */
const sameLog = (a: FetchLogProps, b: FetchLogProps) =>
  a.placement === b.placement &&
  a.offMap === b.offMap &&
  a.waiting === b.waiting &&
  a.log.heading === b.log.heading &&
  a.log.lines.length === b.log.lines.length &&
  a.log.lines.every((l, i) => {
    const m = b.log.lines[i]!;
    return l.key === m.key && l.request === m.request && l.answer === m.answer && l.time === m.time;
  });

/**
 * The fetch log: LOG_LINES slots from the start, the empty ones holding their line's height, so
 * the panel keeps one size as requests land. Memoised on what it shows, as the screen renders on
 * every tick of the clock.
 */
const FetchLog = memo(function FetchLog({ log, placement, offMap, waiting }: FetchLogProps) {
  const where =
    placement === 'over'
      ? `${styles.ov} ${styles.logPanel} ${offMap ? styles.logOverRevealed : ''}`
      : `${styles.logAfter} ${waiting ? styles.waiting : ''}`;
  // Over the map until grading begins; after, drawn there only where it is under the map.
  const over = placement === 'over' && !offMap;
  return (
    <div className={where} {...(over ? { 'data-v2-overlay': '' } : {})}>
      <div className={`${layout.mut} ${styles.logHead}`}>{log.heading}</div>
      {/*
        LOG_LINES fixed slots, there from the start, whose text moves up a slot as a request lands:
        the boxes do not move as the log fills. Only the newest line's text fades in.
      */}
      <ScrollRegion label={log.heading} className={styles.log}>
        {Array.from({ length: LOG_LINES }, (_, slot) => {
          const l = log.lines[slot];
          // An empty slot keeps its place and its line's height until a request fills it.
          if (!l) {
            return (
              <div key={slot} className={styles.logLine} aria-hidden="true">
                {'\u00a0'}
              </div>
            );
          }
          // One visible text node at a time: an element inside the line would move sideways as
          // the path changes. A shortened path is read out whole, and shown whole on a phone,
          // where the line wraps rather than being cut. The time's "·" keeps to what it follows.
          const shown = `${l.request} ${l.answer}\u00a0${l.time}`;
          const whole = `${l.full} ${l.answer}\u00a0${l.time}`;
          const text =
            l.request === l.full ? (
              shown
            ) : (
              <>
                <span aria-hidden="true" className={styles.pathCut}>
                  {shown}
                </span>
                <span aria-hidden="true" className={styles.pathWhole}>
                  {whole}
                </span>
                <VisuallyHidden>{whole}</VisuallyHidden>
              </>
            );
          return (
            <div key={slot} className={styles.logLine}>
              {slot === log.lines.length - 1 ? (
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
}, sameLog);

/**
 * The six AI crawlers' verdicts, drawn in one of two places, each shown at its own widths. Over the
 * map's top right from 1200px until grading begins (D4 allows it from 1024px), hidden there until
 * the tests begin. Under the stage below 1200px, present from the start with each crawler not yet
 * tested, so nothing below it moves when the tests begin; and there from 1200px once grading
 * begins.
 */
interface VerdictPanelProps {
  verdicts: CrawlFrame['verdicts'];
  testsStarted: boolean;
  placement: Placement;
}

/** Two panels show the same thing: each crawler at the same stage of its test. */
const sameVerdicts = (a: VerdictPanelProps, b: VerdictPanelProps) =>
  a.placement === b.placement &&
  a.testsStarted === b.testsStarted &&
  a.verdicts.length === b.verdicts.length &&
  a.verdicts.every((v, i) => {
    const w = b.verdicts[i]!;
    return (
      v.ua === w.ua &&
      v.scored === w.scored &&
      v.testing === w.testing &&
      v.verdict === w.verdict &&
      v.evidence === w.evidence
    );
  });

const VerdictPanel = memo(function VerdictPanel({
  verdicts,
  testsStarted,
  placement,
}: VerdictPanelProps) {
  const over = placement === 'over';
  return (
    <div
      className={`${styles.verdicts} ${over ? styles.verdictsOver : styles.verdictsAfter}`}
      data-v2-verdicts={placement}
      data-v2-addition=""
      {...(over ? { 'data-v2-overlay': '' } : {})}
      {...(over && !testsStarted ? { 'data-v2-waiting': '' } : {})}
    >
      <div className={`${layout.mut} ${styles.logHead}`}>What each AI crawler gets</div>
      <div role="list" aria-live="polite">
        {verdicts.map((v) => (
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
}, sameVerdicts);

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
    <div ref={ref} tabIndex={-1} className={`${className ?? ''} ${styles.focusTarget}`}>
      {children}
    </div>
  );
}
