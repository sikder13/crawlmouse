import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActionPacket } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { AiPacketList } from './AiPacketList';

const packets: ActionPacket[] = [
  { fixId: 'a', format: 'markdown', body: 'First packet body', copyLabel: 'Copy for ChatGPT / Claude' },
  { fixId: 'b', format: 'markdown', body: 'Second packet body', copyLabel: 'Copy for ChatGPT / Claude' },
];

describe('AiPacketList', () => {
  it('renders one copy button per packet and each packet body', () => {
    const html = renderToStaticMarkup(<AiPacketList packets={packets} />);
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    expect(html).toContain('First packet body');
    expect(html).toContain('Second packet body');
  });

  it('A14 — escapes crawled content embedded in a packet body; never emits a live tag', () => {
    const evil: ActionPacket[] = [
      {
        fixId: 'x',
        format: 'markdown',
        body: 'Data: <script>alert(1)</script><img src=x onerror=alert(2)>',
        copyLabel: 'Copy',
      },
    ];
    const html = renderToStaticMarkup(<AiPacketList packets={evil} />);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img ');
  });
});
