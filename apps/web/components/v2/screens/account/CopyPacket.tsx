'use client';

import { FixPacketSchema } from '@crawlmouse/types/v2';
import { useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../../Button';
import { VisuallyHidden } from '../../VisuallyHidden';
import { DASHBOARD_COPY } from '../../../../lib/v2/copy/dashboard';
import { packetPrompt } from '../../../../lib/v2/view/packet-prompt';
import styles from './AccountScreen.module.css';

const SAY = DASHBOARD_COPY.copyFix;

/**
 * Copy fix on a live page: fetches the fix's packet (`GET /api/fixes/[id]/packet`) and copies it as
 * the fix page's prompt (`packetPrompt`), saying in a status line what happened: copied, the plan's
 * gate (402), a failed fetch, or a browser that refused the clipboard.
 */
export function CopyPacket({
  href,
  title,
  label,
  context,
  variant,
  size,
}: {
  href: string;
  title: string;
  label: string;
  context: string | null;
  variant: ButtonVariant;
  size: ButtonSize;
}) {
  const [status, setStatus] = useState('');

  const copy = async () => {
    setStatus(SAY.copying);
    let text: string;
    try {
      const res = await fetch(href, { headers: { accept: 'application/json' } });
      if (res.status === 402) return setStatus(SAY.paywall);
      if (!res.ok) return setStatus(SAY.failed);
      const body = (await res.json()) as { packet?: unknown };
      const packet = FixPacketSchema.safeParse(body.packet);
      if (!packet.success) return setStatus(SAY.failed);
      text = packetPrompt({ title }, packet.data);
    } catch {
      return setStatus(SAY.failed);
    }
    try {
      if (!navigator.clipboard) throw new Error('no clipboard API');
      await navigator.clipboard.writeText(text);
      setStatus(SAY.copied);
    } catch {
      setStatus(SAY.blocked);
    }
  };

  return (
    <span className={styles.inlineForm} data-v2-addition="">
      <Button variant={variant} size={size} onClick={() => void copy()}>
        {label}
        {context ? <VisuallyHidden>{` ${context}`}</VisuallyHidden> : null}
      </Button>
      <span role="status">{status}</span>
    </span>
  );
}
