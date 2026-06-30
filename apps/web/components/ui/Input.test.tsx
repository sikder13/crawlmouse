import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Input } from './Input';

const render = (el: ReactElement) => renderToStaticMarkup(el);

describe('Input — states + a11y', () => {
  it('uses focus-visible (not legacy focus:) and the control radius', () => {
    const html = render(<Input placeholder="https://example.com" />);
    expect(html).toContain('focus-visible:ring-2');
    expect(html).not.toContain('focus:ring-2');
    expect(html).toContain('rounded-control');
  });

  it('has hover + disabled affordances', () => {
    const html = render(<Input />);
    expect(html).toContain('hover:border-ink-muted');
    expect(html).toContain('disabled:opacity-50');
  });

  it('reflects invalid via the warning border + aria-invalid', () => {
    const html = render(<Input invalid />);
    expect(html).toContain('border-warning');
    expect(html).toContain('aria-invalid="true"');
  });

  it('valid input uses the oat border and sets no aria-invalid', () => {
    const html = render(<Input />);
    expect(html).toContain('border-oat');
    expect(html).not.toContain('aria-invalid');
  });
});
