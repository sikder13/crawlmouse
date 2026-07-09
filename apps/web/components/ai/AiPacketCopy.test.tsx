import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActionPacket } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { AiPacketCopy } from './AiPacketCopy';

const packet: ActionPacket = {
  fixId: 'ai-fix-1',
  format: 'markdown',
  body: 'BODY',
  copyLabel: 'Copy for ChatGPT / Claude',
};

describe('AiPacketCopy', () => {
  it('renders an accessible copy button with the copy label', () => {
    const html = renderToStaticMarkup(<AiPacketCopy packet={packet} />);
    expect(html).toContain('<button');
    expect(html).toContain('Copy for ChatGPT / Claude');
    expect(html).toContain('aria-label="Copy for ChatGPT / Claude"');
  });
});
