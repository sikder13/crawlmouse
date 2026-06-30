import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Explainer } from './Explainer';

describe('Explainer', () => {
  it('renders a keyboard-accessible details/summary disclosure with the default prompt', () => {
    const html = renderToStaticMarkup(
      <Explainer>
        <p>because reasons</p>
      </Explainer>,
    );
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('What does this mean?');
    expect(html).toContain('because reasons');
    expect(html).toContain('focus-visible:ring'); // keyboard a11y
  });

  it('accepts a custom summary', () => {
    const html = renderToStaticMarkup(
      <Explainer summary="Why it matters">
        <span>x</span>
      </Explainer>,
    );
    expect(html).toContain('Why it matters');
  });
});
