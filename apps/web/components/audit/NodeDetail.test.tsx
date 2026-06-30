import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@crawlmouse/types';
import { NodeDetail } from './NodeDetail';

const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: 'https://x.example/p',
  url: 'https://x.example/p',
  title: 'A Page',
  depth: 2,
  isHomepage: false,
  isOrphan: false,
  pagerank: 0.1,
  jsOnly: false,
  inboundCount: 2,
  outboundCount: 3,
  ...over,
});

describe('NodeDetail', () => {
  it('orphan: explains there are no inbound internal links', () => {
    const html = renderToStaticMarkup(<NodeDetail node={node({ isOrphan: true })} />);
    expect(html).toContain('Orphan page');
    expect(html.toLowerCase()).toContain('no inbound internal links');
  });

  it('jsOnly: the honest AI-crawler reachability detail (not "this page is JavaScript")', () => {
    const html = renderToStaticMarkup(<NodeDetail node={node({ jsOnly: true })} />);
    expect(html).toContain('Reachable only via JavaScript');
    expect(html.toLowerCase()).toContain('static link path');
    expect(html).toMatch(/ChatGPT|Claude/);
    expect(html.toLowerCase()).not.toContain('this page is javascript');
  });

  it('buried: surfaces the click-depth', () => {
    const html = renderToStaticMarkup(<NodeDetail node={node({ depth: 6 })} />);
    expect(html).toContain('Buried page');
    expect(html).toContain('6 clicks');
  });

  it('shows inbound/outbound/depth counts', () => {
    const html = renderToStaticMarkup(<NodeDetail node={node({ inboundCount: 5, outboundCount: 1, depth: 3 })} />);
    expect(html).toContain('5 in');
    expect(html).toContain('1 out');
    expect(html).toContain('depth 3');
  });

  it('escapes crawled title/url (XSS-safe — rendered as text, never an href)', () => {
    const html = renderToStaticMarkup(
      <NodeDetail node={node({ title: '<script>alert(1)</script>', url: 'https://x/"><img src=x>' })} />,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
  });

  it('renders a close button when onClose is provided', () => {
    const html = renderToStaticMarkup(<NodeDetail node={node()} onClose={() => {}} />);
    expect(html).toContain('aria-label="Close detail"');
  });
});
