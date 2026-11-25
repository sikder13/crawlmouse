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
   * One cell of each row names the row (`<th scope="row">`), so a control later in the row is read
   * with the row it acts on: the first cell, or the cell of the column given (counted from 0) for a
   * table whose first cell does not name its row, such as a rank.
   */
  rowHeader?: boolean | number;
  className?: string;
  /**
   * Shade the edge a wide table continues past (the signed-in app's tables). Off by default, so the
   * public pages' tables render as they did (OPERATING-RULES §13).
   */
  shade?: boolean;
  /**
   * Explicit ARIA roles on the table, its row groups, rows and cells: for a table whose rows a
   * phone lays out as grids, where a browser may drop the table semantics with the layout.
   */
  roles?: boolean;
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
  shade = false,
  roles = false,
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
  const headerColumn = typeof rowHeader === 'number' ? rowHeader : rowHeader ? 0 : null;
  const role = (r: string) => (roles ? { role: r } : {});

  const region = (
    <ScrollRegion
      label={label}
      className={[styles.scroll, className].filter(Boolean).join(' ')}
      edges={shade}
    >
      {heading}
      <table className={styles.table} aria-label={label} {...role('table')}>
        <thead
          className={headersHidden ? styles.hiddenHead : undefined}
          {...(headersHidden ? { 'data-v2-hidden-head': '' } : {})}
          {...role('rowgroup')}
        >
          <tr {...role('row')}>
            {columns.map((c, i) => (
              <th
                key={i}
                scope="col"
                className={headClass(c)}
                {...numeric(c)}
                {...role('columnheader')}
              >
                {headersHidden ? <VisuallyHidden>{c.header}</VisuallyHidden> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody {...role('rowgroup')}>
          {rows.map((row) => (
            <tr
              {...role('row')}
              key={row.key}
              className={row.muted ? styles.muted : undefined}
              {...(row.muted ? { 'data-v2-muted': '' } : {})}
            >
              {row.cells.map((cell, i) => {
                const col = columns[i] ?? {};
                const Cell = i === headerColumn ? 'th' : 'td';
                return (
                  <Cell
                    key={i}
                    {...(Cell === 'th' ? { scope: 'row' } : {})}
                    {...role(Cell === 'th' ? 'rowheader' : 'cell')}
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
  if (!shade) return region;
  // The edge shades are drawn over the region, not behind its text: a background image behind the
  // cells left axe unable to read their contrast (CI run 45600609996). They take no pointer events,
  // so a point's background is read without them; the region marks the ends it can scroll to.
  return (
    <div className={styles.shade}>
      {region}
      <span className={styles.edgeStart} aria-hidden="true" />
      <span className={styles.edgeEnd} aria-hidden="true" />
    </div>
  );
}
