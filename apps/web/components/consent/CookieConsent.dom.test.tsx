// @vitest-environment jsdom
/**
 * The consent banner as a person uses it (F-067, F-088): it does not cover the end of the page,
 * focus goes into it when it is opened from "Cookie settings" and comes back when it closes, Escape
 * closes it without recording a choice, and neither choice is given more weight than the other.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('posthog-js', () => ({ default: { __loaded: false } }));

import { CookieConsent } from './CookieConsent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) =>
  [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === label)!;
const mount = () => act(() => root.render(<CookieConsent />));
const openFromSettings = () => {
  opener.focus();
  act(() => void window.dispatchEvent(new Event('cm:open-consent')));
};
const escape = () =>
  act(
    () =>
      void document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
  );

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'cm_consent=; Max-Age=0; Path=/';
  document.cookie = 'cm_consent_required=0; Path=/';
  document.body.style.paddingBottom = '';
  host = document.createElement('div');
  opener = document.createElement('button');
  document.body.append(opener, host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(96);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  opener.remove();
  vi.restoreAllMocks();
});

describe('the consent banner', () => {
  it('shown by itself, it does not take focus from the page', () => {
    document.cookie = 'cm_consent_required=1; Path=/';
    opener.focus();
    mount();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('opened from Cookie settings, focus moves into it', () => {
    mount();
    openFromSettings();
    expect(dialog()!.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes it, records no choice, and returns focus to the control', () => {
    mount();
    openFromSettings();
    escape();
    expect(dialog()).toBeNull();
    expect(localStorage.getItem('cm_consent')).toBeNull();
    expect(document.cookie).not.toContain('cm_consent=');
    expect(document.activeElement).toBe(opener);
  });

  it('a choice closes it and returns focus to the control', () => {
    mount();
    openFromSettings();
    act(() => button('Decline').click());
    expect(dialog()).toBeNull();
    expect(localStorage.getItem('cm_consent')).toBe('denied');
    expect(document.activeElement).toBe(opener);
  });

  it('while open the page keeps room for it, so the footer can be read; closed, the room goes', () => {
    document.body.style.paddingBottom = '12px';
    mount();
    openFromSettings();
    expect(document.body.style.paddingBottom).toBe('96px');
    act(() => button('Allow analytics').click());
    expect(document.body.style.paddingBottom).toBe('12px');
  });

  it('gives Decline and Allow the same weight', () => {
    mount();
    openFromSettings();
    expect(button('Decline').className).toBe(button('Allow analytics').className);
  });

  it('is labelled, and is not announced as modal: the page stays usable behind it', () => {
    mount();
    openFromSettings();
    expect(dialog()!.getAttribute('aria-label')).toBe('Analytics consent');
    expect(dialog()!.hasAttribute('aria-modal')).toBe(false);
  });
});
