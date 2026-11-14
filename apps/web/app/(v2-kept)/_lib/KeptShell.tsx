import '../../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import { Button } from '@/components/v2/Button';
import { PageShell } from '@/components/v2/PageShell';
import { LOG_IN, MARKETING_NAV } from '@/components/v2/footer-links';
import { withoutV1Chrome, type V1Layout } from './v1-chrome';

/**
 * A kept v1 public page in the v2 shell (CC-36 D3): v2's marketing header, with the same nav and
 * Log in button as the v2 home, and v2's footer, around the page's own output. That output sits on
 * the canvas v1's root layout gives it (`app/layout.tsx`: `bg-cream text-ink font-sans
 * antialiased`), so its colours read as they do on v1 in either colour scheme of the shell.
 */
export function KeptShell({ children }: { children: ReactNode }) {
  return (
    <PageShell
      nav={MARKETING_NAV}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <div className="flex-1 bg-cream text-ink font-sans antialiased" data-v1-content="">
        {children}
      </div>
    </PageShell>
  );
}

/** A v1 page's output in the v2 shell, its own header and footer taken out (`withoutV1Chrome`). */
export function keptPage(page: ReactNode, layouts?: readonly V1Layout[]) {
  return <KeptShell>{withoutV1Chrome(page, layouts)}</KeptShell>;
}
