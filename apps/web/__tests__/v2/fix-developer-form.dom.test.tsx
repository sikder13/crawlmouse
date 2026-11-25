// @vitest-environment jsdom
/**
 * The fix page's email form sends the steps the reader is looking at: its `framework` field follows
 * the framework switch, so the mail holds the body on screen.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FrameworkSwitch } from '../../components/v2/screens/fix/FrameworkSwitch';
import { ChosenDeveloperForm, PacketChoice } from '../../components/v2/screens/fix/PacketChoice';
import { emailDeveloperAction } from '../../lib/v2/view/account-actions';
import type { FrameworkOption, PacketBodyView } from '../../lib/v2/view/fix';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIX = '1c8e2d41-6b0d-4e9f-8a33-0e1d2c3b4a59';
const options: FrameworkOption[] = [
  { key: 'generic', label: 'Other' },
  { key: 'wordpress', label: 'WordPress' },
];
const bodies = options.map((o) => ({ key: o.key })) as unknown as PacketBodyView[];

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <PacketChoice>
        <FrameworkSwitch options={options} />
        <ChosenDeveloperForm
          action={emailDeveloperAction(FIX, 'Email this fix to my developer', 'about: a fix')}
          bodies={bodies}
        />
      </PacketChoice>,
    ),
  );
}

const field = () => host.querySelector<HTMLInputElement>('input[name="framework"]')!.value;
const press = (label: string) =>
  act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click());

describe('the email form on the fix page', () => {
  it('starts on the packet’s own body', () => {
    render();
    expect(field()).toBe('generic');
  });

  it('follows the switch, there and back', () => {
    render();
    press('WordPress');
    expect(field()).toBe('wordpress');
    press('Other');
    expect(field()).toBe('generic');
  });

  it('shows the address field on the live page', () => {
    render();
    expect(host.querySelector('input[name="email"]')).not.toBeNull();
  });
});
