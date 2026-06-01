'use client';

import { useEffect, useState } from 'react';

/**
 * Render an ISO timestamp in the viewer's local timezone after mount, with a stable,
 * locale-independent fallback (date only) for the server render and first client paint —
 * so there's no hydration mismatch and no "server timezone" leaking to the user.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    setLocal(new Date(iso).toLocaleString());
  }, [iso]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {local ?? iso.slice(0, 10)}
    </time>
  );
}
