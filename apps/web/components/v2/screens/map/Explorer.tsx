'use client';

import dynamic from 'next/dynamic';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { StatusPill } from '../../StatusPill';
import { VerdictCell } from '../../VerdictCell';
import type { LinkMapView, PageDetails } from '../../../../lib/v2/view/link-map';
import { KeepBar } from '../result/KeepBar';
import { ExplorerSvg } from './ExplorerSvg';
import { EXPLORER_KEYS } from './keys';
import { viewport, ZOOMS } from './viewport';
import layout from '../../layout.module.css';
import segment from '../segment/SegmentScreen.module.css';
import structure from '../segment/StructureScreen.module.css';
import styles from './Explorer.module.css';

/**
 * The canvas renderer, loaded only when a map is too large for SVG. `ssr: false` keeps it out of
 * the server render and its chunk off every page that does not draw one (tests/visual).
 */
const ExplorerCanvas = dynamic(() => import('./ExplorerCanvas'), {
  ssr: false,
  loading: () => <div className={styles.canvas} />,
});

export type ExplorerData = LinkMapView;

const KIND_WORDS = { page: 'page', orphan: 'orphan', js_only: 'JavaScript-only' } as const;

/** How long the selection rests before the status line speaks. */
const SAY_AFTER_MS = 250;

/**
 * One page in the list the keyboard walks. Memoised on its own values, so moving the selection
 * renders the two options that change, not all of a 2,000-page map's.
 */
const Option = memo(function Option({
  index,
  node,
  selected,
  shown,
  onPick,
}: {
  /** The list is shown ("List view"); otherwise only assistive technology reads its options. */
  shown: boolean;
  index: number;
  node: ExplorerData['nodes'][number];
  selected: boolean;
  onPick: (path: string) => void;
}) {
  return (
    <div
      id={`v2-map-option-${index}`}
      role="option"
      aria-selected={selected}
      className={shown ? styles.option : styles.optionHidden}
      onClick={() => onPick(node.path)}
    >
      {node.path}
      <span className={layout.mut}>
        {' '}
        · {node.depth === null ? KIND_WORDS[node.kind] : `depth ${node.depth}`}
        {node.kind === 'js_only' && node.depth !== null ? ', JavaScript-only' : ''}
      </span>
    </div>
  );
});

/** Items two to a line. */
function pairs<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  xs.forEach((x, i) => (i % 2 ? out[out.length - 1]!.push(x) : out.push([x])));
  return out;
}

/** What the panel says of the selected page: its record, or that the record does not hold it. */
function Panel({
  path,
  details,
  reduced,
  depth,
  kind,
}: {
  path: string;
  details: PageDetails | undefined;
  reduced: string;
  depth: number | null;
  kind: keyof typeof KIND_WORDS;
}) {
  const pills = details?.pills ?? [
    { state: 'neutral' as const, label: depth === null ? KIND_WORDS[kind] : `depth ${depth}` },
    ...(kind === 'js_only' && depth !== null
      ? [{ state: 'warn' as const, label: 'JavaScript-only' }]
      : []),
  ];
  return (
    <>
      <div className={styles.hd}>
        <div className={styles.small} id="v2-map-selected-label">
          Selected
        </div>
        <div
          className={styles.path}
          tabIndex={-1}
          id="v2-map-selected"
          // A group may be named; a bare div may not (axe aria-prohibited-attr).
          role="group"
          aria-labelledby="v2-map-selected-label v2-map-selected"
        >
          {path}
        </div>
        <div className={`${layout.row} ${styles.pills}`}>
          {pills.map((p) => (
            <StatusPill key={p.label} state={p.state}>
              {p.label}
            </StatusPill>
          ))}
        </div>
      </div>
      {details ? (
        <>
          <table aria-label="Page facts" className={styles.facts}>
            <tbody>
              {details.facts.map((f) => (
                <tr key={f.label}>
                  <th scope="row">{f.label}</th>
                  <td className={styles.num}>{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.block}>
            <div className={styles.small}>{details.linkedFrom.heading}</div>
            <ul className={styles.lines}>
              {details.linkedFrom.lines.map((l) => (
                <li key={`${l.path}${l.anchor}`}>
                  {l.path} · &quot;{l.anchor}&quot;{' '}
                  {l.generic ? <StatusPill state="warn">generic</StatusPill> : null}
                </li>
              ))}
              {details.linkedFrom.more ? (
                <li className={layout.mut}>{details.linkedFrom.more}</li>
              ) : null}
            </ul>
          </div>
          <div className={styles.block}>
            <div className={styles.small}>{details.linksTo.heading}</div>
            <p className={styles.mono}>
              {/* Two to a line, as the locked panel sets them. */}
              {pairs([
                ...details.linksTo.paths,
                ...(details.linksTo.more ? [details.linksTo.more] : []),
              ]).map((pair, i) => (
                <span key={pair.join()}>
                  {i ? <br /> : null}
                  {pair.join(' · ')}
                </span>
              ))}
            </p>
          </div>
          {details.access || details.fix ? (
            <div className={`${styles.block} ${styles.last}`}>
              {details.access ? (
                <>
                  <div className={styles.small}>{details.access.heading}</div>
                  <table aria-label={`Crawler access for ${path}`} className={styles.access}>
                    <tbody>
                      {details.access.rows.map((r) => (
                        <tr key={r.ua}>
                          <td>{r.ua}</td>
                          <td className={styles.num}>
                            <VerdictCell
                              verdict={r.verdict}
                              evidence={r.evidence}
                              qualifier={r.qualifier ?? undefined}
                            />
                            {r.words ? (
                              <span className={layout.mut}>
                                {r.qualifier ? ' · ' : ' '}
                                {r.words}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {details.access.note ? (
                    <p className={styles.note} data-v2-addition="">
                      {details.access.note}
                    </p>
                  ) : null}
                  {details.access.tagged ? (
                    <p className={styles.note}>{details.access.tagged}</p>
                  ) : null}
                </>
              ) : null}
              {details.fix ? (
                // The selected page's fix is the page's orange element (DESIGN-LOCK: the fix link).
                <Button variant="primary" href={details.fix.href} className={styles.fix}>
                  {details.fix.label}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className={`${styles.block} ${styles.note}`}>{reduced}</p>
      )}
    </>
  );
}

/**
 * The link-map explorer's body: find, filters and the list view; the map; the selected page.
 *
 * The keyboard model is a listbox over every drawn page, in `order` (depth, then path): it holds
 * the focus, the arrow keys move the selection, Home and End go to the ends, and Enter moves the
 * focus to the selected page's details. The map draws a ring on the selected page, and a polite
 * status line says which page it is. The list is visually hidden until "List view" shows it.
 */
export function Explorer({ data }: { data: ExplorerData }) {
  const [selected, setSelected] = useState(data.initial);
  const [filter, setFilter] = useState<string | null>(null);
  const [listView, setListView] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [query, setQuery] = useState('');
  const [said, setSaid] = useState('');
  const [missed, setMissed] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const saying = useRef<number | undefined>(undefined);

  /**
   * Say `words` in the status line once the selection rests: held-down arrows repeat about 30
   * times a second, and each step would otherwise queue an announcement.
   */
  const say = useCallback((words: string) => {
    window.clearTimeout(saying.current);
    saying.current = window.setTimeout(() => setSaid(words), SAY_AFTER_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(saying.current), []);

  const byPath = useMemo(() => new Map(data.nodes.map((n) => [n.path, n])), [data.nodes]);
  const index = useMemo(() => new Map(data.order.map((p, i) => [p, i])), [data.order]);
  const highlight = useMemo(() => {
    const f = data.filters.find((x) => x.key === filter);
    return f ? new Set(f.ids) : null;
  }, [data.filters, filter]);
  const node = byPath.get(selected)!;
  const view = useMemo(() => viewport(ZOOMS[zoom]!, node), [zoom, node]);

  const select = useCallback(
    (path: string) => {
      setSelected(path);
      // The option itself is read as the selection moves (its path and depth); the status line
      // adds only what the option does not say, from the page's record. A page with no record
      // clears it at once, so what was said of the page before is not left standing.
      const d = data.details[path];
      if (d) {
        const pills = d.pills.filter((p) => !p.label.startsWith('depth ')).map((p) => p.label);
        say([...pills, `${d.facts[0]!.value} links in`].join(', ') + '.');
      } else {
        window.clearTimeout(saying.current);
        setSaid('');
      }
      document
        .getElementById(`v2-map-option-${index.get(path)}`)
        ?.scrollIntoView({ block: 'nearest' });
    },
    [data.details, index, say],
  );

  // Where the stage scrolls sideways (a phone, or a zoomed page), bring the selected page into view.
  useEffect(() => {
    const box = frame.current;
    const scroller = box?.parentElement;
    if (!box || !scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const x = ((node.x - view.x) / view.w) * box.clientWidth;
    const margin = 40;
    if (
      x < scroller.scrollLeft + margin ||
      x > scroller.scrollLeft + scroller.clientWidth - margin
    ) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    }
  }, [node, view]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // A key with a modifier is the browser's or the reader's (Alt+ArrowLeft is Back).
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const move = EXPLORER_KEYS.find((k) => k.key === e.key)?.move;
    if (!move) return;
    e.preventDefault();
    if (move === 'details') {
      document.getElementById('v2-map-selected')?.focus();
      return;
    }
    const at = index.get(selected) ?? 0;
    const last = data.order.length - 1;
    const to = { next: at + 1, previous: at - 1, first: 0, last }[move];
    select(data.order[Math.min(last, Math.max(0, to))]!);
  };

  const find = (q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return;
    const hit = data.order.find((p) => p.toLowerCase().includes(term));
    if (hit) {
      select(hit);
      const all = data.order.filter((p) => p.toLowerCase().includes(term)).length;
      setMissed(null);
      say(`${all} of ${data.order.length} pages match; ${hit} is selected.`);
    } else {
      const words = `No page on this map matches “${q.trim()}”.`;
      setMissed(words);
      say(words);
    }
  };

  const zoomGroup = useRef<HTMLDivElement>(null);
  const zoomTo = (z: number) => {
    const to = Math.min(ZOOMS.length - 1, Math.max(0, z));
    setZoom(to);
    say(to === 0 ? 'The whole map.' : `Zoomed ${ZOOMS[to]} times, on ${selected}.`);
  };
  // A zoom button that disables itself (Fit, or either end) would drop the keyboard's focus to
  // the page: hand it to the group's next enabled button instead. A layout effect runs before the
  // browser moves the focus off a disabled button, however the zoom was changed.
  useLayoutEffect(() => {
    const group = zoomGroup.current;
    const focused = document.activeElement;
    if (!group || !(focused instanceof HTMLButtonElement) || !group.contains(focused)) return;
    if (focused.disabled) group.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [zoom]);

  // One orange element, the reader's best action for the page selected (DESIGN-LOCK orange
  // convention): its fix link; with none, keeping the map; with no keep bar, the fixes it leads to.
  const orange: 'fix' | 'keep' | 'next' = data.details[selected]?.fix
    ? 'fix'
    : data.keep && data.frame.keptUntil
      ? 'keep'
      : 'next';

  const Stage = data.renderer === 'canvas' ? ExplorerCanvas : ExplorerSvg;
  return (
    <>
      <section className={`${layout.row} ${styles.top}`}>
        <div>
          <Heading level={1} size="m">
            {data.title}
          </Heading>
          <div className={styles.caption}>{data.caption}</div>
        </div>
        <div className={`${layout.row} ${styles.controls}`}>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              find(query);
            }}
          >
            <label htmlFor="v2-map-find" className={layout.srOnly} data-v2-sr-only="">
              Find a page
            </label>
            <input
              id="v2-map-find"
              className={styles.find}
              type="search"
              placeholder="Find a page, e.g. /products/ridge"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {/* Shown as well as said: the status line is for assistive technology only. */}
            {missed ? (
              <p className={styles.missed} aria-hidden="true" data-v2-addition="">
                {missed}
              </p>
            ) : null}
          </form>
          <div className={`${layout.row} ${styles.filters}`} role="group" aria-label="Show only">
            {data.filters.map((f) => (
              <Button
                key={f.key}
                variant="quiet"
                size="sm"
                pressed={filter === f.key}
                onClick={() => {
                  const on = filter !== f.key;
                  setFilter(on ? f.key : null);
                  say(on ? f.note : 'Every page is shown.');
                }}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Button
            variant="quiet"
            size="sm"
            pressed={listView}
            onClick={() => setListView(!listView)}
          >
            List view
          </Button>
          {data.explore ? (
            <span data-v2-addition="">
              <Button variant="quiet" size="sm" href={data.explore.href}>
                {data.explore.label}
              </Button>
            </span>
          ) : null}
        </div>
      </section>

      <section className={`${layout.row} ${styles.body}`}>
        <Card className={listView ? `${styles.stage} ${styles.listOn}` : styles.stage}>
          <div className={styles.mapArea}>
            <ScrollRegion label="Link map" className={structure.mapScroll}>
              <div className={styles.frame} ref={frame}>
                <Stage
                  nodes={data.nodes}
                  selected={selected}
                  highlight={highlight}
                  view={view}
                  onSelect={select}
                />
              </div>
            </ScrollRegion>
            <div
              ref={list}
              role="listbox"
              tabIndex={0}
              aria-label={data.label}
              aria-activedescendant={`v2-map-option-${index.get(selected)}`}
              className={listView ? styles.list : styles.overlay}
              onKeyDown={onKey}
              data-v2-map-list=""
              data-v2-sr-only={listView ? undefined : ''}
            >
              {data.order.map((p, i) => (
                <Option
                  key={p}
                  index={i}
                  node={byPath.get(p)!}
                  selected={p === selected}
                  shown={listView}
                  onPick={select}
                />
              ))}
            </div>
          </div>
          <div className={`${layout.row} ${structure.legend} ${styles.legend}`}>
            <span className={layout.row}>
              <span className={structure.keyDot} />
              page
            </span>
            {data.legend.jsOnly ? (
              <span className={layout.row}>
                <span className={structure.keyTriangle} />
                JavaScript-only
              </span>
            ) : null}
            {data.legend.orphans ? (
              <span className={layout.row}>
                <span className={structure.keySquare} />
                orphan
              </span>
            ) : null}
            {data.legend.jsLinks ? (
              <span className={layout.row}>
                <span className={structure.keyDash} />
                JavaScript-only link
              </span>
            ) : null}
            <span className={layout.row}>
              <span className={styles.keyRing} />
              selected
            </span>
          </div>
          <div
            ref={zoomGroup}
            className={`${layout.row} ${styles.zoom}`}
            role="group"
            aria-label="Zoom"
          >
            <Button
              variant="quiet"
              size="sm"
              ariaLabel="Zoom in"
              disabled={zoom === ZOOMS.length - 1}
              onClick={() => zoomTo(zoom + 1)}
            >
              +
            </Button>
            <Button
              variant="quiet"
              size="sm"
              ariaLabel="Zoom out"
              disabled={zoom === 0}
              onClick={() => zoomTo(zoom - 1)}
            >
              {/* A drawn bar, not the U+2212 the lock types: axe reads that as a non-text
                      character whose contrast it cannot decide. The button's name is its label. */}
              <span className={styles.minus} aria-hidden="true" />
            </Button>
            <Button variant="quiet" size="sm" disabled={zoom === 0} onClick={() => zoomTo(0)}>
              Fit
            </Button>
          </div>
        </Card>

        <Card as="section" className={styles.side} aria-label="The selected page">
          <Panel
            path={selected}
            details={data.details[selected]}
            reduced={data.reduced}
            depth={node.depth}
            kind={node.kind}
          />
        </Card>
      </section>
      <p role="status" className={layout.srOnly} data-v2-sr-only="">
        {said}
      </p>
      {data.keep && data.frame.keptUntil ? (
        <KeepBar
          domain={data.frame.domain}
          expires={data.frame.keptUntil}
          inline={{ ...data.keep, primary: orange === 'keep' }}
        />
      ) : null}
      <div className={`${layout.row} ${segment.nav}`}>
        <Button variant="quiet" href={data.frame.back.href}>
          {data.frame.back.label}
        </Button>
        <Button variant={orange === 'next' ? 'primary' : 'default'} href={data.frame.next.href}>
          {data.frame.next.label}
        </Button>
      </div>
    </>
  );
}
