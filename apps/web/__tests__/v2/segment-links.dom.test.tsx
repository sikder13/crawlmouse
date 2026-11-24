// @vitest-environment jsdom
/**
 * Links and pages rendered by the client, which (unlike a server render) checks that each list's
 * children carry distinct keys and says so on console.error.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { LinksScreen } from '../../components/v2/screens/segment/LinksScreen';
import { fixture } from '../../lib/v2/fixtures';
import { linksView } from '../../lib/v2/view/segment/links';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Links and pages, rows keyed by full URL', () => {
  it('renders two pages that share a path on two schemes without a duplicate key', () => {
    const d = structuredClone(fixture('built-site'));
    const id = d.checks[0]!.id;
    const served = d.page_results.filter((p) => p.check_id === id && p.status_code === 200);
    // A guide: no meta description, and the title "Guide" that two other pages share.
    const [a] = served.filter((p) => !p.meta_description?.text);
    d.page_results.push({ ...structuredClone(a!), url: a!.url.replace('https:', 'http:') });
    const view = linksView(d, id);
    // The twin is listed under the same path as its page: the case a key by path collides on.
    const paths = view.descriptions.missing.shown.map((p) => p.path);
    expect(new Set(paths).size).toBeLessThan(paths.length);

    const errors: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')));
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      act(() => root.render(<LinksScreen data={view} />));
    } finally {
      act(() => root.unmount());
      spy.mockRestore();
    }
    expect(errors.filter((e) => /same key/.test(e))).toEqual([]);
  });
});
