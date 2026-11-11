'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useLive } from './screens/account/LiveActions';
import { THEME_CHOICES, type ThemeChoice } from './theme-choices';
import styles from './ThemeControl.module.css';

const LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const STORE = 'crawlmouse-theme';

export interface ThemeControlProps {
  /** The signed-in seat's saved theme. */
  initial: ThemeChoice;
  /** Where the choice is saved (PATCH /api/me {theme}); the form names the verb in `_method`. */
  action: string;
}

/** Light and Dark set `data-theme` on the page; System removes it, so the device decides. */
function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

function stored(): ThemeChoice | null {
  try {
    const v = window.localStorage.getItem(STORE);
    return v === 'system' || v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/**
 * System, Light or Dark (DESIGN-LOCK §2: three states, default System). The choice applies at once
 * and is kept in this browser. Under `LiveActions` it is also saved to the seat: sent as JSON with
 * the page staying put, or, without script, by the form itself. A preview saves nothing.
 */
export function ThemeControl({ initial, action }: ThemeControlProps) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const labelId = useId();
  const live = useLive();

  // What it shows pressed is what the page wears: this browser's choice, else the seat's.
  useEffect(() => {
    const kept = stored() ?? initial;
    setChoice(kept);
    apply(kept);
  }, [initial]);

  const choose = (next: ThemeChoice) => {
    setChoice(next);
    apply(next);
    try {
      window.localStorage.setItem(STORE, next);
    } catch {
      // private windows and blocked storage: the choice still applies to this page
    }
    if (live) {
      // A failed save leaves the choice applied here and kept in this browser.
      void fetch(action, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: next }),
      }).catch(() => undefined);
    }
  };

  return (
    <form
      method="post"
      action={action}
      className={styles.control}
      // With script the click saves (above); the form posts only where script does not run.
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      <input type="hidden" name="_method" value="PATCH" />
      <span className={styles.label} id={labelId}>
        Theme
      </span>
      <span className={styles.group} role="group" aria-labelledby={labelId}>
        {THEME_CHOICES.map((c) => (
          <button
            key={c}
            type="submit"
            name="theme"
            value={c}
            className={styles.choice}
            aria-pressed={choice === c}
            onClick={() => choose(c)}
          >
            {LABELS[c]}
          </button>
        ))}
      </span>
    </form>
  );
}
