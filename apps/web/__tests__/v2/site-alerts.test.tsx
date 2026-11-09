// @vitest-environment jsdom
/** The site page's alert switches: named by their rows, flipped, posted, and stopped in a preview. */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import { shellPreview, sitePreview } from '../../app/(v2-preview)/v2-preview/_preview/accounts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('Final-Site, the alert rules', () => {
  it('names each alert switch by its own row text, and posts the flip, stopped', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />));
    const switches = [...host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(switches).toHaveLength(6);
    for (const s of switches) {
      const row = s.closest('tr')!;
      expect(row.querySelector('th')!.textContent).toBe(s.getAttribute('aria-label'));
    }
    const anyChange = switches.at(-1)!;
    expect(anyChange.getAttribute('aria-checked')).toBe('false');
    const form = anyChange.closest('form')!;
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    act(() => anyChange.click());
    act(() => {
      form.dispatchEvent(submit);
    });
    expect(submit.defaultPrevented).toBe(true);
    expect(anyChange.getAttribute('aria-checked')).toBe('true');
    expect(form.getAttribute('action')).toBe(
      '/api/sites/50000000-0000-4000-8000-000000000001/alert-rules',
    );
  });
});
