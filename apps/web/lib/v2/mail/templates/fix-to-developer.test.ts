import { describe, expect, it } from 'vitest';
import { fixToDeveloper, PACKET_MAX, TITLE_MAX } from './fix-to-developer';
import { foreignTargets, htmlTargets } from './inspect';

const PACKET = [
  'Let GPTBot read the site',
  '',
  'robots.txt blocks GPTBot from every page.',
  '',
  'Change:',
  'Remove the Disallow: / line under User-agent: GPTBot.',
  '',
  'We will request https://example.com/robots.txt as GPTBot afterwards.',
].join('\n');

const input = {
  host: 'example.com',
  fixTitle: 'Let GPTBot read the site',
  packet: PACKET,
};

describe('fix-to-developer (D2)', () => {
  it('sends the packet as text, names who asked by the site only, and links nothing', () => {
    const m = fixToDeveloper(input);
    expect(m.subject).toBe('A fix for example.com: Let GPTBot read the site');
    expect(m.text).toContain('Someone working on example.com asked Crawlmouse to send you this fix.');
    expect(m.text).toContain(PACKET);
    expect(htmlTargets(m.html)).toEqual([]);
  });

  it('escapes the packet and the title in the HTML, and keeps the packet’s lines', () => {
    const m = fixToDeveloper({
      ...input,
      fixTitle: '<img src=x onerror=alert(1)>',
      packet: '<a href="https://evil.example">click</a>\nline two & more',
    });
    expect(m.html).not.toContain('<img');
    expect(m.html).not.toContain('<a href="https://evil.example"');
    expect(m.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;\nline two &amp; more');
    expect(foreignTargets(m)).toEqual([]);
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it('bounds the title and the packet, saying when the packet was cut', () => {
    const m = fixToDeveloper({
      host: 'h'.repeat(500),
      fixTitle: 't\r\n'.repeat(500),
      packet: 'p'.repeat(PACKET_MAX * 2),
    });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject.length).toBeLessThanOrEqual(200);
    expect([...m.text].length).toBeLessThan(PACKET_MAX + 1000);
    expect(m.text).toContain('The packet was cut');
    expect(fixToDeveloper(input).text).not.toContain('The packet was cut');
    expect(TITLE_MAX).toBeLessThan(200);
  });
});
