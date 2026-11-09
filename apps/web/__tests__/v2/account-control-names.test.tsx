/**
 * Every account preview: no two interactive controls share an accessible name unless a row header
 * cell (`th[scope=row]` or `role=rowheader`) separates them (WCAG 2.4.4). Two "Connect" buttons in
 * one table with no row header read the same to a screen reader, which is the defect this guards.
 *
 * A second, stricter check: where several controls show the same visible label ("Connect" three
 * times), each must carry a name beyond that label or sit under a row header. The first check alone
 * stays green when one of three loses its hidden context, since the bare "Connect" left is then
 * unique; this one does not.
 *
 * The name is worked out here from the rendered markup, the way the accessible-name rules give it
 * for these controls: `aria-labelledby`, then `aria-label`, then a form field's `<label>`, then the
 * control's text, with `aria-hidden` subtrees left out and visually hidden text kept. What it does
 * not do: it reads server-rendered markup, so a name a client effect sets later is not seen, and it
 * does not resolve `title` or `alt` (no account control relies on either).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { ACCOUNT_ELEMENTS, CC27_ELEMENTS } from './_lib/screens';

const CONTROLS = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(', ');

const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

/**
 * An element's text, leaving out what is hidden from assistive technology; with `seen`, also
 * leaving out text drawn for screen readers only (`data-v2-sr-only`), which gives the visible label.
 */
function textOf(el: Element, seen = false): string {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.textContent ?? '';
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('hidden')) continue;
      if (seen && e.hasAttribute('data-v2-sr-only')) continue;
      out += textOf(e, seen);
    }
  }
  return out;
}

function nameOf(el: Element, doc: Document): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    return squash(
      by
        .split(/\s+/)
        .map((id) => doc.getElementById(id))
        .map((e) => (e ? textOf(e) : ''))
        .join(' '),
    );
  }
  const label = el.getAttribute('aria-label');
  if (label) return squash(label);
  const id = el.getAttribute('id');
  if (id) {
    const forIt = doc.querySelector(`label[for="${id}"]`);
    if (forIt) return squash(textOf(forIt));
  }
  const wrapping = el.closest('label');
  if (wrapping && wrapping !== el) return squash(textOf(wrapping));
  return squash(textOf(el));
}

/** The text of the row header in the control's table row, if the row has one. */
function rowHeaderOf(el: Element): string | null {
  const row = el.closest('tr, [role="row"]');
  const head = row?.querySelector('th[scope="row"], [role="rowheader"]');
  return head ? squash(textOf(head)) : null;
}

interface Control {
  name: string;
  label: string;
  head: string | null;
}

function controlsIn(html: string): Control[] {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  return [...doc.querySelectorAll(CONTROLS)].map((el) => ({
    name: nameOf(el, doc),
    label: squash(textOf(el, true)),
    head: rowHeaderOf(el),
  }));
}

/** Names that two or more controls share without distinct row headers to tell them apart. */
export function sharedNames(html: string): string[] {
  const groups = new Map<string, (string | null)[]>();
  for (const c of controlsIn(html)) groups.set(c.name, [...(groups.get(c.name) ?? []), c.head]);
  const bad: string[] = [];
  for (const [name, heads] of groups) {
    if (heads.length < 2) continue;
    const separated = heads.every((h) => h !== null) && new Set(heads).size === heads.length;
    if (!separated) bad.push(`"${name}" ×${heads.length}`);
  }
  return bad;
}

/** Controls that show a label others show too, and are named by that label alone. */
export function bareRepeats(html: string): string[] {
  const all = controlsIn(html);
  const count = new Map<string, number>();
  for (const c of all) if (c.label) count.set(c.label, (count.get(c.label) ?? 0) + 1);
  return all
    .filter((c) => c.label && count.get(c.label)! > 1 && c.name === c.label && c.head === null)
    .map((c) => `"${c.label}" (shown ${count.get(c.label)} times)`);
}

describe('the checker itself', () => {
  it('flags two same-named controls, and lets distinct row headers separate them', () => {
    expect(sharedNames('<button>Connect</button><button>Connect</button>')).toEqual([
      '"Connect" ×2',
    ]);
    expect(
      sharedNames(
        '<table><tbody>' +
          '<tr><th scope="row">Slack</th><td><button>Connect</button></td></tr>' +
          '<tr><th scope="row">Search Console</th><td><button>Connect</button></td></tr>' +
          '</tbody></table>',
      ),
    ).toEqual([]);
    expect(
      sharedNames(
        '<button>Connect<span class="sr"> for Slack</span></button>' +
          '<button>Connect<span class="sr"> for Search Console</span></button>' +
          '<a href="/x" aria-label="Billing">x</a><a href="/y"><span aria-hidden="true">→</span>Billing</a>',
      ),
    ).toEqual(['"Billing" ×2']);
  });

  it('flags a control named only by a label other controls also show', () => {
    const sr = (t: string) => `<span data-v2-sr-only="">${t}</span>`;
    expect(
      bareRepeats(
        `<button>Connect${sr(' for Slack')}</button><button>Connect</button>` +
          `<button>Connect${sr(' for Search Console')}</button><button>Billing</button>`,
      ),
    ).toEqual(['"Connect" (shown 3 times)']);
    expect(
      bareRepeats(
        '<table><tbody><tr><th scope="row">Schedule</th><td><button>Change</button></td></tr>' +
          '<tr><th scope="row">Alerts</th><td><button>Change</button></td></tr></tbody></table>',
      ),
    ).toEqual([]);
  });
});

describe('Account previews: no two controls share a name a row header does not separate', () => {
  const elements = { ...ACCOUNT_ELEMENTS, ...CC27_ELEMENTS };
  const paths = Object.keys(elements);
  it('covers every account preview in the registry', () => {
    const account = PREVIEWS.map((p) => p.path).filter((p) =>
      /\/screens\/(dashboard|site|changes-log|alerts|reports|settings|trial-end)(\/|$)/.test(p),
    );
    expect(paths.sort()).toEqual(account.sort());
  });
  it.each(paths)('%s', (path) => {
    const html = renderToStaticMarkup(elements[path]!());
    // It found the page's controls: the rail alone has seven links.
    expect(html.match(/<a [^>]*href=|<button/g)?.length ?? 0).toBeGreaterThan(7);
    expect(sharedNames(html)).toEqual([]);
    expect(bareRepeats(html)).toEqual([]);
  });
});
