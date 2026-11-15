import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';

/**
 * A v1 layout component that draws the chrome around what it is given (ArticleLayout, LegalPage).
 * Its props are its own; this module only hands an element's props back to its own component.
 */
export type V1Layout = (props: never) => ReactNode;

type Count = { header: number; footer: number };

const isChrome = (node: ReactNode): node is ReactElement =>
  isValidElement(node) && (node.type === Header || node.type === Footer);

/** A host element whose one child is v1's header or footer: v1's report wraps each in a div. */
function onlyChrome(node: ReactElement<{ children?: ReactNode }>): ReactElement | null {
  const { children } = node.props;
  const only = Array.isArray(children) && children.length === 1 ? children[0] : children;
  return typeof node.type === 'string' && isChrome(only) ? only : null;
}

function strip(node: ReactNode, layouts: readonly V1Layout[], count: Count): ReactNode {
  if (Array.isArray(node)) return node.map((n: ReactNode) => strip(n, layouts, count));
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  const chrome = isChrome(node) ? node : onlyChrome(node);
  if (chrome !== null) {
    if (chrome.type === Header) count.header += 1;
    else count.footer += 1;
    return null;
  }
  if (layouts.includes(node.type as V1Layout))
    return strip((node.type as V1Layout)(node.props as never), layouts, count);
  if (node.type !== Fragment && typeof node.type !== 'string') return node;
  const { children } = node.props;
  if (children === undefined) return node;
  // Spread an array of children back as arguments, as JSX passes them, so React reads them as
  // fixed children and not as a list that needs keys.
  return Array.isArray(children)
    ? cloneElement(node, undefined, ...(strip(children, layouts, count) as ReactNode[]))
    : cloneElement(node, undefined, strip(children, layouts, count));
}

/**
 * A v1 page's output (CC-36 D3) with v1's `Header` and `Footer` taken out, for the v2 shell to draw
 * its own around it. It reads the element tree the page returned: fragments and host elements are
 * walked, a component in `layouts` is rendered by calling it and its output walked, and any other
 * component is left as it is, unopened. A host element whose one child is the header or footer
 * goes with it. Everything else is the page's own element, in its own order.
 *
 * It throws unless it took out exactly one header and one footer, so a page whose chrome moved
 * where this does not look (inside a component it does not open) fails loudly rather than being
 * drawn with two headers.
 */
export function withoutV1Chrome(page: ReactNode, layouts: readonly V1Layout[] = []): ReactNode {
  const count: Count = { header: 0, footer: 0 };
  const stripped = strip(page, layouts, count);
  if (count.header !== 1 || count.footer !== 1)
    throw new Error(
      `withoutV1Chrome: expected one v1 Header and one v1 Footer, found ${count.header} and ${count.footer}`,
    );
  return stripped;
}
