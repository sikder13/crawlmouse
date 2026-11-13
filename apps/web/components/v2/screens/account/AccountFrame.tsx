import type { ReactNode } from 'react';
import { AccountShell } from '../../AccountShell';
import { AccountSwitcher } from '../../AccountSwitcher';
import { ThemeControl } from '../../ThemeControl';
import { TrialCard } from '../../TrialCard';
import type { ShellView } from '../../../../lib/v2/view/account-shell';
import { ActionControl } from './ActionControl';

/**
 * An account screen's frame: the rail, its account switcher (for a person with several seats), its
 * trial or plan card and theme row, then the page.
 */
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
  const p = shell.plan;
  return (
    <AccountShell
      nav={shell.nav}
      badge={shell.badge}
      account={shell.switcher ? <AccountSwitcher switcher={shell.switcher} /> : null}
      currentIs={currentIs}
      card={
        p ? (
          <TrialCard
            title={p.title}
            left={p.counts}
            note={p.note}
            aside={p.billing ? <a href={p.billing.href}>{p.billing.label}</a> : null}
          />
        ) : t ? (
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
