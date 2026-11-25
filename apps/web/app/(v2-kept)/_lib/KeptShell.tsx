import '../../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import { Button } from '@/components/v2/Button';
import { PageShell } from '@/components/v2/PageShell';
import { LOG_IN, MARKETING_NAV } from '@/components/v2/footer-links';
import { withoutV1Chrome, type V1Layout } from './v1-chrome';
import styles from './KeptShell.module.css';
import toneStyles from './KeptV2Tone.module.css';

/**
 * How the page's own output is coloured. Unset, it keeps v1's colours. `v2` (F-265) reads v1's
 * colour and type classes in v2's tokens (`KeptV2Tone.module.css`): the blog, guides and author
 * pages pass it, so they read as the product they sit in. The markup inside is v1's either way.
 */
export type KeptTone = 'v2';

/**
 * A kept v1 public page in the v2 shell (CC-36 D3): v2's marketing header, with the same nav and
 * Log in button as the v2 home, and v2's footer, around the page's own output. That output sits on
 * the canvas v1's root layout gives it (`app/layout.tsx`: `bg-cream text-ink font-sans
 * antialiased`), so without a `tone` its colours read as they do on v1 in either colour scheme of
 * the shell; with `tone="v2"` they read in v2's tokens, which follow the shell's scheme. In print the shell's header and footer are hidden (`KeptShell.module.css`), as v1's report hid its own.
 */
export function KeptShell({ children, tone }: { children: ReactNode; tone?: KeptTone }) {
  return (
    <div className={styles.kept} data-v2-kept="">
      <PageShell
        nav={MARKETING_NAV}
        actions={
          <Button variant="quiet" href={LOG_IN.href}>
            {LOG_IN.label}
          </Button>
        }
      >
        <div
          className={`flex-1 bg-cream text-ink font-sans antialiased${tone === 'v2' ? ` ${toneStyles.tone}` : ''}`}
          data-v1-content=""
          data-v1-tone={tone}
        >
          {children}
        </div>
      </PageShell>
    </div>
  );
}

/**
 * A v1 page's output in the v2 shell, its own header and footer taken out (`withoutV1Chrome`),
 * coloured by `tone` when one is given.
 */
export function keptPage(page: ReactNode, layouts?: readonly V1Layout[], tone?: KeptTone) {
  return <KeptShell tone={tone}>{withoutV1Chrome(page, layouts)}</KeptShell>;
}
