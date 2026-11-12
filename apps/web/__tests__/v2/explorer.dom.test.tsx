// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Explorer } from '../../components/v2/screens/map/Explorer';
import { FrameworkSwitch, switchedTo } from '../../components/v2/screens/fix/FrameworkSwitch';
import { ChosenPacket, PacketChoice } from '../../components/v2/screens/fix/PacketChoice';
import { mapPreview } from '../../app/(v2-preview)/v2-preview/_preview/maps';
import { FIX_SOURCES, fixIdOf } from '../../app/(v2-preview)/v2-preview/_preview/fixes';
import { EXPLORER_KEYS } from '../../components/v2/screens/map/keys';
import { fixture } from '../../lib/v2/fixtures';
import { fixView } from '../../lib/v2/view/fix';
import { withBodies } from '../../lib/v2/view/test-support/multi-body';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The explorer and the framework switch, operated: the keys move the selection along the list in
 * its order, the status line names what changed, Enter takes the focus to the details, and the
 * one orange element follows the page selected.
 */
let root: Root | null = null;
const mount = (el: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom lays nothing out: scrolling into view is a no-op there.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
};
const click = (el: Element) => act(() => (el as HTMLElement).click());

describe('the explorer’s list, by keyboard', () => {
  const data = mapPreview('all');
  const listbox = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="listbox"]')!;
  const active = (host: HTMLElement) => listbox(host).getAttribute('aria-activedescendant')!;
  const at = (host: HTMLElement) => Number(active(host).replace('v2-map-option-', ''));

  it('names an option that exists, the one selected, and only one', () => {
    const host = mount(<Explorer data={data} />);
    expect(host.querySelector(`#${active(host)}`)?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(data.order.length);
  });

  it('moves with the arrows, in the list’s order, and stops at its ends', () => {
    const host = mount(<Explorer data={data} />);
    const start = at(host);
    press(listbox(host), 'ArrowDown');
    expect(at(host)).toBe(start + 1);
    press(listbox(host), 'ArrowRight');
    expect(at(host)).toBe(start + 2);
    press(listbox(host), 'ArrowUp');
    press(listbox(host), 'ArrowLeft');
    expect(at(host)).toBe(start);
    press(listbox(host), 'Home');
    expect(at(host)).toBe(0);
    press(listbox(host), 'ArrowUp');
    expect(at(host)).toBe(0);
    press(listbox(host), 'End');
    expect(at(host)).toBe(data.order.length - 1);
    press(listbox(host), 'ArrowDown');
    expect(at(host)).toBe(data.order.length - 1);
    expect(host.querySelector('[data-v2-selected]')?.getAttribute('data-v2-selected')).toBe(
      data.order.at(-1),
    );
  });

  it('acts on every key the model lists, and leaves a key with a modifier to the browser', () => {
    const host = mount(<Explorer data={data} />);
    for (const k of EXPLORER_KEYS) {
      expect(press(listbox(host), k.key).defaultPrevented, k.key).toBe(true);
    }
    const before = at(host);
    const back = press(listbox(host), 'ArrowLeft', { altKey: true });
    expect(back.defaultPrevented).toBe(false);
    expect(at(host)).toBe(before);
  });

  it('takes the focus to the selected page’s details on Enter, named by its label', () => {
    const host = mount(<Explorer data={data} />);
    press(listbox(host), 'Enter');
    expect(document.activeElement?.id).toBe('v2-map-selected');
    // A name is allowed on a group, not on a bare div (axe aria-prohibited-attr).
    expect(document.activeElement?.getAttribute('role')).toBe('group');
    expect(document.activeElement?.getAttribute('aria-labelledby')).toBe(
      'v2-map-selected-label v2-map-selected',
    );
  });

  it('says what the option does not, once the selection rests', () => {
    const host = mount(<Explorer data={mapPreview('bad-site')} />);
    const status = host.querySelector('p[role="status"]')!;
    press(listbox(host), 'Home');
    expect(status.textContent).toBe('');
    act(() => vi.advanceTimersByTime(300));
    // The home page's record, less its depth, which the option already reads: its text without
    // JavaScript (0.94) and its links in (190).
    expect(status.textContent).toBe('94% text without JS, 190 links in.');
  });
});

describe('the explorer’s controls', () => {
  it('shows the list in List view, and hides it again', () => {
    const host = mount(<Explorer data={mapPreview('bad-site')} />);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'List view')!;
    const list = host.querySelector('[role="listbox"]')!;
    expect(list.hasAttribute('data-v2-sr-only')).toBe(true);
    click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(list.hasAttribute('data-v2-sr-only')).toBe(false);
    click(button);
    expect(list.hasAttribute('data-v2-sr-only')).toBe(true);
  });

  it('presses one filter at a time, and says what it picks out', () => {
    const data = mapPreview('all');
    const host = mount(<Explorer data={data} />);
    const group = host.querySelector('[role="group"][aria-label="Show only"]')!;
    const [orphans, js] = [...group.querySelectorAll('button')];
    click(orphans!);
    expect(orphans!.getAttribute('aria-pressed')).toBe('true');
    click(js!);
    expect(orphans!.getAttribute('aria-pressed')).toBe('false');
    expect(js!.getAttribute('aria-pressed')).toBe('true');
    act(() => vi.advanceTimersByTime(300));
    expect(host.querySelector('p[role="status"]')!.textContent).toBe(data.filters[1]!.note);
  });

  it('says nothing of the page before when the selection moves to a page with no record', () => {
    const data = mapPreview('all');
    const host = mount(<Explorer data={data} />);
    const listbox = host.querySelector('[role="listbox"]')!;
    const status = host.querySelector('p[role="status"]')!;
    press(listbox, 'Home');
    expect(data.details[data.order[0]!]).toBeDefined();
    expect(data.details[data.order[1]!]).toBeUndefined();
    press(listbox, 'ArrowDown');
    act(() => vi.advanceTimersByTime(300));
    expect(status.textContent).toBe('');
  });

  it('keeps the focus in the zoom group when a button disables itself', () => {
    const host = mount(<Explorer data={mapPreview('bad-site')} />);
    const zoomIn = host.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
    click(zoomIn);
    const fit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Fit')!;
    act(() => fit.focus());
    click(fit);
    expect(fit.disabled).toBe(true);
    expect(document.activeElement).toBe(zoomIn);
  });

  it('disables zoom at its ends', () => {
    const host = mount(<Explorer data={mapPreview('bad-site')} />);
    const zoomIn = host.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
    const zoomOut = host.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')!;
    expect(zoomOut.disabled).toBe(true);
    for (let i = 0; i < 10; i++) click(zoomIn);
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
  });

  it('shows a search that finds nothing, as well as saying it', () => {
    const host = mount(<Explorer data={mapPreview('bad-site')} />);
    const input = host.querySelector<HTMLInputElement>('#v2-map-find')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '/no-such-page');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.form!.requestSubmit();
    });
    expect(host.textContent).toContain('No page on this map matches “/no-such-page”.');
  });
});

describe('the explorer’s one orange element follows the page selected', () => {
  const primaries = (host: HTMLElement) => [...host.querySelectorAll('[data-v2-primary]')];

  it('is the fix link on a page with one, and the keep bar’s button on a page without', () => {
    const data = mapPreview('bad-site');
    const host = mount(<Explorer data={data} />);
    expect(primaries(host).map((e) => e.textContent)).toEqual(['Open the fix for this template']);
    const withoutFix = data.order.find((p) => !data.details[p]?.fix)!;
    const listbox = host.querySelector('[role="listbox"]')!;
    press(listbox, 'Home');
    expect(data.order[0]).toBe(withoutFix);
    expect(primaries(host).map((e) => e.textContent)).toEqual(['Keep it']);
  });

  it('is the link to the section’s fixes where there is no fix link and no keep bar', () => {
    const host = mount(<Explorer data={mapPreview('challenged')} />);
    expect(primaries(host).map((e) => e.textContent)).toEqual([
      mapPreview('challenged').frame.next.label,
    ]);
  });
});

describe('the framework switch, operated', () => {
  /** Fix 2 of the bad site with a WordPress body and one for any stack beside its Next.js one. */
  const view = (() => {
    const d = structuredClone(fixture('bad-site'));
    const f = d.fixes.find((x) => x.id === fixIdOf('bad-site'))!;
    f.packet = withBodies(f.packet!, ['wordpress', 'generic']);
    const v = fixView(d, FIX_SOURCES['bad-site'].check, f.id, { asFirstSeen: true });
    if (v.kind !== 'open' || !v.packet || !v.switcher) throw new Error('fix 2 opens with a switch');
    return { packet: v.packet, switcher: v.switcher };
  })();
  const page = () =>
    mount(
      <PacketChoice>
        <ChosenPacket bodies={view.packet.bodies} download={view.packet.download} ask="#keep" />
        <FrameworkSwitch options={view.switcher.options} />
      </PacketChoice>,
    );
  const toggles = (host: HTMLElement) => [
    ...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Front end"] button'),
  ];
  const pressed = (host: HTMLElement) =>
    toggles(host)
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent);
  const copyButton = (host: HTMLElement) =>
    [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Copy as a prompt'),
    )!;
  const [next, wordpress, generic] = view.packet.bodies;

  it('opens on the packet’s own body, its toggle pressed, with nothing said yet', () => {
    const host = page();
    expect(toggles(host).map((b) => b.textContent)).toEqual(['Next.js', 'WordPress', 'Other']);
    expect(pressed(host)).toEqual(['Next.js']);
    expect(host.querySelector('pre')!.textContent).toBe(next!.block);
    expect(host.textContent).toContain(next!.stack);
    expect(host.querySelector('p[role="status"]')!.textContent).toBe('');
  });

  it('shows the body of the framework chosen, presses its toggle alone, and says so', () => {
    const host = page();
    click(toggles(host)[1]!);
    expect(pressed(host)).toEqual(['WordPress']);
    expect(host.querySelector('pre')!.textContent).toBe(wordpress!.block);
    expect(host.textContent).toContain(wordpress!.stack);
    expect(host.textContent).not.toContain(next!.stack);
    expect(host.querySelector('p[role="status"]')!.textContent).toBe(
      'The packet now shows the steps written for WordPress.',
    );
    click(toggles(host)[2]!);
    expect(pressed(host)).toEqual(['Other']);
    expect(host.querySelector('pre')!.textContent).toBe(generic!.block);
    expect(host.querySelector('p[role="status"]')!.textContent).toBe(switchedTo(generic!));
    expect(switchedTo(generic!)).toBe('The packet now shows the steps written for any stack.');
    // Back to the packet's own framework.
    click(toggles(host)[0]!);
    expect(host.querySelector('pre')!.textContent).toBe(next!.block);
  });

  it('copies the prompt of the body shown, under a button whose name does not change', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const host = page();
    const name = copyButton(host).textContent;
    expect(name).toBe('Copy as a prompt for your coding tool');
    await act(async () => copyButton(host).click());
    click(toggles(host)[1]!);
    expect(copyButton(host).textContent).toBe(name);
    await act(async () => copyButton(host).click());
    expect(writeText.mock.calls.map((c) => c[0])).toEqual([next!.prompt, wordpress!.prompt]);
    expect(next!.prompt).not.toBe(wordpress!.prompt);
  });

  it('keeps the focus on the toggle chosen, by click and by keyboard', () => {
    const host = page();
    const [, second] = toggles(host);
    second!.focus();
    click(second!);
    expect(document.activeElement).toBe(toggles(host)[1]);
    // A toggle is a button: it is in the tab order, and the browser's Enter and Space click it.
    for (const b of toggles(host)) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.tabIndex).toBe(0);
      expect(b.disabled).toBe(false);
    }
  });

  it('a switch outside the choice it sets is a programming error, not a dead control', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount(<FrameworkSwitch options={view.switcher.options} />)).toThrow(
      /outside PacketChoice/,
    );
    spy.mockRestore();
  });
});
