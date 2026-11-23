'use client';

import { useState } from 'react';
import { SITE_COPY } from '../../../../lib/v2/copy/site';
import type { ActionView } from '../../../../lib/v2/view/account-actions';
import type { SitePublicLink } from '../../../../lib/v2/view/site';
import { Button } from '../../Button';
import { ActionControl } from '../account/ActionControl';
import { useLive } from '../account/LiveActions';
import { CopyText } from '../segment/CopyText';

const COPY = SITE_COPY.publicLink;

/** What a refused mint says: the codes with a remedy of their own, and a general sentence. */
function refusal(code: unknown): string {
  if (code === 'auth_required') return COPY.signedOut;
  if (code === 'host_taken_down') return COPY.withdrawn;
  if (code === 'captcha_required' || code === 'captcha_failed') return COPY.capped;
  if (code === 'check_partial' || code === 'check_not_finished') return COPY.notFinished;
  return COPY.failed;
}

/**
 * The site's public link: Copy and Open once there is one, and Create for a seat that may publish
 * (F-123). Creating posts to the guarded mint route, which decides, and the page is then read again.
 */
export function PublicLinkControl({
  link,
  open,
}: {
  link: SitePublicLink;
  open: ActionView | null;
}) {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const create = async (checkId: string) => {
    setBusy(true);
    setSaid('');
    try {
      const res = await fetch('/api/reports/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkId }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      setSaid(refusal(body?.error));
    } catch {
      setSaid(COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {link.url ? <CopyText text={link.url}>{COPY.copy}</CopyText> : null}
      {open ? <ActionControl action={open} variant="quiet" /> : null}
      {link.mintCheckId ? (
        <Button
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={live ? () => void create(link.mintCheckId!) : undefined}
        >
          {link.url ? COPY.update : COPY.create}
        </Button>
      ) : null}
      {said ? <span role="status">{said}</span> : null}
    </>
  );
}
