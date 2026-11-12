// @vitest-environment jsdom
/**
 * The rail's account switcher (CC-31 D2b): what it renders for a person with several seats, how it
 * opens and closes, what a reader without script gets, and that a person with one seat has none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountSwitcher } from '../../components/v2/AccountSwitcher';
import { AccountFrame } from '../../components/v2/screens/account/AccountFrame';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import {
  SWITCHER_PREVIEWS,
  shellPreview,
  switcherPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { switcherView, type SwitcherAccount } from '../../lib/v2/view/account-shell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS: SwitcherAccount[] = [
  { id: 'a0000000-0000-4000-8000-000000000001', kind: 'personal', name: null },
  { id: 'a0000000-0000-4000-8000-0000000000aa', kind: 'agency', name: 'Summit Digital' },
  { id: 'a0000000-0000-4000-8000-0000000000ab', kind: 'agency', name: 'Atlas & Co' },
];
const SUMMIT = ACCOUNTS[1]!.id;
const switcher = switcherView(ACCOUNTS, SUMMIT)!;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** The switcher, with a focusable control outside it to move focus and presses to. */
function mount(live = false) {
  const host = document.createElement('div');
  const outside = document.createElement('button');
  outside.textContent = 'outside';
  document.body.append(host, outside);
  root = createRoot(host);
  const el = <AccountSwitcher switcher={switcher} />;
  act(() => root!.render(live ? <LiveActions>{el}</LiveActions> : el));
  const button = host.querySelector('button[aria-controls]') as HTMLButtonElement;
  const panel = () => document.getElementById(button.getAttribute('aria-controls') ?? '')!;
  return { host, outside, button, panel };
}

const key = (el: Element | Document, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

/** Each form in `el`: where it posts, how, its fields and its button's text. */
const forms = (el: ParentNode) =>
  [...el.querySelectorAll('form')].map((f) => ({
    action: f.getAttribute('action'),
    method: f.getAttribute('method'),
    fields: Object.fromEntries(
      [...f.querySelectorAll('input[type="hidden"]')].map((i) => [
        i.getAttribute('name'),
        i.getAttribute('value'),
      ]),
    ),
    button: f.querySelector('button[type="submit"]')?.textContent,
  }));

const OTHERS = [
  {
    action: '/api/seats/switch',
    method: 'post',
    fields: { accountId: ACCOUNTS[2]!.id },
    button: 'Switch to Atlas & Co',
  },
  {
    action: '/api/seats/switch',
    method: 'post',
    fields: { accountId: ACCOUNTS[0]!.id },
    button: 'Switch to Personal account',
  },
];

describe('AccountSwitcher', () => {
  it('starts closed: a button naming the account acted in, and a hidden list it controls', () => {
    const { button, panel } = mount();
    expect(button.textContent).toBe('Account: Summit Digital');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel().hasAttribute('hidden')).toBe(true);
  });

  it('is a disclosure, not an ARIA menu', () => {
    const { host } = mount();
    expect(host.querySelector('[role="menu"], [role="menuitem"], [aria-haspopup]')).toBeNull();
  });

  it('opens and closes from its button', () => {
    const { button, panel } = mount();
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel().hasAttribute('hidden')).toBe(false);
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel().hasAttribute('hidden')).toBe(true);
  });

  it('offers each other account as a POST of its id to the switch, by name', () => {
    const { panel } = mount();
    expect(forms(panel())).toEqual(OTHERS);
  });

  it('closes on Escape from inside, and gives focus back to its button', () => {
    const { button, panel } = mount();
    act(() => button.click());
    const item = panel().querySelector('button[type="submit"]') as HTMLButtonElement;
    act(() => item.focus());
    key(item, 'Escape');
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('closes on a press outside it, and when focus moves to an element outside it', () => {
    const { button, panel, outside } = mount();
    act(() => button.click());
    act(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(panel().hasAttribute('hidden')).toBe(true);

    act(() => button.click());
    act(() => button.focus());
    act(() => outside.focus());
    expect(panel().hasAttribute('hidden')).toBe(true);
  });

  it('stays open for a press inside it', () => {
    const { button, panel } = mount();
    act(() => button.click());
    act(() => {
      panel().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(panel().hasAttribute('hidden')).toBe(false);
  });

  it('switches nothing on a preview, and posts on a live page', () => {
    const submitted = (live: boolean) => {
      const { button, panel } = mount(live);
      act(() => button.click());
      const event = new Event('submit', { bubbles: true, cancelable: true });
      act(() => {
        panel().querySelector('form')!.dispatchEvent(event);
      });
      act(() => root?.unmount());
      root = null;
      document.body.innerHTML = '';
      return !event.defaultPrevented;
    };
    expect(submitted(false)).toBe(false);
    expect(submitted(true)).toBe(true);
  });
});

describe('AccountSwitcher, as the server sends it', () => {
  const html = renderToStaticMarkup(<AccountSwitcher switcher={switcher} />);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it('where script does not run, the list is open: the same forms, in <noscript>, not hidden', () => {
    const fallback = doc.querySelector('noscript')!;
    // DOMParser parses with scripting off, so the fallback's markup is elements here as it is for
    // a reader whose browser runs no script.
    expect(forms(fallback)).toEqual(OTHERS);
    expect(fallback.querySelector('[hidden]')).toBeNull();
  });

  it('has no orange element and no link', () => {
    expect(html).not.toContain('data-v2-primary');
    expect(doc.querySelector('a')).toBeNull();
  });
});

describe('AccountSwitcher, on a page of an account the reader is not acting in', () => {
  const visiting = switcherView(ACCOUNTS, SUMMIT, ACCOUNTS[0]!.id)!;
  const html = renderToStaticMarkup(<AccountSwitcher switcher={visiting} />);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it('names the page’s account and the one acted in, and offers one switch: to the page’s', () => {
    expect(doc.body.textContent).toBe(
      'Account: Summit DigitalYou are acting in Personal account.Switch to Summit Digital',
    );
    expect(forms(doc)).toEqual([
      {
        action: '/api/seats/switch',
        method: 'post',
        fields: { accountId: SUMMIT },
        button: 'Switch to Summit Digital',
      },
    ]);
  });

  it('is no disclosure: nothing to open, and nothing kept for a reader without script', () => {
    expect(doc.querySelector('[aria-expanded], noscript')).toBeNull();
    expect(html).not.toContain('data-v2-primary');
  });
});

describe('the account frame', () => {
  it('has no switcher for a person with one seat', () => {
    for (const name of ['day0', 'home', 'clean', 'withheld'] as const) {
      const shell = shellPreview(name);
      expect(shell.switcher).toBeNull();
      const html = renderToStaticMarkup(<AccountFrame shell={shell}>page</AccountFrame>);
      expect(html).not.toContain('data-v2-account-switcher');
      expect(html).not.toContain('<noscript');
    }
  });

  it('puts the switcher under the brand and before the rail’s links', () => {
    const shell = { ...shellPreview('home'), switcher };
    const html = renderToStaticMarkup(<AccountFrame shell={shell}>page</AccountFrame>);
    const [brand, account, nav] = [
      html.indexOf('aria-label="Crawlmouse home"'),
      html.indexOf('data-v2-account-switcher'),
      html.indexOf('aria-label="Primary"'),
    ];
    expect(brand).toBeGreaterThan(-1);
    expect(account).toBeGreaterThan(brand);
    expect(nav).toBeGreaterThan(account);
  });
});

describe('the switcher previews', () => {
  const read = (name: keyof typeof SWITCHER_PREVIEWS) => {
    const shell = switcherPreview(name);
    return {
      rail: shell.nav[0]!.label,
      current: shell.switcher!.current,
      others: shell.switcher!.others.map((o) => o.label),
    };
  };

  it('two accounts: a personal account acted in, an agency to switch to', () => {
    expect(read('two')).toEqual({
      rail: 'Sites',
      current: 'Personal account',
      others: ['Northwind Digital'],
    });
  });

  it('three accounts: the two others by name', () => {
    expect(read('three').others).toEqual(['Kestrel Creative', 'Northwind Digital']);
  });

  it('a long name: an agency acted in on the agency rail, another long name in the list', () => {
    const long = read('long');
    expect(long.rail).toBe('Clients');
    expect(long.current.length).toBeGreaterThan(60);
    expect(long.others).toEqual(['Alex', `${long.current} (Canada)`]);
  });

  it('opens the list from the start where a preview asks, and in no other case', () => {
    const shown = (defaultOpen?: boolean) => {
      const html = renderToStaticMarkup(
        <AccountSwitcher switcher={switcherPreview('three').switcher!} defaultOpen={defaultOpen} />,
      );
      return /aria-expanded="true"/.test(html);
    };
    expect([shown(true), shown(false), shown()]).toEqual([true, false, false]);
  });
});
