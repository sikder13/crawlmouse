import type { ReactNode } from 'react';
import { Button } from '../../Button';
import { CopyText } from './CopyText';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';

/**
 * What a reader does with an open fix's packet, wherever it is shown (a segment's open fix, the fix
 * page): copy it as a prompt, or ask for it to be emailed, which needs an account and so opens the
 * keep bar (`ask`). A page adds its own last actions as children.
 */
export function PacketActions({
  prompt,
  primary,
  ask,
  className,
  children,
}: {
  prompt: string;
  /** The copy button is the page's orange element (FACTS orange convention). */
  primary: boolean;
  ask: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={[layout.row, styles.packetActions, className].filter(Boolean).join(' ')}>
      <CopyText text={prompt} variant={primary ? 'primary' : 'default'} size="md">
        Copy as a prompt for your coding tool
      </CopyText>
      <Button variant="quiet" size="sm" href={ask}>
        Email this fix to my developer
      </Button>
      {children}
    </div>
  );
}
