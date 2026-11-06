// @vitest-environment jsdom
/**
 * The account frame's primitives: AccountShell (the rail and the page), TrialCard and
 * ThemeControl, rendered and, for the theme row, pressed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountShell, THEME_CHOICES, ThemeControl, TrialCard } from '../../components/v2';
import { AccountFrame } from '../../components/v2/screens/account/AccountFrame';
import { shellPreview } from '../../app/(v2-preview)/v2-preview/_preview/accounts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

const NAV = [
  { label: 'Sites', href: '/dashboard', count: '5', current: true },
  { label: 'Changes', href: '/changes', count: '3 new', current: false },
  { label: 'Alerts', href: '/alerts', count: null, current: false },
];

describe('AccountShell', () => {
  const out = renderToStaticMarkup(
    <AccountShell nav={NAV} card={<p>card</p>} theme={<p>theme</p>}>
      <h1>page</h1>
    </AccountShell>,
  );

  it('labels the rail as the primary navigation and marks the current page', () => {
    expect(out).toContain('<nav class');
    expect(out).toMatch(/<nav [^>]*aria-label="Primary"/);
    expect(out).toMatch(/<a [^>]*aria-current="page"[^>]*>Sites<span[^>]*>5<\/span><\/a>/);
    expect(out.match(/aria-current/g)).toHaveLength(1);
    expect(out).toMatch(/>Alerts<\/a>/);
  });

  it('puts the page in the one <main>, beside the rail, with no site header or footer', () => {
    expect(out.match(/<main/g)).toHaveLength(1);
    expect(out).toMatch(/<main[^>]*><h1>page<\/h1><\/main>/);
    expect(out).not.toContain('<footer');
    expect(out).not.toContain('<header');
  });
});

describe('TrialCard', () => {
  it('names itself by its visible title and shows what the trial leaves', () => {
    const out = renderToStaticMarkup(
      <TrialCard title="Pro, trial · ends Sat 7 Nov" left="8 days left" note="Then Free.">
        <button type="button">Keep</button>
      </TrialCard>,
    );
    expect(out).toMatch(/<section [^>]*aria-label="Pro, trial · ends Sat 7 Nov"/);
    expect(out).toContain('>Pro, trial · ends Sat 7 Nov<');
    expect(out).toContain('8 days left');
    expect(out).toContain('Then Free.');
    expect(out).toContain('<button type="button">Keep</button>');
  });
});

describe('ThemeControl', () => {
  it('offers System, Light and Dark, with the saved one pressed', () => {
    for (const initial of THEME_CHOICES) {
      const out = renderToStaticMarkup(<ThemeControl initial={initial} action="/api/me" />);
      const pressed = [...out.matchAll(/aria-pressed="true"[^>]*>(\w+)</g)].map((m) => m[1]);
      expect(pressed).toEqual([{ system: 'System', light: 'Light', dark: 'Dark' }[initial]]);
      expect(out.match(/<button/g)).toHaveLength(3);
      expect(out).toMatch(/role="group" aria-labelledby="[^"]+"/);
    }
  });

  it('applies a choice to the page at once, and System hands it back to the device', () => {
    const host = mount(<ThemeControl initial="system" action="/api/me" />);
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
    act(() => button('Dark').click());
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(button('Dark').getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('crawlmouse-theme')).toBe('dark');
    act(() => button('System').click());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('posts PATCH to the route it is given, and stops the submit in a preview', () => {
    const host = mount(<ThemeControl initial="light" action="/api/me" />);
    const form = host.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/me');
    expect(form.querySelector<HTMLInputElement>('input[name="_method"]')!.value).toBe('PATCH');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      form.dispatchEvent(submit);
    });
    expect(submit.defaultPrevented).toBe(true);
  });

  it('starts from the choice this browser kept', () => {
    window.localStorage.setItem('crawlmouse-theme', 'light');
    const host = mount(<ThemeControl initial="dark" action="/api/me" />);
    const pressed = host.querySelector('button[aria-pressed="true"]')!;
    expect(pressed.textContent).toBe('Light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('AccountFrame', () => {
  it('renders the trial card’s keep action as a stopped POST to checkout', () => {
    const host = mount(<AccountFrame shell={shellPreview('home')}>page</AccountFrame>);
    const form = [...host.querySelectorAll('form')].find(
      (f) => f.getAttribute('action') === '/api/billing/checkout',
    )!;
    expect(form.textContent).toBe('Keep Pro, $19 a month');
    expect(form.querySelector<HTMLInputElement>('input[name="plan"]')!.value).toBe('pro');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      form.dispatchEvent(submit);
    });
    expect(submit.defaultPrevented).toBe(true);
  });

  it('links billing on the first run, and has no orange element (the rail is not the action)', () => {
    const out = renderToStaticMarkup(
      <AccountFrame shell={shellPreview('day0')}>page</AccountFrame>,
    );
    expect(out).toMatch(/<a href="\/settings\/plan">Billing<\/a>/);
    expect(out).not.toContain('data-v2-primary');
  });
});
