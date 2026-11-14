// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeptShell } from './KeptShell';

describe('the kept shell in print', () => {
  const css = readFileSync(join(__dirname, 'KeptShell.module.css'), 'utf8');
  const print = css.slice(css.indexOf('@media print'));

  it("hides the shell's header and footer, as v1 hid its own", () => {
    expect(print).toMatch(/\.kept > \[data-v2-shell\] > header/);
    expect(print).toMatch(/\.kept > \[data-v2-shell\] > \[data-v2-footer\]/);
    expect(print).toMatch(/display:\s*none/);
  });

  it('the selectors name what the shell draws: a header and a footer directly under it', () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<KeptShell>content</KeptShell>),
      'text/html',
    );
    expect(doc.querySelectorAll('[data-v2-kept] > [data-v2-shell] > header')).toHaveLength(1);
    expect(
      doc.querySelectorAll('[data-v2-kept] > [data-v2-shell] > [data-v2-footer]'),
    ).toHaveLength(1);
    expect(doc.querySelector('[data-v2-kept]')?.className).toBeTruthy();
  });
});
