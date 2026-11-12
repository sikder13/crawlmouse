'use client';

import { Button } from '../../Button';
import type { FrameworkOption } from '../../../../lib/v2/view/fix';
import { usePacketChoice } from './PacketChoice';
import layout from '../../layout.module.css';
import styles from './FixScreen.module.css';

/** What a choice says, in the switch's status region. */
export const switchedTo = (o: FrameworkOption) =>
  `The packet now shows the steps written for ${o.key === 'generic' ? 'any stack' : o.label}.`;

/**
 * The front-end switch: one pressed toggle per framework the packet holds a body for, the packet's
 * own first and pressed until another is chosen. Choosing one shows that body in the packet card
 * (`ChosenPacket`) and says so in a status region, so the change is read out; focus stays on the
 * toggle.
 */
export function FrameworkSwitch({ options }: { options: FrameworkOption[] }) {
  const { chosen, choose } = usePacketChoice();
  const shown = options.find((o) => o.key === chosen) ?? options[0]!;
  return (
    <>
      <div className={`${layout.row} ${styles.switch}`} role="group" aria-label="Front end">
        {options.map((o) => (
          <Button
            key={o.key}
            variant="quiet"
            size="sm"
            pressed={o.key === shown.key}
            className={o.key === shown.key ? styles.switchOn : undefined}
            onClick={() => choose(o.key)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      <p role="status" className={styles.switchNote}>
        {chosen === null ? '' : switchedTo(shown)}
      </p>
    </>
  );
}
