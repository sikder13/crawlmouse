/**
 * The capability honesty test of For agencies (CC-29 D4), on the rendered page.
 *
 * - Every capability an element names (`data-capability`) is in `CAPABILITIES`.
 * - An element that names a coming capability carries the "coming" mark, inside itself or, for a
 *   table cell, in its row's first cell.
 * - Text that names a coming capability (its `named` pattern) sits inside an element that carries
 *   that capability, so a sentence added without its tag is found.
 * What it cannot see: a coming capability named in words its pattern does not match. The patterns
 * are in the table beside the status, so a new phrase is added where the capability is.
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, agenciesView, type CapabilityKey } from '../../../../lib/v2/view/agencies';
import { AgenciesScreen } from './AgenciesScreen';

function render() {
  const markup = renderToStaticMarkup(<AgenciesScreen data={agenciesView()} audit="live" />);
  return new JSDOM(markup).window.document;
}

const keysOf = (el: Element) =>
  (el.getAttribute('data-capability') ?? '').split(' ').filter(Boolean);

/** The capabilities an element carries, its own and its ancestors'. */
function carried(node: Node): Set<string> {
  const keys = new Set<string>();
  for (let el = node.parentElement; el; el = el.parentElement) {
    for (const k of keysOf(el)) keys.add(k);
  }
  return keys;
}

const coming = (k: string) => CAPABILITIES[k as CapabilityKey]?.status === 'coming';

describe('For agencies names only capabilities it can account for', () => {
  const doc = render();
  const tagged = [...doc.querySelectorAll('[data-capability]')];

  it('tags the pieces of the page that name capabilities', () => {
    expect(tagged.length).toBeGreaterThan(20);
  });

  it('names no capability that is not in the table', () => {
    const unknown = tagged.flatMap(keysOf).filter((k) => !(k in CAPABILITIES));
    expect(unknown).toEqual([]);
  });

  it('marks "coming" each element that names a coming capability', () => {
    const unmarked = tagged
      .filter((el) => keysOf(el).some(coming))
      .filter((el) => {
        const cell = el.closest('td, th');
        const scope = cell ? cell.closest('tr')!.firstElementChild! : el;
        return scope.querySelector('[data-v2-coming]') === null;
      })
      .map((el) => el.textContent);
    expect(unmarked).toEqual([]);
  });

  it('puts no "coming" mark on an element that names only built capabilities', () => {
    const marked = [...doc.querySelectorAll('[data-v2-coming]')].map((m) =>
      m.parentElement!.closest('[data-capability]'),
    );
    for (const el of marked) expect(keysOf(el!).some(coming), el!.textContent!).toBe(true);
  });

  it('names a coming capability only inside an element that carries it', () => {
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const loose: string[] = [];
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const [key, cap] of Object.entries(CAPABILITIES)) {
        if (cap.status !== 'coming' || !cap.named?.test(text)) continue;
        seen++;
        if (!carried(node).has(key)) loose.push(`${key}: "${text}"`);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(loose).toEqual([]);
  });

  it('has one h1, one orange element (the trial button) and no "#" link', () => {
    const html = doc.body.innerHTML;
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    const primary = doc.querySelectorAll('[data-v2-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.getAttribute('href')).toBe('/agency-trial');
    expect(html).not.toContain('href="#"');
  });
});

describe('the matcher finds an untagged mention', () => {
  it('reports a coming capability named outside its tag', () => {
    const doc = new JSDOM(
      '<p data-capability="free_audit">Audit it free.</p><p>Your one-pager.</p>',
    ).window.document;
    const node = doc.querySelectorAll('p')[1]!.firstChild!;
    expect(CAPABILITIES.one_pagers.named!.test(node.textContent!)).toBe(true);
    expect(carried(node).has('one_pagers')).toBe(false);
  });
});
