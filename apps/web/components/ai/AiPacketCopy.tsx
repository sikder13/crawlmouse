'use client';

import { useState } from 'react';
import type { ActionPacket } from '@crawlmouse/types';
import { track } from '@/lib/analytics';
import { Button } from '../ui/Button';
import { actionPacketClipboardText } from '../audit/result-logic';

// PRO — the copy control for a deterministic AI-fix packet. The text written to the clipboard is the pure,
// unit-tested actionPacketClipboardText(packet) — the EXACT engine-sanitized packet body, no transformation.
// Mirrors the SPEC 02 ActionPacketCopy, but fires the AI funnel event.
export function AiPacketCopy({ packet }: { packet: ActionPacket }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(actionPacketClipboardText(packet));
      setCopied(true);
      track('ai_packet_copied', { fixId: packet.fixId });
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
