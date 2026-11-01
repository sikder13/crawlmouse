'use client';

import { useState } from 'react';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { StatusPill } from '../../StatusPill';
import { VisuallyHidden } from '../../VisuallyHidden';
import type { NoJsView } from '../../../../lib/v2/view/segment/nojs';
import { CopyText } from './CopyText';
import layout from '../../layout.module.css';
import table from '../../Table.module.css';
import styles from './SegmentScreen.module.css';
import own from './NoJsScreen.module.css';

const FILL = { bad: own.fillBad, warn: own.fillWarn } as Record<string, string | undefined>;

/**
 * The measured pages and their evidence band. Each row's status is a button: selecting it (click,
 * or Enter or Space on a focused button) shows what the server sent beside what a browser shows,
 * in a band that announces the change. A page whose responses are not in the record says so.
 */
export function NoJsTable({
  rows,
  initial,
  missing,
}: Pick<NoJsView, 'rows' | 'initial' | 'missing'>) {
  const [selected, setSelected] = useState<string | null>(initial);
  const row = rows.find((r) => r.id === selected) ?? null;
  const shown = row?.evidence ?? null;

  return (
    <>
      <ScrollRegion label="Text without JavaScript by page" className={table.scroll}>
        <table className={table.table} aria-label="Text without JavaScript by page">
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Section</th>
              <th scope="col" className={table.num} data-v2-numeric="">
                Raw words
              </th>
              <th scope="col" className={table.num} data-v2-numeric="">
                Rendered
              </th>
              <th scope="col" className={table.num} data-v2-numeric="">
                Survives
              </th>
              <th scope="col" className={own.shareCol}>
                <span className={layout.mut}>share</span>
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === selected ? own.selected : undefined}>
                <th scope="row" className={`${own.page} ${table.mono}`}>
                  {r.id === selected ? <strong>{r.path}</strong> : r.path}
                </th>
                <td>{r.section}</td>
                <td className={`${table.num} ${table.mono}`} data-v2-numeric="">
                  {r.raw}
                </td>
                <td className={`${table.num} ${table.mono}`} data-v2-numeric="">
                  {r.rendered}
                </td>
                <td className={`${table.num} ${table.mono}`} data-v2-numeric="">
                  {r.share}
                </td>
                <td className={own.shareCol}>
                  <div className={own.bar}>
                    <i
                      className={`${own.fill} ${FILL[r.status.state] ?? ''}`}
                      style={{ width: `${Math.max(0, Math.min(100, r.percent))}%` }}
                    />
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className={own.select}
                    aria-pressed={r.id === selected}
                    onClick={() => setSelected(r.id)}
                    data-v2-row={r.id}
                  >
                    <VisuallyHidden>{`${r.path}: `}</VisuallyHidden>
                    <StatusPill state={r.status.state}>{r.status.label}</StatusPill>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <div className={styles.evidence} aria-live="polite" data-v2-evidence-band="">
        {shown ? (
          <>
            <div className={`${layout.row} ${styles.evidenceHead}`}>
              <Heading level={3} size="s" className={styles.evidenceTitle}>
                {shown.title} <span className={styles.evidenceCaption}>· {shown.caption}</span>
              </Heading>
              <CopyText text={`${shown.raw}\n\n${shown.rendered}`}>Copy</CopyText>
            </div>
            <div className={styles.g2}>
              <pre className={styles.raw} aria-label="What the server sent">
                {shown.raw}
              </pre>
              <pre className={styles.raw} aria-label="What a browser shows">
                {shown.rendered}
              </pre>
            </div>
          </>
        ) : (
          <p className={`${styles.small} ${styles.muted}`} data-v2-addition="">
            {row ? missing : 'No measured page is in this record to compare.'}
          </p>
        )}
      </div>
    </>
  );
}
