import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphSlot } from './GraphSlot';

describe('GraphSlot', () => {
  it('renders the reserved graph placeholder', () => {
    const html = renderToStaticMarkup(<GraphSlot />);
    expect(html).toContain('Live link graph');
    expect(html).toContain('will appear here');
  });
});
