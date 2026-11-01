'use client';

import dynamic from 'next/dynamic';
import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { StatusPill } from '../../StatusPill';
import { VerdictCell } from '../../VerdictCell';
import type { LinkMapView, PageDetails } from '../../../../lib/v2/view/link-map';
import { ExplorerSvg } from './ExplorerSvg';
import { EXPLORER_KEYS } from './keys';
import { viewport, ZOOMS } from './viewport';
import layout from '../../layout.module.css';
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

export type ExplorerData = Omit<LinkMapView, 'frame' | 'keep'>;

const KIND_WORDS = { page: 'page', orphan: 'orphan', js_only: 'JavaScript-only' } as const;

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
        <div className={styles.path} tabIndex={-1} id="v2-map-selected">
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
                            <VerdictCell verdict={r.verdict} evidence={r.evidence} />{' '}
                            <span className={layout.mut}>{r.words}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {details.access.note ? (
                    <p className={styles.note}>{details.access.note}</p>
                  ) : null}
                </>
              ) : null}
              {details.fix ? (
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
  const list = useRef<HTMLDivElement>(null);

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
      const n = byPath.get(path)!;
      const d = data.details[path];
      setSaid(
        d
          ? `${path}: ${d.pills.map((p) => p.label).join(', ')}, ${d.facts[0]!.value} links in.`
          : `${path}: ${n.depth === null ? KIND_WORDS[n.kind] : `depth ${n.depth}`}.`,
      );
      document
        .getElementById(`v2-map-option-${index.get(path)}`)
        ?.scrollIntoView({ block: 'nearest' });
    },
    [byPath, data.details, index],
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
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
      setSaid(`${all} of ${data.order.length} pages match; ${hit} is selected.`);
    } else {
      setSaid(`No page on this map matches “${q.trim()}”.`);
    }
  };

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
                  setSaid(on ? f.note : 'Every page is shown.');
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
        <Card className={styles.stage}>
          <div className={styles.mapArea}>
            <ScrollRegion label="Link map" className={structure.mapScroll}>
              <div className={styles.frame}>
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
            <span className={layout.row}>
              <span className={structure.keyTriangle} />
              JavaScript-only
            </span>
            <span className={layout.row}>
              <span className={structure.keySquare} />
              orphan
            </span>
            <span className={layout.row}>
              <span className={structure.keyDash} />
              JavaScript-only link
            </span>
            <span className={layout.row}>
              <span className={styles.keyRing} />
              selected
            </span>
            <div className={`${layout.row} ${styles.zoom}`} role="group" aria-label="Zoom">
              <Button
                variant="quiet"
                size="sm"
                ariaLabel="Zoom in"
                onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))}
              >
                +
              </Button>
              <Button
                variant="quiet"
                size="sm"
                ariaLabel="Zoom out"
                onClick={() => setZoom(Math.max(0, zoom - 1))}
              >
                {/* A drawn bar, not the U+2212 the lock types: axe reads that as a non-text
                    character whose contrast it cannot decide. The button's name is its label. */}
                <span className={styles.minus} aria-hidden="true" />
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setZoom(0)}>
                Fit
              </Button>
            </div>
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
    </>
  );
}
