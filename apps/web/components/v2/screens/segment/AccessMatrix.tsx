'use client';

import { useState } from 'react';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { VerdictCell } from '../../VerdictCell';
import { VisuallyHidden } from '../../VisuallyHidden';
import type { AccessView, MatrixCell } from '../../../../lib/v2/view/segment/access';
import { CopyText } from './CopyText';
import layout from '../../layout.module.css';
import table from '../../Table.module.css';
import { RawBlock } from './SegmentParts';
import styles from './SegmentScreen.module.css';
import own from './AccessScreen.module.css';

type Props = Pick<
  AccessView,
  'columns' | 'groups' | 'evidence' | 'initial' | 'noEvidence' | 'cellWithoutEvidence' | 'footnote'
>;

/**
 * The crawler matrix and its evidence band. Each cell is a button: selecting one (click, or Enter
 * or Space on a focused cell) shows the raw request and response the check kept for it, in a band
 * that announces the change. A cell whose response is not in the record says so.
 */
export function AccessMatrix({
  columns,
  groups,
  evidence,
  initial,
  noEvidence,
  cellWithoutEvidence,
  footnote,
}: Props) {
  const [selected, setSelected] = useState<string | null>(initial);
  const cells = groups.flatMap((g) => g.rows.flatMap((r) => r.cells.map((c) => ({ ua: r.ua, c }))));
  const current = cells.find((x) => x.c.id === selected) ?? null;
  const shown = current?.c.evidenceId ? evidence.find((e) => e.id === current.c.evidenceId) : null;

  const cellButton = (ua: string, c: MatrixCell) => (
    <button
      type="button"
      className={own.cell}
      aria-pressed={c.id === selected}
      onClick={() => setSelected(c.id)}
      data-v2-cell={c.id}
    >
      <VisuallyHidden>{`${ua}, ${c.section}: `}</VisuallyHidden>
      <VerdictCell verdict={c.verdict} evidence={c.evidence} qualifier={c.qualifier} />
      {c.status ? <span className={own.status}>{c.status}</span> : null}
    </button>
  );

  return (
    <>
      <ScrollRegion label="Crawler access matrix" className={table.scroll}>
        <table className={`${table.table} ${own.matrix}`} aria-label="Crawler access matrix">
          <thead>
            <tr>
              <th scope="col">Crawler</th>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
              <th scope="col" className={table.num} data-v2-numeric="">
                Text it can read
              </th>
              <th scope="col">Cause</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.group} data-v2-group={g.group}>
              <tr className={own.groupRow} data-v2-addition="">
                {/* A td, not a th: axe requires a header to head data cells, and this row heads a group. */}
                <td colSpan={columns.length + 3}>
                  <strong className={own.groupTitle}>{g.title}</strong>{' '}
                  <span className={own.groupNote}>· {g.note}</span>
                </td>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.ua} data-v2-crawler={r.ua}>
                  <th scope="row" className={own.ua}>
                    {r.ua}
                  </th>
                  {r.cells.map((c) => (
                    <td key={c.id} colSpan={c.span > 1 ? c.span : undefined}>
                      {cellButton(r.ua, c)}
                    </td>
                  ))}
                  <td className={`${table.num} ${table.mono}`} data-v2-numeric="">
                    {r.text}
                  </td>
                  <td className={r.cause === '—' ? table.mutedCell : undefined}>{r.cause}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </ScrollRegion>
      {footnote ? (
        <p className={styles.footnote} data-v2-addition="">
          {footnote}
        </p>
      ) : null}
      <div id="evidence" className={styles.evidence} aria-live="polite" data-v2-evidence-band="">
        {shown ? (
          <>
            <div className={`${layout.row} ${styles.evidenceHead}`}>
              <Heading level={3} size="s" className={styles.evidenceTitle}>
                {shown.title}{' '}
                {shown.caption ? (
                  <span className={styles.evidenceCaption}>· {shown.caption}</span>
                ) : null}
              </Heading>
              <CopyText text={`${shown.request}\n\n${shown.response}`}>Copy</CopyText>
            </div>
            <div className={styles.g2}>
              <RawBlock label="Request">{shown.request}</RawBlock>
              <RawBlock label="Response">{shown.response}</RawBlock>
            </div>
            {shown.limitations.length ? (
              <ul className={styles.limits} data-v2-addition="">
                {shown.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className={`${styles.small} ${styles.muted}`} data-v2-addition="">
            {noEvidence ?? (current ? cellWithoutEvidence : 'Select a cell to see its evidence.')}
          </p>
        )}
      </div>
    </>
  );
}
