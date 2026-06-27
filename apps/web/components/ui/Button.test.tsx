import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Button } from './Button';

const render = (el: ReactElement) => renderToStaticMarkup(el);

describe('Button — variants, states, a11y', () => {
  it('defaults to primary with AA-safe ink-on-peach (never white-on-peach)', () => {
    const html = render(<Button>Go</Button>);
    expect(html).toContain('bg-peach');
    expect(html).toContain('text-ink');
    expect(html).not.toContain('text-white'); // white-on-peach is ~2.6:1 — fails AA
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

  it('destructive uses the warning fill with ink text', () => {
    const html = render(<Button variant="destructive">Delete</Button>);
    expect(html).toContain('bg-warning');
    expect(html).toContain('text-ink');
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
