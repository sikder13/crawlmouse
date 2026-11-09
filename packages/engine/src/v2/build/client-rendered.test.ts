/**
 * The builder's side of the JS/SPA gate (OPERATING-RULES §5; CC-20b D8): what it hands the structure
 * detectors as served for JavaScript to fill in, and what a site of one app shell comes out as. The
 * detectors' own rule is pinned in detectors/client-rendered.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { RenderOutcome } from '../render/run.js';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import {
  SHELL_ROUTES,
  shellBuild,
  shellUrl,
  type ShellOptions,
} from '../../../fixtures/v2/build/shell-site.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { buildCheck } from './build.js';
import type { BuildInput } from './types.js';

const assembled = (input: BuildInput) =>
  assemble(input, readBatches(input.batches, input.check, input.lineage.worker_release));

const NOT_HOME = SHELL_ROUTES.filter((p) => p !== '/').map(shellUrl);

/** The built check's orphan and deep-page records, by state. */
function structureOf(o: ShellOptions) {
  const built = buildCheck(shellBuild(o));
  const records = built.grades.inputs.seo.detections.filter(
    (d) => d.type === 'orphan_pages' || d.type === 'deep_pages',
  );
  const where = (state: string) =>
    records
      .filter((d) => d.state === state)
      .map((d) => `${d.type} ${d.key.slice(d.key.indexOf(':') + 1)}`)
      .sort();
  return { built, records, detected: where('detected'), indeterminate: where('indeterminate') };
}
const both = (urls: readonly string[]) =>
  [...urls.map((u) => `deep_pages ${u}`), ...urls.map((u) => `orphan_pages ${u}`)].sort();

describe('what the builder hands the detectors as served for JavaScript to fill in', () => {
  it('the homepage, when its crawl row reads as an app shell, and its template', () => {
    const a = assembled(shellBuild({ clientRendered: true, shell: 'SHELL' }));
    expect(a.client_rendered).toEqual({
      homepage: true,
      templates: ['/', '/about', '/blog', '/contact', '/portfolio', '/services', '/work/{slug}'],
    });
    expect(
      assembled(shellBuild({ clientRendered: false, shell: 'SHELL' })).client_rendered,
    ).toEqual({ homepage: false, templates: [] });
  });

  it('a template, when one crawl row of it reads as an app shell: the recorded guides', () => {
    expect(assembled(recordedBuild()).client_rendered).toEqual({
      homepage: false,
      templates: ['/guides/{slug}'],
    });
  });

  it('a template, when the render found a page of it an empty shell', () => {
    const input = recordedBuild();
    const render = structuredClone(input.render) as RenderOutcome;
    const product = render.pages.find((p) => p.url.includes('/products/') && p.rendered)!;
    if (!product.rendered) throw new Error('the recorded render has no rendered product');
    product.without_js = { ...product.without_js, state: 'empty_shell' };
    expect(assembled({ ...input, render }).client_rendered.templates).toEqual([
      '/guides/{slug}',
      '/products/{slug}',
    ]);
    const partial = structuredClone(render);
    const again = partial.pages.find((p) => p.url === product.url)!;
    if (again.rendered) again.without_js = { ...again.without_js, state: 'partial' };
    expect(assembled({ ...input, render: partial }).client_rendered.templates).toEqual([
      '/guides/{slug}',
    ]);
  });
});

describe('a site of one app shell (www.alynthe.com, CC-12b)', () => {
  it('as measured (no text of its own): builds, and v1’s classifier already leaves the shells out as thin', () => {
    for (const clientRendered of [true, false]) {
      const { built, records } = structureOf({ clientRendered, shell: 'SHELL' });
      expect(built.page_results.map((p) => p.url).sort()).toEqual(
        SHELL_ROUTES.map(shellUrl).sort(),
      );
      for (const url of NOT_HOME) {
        expect(built.page_results.find((p) => p.url === url)!.kind, url).toBe('thin');
      }
      // A thin page is not judged at all, so this shape cannot test the gate: the next case does.
      expect(records).toEqual([]);
    }
  });

  it('with a line of text of its own, so the shells are content: no orphan and no deep page detected', () => {
    const { built, detected, indeterminate, records } = structureOf({
      clientRendered: true,
      shell: 'SHELL_WITH_TEXT',
    });
    for (const url of NOT_HOME) {
      expect(built.page_results.find((p) => p.url === url)!.kind, url).toBe('content');
    }
    expect(detected).toEqual([]);
    expect(indeterminate).toEqual(both(NOT_HOME));
    for (const r of records) expect(r, r.key).toMatchObject({ reason: 'client_rendered' });
    expect(built.page_results.filter((p) => p.is_orphan)).toEqual([]);
  });

  it('control: the same site, not read as an app shell, has every page but the homepage detected', () => {
    const { detected } = structureOf({ clientRendered: false, shell: 'SHELL_WITH_TEXT' });
    expect(detected).toEqual(both(NOT_HOME));
  });
});
