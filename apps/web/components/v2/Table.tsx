import type { ReactNode } from 'react';
import { ScrollRegion } from './ScrollRegion';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Table.module.css';

export interface TableColumn {
  header: ReactNode;
  /** Right-aligned with tabular figures (rule 6). */
  numeric?: boolean;
  /** Data in the mono face (rule 4: mono only for real data). */
  mono?: boolean;
  hideOnPhone?: boolean;
  /** Secondary text, in the muted colour. */
  muted?: boolean;
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
  /**
   * The column headers are read by assistive technology but not drawn, for a table the locked
   * screen shows without a header row; each column still has its name. The header row stays in the
   * table's layout, zero height, so every cell keeps its header.
   */
  headersHidden?: boolean;
  /**
   * The first cell of each row names the row (`<th scope="row">`), so a control later in the row is
   * read with the row it acts on.
   */
  rowHeader?: boolean;
  className?: string;
}

/** A table of records that scrolls sideways on a phone rather than squeezing (phone rules). */
export function Table({
  label,
  columns,
  rows,
  heading,
  headersHidden,
  rowHeader,
  className,
}: TableProps) {
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
      c.muted ? styles.mutedCell : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  // A header names the column; it takes the alignment, not the data face or the muted colour.
  const headClass = (c: TableColumn) =>
    [c.numeric ? styles.num : null, c.hideOnPhone ? styles.hideOnPhone : null]
      .filter(Boolean)
      .join(' ') || undefined;
  const numeric = (c: Partial<TableColumn>) => (c.numeric ? { 'data-v2-numeric': '' } : {});

  return (
    <ScrollRegion label={label} className={[styles.scroll, className].filter(Boolean).join(' ')}>
      {heading}
      <table className={styles.table} aria-label={label}>
        <thead className={headersHidden ? styles.hiddenHead : undefined}>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={headClass(c)} {...numeric(c)}>
                {headersHidden ? <VisuallyHidden>{c.header}</VisuallyHidden> : c.header}
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
                const Cell = rowHeader && i === 0 ? 'th' : 'td';
                return (
                  <Cell
                    key={i}
                    {...(Cell === 'th' ? { scope: 'row' } : {})}
                    className={cellClass(col)}
                    {...numeric(col)}
                  >
                    {cell}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
