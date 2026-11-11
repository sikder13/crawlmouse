'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { track } from '../../../../lib/analytics';
import { Button, type ButtonProps } from '../../Button';

/**
 * Where a control goes on an audit page that has a route for it. A control named here with no
 * href is not rendered.
 */
export interface AuditLinks {
  /** A public link to the result. */
  share?: string;
  /** Running the audit again. */
  rerun?: string;
  /** Sending a fix to someone by email. */
  emailFix?: string;
  /** What the paid plan includes. */
  pro?: string;
}

/** What a real audit page tells the screens inside it. The previews render with none. */
export interface AuditPage {
  /** The check the page shows: what "Keep it" claims. */
  checkId: string;
  /** How product events name the check (the id itself is the capability to read it). */
  checkRef: string;
  /** Which page this is, as `keep_clicked` reports it. */
  from: 'result' | 'segment' | 'fix' | 'map';
  links: AuditLinks;
}

const AuditPageContext = createContext<AuditPage | null>(null);

export function AuditPageProvider({ page, children }: { page: AuditPage; children: ReactNode }) {
  return <AuditPageContext.Provider value={page}>{children}</AuditPageContext.Provider>;
}

/** The audit page around this component; null in a preview. */
export const useAuditPage = (): AuditPage | null => useContext(AuditPageContext);

/**
 * A control whose destination is one of `AuditLinks`. In a preview it renders as the locked screen
 * shows it, linking nowhere ("#"); on an audit page it links to the page's route for it, and is
 * not rendered when the page has none.
 */
export function AuditLink({ to, ...button }: { to: keyof AuditLinks } & Omit<ButtonProps, 'href'>) {
  const page = useAuditPage();
  const href = page ? page.links[to] : '#';
  return href === undefined ? null : <Button {...button} href={href} />;
}

/**
 * Words about a control of `AuditLinks`. A preview, and an audit page with a route for the control,
 * say `children`; an audit page with no route for it says `otherwise`.
 */
export function AuditLinkWords({
  to,
  otherwise,
  children,
}: {
  to: keyof AuditLinks;
  otherwise: string;
  children: string;
}) {
  const page = useAuditPage();
  return page && page.links[to] === undefined ? otherwise : children;
}

/** Sends one product event when the page it is on mounts. */
export function AuditEvent({
  event,
  props,
}: {
  event: 'result_viewed' | 'fix_opened';
  props: Record<string, string | boolean>;
}) {
  // Once per mount: the props are fixed for a rendered page.
  useEffect(() => {
    track(event, props);
  }, []);
  return null;
}
