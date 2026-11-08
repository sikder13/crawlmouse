// @vitest-environment jsdom
/**
 * Switch and Select as a reader uses them: the switch flips on a click and on the keys a native
 * button answers (Enter, Space), and posts the state it moves to; the select is a native select, so
 * the keyboard and the form are the browser's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Select, Switch } from '../../components/v2';

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

  it('flips on a click, and the form carries the state it moves to', () => {
    const host = mount(<Switch {...props} on />);
    const button = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    const posted = () => new FormData(host.querySelector('form')!).get('enabled');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(posted()).toBe('false');
    act(() => button.click());
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(posted()).toBe('true');
    expect(new FormData(host.querySelector('form')!).get('rule')).toBe('crawler_blocked');
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
