'use client';

import { useState } from 'react';
import type { ActionPacket } from '@crawlmouse/types';
import { trackRaw } from '@/lib/analytics';
import { Button } from '../ui/Button';
import { actionPacketClipboardText } from './result-logic';

// The copy control. The text written to the clipboard is the pure, unit-tested
// actionPacketClipboardText(packet) — the EXACT packet body (U7), no transformation, no injection.
export function ActionPacketCopy({ packet, fixId }: { packet: ActionPacket; fixId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(actionPacketClipboardText(packet));
      setCopied(true);
      trackRaw('action_packet_copied', { fixId });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable / permission denied — leave the label unchanged.
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={packet.copyLabel}>
      {copied ? 'Copied ✓' : packet.copyLabel}
    </Button>
  );
}
