import type { ReactNode } from 'react';
import layout from '../../layout.module.css';

/**
 * A form's alert or status region. It is rendered from the start and stays in the accessibility
 * tree while empty, visually hidden rather than `display: none`, so a screen reader that has
 * already met the region announces the text that arrives in it. Marked as an addition to the
 * locked screens (`data-v2-addition`).
 */
export function LiveRegion({
  role,
  id,
  className,
  children,
}: {
  role: 'alert' | 'status';
  id?: string;
  /** The region's look once it holds text. */
  className: string | undefined;
  children: ReactNode;
}) {
  const empty =
    children === null || children === undefined || children === false || children === '';
  return (
    <p id={id} role={role} className={empty ? layout.srOnly : className} data-v2-addition="">
      {children}
    </p>
  );
}
