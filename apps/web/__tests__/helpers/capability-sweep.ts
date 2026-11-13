/**
 * The capability honesty sweep of a rendered page (CC-29 D4, Q27), as `agencies-screen.test.tsx`
 * runs it on For agencies, for the other pages that sell:
 * - `unknown`: capabilities an element names (`data-capability`) that are not in `CAPABILITIES`;
 * - `unmarked`: elements naming a coming capability with no "coming" mark inside them, or, for a
 *   table cell, in its row's first cell;
 * - `overMarked`: "coming" marks on an element that names only built capabilities;
 * - `loose`: text matching a coming capability's `named` pattern outside an element carrying it;
 * - `seen`: how many coming mentions the pattern pass found, so a caller can refuse a vacuous run.
 * What it cannot see: a coming capability named in words its pattern does not match.
 */
import { JSDOM } from 'jsdom';
import { CAPABILITIES, type CapabilityKey } from '../../lib/v2/view/agencies';

const keysOf = (el: Element) =>
  (el.getAttribute('data-capability') ?? '').split(' ').filter(Boolean);

function carried(node: Node): Set<string> {
  const keys = new Set<string>();
  for (let el = node.parentElement; el; el = el.parentElement) {
    for (const k of keysOf(el)) keys.add(k);
  }
  return keys;
}

const coming = (k: string) =>
  Object.hasOwn(CAPABILITIES, k) && CAPABILITIES[k as CapabilityKey].status === 'coming';

export function capabilitySweep(html: string) {
  const doc = new JSDOM(html).window.document;
  const tagged = [...doc.querySelectorAll('[data-capability]')];
  const unknown = tagged.flatMap(keysOf).filter((k) => !Object.hasOwn(CAPABILITIES, k));
  const unmarked = tagged
    .filter((el) => keysOf(el).some(coming))
    .filter((el) => {
      const cell = el.closest('td, th');
      const scope =
        cell && !cell.contains(el.querySelector('[data-v2-coming]'))
          ? cell.closest('tr')!.firstElementChild!
          : el;
      return scope.querySelector('[data-v2-coming]') === null;
    })
    .map((el) => el.textContent ?? '');
  const overMarked = [...doc.querySelectorAll('[data-v2-coming]')]
    .map((m) => m.parentElement!.closest('[data-capability]'))
    .filter((el) => el === null || !keysOf(el).some(coming))
    .map((el) => el?.textContent ?? '(no tagged element)');
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
  return { tagged: tagged.length, unknown, unmarked, overMarked, loose, seen };
}

/** The coming capabilities a plain string names, by their patterns. */
export const comingNamedIn = (text: string) =>
  Object.entries(CAPABILITIES)
    .filter(([, c]) => c.status === 'coming' && c.named?.test(text))
    .map(([k]) => k);
