// @vitest-environment jsdom
/**
 * The door's forms with Turnstile configured: the widget appears when a send is asked for, the send
 * goes when it answers, and a widget that fails or never answers frees the form with the
 * verification copy instead of leaving it waiting. The widget is replaced by a stub that hands the
 * test its `onToken`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const widget = vi.hoisted(() => ({ onToken: null as ((t: string | null) => void) | null }));
vi.mock('@/lib/turnstile-client', () => ({
  turnstileEnabled: () => true,
  TURNSTILE_SITE_KEY: 'test-site-key',
}));
vi.mock('@/components/ui/Turnstile', async () => {
  const { forwardRef } = await import('react');
  return {
    Turnstile: forwardRef(function Stub(props: { onToken: (t: string | null) => void }, _ref) {
      widget.onToken = props.onToken;
      return <div data-testid="turnstile" />;
    }),
  };
});

import { SignupForm } from '../../components/v2/screens/signup/SignupForm';
import { SignupScreen } from '../../components/v2/screens/signup/SignupScreen';
import { CheckEmailScreen } from '../../components/v2/screens/check-email/CheckEmailScreen';
import { ContinueScreen } from '../../components/v2/screens/continue/ContinueScreen';
import { SEND_COPY } from '../../components/v2/screens/signup/send-link';
import {
  VERIFY_TIMEOUT_MS,
  VERIFYING_COPY,
} from '../../components/v2/screens/signup/useLinkSender';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  widget.onToken = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mountForm() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<SignupForm pipeline={false} />));
  (host.querySelector('input[name="email"]') as HTMLInputElement).value = 'a@b.co';
  return host;
}
const submit = (host: HTMLElement) =>
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const button = (host: HTMLElement) =>
  host.querySelector('button[type="submit"]') as HTMLButtonElement;
const alertText = (host: HTMLElement) => host.querySelector('[role="alert"]')!.textContent;
const statusText = (host: HTMLElement) => host.querySelector('[role="status"]')!.textContent;

describe('a send that waits for Turnstile', () => {
  it('shows the widget and the verifying status, then sends once the widget answers', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const host = mountForm();
    expect(host.querySelector('[data-testid="turnstile"]')).toBeNull();
    submit(host);
    expect(host.querySelector('[data-testid="turnstile"]')).not.toBeNull();
    expect(statusText(host)).toBe(VERIFYING_COPY);
    expect(button(host).disabled).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => {
      widget.onToken!('tok-1');
      await new Promise((r) => setTimeout(r, 0));
    });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ turnstileToken: 'tok-1' });
  });

  it('a widget that fails frees the form with the verification copy', () => {
    const host = mountForm();
    submit(host);
    act(() => widget.onToken!(null));
    expect(alertText(host)).toBe(SEND_COPY.verification);
    expect(button(host).disabled).toBe(false);
    expect(host.querySelector('[data-testid="turnstile"]')).toBeNull();
  });

  it('a widget that never answers frees the form after the timeout', () => {
    vi.useFakeTimers();
    const host = mountForm();
    submit(host);
    expect(button(host).disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(VERIFY_TIMEOUT_MS);
    });
    expect(alertText(host)).toBe(SEND_COPY.verification);
    expect(button(host).disabled).toBe(false);
  });
});

describe('the live regions are in the page from the first render', () => {
  it.each([
    ['Sign-up', renderToStaticMarkup(<SignupScreen pipeline={false} />)],
    [
      'Check-email',
      renderToStaticMarkup(<CheckEmailScreen kind="signin" site={null} pipeline={false} />),
    ],
    ['Continue, expired', renderToStaticMarkup(<ContinueScreen state="expired" />)],
  ])('%s renders an alert and a status region while both are empty', (_, html) => {
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/role="status"/);
    expect(html).not.toMatch(/role="(alert|status)"[^>]*hidden/);
  });
});
