// @vitest-environment jsdom
/**
 * The Settings forms on a live page (CC-27b D6): a preview stops each submit, and under
 * `LiveActions` the same form submits. The switch, the account form and an action's form, alike.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Switch } from '../../components/v2';
import { ActionControl } from '../../components/v2/screens/account/ActionControl';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import { StoppedForm } from '../../components/v2/screens/settings/StoppedForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Whether a click on the form's submit button left the submit to the browser. */
function submits(el: ReactElement): boolean {
  // jsdom does not navigate; it reports a submit it was left to do on the console.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  let prevented: boolean | null = null;
  const listen = (e: Event) => {
    prevented = e.defaultPrevented;
  };
  document.addEventListener('submit', listen);
  act(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  document.removeEventListener('submit', listen);
  if (prevented === null) throw new Error('no submit happened');
  return !prevented;
}

const FORMS: [string, () => ReactElement][] = [
  [
    'a switch',
    () => <Switch label="Notes" name="change_notes" on action="/api/account" fields={{}} />,
  ],
  [
    'the account form',
    () => (
      <StoppedForm action="/api/account">
        <button type="submit">Save</button>
      </StoppedForm>
    ),
  ],
  [
    'an action’s form',
    () => (
      <ActionControl
        action={{
          label: 'Cancel, back to Free',
          route: '/api/billing/cancel',
          href: '/api/billing/cancel',
          method: 'post',
          fields: {},
          primary: false,
          context: null,
        }}
      />
    ),
  ],
];

describe.each(FORMS)('%s', (_name, form) => {
  it('is stopped in a preview', () => {
    expect(submits(form())).toBe(false);
  });

  it('submits under LiveActions', () => {
    expect(submits(<LiveActions>{form()}</LiveActions>)).toBe(true);
  });
});
