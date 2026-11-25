'use client';

import { useEffect } from 'react';
import { applyTheme, storedTheme } from './theme-apply';
import type { ThemeChoice } from './theme-choices';

/**
 * The signed-in seat's theme on a page outside the account shell (F-292): the result, fix and
 * report pages. It applies what the dashboard's `ThemeControl` applies on mount, this browser's own
 * choice first, else the seat's, and draws nothing.
 */
export function SeatTheme({ theme }: { theme: ThemeChoice }) {
  useEffect(() => {
    applyTheme(storedTheme() ?? theme);
  }, [theme]);
  return null;
}
