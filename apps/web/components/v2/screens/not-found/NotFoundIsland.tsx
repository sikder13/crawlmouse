'use client';

import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { NOT_FOUND_COPY as COPY } from '@/lib/v2/copy/not-found';

/** What a 404 says before the v2 screen has loaded, and all it says without JavaScript. */
function NotFoundFallback() {
  return (
    <main>
      <h1>{COPY.title}</h1>
      <p>{COPY.lead}</p>
      <a href={COPY.primary.href}>{COPY.primary.label}</a>
    </main>
  );
}

/**
 * The v2 screen, or the plain 404 when its chunk cannot load (a dropped connection, a stale
 * deployment): a rejected load would otherwise replace the 404 with the global error page.
 */
export const loadNotFoundScreen = (
  load: () => Promise<{ NotFoundScreen: ComponentType }> = () => import('./NotFoundScreen'),
): Promise<ComponentType> =>
  load()
    .then((m) => m.NotFoundScreen)
    .catch(() => NotFoundFallback);

const Screen = dynamic(() => loadNotFoundScreen(), {
  ssr: false,
  loading: NotFoundFallback,
});

/**
 * The site's 404 (RC-20). Next serialises the root `not-found` into the payload of every page, so
 * this holds only the words above and a client reference: the shell, its footer and the v2
 * stylesheets load when a 404 is actually shown (measured on a production build, B question 013).
 */
export function NotFoundIsland() {
  return <Screen />;
}
