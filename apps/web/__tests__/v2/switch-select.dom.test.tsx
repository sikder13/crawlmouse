// @vitest-environment jsdom
/**
 * Switch and Select as a reader uses them: the switch flips on a click and on the keys a native
 * button answers (Enter, Space), and posts the state it moves to; the select is a native select, so
 * the keyboard and the form are the browser's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Select, Switch } from '../../components/v2';
import { StoppedForm } from '../../components/v2/screens/settings/StoppedForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

describe('Switch', () => {
  const props = {
    label: 'A crawler becomes blocked',
    name: 'enabled',
    action: '/api/alert-rules',
    fields: { rule: 'crawler_blocked' },
  };

  it('posts the state it moves to, read when the form is submitted, then flips', () => {
    vi.useFakeTimers();
    const host = mount(<Switch {...props} on />);
    const button = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    const posted: (string | null)[] = [];
    let stopped = false;
    // On the document, so React's listener on its root has run first.
    document.addEventListener('submit', (e) => {
      posted.push(new FormData(e.target as HTMLFormElement).get('enabled') as string);
      stopped = e.defaultPrevented;
    });
    act(() => button.click());
    // Read at submit: the click turns the switch off. What the browser reads after React has
    // re-rendered is pinned in a real browser, tests/visual/switch.spec.ts.
    expect(posted).toEqual(['false']);
    expect(new FormData(host.querySelector('form')!).get('rule')).toBe('crawler_blocked');
    act(() => vi.runAllTimers());
    expect(button.getAttribute('aria-checked')).toBe('false');
    // The preview stops the submit: no route is built yet (CC-27b).
    expect(stopped).toBe(true);
    vi.useRealTimers();
  });

  it('is a native submit button in the tab order, named by its row text (the browser gives it Enter and Space)', () => {
    const host = mount(<Switch {...props} on={false} />);
    const button = host.querySelector<HTMLButtonElement>('button')!;
    expect(button.type).toBe('submit');
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-label')).toBe('A crawler becomes blocked');
  });
});

describe('Select', () => {
  it('is a native select with its label tied to it and the given option chosen', () => {
    const host = mount(
      <Select
        id="site"
        label="Site"
        name="siteId"
        defaultValue="b"
        options={[
          { value: 'a', label: 'example-outfitter.com' },
          { value: 'b', label: 'nahltech.com' },
        ]}
      />,
    );
    const select = host.querySelector('select')!;
    expect(host.querySelector('label')!.htmlFor).toBe('site');
    expect(select.id).toBe('site');
    expect(select.name).toBe('siteId');
    expect(select.value).toBe('b');
    expect([...select.options].map((o) => o.text)).toEqual([
      'example-outfitter.com',
      'nahltech.com',
    ]);
  });
});

describe('StoppedForm', () => {
  it('stops its submit: the account form posts nowhere in a preview', () => {
    const host = mount(
      <StoppedForm action="/api/account">
        <button type="submit">Save</button>
      </StoppedForm>,
    );
    let stopped = false;
    // On the document, so React's listener on its root has run first.
    document.addEventListener('submit', (e) => {
      stopped = e.defaultPrevented;
    });
    act(() => host.querySelector('button')!.click());
    expect(stopped).toBe(true);
  });
});
