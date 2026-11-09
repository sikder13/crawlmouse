import type { ReactNode } from 'react';
import { AccountShell } from '../../AccountShell';
import { ThemeControl } from '../../ThemeControl';
import { TrialCard } from '../../TrialCard';
import type { ShellView } from '../../../../lib/v2/view/account-shell';
import { ActionControl } from './ActionControl';

/** An account screen's frame: the rail, its trial card and theme row, then the page. */
export function AccountFrame({
  shell,
  currentIs,
  children,
}: {
  shell: ShellView;
  /** `location` on a page under its rail entry (a site page, under Sites). */
  currentIs?: 'page' | 'location';
  children: ReactNode;
}) {
  const t = shell.trial;
  return (
    <AccountShell
      nav={shell.nav}
      currentIs={currentIs}
      card={
        t ? (
          <TrialCard
            title={t.title}
            left={t.left}
            note={t.note}
            aside={t.billing ? <a href={t.billing.href}>{t.billing.label}</a> : null}
          >
            {t.keep ? <ActionControl action={t.keep} size="md" /> : null}
          </TrialCard>
        ) : null
      }
      theme={<ThemeControl initial={shell.theme} action={shell.themeAction.href} />}
    >
      {children}
    </AccountShell>
  );
}
