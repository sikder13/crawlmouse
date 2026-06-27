import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Card } from './Card';

const render = (el: ReactElement) => renderToStaticMarkup(el);

describe('Card — variants, sizes, interactive', () => {
  it('default is the flat surface card (backward-compatible look)', () => {
    const html = render(<Card>body</Card>);
    expect(html).toContain('bg-surface-raised');
    expect(html).toContain('border-oat');
    expect(html).toContain('rounded-card');
    expect(html).toContain('p-6');
    expect(html).toContain('body');
    expect(html).not.toContain('shadow-'); // default stays flat (non-regression)
  });

  it('raised adds elevation; lg uses the large radius/padding (replaces GradeCard ! hacks)', () => {
    expect(render(<Card variant="raised">x</Card>)).toContain('shadow-raised');
    const lg = render(<Card size="lg">x</Card>);
    expect(lg).toContain('rounded-card-lg');
    expect(lg).toContain('p-7');
  });

  it('locked shows the dashed locked affordance', () => {
    expect(render(<Card variant="locked">x</Card>)).toContain('border-dashed');
  });

  it('interactive adds hover elevation + a focus-visible ring', () => {
    const html = render(
      <Card interactive tabIndex={0}>
        x
      </Card>,
    );
    expect(html).toContain('hover:shadow-raised');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('cursor-pointer');
  });

  it('merges className and passes through DOM props', () => {
    const html = render(
      <Card className="mt-4" data-testid="c">
        x
      </Card>,
    );
    expect(html).toContain('mt-4');
    expect(html).toContain('data-testid="c"');
  });
});
