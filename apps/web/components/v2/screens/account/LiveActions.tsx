'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the account screens under it act. A preview renders without it, so its forms stay inert
 * and the fields and controls only a live page offers stay out (`ActionControl`, `ThemeControl`);
 * a page served from a signed-in account wraps its screen in it.
 */
const Live = createContext(false);

export function LiveActions({ children }: { children: ReactNode }) {
  return <Live.Provider value>{children}</Live.Provider>;
}

export const useLive = (): boolean => useContext(Live);
