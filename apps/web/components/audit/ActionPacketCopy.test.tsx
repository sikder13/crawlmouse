import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActionPacket } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { ActionPacketCopy } from './ActionPacketCopy';

const packet: ActionPacket = {
  fixId: 'f1',
  format: 'markdown',
  body: 'BODY',
  copyLabel: 'Copy for ChatGPT / Claude',
};

describe('ActionPacketCopy', () => {
  it('renders an accessible copy button with the copy label', () => {
    const html = renderToStaticMarkup(<ActionPacketCopy packet={packet} fixId="f1" />);
    expect(html).toContain('<button');
    expect(html).toContain('Copy for ChatGPT / Claude');
    expect(html).toContain('aria-label="Copy for ChatGPT / Claude"');
  });
});
