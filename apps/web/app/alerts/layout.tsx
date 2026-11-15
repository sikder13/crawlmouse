import type { ReactNode } from 'react';
import { IdentifyPersonMount } from '@/components/analytics/IdentifyPersonMount';

// Signed-in pages: the browser is identified as the user (CC-41 D1).
export default function AlertsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <IdentifyPersonMount />
    </>
  );
}
