import type { LayoutNode } from './map-layout';

/**
 * What the map shows, counted from its nodes so the description cannot disagree with the picture.
 */
export function mapLabel(nodes: readonly LayoutNode[], building: boolean): string {
  const count = (k: LayoutNode['kind']) => nodes.filter((n) => n.kind === k).length;
  const pages = nodes.length;
  const head = building
    ? `Map of the site's internal links, building as pages are crawled: ${pages} ${pages === 1 ? 'page' : 'pages'} reached so far`
    : `Map of the site's internal links: ${pages} ${pages === 1 ? 'page' : 'pages'}, each linked page drawn from the first page found linking to it`;
  const orphans = count('orphan');
  const js = count('js_only');
  const tail = [
    orphans ? `${orphans} orphan ${orphans === 1 ? 'page' : 'pages'} with no links in` : null,
    js ? `${js} ${js === 1 ? 'page' : 'pages'} reachable only through JavaScript` : null,
  ].filter(Boolean);
  return tail.length ? `${head}; ${tail.join(', ')}` : head;
}
