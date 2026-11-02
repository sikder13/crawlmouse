'use client';

import { useState } from 'react';
import { Button } from '../../Button';
import type { FrameworkOption } from '../../../../lib/v2/view/fix';
import layout from '../../layout.module.css';
import styles from './FixScreen.module.css';

/**
 * The front-end switch. The audit holds one packet, written for one framework, so choosing another
 * does not rewrite it: it says there is no packet for that framework yet (the contract has no
 * per-framework bodies). The sentence is a status region, so the change is read out.
 */
export function FrameworkSwitch({ options }: { options: FrameworkOption[] }) {
  const [chosen, setChosen] = useState(options.find((o) => o.current)?.key ?? null);
  const note = options.find((o) => o.key === chosen)?.note ?? '';
  return (
    <>
      <div className={`${layout.row} ${styles.switch}`} role="group" aria-label="Front end">
        {options.map((o) => (
          <Button
            key={o.key}
            variant="quiet"
            size="sm"
            pressed={o.key === chosen}
            className={o.key === chosen ? styles.switchOn : undefined}
            onClick={() => setChosen(o.key)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      <p role="status" className={styles.switchNote}>
        {note}
      </p>
    </>
  );
}
