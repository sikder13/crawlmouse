import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import BlogPostPage, { generateMetadata } from '../../app/blog/[slug]/page';
import BlogIndex, { metadata as blogIndexMetadata } from '../../app/blog/page';

// Renders the blog's public surfaces the way a crawler receives them, reduced to the parts the
// SEO-protection rules name (OPERATING-RULES §13): title, description, canonical, H1, the article
// markup and the JSON-LD. Shared by the baseline capture and the non-regression tests, so the two
// cannot disagree about what "the same page" means. The tests that use it also pin each captured
// field against an independent source (the post metadata), so a helper that captured nothing would
// fail rather than compare empty to empty.

export interface PostSnapshot {
  /** The route metadata, JSON-normalised. */
  metadata: Record<string, unknown>;
  /** Text of the page's one <h1>. */
  h1: string;
  /** Number of <h1> elements on the page. */
  h1Count: number;
  /** outerHTML of <article>: header, byline line and body. Excludes the "Keep reading" aside. */
  articleHtml: string;
  /** Every JSON-LD block on the page, parsed. */
  jsonLd: unknown[];
}

export interface IndexSnapshot {
  metadata: Record<string, unknown>;
  /** outerHTML of the index's <main>. */
  mainHtml: string;
}

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const parse = (html: string): Document => new JSDOM(html).window.document;

export async function renderPostPage(slug: string): Promise<{ html: string; doc: Document }> {
  const element = await BlogPostPage({ params: Promise.resolve({ slug }) });
  const html = renderToStaticMarkup(element);
  return { html, doc: parse(html) };
}

export async function snapshotPost(slug: string): Promise<PostSnapshot> {
  const metadata = json(await generateMetadata({ params: Promise.resolve({ slug }) })) as Record<
    string,
    unknown
  >;
  const { doc } = await renderPostPage(slug);
  const h1s = [...doc.querySelectorAll('h1')];
  const article = doc.querySelector('article');
  const jsonLd = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(
    (s) => JSON.parse(s.textContent ?? 'null') as unknown,
  );
  return {
    metadata,
    h1: h1s[0]?.textContent ?? '',
    h1Count: h1s.length,
    articleHtml: article?.outerHTML ?? '',
    jsonLd,
  };
}

export function renderIndexHtml(): string {
  return renderToStaticMarkup(BlogIndex());
}

export function snapshotIndex(): IndexSnapshot {
  const doc = parse(renderIndexHtml());
  return {
    metadata: json(blogIndexMetadata) as Record<string, unknown>,
    mainHtml: doc.querySelector('main')?.outerHTML ?? '',
  };
}
