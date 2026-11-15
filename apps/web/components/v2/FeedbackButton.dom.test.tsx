// @vitest-environment jsdom
/** The account shell's Feedback button (CC-41 D8a): there only while a feedback survey can open. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_DENIED_EVENT, CONSENT_GRANTED_EVENT } from '../../lib/consent';

const ph = vi.hoisted(() => ({ __loaded: true, optedOut: false }));
vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return ph.__loaded;
    },
    has_opted_out_capturing: () => ph.optedOut,
  },
}));

const { FeedbackButton } = await import('./FeedbackButton');
const { AccountShell } = await import('./AccountShell');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  ph.__loaded = true;
  ph.optedOut = false;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = () => host.querySelector('[data-cm-feedback]');

describe('FeedbackButton', () => {
  it('in the account shell’s rail, a button carrying data-cm-feedback while PostHog captures', () => {
    act(() => root.render(<AccountShell nav={[]}>page</AccountShell>));
    expect(button()?.tagName).toBe('BUTTON');
    expect(button()?.textContent).toBe('Feedback');
    expect(button()?.closest('header')).not.toBeNull();
  });

  it('is not in the server-rendered page, which cannot know the visitor’s consent', () => {
    expect(renderToStaticMarkup(<AccountShell nav={[]}>page</AccountShell>)).not.toContain(
      'data-cm-feedback',
    );
  });

  it.each([
    ['capture is opted out', () => (ph.optedOut = true)],
    ['PostHog has not started', () => (ph.__loaded = false)],
  ])('is not rendered while %s', (_n, set) => {
    set();
    act(() => root.render(<FeedbackButton />));
    expect(button()).toBeNull();
  });

  it('comes on the consent grant and goes on the decline', () => {
    ph.optedOut = true;
    act(() => root.render(<FeedbackButton />));
    expect(button()).toBeNull();
    ph.optedOut = false;
    act(() => void window.dispatchEvent(new Event(CONSENT_GRANTED_EVENT)));
    expect(button()).not.toBeNull();
    ph.optedOut = true;
    act(() => void window.dispatchEvent(new Event(CONSENT_DENIED_EVENT)));
    expect(button()).toBeNull();
  });
});
