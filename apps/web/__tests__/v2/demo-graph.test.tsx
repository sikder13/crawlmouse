import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEMO_EDGES, DEMO_NODES, type GraphRole } from '../../components/v2/graph/demo-graph';
import { LinkMapGraph, edgeLength } from '../../components/v2/graph/LinkMapGraph';
import { lockedGraph, type LockedGraph } from './_lib/locked-graph';
import { WEB_ROOT, parseTokens, tokenMap } from './_lib/tokens-css';

const SCREENS = {
  home: lockedGraph('Final-Home.dc.html', 'aria-label="Map of a site'),
  result: lockedGraph('Final-Result.dc.html', 'class="thumb"'),
  resultDark: lockedGraph('Final-Result-Dark.dc.html', 'class="thumb"'),
};

/** Geometry only: colour and timing are compared separately. */
const geometry = (g: { edges: object[]; nodes: object[] }) => ({
  edges: (g.edges as LockedGraph['edges']).map(({ x1, y1, x2, y2, js }) => ({
    x1,
    y1,
    x2,
    y2,
    js,
  })),
  nodes: (g.nodes as Record<string, unknown>[]).map((n) =>
    Object.fromEntries(
      Object.entries(n).filter(([k]) => k !== 'fill' && k !== 'role' && k !== 'delay'),
    ),
  ),
});

describe('the demo link map', () => {
  it('is the graph the locked screens draw: Home stage and both Result thumbnails', () => {
    const ours = geometry({ edges: DEMO_EDGES, nodes: DEMO_NODES });
    expect(ours.edges).toHaveLength(89);
    expect(ours.nodes).toHaveLength(67);
    for (const [name, g] of Object.entries(SCREENS)) {
      expect(geometry(g), name).toEqual(ours);
    }
  });

  it('strokes every edge with the token whose value the locked screens use', () => {
    const decls = parseTokens();
    const light = tokenMap(decls, 'root');
    const dark = new Map([...light, ...tokenMap(decls, 'dark-media')]);
    const sheet = readFileSync(
      join(WEB_ROOT, 'components', 'v2', 'graph', 'LinkMapGraph.module.css'),
      'utf8',
    );
    const edgeToken = /\.edge \{[^}]*stroke: var\((--v2-[\w-]+)\)/.exec(sheet)?.[1] ?? '';
    const strokes = (file: string, marker: string) => {
      const html = readFileSync(
        join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'screens', file),
        'utf8',
      );
      const at = html.indexOf(marker);
      const svg = html.slice(at, html.indexOf('</svg>', at));
      return new Set(
        [...svg.matchAll(/<line class="ge[^"]*"[^>]*stroke="(#[0-9A-Fa-f]{6})"/g)].map((m) =>
          (m[1] ?? '').toLowerCase(),
        ),
      );
    };
    expect([...strokes('Final-Home.dc.html', 'aria-label="Map of a site')]).toEqual([
      light.get(edgeToken)?.value,
    ]);
    expect([...strokes('Final-Result-Dark.dc.html', 'class="thumb"')]).toEqual([
      dark.get(edgeToken)?.value,
    ]);
  });

  it('keeps the Home stage animation delays', () => {
    expect(DEMO_EDGES.map((e) => e.delay)).toEqual(SCREENS.home.edges.map((e) => e.delay));
    expect(DEMO_NODES.map((n) => n.delay)).toEqual(SCREENS.home.nodes.map((n) => n.delay));
  });

  it('colours each role exactly as the locked screens do, light and dark, through tokens', () => {
    const decls = parseTokens();
    const light = tokenMap(decls, 'root');
    const dark = new Map([...light, ...tokenMap(decls, 'dark-media')]);
    // Which token each role is painted with, read from the component's own stylesheet.
    const sheet = readFileSync(
      join(WEB_ROOT, 'components', 'v2', 'graph', 'LinkMapGraph.module.css'),
      'utf8',
    );
    const tokenOf = (cls: string, prop: 'fill' | 'stroke') => {
      const m = new RegExp(`\\.${cls} \\{[^}]*${prop}: var\\((--v2-[\\w-]+)\\)`).exec(sheet);
      if (!m?.[1]) throw new Error(`LinkMapGraph.module.css paints no .${cls} ${prop}`);
      return m[1];
    };
    const token = (m: typeof light, role: GraphRole) =>
      m.get(tokenOf(role, 'fill'))?.value.toLowerCase();
    const cases = [
      ['home', SCREENS.home, light],
      ['result', SCREENS.result, light],
      ['resultDark', SCREENS.resultDark, dark],
    ] as const;
    for (const [name, g, theme] of cases) {
      g.nodes.forEach((n, i) => {
        const role = DEMO_NODES[i]?.role;
        if (!role) throw new Error(`no node ${i}`);
        expect(n.fill.toLowerCase(), `${name} node ${i} (${role})`).toBe(token(theme, role));
      });
    }
  });

  it('keeps the locked dash length of every edge, each within 1.5px of the edge drawn', () => {
    expect(DEMO_EDGES.map((e) => e.dash)).toEqual(SCREENS.home.edges.map((e) => e.dash));
    const off = DEMO_EDGES.filter((e) => Math.abs(e.dash - edgeLength(e)) > 1.5);
    expect(off).toEqual([]);
  });
});

describe('LinkMapGraph', () => {
  const stage = renderToStaticMarkup(<LinkMapGraph variant="stage" label="Map of a site" />);
  const thumb = renderToStaticMarkup(<LinkMapGraph variant="thumb" />);

  it('draws every edge and node', () => {
    expect(stage.match(/<line /g)).toHaveLength(89);
    expect(stage.match(/<(circle|polygon|rect) /g)).toHaveLength(67);
  });

  it('labels the stage as an image and hides the thumbnail from screen readers', () => {
    expect(stage).toMatch(/<svg [^>]*role="img"[^>]*aria-label="Map of a site"/);
    expect(thumb).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(thumb).not.toContain('role="img"');
  });

  it('takes no colour from the markup: every fill and stroke comes from a token class', () => {
    expect(stage).not.toMatch(/(fill|stroke)="#/);
    expect(thumb).not.toMatch(/(fill|stroke)="#/);
  });

  it('never animates the thumbnail', () => {
    expect(thumb).toContain('data-v2-motion="none"');
  });
});
