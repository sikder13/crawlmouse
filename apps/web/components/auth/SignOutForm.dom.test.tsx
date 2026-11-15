// @vitest-environment jsdom
/** SignOutForm (CC-41 D1): resets PostHog on submit and leaves the POST to go on. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ph = vi.hoisted(() => ({ __loaded: true, reset: vi.fn() }));
vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return ph.__loaded;
    },
    reset: () => ph.reset(),
  },
}));

const { SignOutForm } = await import('./SignOutForm');
const { AuthNavView } = await import('../layout/AuthNavView');
const { MobileMenuView } = await import('../layout/MobileMenuView');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let submitted: boolean[];
const onSubmit = (e: Event) => {
  submitted.push(e.defaultPrevented);
  e.preventDefault(); // jsdom does not navigate; record whether anything before us prevented it.
};

beforeEach(() => {
  ph.__loaded = true;
  ph.reset.mockReset();
  submitted = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener('submit', onSubmit);
});

function submit() {
  window.addEventListener('submit', onSubmit);
  act(() => host.querySelector('button')!.click());
}

describe('SignOutForm', () => {
  it('posts to the logout route, as the forms it replaces did', () => {
    host.innerHTML = renderToStaticMarkup(
      <SignOutForm className="x">
        <button type="submit">Log out</button>
      </SignOutForm>,
    );
    const form = host.querySelector('form')!;
    expect(
      [...form.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => a!.localeCompare(b!)),
    ).toEqual([
      ['action', '/api/auth/logout'],
      ['class', 'x'],
      ['method', 'post'],
    ]);
    expect(form.innerHTML).toBe('<button type="submit">Log out</button>');
  });

  it('resets PostHog on submit, and the submit is not stopped', () => {
    act(() =>
      root.render(
        <SignOutForm>
          <button type="submit">Log out</button>
        </SignOutForm>,
      ),
    );
    submit();
    expect(ph.reset).toHaveBeenCalledTimes(1);
    expect(submitted).toEqual([false]);
  });

  it('a reset that throws does not stop the submit, and reaches no error handler', () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    ph.reset.mockImplementation(() => {
      throw new Error('boom');
    });
    act(() =>
      root.render(
        <SignOutForm>
          <button type="submit">Log out</button>
        </SignOutForm>,
      ),
    );
    submit();
    window.removeEventListener('error', onError);
    expect([submitted, errors]).toEqual([[false], []]);
  });

  it('resets nothing when PostHog has not started', () => {
    ph.__loaded = false;
    act(() =>
      root.render(
        <SignOutForm>
          <button type="submit">Log out</button>
        </SignOutForm>,
      ),
    );
    submit();
    expect(ph.reset).not.toHaveBeenCalled();
    expect(submitted).toEqual([false]);
  });

  it.each([
    ['the header menu', () => <AuthNavView email="jane@acme.com" />],
    ['the mobile menu', () => <MobileMenuView email="jane@acme.com" />],
  ])('%s signs out through it', (_n, view) => {
    act(() => root.render(view()));
    submit();
    expect(ph.reset).toHaveBeenCalledTimes(1);
  });
});
