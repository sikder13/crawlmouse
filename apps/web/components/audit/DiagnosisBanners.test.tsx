import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Finding } from '@crawlmouse/types';
import { DiagnosisBanners } from './DiagnosisBanners';
import { freeFixture } from './__fixtures__/client-audit-v2';

describe('DiagnosisBanners', () => {
  it('renders the site-wide caveats with the js_rendered AI-crawler framing (U5)', () => {
    const html = renderToStaticMarkup(<DiagnosisBanners findings={freeFixture.findings} />);
    expect(html).toContain('JavaScript-rendered links');
    expect(html).toContain('ChatGPT');
    expect(html).toContain('Claude');
    expect(html).toContain('Partial crawl');
  });

  it('renders nothing when there are no informational findings', () => {
    const actionableOnly: Finding[] = [{ category: 'orphan', severity: 'critical', pageUrl: 'https://x.example/a' }];
    expect(renderToStaticMarkup(<DiagnosisBanners findings={actionableOnly} />)).toBe('');
  });
});
