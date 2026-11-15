/**
 * The kept v1 public pages the visual harness screenshots in both states (CC-36 D3): `v1`, the
 * page at its own address, which `next dev` serves as v1 with V2_CHECKS_PUBLIC unset, and
 * `/kept-preview/<slug>`, the same page in the v2 shell as its target draws it. Data only, so the
 * harness can import it. Pages that read a database row or a session (`/audit/<id>`,
 * `/verify/<id>`, a v1 `/r/<slug>`) are not here: the harness has no database.
 */
export interface KeptPreview {
  slug: string;
  name: string;
  /** The page's own address. */
  v1: string;
}

export const KEPT_PREVIEW_INDEX: readonly KeptPreview[] = [
  { slug: 'ai-readiness-checker', name: 'AI readiness checker', v1: '/ai-readiness-checker' },
  { slug: 'author', name: 'Author', v1: '/authors/udaay-sikder' },
  { slug: 'blog', name: 'Blog', v1: '/blog' },
  { slug: 'blog-research', name: 'Research', v1: '/blog/research' },
  { slug: 'blog-post', name: 'Blog post', v1: '/blog/orphan-pages' },
  { slug: 'bot', name: 'Our crawler', v1: '/bot' },
  { slug: 'guides', name: 'Guides', v1: '/guides' },
  { slug: 'login', name: 'Log in', v1: '/login' },
  { slug: 'status', name: 'Status', v1: '/status' },
  { slug: 'takedown', name: 'Takedown', v1: '/takedown' },
  { slug: 'privacy', name: 'Privacy', v1: '/privacy' },
  { slug: 'terms', name: 'Terms', v1: '/terms' },
  { slug: 'aup', name: 'Acceptable use', v1: '/aup' },
  { slug: 'subprocessors', name: 'Subprocessors', v1: '/subprocessors' },
];
