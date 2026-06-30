import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphData } from '@crawlmouse/types';
import { LinkGraphSlot } from './LinkGraphSlot';
import {
  cappedGraphFixture,
  errorFixture,
  freeFixture,
  jsOnlyHeavyFixture,
  xssFixture,
} from './__fixtures__/client-audit-v2';

// The canvas (LinkGraph / react-force-graph) is client-only and loaded after mount, so renderToStaticMarkup
// exercises only the server-safe shell: header, coverage, legend, summary, upsell, and the skeleton.
const render = (graph: GraphData | null) => renderToStaticMarkup(<LinkGraphSlot graph={graph} />);

describe('LinkGraphSlot (server-safe shell)', () => {
  it('normal graph: header + honest plain count + orphan summary + legend + skeleton (pre-mount)', () => {
    const html = render(freeFixture.graph);
    expect(html).toContain('Your link graph');
    expect(html).toContain('8 pages'); // not capped → a plain count
    expect(html).toContain('orphan'); // NORMAL_GRAPH has one orphan (Pricing)
    expect(html).toContain('Reachable only via JavaScript'); // legend entry
    expect(html).toContain('Drawing your link graph'); // canvas not mounted server-side → skeleton
    expect(html).not.toContain('See your full graph with Pro'); // not free-tier-capped
  });

  it('capped free-tier graph: honest "Showing N of M" + the Pro upsell', () => {
    const html = render(cappedGraphFixture.graph);
    expect(html).toContain('Showing 150 of 1,240 pages');
    expect(html).toContain('See your full graph with Pro');
  });

  it('jsOnly-heavy graph: the honest AI-crawler reachability message, not "this page is JavaScript"', () => {
    const html = render(jsOnlyHeavyFixture.graph);
    expect(html.toLowerCase()).toContain('no static link path');
    expect(html).toMatch(/ChatGPT|Claude/);
    expect(html.toLowerCase()).not.toContain('this page is javascript');
  });

  it('null graph: the reserved placeholder (still building / error)', () => {
    const html = render(errorFixture.graph); // null
    expect(html).toContain('once the crawl completes');
    expect(html).not.toContain('Showing');
  });

  it('crawled node strings never reach the slot output unescaped (counts-only summary)', () => {
    const html = render(xssFixture.graph);
    expect(html).not.toContain('<script>');
  });
});
