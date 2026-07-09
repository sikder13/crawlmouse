import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { LlmsTxtGenerator } from './LlmsTxtGenerator';

describe('LlmsTxtGenerator', () => {
  it('renders the generate button and honest, non-ranking helper copy', () => {
    const html = renderToStaticMarkup(<LlmsTxtGenerator auditId="aud-1" />);
    expect(html).toContain('<button');
    expect(html).toContain('Generate llms.txt');
    expect(html).toContain('AI coding agents');
    expect(html).toContain('not consumed by AI search engines');
  });
});
