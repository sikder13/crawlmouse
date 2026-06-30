import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Button } from './Button';

const render = (el: ReactElement) => renderToStaticMarkup(el);

describe('Button — variants, states, a11y', () => {
  it('defaults to primary with white text on the AA accent-fill (darkened orange)', () => {
    const html = render(<Button>Go</Button>);
    expect(html).toContain('bg-accent-fill');
    expect(html).toContain('text-white');
    expect(html).toContain('Go');
  });

  it('gives every variant a focus-visible ring (not legacy focus:)', () => {
    expect(render(<Button variant="primary">x</Button>)).toContain('focus-visible:ring-peach');
    expect(render(<Button variant="secondary">x</Button>)).toContain('focus-visible:ring-ink');
    expect(render(<Button variant="ghost">x</Button>)).toContain('focus-visible:ring-ink');
    expect(render(<Button variant="destructive">x</Button>)).toContain('focus-visible:ring-warning');
    const base = render(<Button>x</Button>);
    expect(base).toContain('focus-visible:ring-2');
    expect(base).not.toContain('focus:ring-2'); // converted away from the mouse-firing variant
  });

  it('destructive uses the warning-fill with white text (AA)', () => {
    const html = render(<Button variant="destructive">Delete</Button>);
    expect(html).toContain('bg-warning-fill');
    expect(html).toContain('text-white');
  });

  it('ghost reads on cream (ink-muted), not the sub-AA sage', () => {
    const html = render(<Button variant="ghost">x</Button>);
    expect(html).toContain('text-ink-muted');
    expect(html).not.toContain('text-sage');
  });

  it('loading shows a spinner, marks aria-busy, and disables the button', () => {
    const html = render(<Button loading>Save</Button>);
    expect(html).toContain('animate-spin');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
    expect(html).toContain('Save'); // label stays visible
  });

  it('honors disabled and merges a custom className', () => {
    const html = render(
      <Button disabled className="w-full">
        x
      </Button>,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('disabled:opacity-50');
    expect(html).toContain('w-full');
  });
});

describe('Button asChild — render the child element as the button (Slot)', () => {
  it('renders the child <a> styled as a button, with no <button> element', () => {
    const html = render(
      <Button asChild>
        <a href="/pricing">See pricing</a>
      </Button>,
    );
    expect(html).toContain('<a');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('See pricing');
    expect(html).toContain('bg-accent-fill'); // primary button styling applied to the link itself
    expect(html).not.toContain('<button'); // a single keyboard-correct control, not a nested button
  });

  it("merges the child's own className with the variant classes", () => {
    const html = render(
      <Button asChild variant="secondary">
        <a href="/x" className="mt-3 w-full">
          Go
        </a>
      </Button>,
    );
    expect(html).not.toContain('<button'); // classes land on the <a>, not a wrapping button
    expect(html).toContain('mt-3'); // child className preserved
    expect(html).toContain('w-full');
    expect(html).toContain('border-ink'); // secondary variant classes applied to the link
  });

  it('forwards extra props from Button onto the child', () => {
    const html = render(
      <Button asChild aria-label="Open dashboard">
        <a href="/dashboard">→</a>
      </Button>,
    );
    expect(html).not.toContain('<button'); // the <a> is the element; aria-label lands on it
    expect(html).toContain('aria-label="Open dashboard"');
  });

  it('still renders a real <button> when asChild is not set (backward compatible)', () => {
    const html = render(<Button>Click</Button>);
    expect(html).toContain('<button');
    expect(html).toContain('Click');
  });
});
