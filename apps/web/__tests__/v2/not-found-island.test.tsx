/**
 * The wiring of the root 404's island (RC-20): the loader `next/dynamic` is actually given survives a
 * failed chunk, and no static edge brings the v2 screen into the payload of every page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loader: null as null | (() => Promise<ComponentType>),
  options: null as null | { ssr?: boolean },
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<ComponentType>, options: { ssr?: boolean }) => {
    h.loader = loader;
    h.options = options;
    return () => null;
  },
}));

const SCREEN = '../../components/v2/screens/not-found/NotFoundScreen';
const WEB = join(__dirname, '../..');
const read = (file: string) => readFileSync(join(WEB, file), 'utf8');

/** Every static edge of a module: `import … from`, a bare `import`, and `export … from`. */
function staticEdges(source: string): string[] {
  const file = ts.createSourceFile(
    'm.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edges: string[] = [];
  for (const st of file.statements) {
    if (ts.isImportDeclaration(st) && !st.importClause?.isTypeOnly) {
      edges.push((st.moduleSpecifier as ts.StringLiteral).text);
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && !st.isTypeOnly) {
      edges.push((st.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return edges;
}

const v2Edges = (source: string) =>
  staticEdges(source).filter((m) => /components\/v2|styles\/v2|^\.\.?\//.test(m));

afterEach(() => {
  vi.doUnmock(SCREEN);
  vi.resetModules();
});

describe('the loader next/dynamic receives', () => {
  it('runs in the browser only', async () => {
    await import('../../components/v2/screens/not-found/NotFoundIsland');
    expect(h.options?.ssr).toBe(false);
  });

  it('resolves to the plain 404 when the chunk fails', async () => {
    vi.resetModules();
    vi.doMock(SCREEN, () => {
      throw new Error('chunk failed');
    });
    await import('../../components/v2/screens/not-found/NotFoundIsland');
    const Loaded = await h.loader!();
    const html = renderToStaticMarkup(<Loaded />);
    expect(html).toContain('<h1>This page isn’t here</h1>');
    expect(html).toContain('href="/"');
  });

  it('resolves to the screen when the chunk arrives', async () => {
    vi.resetModules();
    const Marker = () => null;
    vi.doMock(SCREEN, () => ({ NotFoundScreen: Marker }));
    await import('../../components/v2/screens/not-found/NotFoundIsland');
    expect(await h.loader!()).toBe(Marker);
  });
});

describe('the static edges of the root 404', () => {
  it('reads every spelling of a static edge', () => {
    for (const planted of [
      `import { A } from './NotFoundScreen';`,
      `import { A } from "./NotFoundScreen"`,
      `import {\n  A,\n  B,\n} from './NotFoundScreen';`,
      `import './NotFoundScreen';`,
      `import * as S from '@/components/v2/PageShell';`,
      `export { NotFoundScreen } from './NotFoundScreen';`,
      `export * from "@/components/v2/PageShell"`,
    ]) {
      expect(v2Edges(planted), planted).toHaveLength(1);
    }
    expect(v2Edges(`import type { A } from './NotFoundScreen';`)).toEqual([]);
    expect(v2Edges(`const load = () => import('./NotFoundScreen');`)).toEqual([]);
  });

  it('app/not-found.tsx reaches v2 only through the island', () => {
    expect(v2Edges(read('app/not-found.tsx'))).toEqual([
      '@/components/v2/screens/not-found/NotFoundIsland',
    ]);
  });

  it('the island has no static edge to a v2 component or stylesheet', () => {
    expect(v2Edges(read('components/v2/screens/not-found/NotFoundIsland.tsx'))).toEqual([]);
  });
});
