import type { ReactNode } from 'react';
import { ScrollRegion } from './ScrollRegion';
import styles from './Table.module.css';

export interface TableColumn {
  header: ReactNode;
  /** Right-aligned with tabular figures (rule 6). */
  numeric?: boolean;
  /** Data in the mono face (rule 4: mono only for real data). */
  mono?: boolean;
  hideOnPhone?: boolean;
}

export interface TableRow {
  key: string;
  cells: ReactNode[];
  /** Shown in the muted colour, e.g. a row that only Pro opens. */
  muted?: boolean;
}

export interface TableProps {
  /** Names the table, and the scroll region when it overflows. */
  label: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** Rendered inside the scroll region, above the table (a heading row with pills). */
  heading?: ReactNode;
  className?: string;
}

/** A table of records that scrolls sideways on a phone rather than squeezing (phone rules). */
export function Table({ label, columns, rows, heading, className }: TableProps) {
  for (const row of rows) {
    if (row.cells.length !== columns.length) {
      throw new Error(
        `Table "${label}": row ${row.key} has ${row.cells.length} cells for ${columns.length} columns`,
      );
    }
  }
  const cellClass = (c: Partial<TableColumn>) =>
    [
      c.numeric ? styles.num : null,
      c.mono ? styles.mono : null,
      c.hideOnPhone ? styles.hideOnPhone : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const numeric = (c: Partial<TableColumn>) => (c.numeric ? { 'data-v2-numeric': '' } : {});

  return (
    <ScrollRegion label={label} className={[styles.scroll, className].filter(Boolean).join(' ')}>
      {heading}
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={cellClass(c)} {...numeric(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={row.muted ? styles.muted : undefined}
              {...(row.muted ? { 'data-v2-muted': '' } : {})}
            >
              {row.cells.map((cell, i) => {
                const col = columns[i] ?? {};
                return (
                  <td key={i} className={cellClass(col)} {...numeric(col)}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
