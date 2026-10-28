import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_ROOT } from './tokens-css';

/** The example link map as drawn in a locked screen: geometry, colour role and animation delay. */
export interface LockedGraph {
  edges: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    js: boolean;
    delay: number;
    /** stroke-dasharray, which the screens set to the edge's length for the draw animation. */
    dash: number;
  }[];
  nodes: (
    | { shape: 'circle'; cx: number; cy: number; r: number; fill: string; delay: number }
    | { shape: 'polygon'; points: string; fill: string; delay: number; origin: [number, number] }
    | {
        shape: 'rect';
        x: number;
        y: number;
        w: number;
        h: number;
        fill: string;
        delay: number;
        origin: [number, number];
      }
  )[];
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!m?.[1] && m?.[1] !== '') throw new Error(`no ${name} in ${tag}`);
  return m[1];
};
const num = (tag: string, name: string) => Number(attr(tag, name));
const delay = (tag: string) => Number(/animation-delay:([\d.]+)s/.exec(tag)?.[1] ?? 'NaN');
const origin = (tag: string): [number, number] => {
  const m = /transform-origin:(-?[\d.]+)px (-?[\d.]+)px/.exec(tag);
  return [Number(m?.[1]), Number(m?.[2])];
};

/** Parse the graph elements (class ge / gn) of the first <svg> carrying `marker` in a screen. */
export function lockedGraph(screen: string, marker: string): LockedGraph {
  const html = readFileSync(
    join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'screens', screen),
    'utf8',
  );
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`${marker} not found in ${screen}`);
  const svg = html.slice(start, html.indexOf('</svg>', start));
  const edges: LockedGraph['edges'] = [];
  const nodes: LockedGraph['nodes'] = [];
  for (const [tag] of svg.matchAll(/<(line|circle|polygon|rect) class="g[en][^>]*>/g)) {
    if (tag.startsWith('<line')) {
      edges.push({
        x1: num(tag, 'x1'),
        y1: num(tag, 'y1'),
        x2: num(tag, 'x2'),
        y2: num(tag, 'y2'),
        js: /class="ge ejs"/.test(tag),
        delay: delay(tag),
        dash: Number(/stroke-dasharray:([\d.]+)/.exec(tag)?.[1] ?? 'NaN'),
      });
    } else if (tag.startsWith('<circle')) {
      nodes.push({
        shape: 'circle',
        cx: num(tag, 'cx'),
        cy: num(tag, 'cy'),
        r: num(tag, 'r'),
        fill: attr(tag, 'fill'),
        delay: delay(tag),
      });
    } else if (tag.startsWith('<polygon')) {
      nodes.push({
        shape: 'polygon',
        points: attr(tag, 'points'),
        fill: attr(tag, 'fill'),
        delay: delay(tag),
        origin: origin(tag),
      });
    } else {
      nodes.push({
        shape: 'rect',
        x: num(tag, 'x'),
        y: num(tag, 'y'),
        w: num(tag, 'width'),
        h: num(tag, 'height'),
        fill: attr(tag, 'fill'),
        delay: delay(tag),
        origin: origin(tag),
      });
    }
  }
  return { edges, nodes };
}
