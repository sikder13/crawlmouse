/**
 * How a theme choice reaches the page, shared by `ThemeControl` (the account shell's control) and
 * `SeatTheme` (the signed-in pages outside the shell), so both apply it the same way. Browser only:
 * call these from an effect or an event handler.
 */
import type { ThemeChoice } from './theme-choices';

/** Where this browser keeps its own choice. */
export const THEME_STORE = 'crawlmouse-theme';

/** Light and Dark set `data-theme` on the page; System removes it, so the device decides. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** This browser's own choice, or null when it has none or storage is blocked. */
export function storedTheme(): ThemeChoice | null {
  try {
    const v = window.localStorage.getItem(THEME_STORE);
    return v === 'system' || v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
