/**
 * The three theme choices (DESIGN-LOCK §2: System, Light, Dark; default System). Kept out of
 * ThemeControl's client module so a server component can read the list itself.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
