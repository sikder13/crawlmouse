'use client';

import { useState } from 'react';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { StatusPill } from '../../StatusPill';
import { VisuallyHidden } from '../../VisuallyHidden';
import type { ContentCell, ContentView } from '../../../../lib/v2/view/segment/content';
import { CopyText } from './CopyText';
import layout from '../../layout.module.css';
import table from '../../Table.module.css';
import { RawBlock } from './SegmentParts';
import styles from './SegmentScreen.module.css';
import own from './ContentScreen.module.css';

type Props = { grid: NonNullable<ContentView['grid']> } & Pick<
  ContentView,
  'initial' | 'noFailing'
>;

/**
 * The quotability checks by section. Each result is a button: selecting it (click, or Enter or
 * Space on a focused button) shows the pages in the record that fail that check there, and the
 * first words a crawler reads of one of them, in a band that announces the change.
 */
export function ContentGrid({ grid, initial, noFailing }: Props) {
  const [selected, setSelected] = useState<string | null>(initial);
  const found = grid.rows
    .flatMap((r) => r.cells.map((c) => (c ? { row: r, c } : null)))
    .find((x) => x?.c.id === selected);

  const cellButton = (label: string, c: ContentCell) => (
    <button
      type="button"
      className={own.select}
      aria-pressed={c.id === selected}
      onClick={() => setSelected(c.id)}
      data-v2-cell={c.id}
    >
      <VisuallyHidden>{`${c.section}, ${label}: `}</VisuallyHidden>
      <StatusPill state={c.state}>{c.text}</StatusPill>
    </button>
  );

  return (
    <>
      <ScrollRegion label="Quotability checks by section" className={table.scroll}>
        <table className={table.table} aria-label="Quotability checks by section">
          <thead>
            <tr>
              <th scope="col">Check</th>
              {grid.columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
              <th scope="col">Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.check}>
                <th scope="row" className={own.check}>
                  {r.label}
                </th>
                {r.cells.map((c, i) =>
                  c ? (
                    <td key={c.id}>{cellButton(r.label, c)}</td>
                  ) : (
                    <td key={i} className={table.mutedCell}>
                      —
                    </td>
                  ),
                )}
                <td className={table.mutedCell}>{r.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {grid.notChecked ? (
        <p className={own.notChecked} data-v2-addition="">
          {grid.notChecked}
        </p>
      ) : null}
      {found ? (
        <div className={styles.evidence} aria-live="polite" data-v2-evidence-band="">
          {found.c.evidence ? (
            <div className={`${layout.row} ${styles.evidenceHead}`}>
              <Heading level={3} size="s" className={styles.evidenceTitle}>
                {found.c.evidence.title}
              </Heading>
              <CopyText text={found.c.evidence.text}>Copy</CopyText>
            </div>
          ) : null}
          <div className={styles.g2}>
            {found.c.evidence ? (
              <RawBlock label="First words, rendered">{found.c.evidence.text}</RawBlock>
            ) : null}
            <div className={own.failingCol} data-v2-addition="">
              {found.c.failing.length ? (
                <>
                  <p className={`${styles.muted} ${styles.small}`}>
                    Pages in this record that fail “{found.row.label}” in the {found.c.section}:
                  </p>
                  <ul className={own.failing}>
                    {found.c.failing.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className={`${styles.muted} ${styles.small}`}>{noFailing}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
