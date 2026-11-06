'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
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
 * and is kept in this browser; saving it to the account is the form's job, which a preview stops.
 */
export function ThemeControl({ initial, action }: ThemeControlProps) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const labelId = useId();

  useEffect(() => {
    const kept = stored();
    if (kept) {
      setChoice(kept);
      apply(kept);
    }
  }, []);

  const choose = (next: ThemeChoice) => {
    setChoice(next);
    apply(next);
    try {
      window.localStorage.setItem(STORE, next);
    } catch {
      // private windows and blocked storage: the choice still applies to this page
    }
  };

  return (
    <form
      method="post"
      action={action}
      className={styles.control}
      // Not wired to an account yet: the route is CC-26b's.
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
