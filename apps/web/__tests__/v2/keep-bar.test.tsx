// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeepBar } from '../../components/v2/screens/result/KeepBar';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { numberWord } from '../../components/v2/screens/words';
import { RESULT_FIXTURE } from '../../app/(v2-preview)/v2-preview/_fixtures/result';

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

describe('KeepBar', () => {
  it('posts, and stops the submit, so an email never lands in a URL', () => {
    const host = mount(<KeepBar domain="x.com" expires="26 Oct, 02:34 UTC" initial="open" />);
    const form = host.querySelector('form');
    expect(form?.getAttribute('method')).toBe('post');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      form?.dispatchEvent(submit);
    });
    expect(submit.defaultPrevented).toBe(true);
  });

  it('dismisses to the expiry line, and opens again', () => {
    const host = mount(<KeepBar domain="x.com" expires="26 Oct, 02:34 UTC" initial="open" />);
    const notNow = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Not now');
    act(() => notNow?.click());
    expect(host.textContent).toContain('Not kept. This page expires 26 Oct, 02:34 UTC.');
    const keep = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Keep this audit',
    );
    act(() => keep?.click());
    expect(host.querySelector('form')).not.toBeNull();
  });
});

describe('number words', () => {
  it('spells up to twenty and writes larger counts in digits', () => {
    expect(numberWord(14)).toBe('fourteen');
    expect(numberWord(20)).toBe('twenty');
    expect(numberWord(21)).toBe('21');
    expect(numberWord(1284)).toBe('1,284');
    expect(() => numberWord(-1)).toThrow();
    expect(() => numberWord(1.5)).toThrow();
  });

  it('renders a result with more than twenty fixes', () => {
    const rows = [...RESULT_FIXTURE.fixes.rows];
    const last = rows.pop()!;
    rows.push({ ...last, count: last.count + 7 });
    const out = renderToStaticMarkup(
      <ResultScreen data={{ ...RESULT_FIXTURE, fixes: { total: 21, rows } }} />,
    );
    expect(out).toContain('21 fixes, in order of impact');
    expect(out).toContain('All 21, and this site checked every week.');
  });
});
