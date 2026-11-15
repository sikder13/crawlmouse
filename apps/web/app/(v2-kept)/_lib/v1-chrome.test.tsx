/**
 * `withoutV1Chrome`: a v1 page's output with v1's header and footer taken out, and nothing else
 * changed. The cases are synthetic page shapes, one for each shape a kept page has: chrome at the
 * top of a fragment, chrome inside a layout component, and chrome inside a wrapper that holds
 * nothing else (v1's report wraps each in a `no-print` div).
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { withoutV1Chrome } from './v1-chrome';

vi.mock('@/components/layout/Header', () => ({ Header: () => <header>v1 header</header> }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => <footer>v1 footer</footer> }));

const Note = ({ text }: { text: string }) => <p>{text}</p>;
const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main>
        <h1>{title}</h1>
        {children}
      </main>
      <Footer />
    </>
  );
}

describe('withoutV1Chrome', () => {
  it('takes the header and footer out of a page fragment and keeps the rest in its order', () => {
    const page = (
      <>
        <script type="application/ld+json">{'{}'}</script>
        <Header />
        <main className="m">
          <h1>Title</h1>
          <ul>
            {['a', 'b'].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Note text="kept" />
        </main>
        <Footer />
      </>
    );
    expect(html(withoutV1Chrome(page))).toBe(
      '<script type="application/ld+json">{}</script><main class="m"><h1>Title</h1><ul><li>a</li><li>b</li></ul><p>kept</p></main>',
    );
    expect(html(page)).toBe(
      '<script type="application/ld+json">{}</script><header>v1 header</header><main class="m"><h1>Title</h1><ul><li>a</li><li>b</li></ul><p>kept</p></main><footer>v1 footer</footer>',
    );
  });

  it('opens a layout it is given and takes the chrome out of what it renders', () => {
    const page = (
      <>
        <Note text="before" />
        <Layout title="Terms">
          <p>body</p>
        </Layout>
      </>
    );
    expect(html(withoutV1Chrome(page, [Layout]))).toBe(
      '<p>before</p><main><h1>Terms</h1><p>body</p></main>',
    );
  });

  it('does not open a component it is not given, so the chrome inside it is not found', () => {
    const page = (
      <Layout title="Terms">
        <p>body</p>
      </Layout>
    );
    expect(() => withoutV1Chrome(page)).toThrow(/one v1 Header and one v1 Footer, found 0 and 0/);
  });

  it('takes out a wrapper that holds only the chrome, with the chrome', () => {
    const page = (
      <>
        <div className="no-print">
          <Header />
        </div>
        <main>report</main>
        <div className="no-print">
          <Footer />
        </div>
      </>
    );
    expect(html(withoutV1Chrome(page))).toBe('<main>report</main>');
  });

  it('keeps a wrapper that holds the chrome and anything else', () => {
    const page = (
      <div className="frame">
        <Header />
        <main>x</main>
        <Footer />
      </div>
    );
    expect(html(withoutV1Chrome(page))).toBe('<div class="frame"><main>x</main></div>');
  });

  it('refuses a page with no chrome, or with more than one header or footer', () => {
    expect(() => withoutV1Chrome(<main>x</main>)).toThrow(/found 0 and 0/);
    expect(() =>
      withoutV1Chrome(
        <>
          <Header />
          <Header />
          <main />
          <Footer />
        </>,
      ),
    ).toThrow(/found 2 and 1/);
    expect(() =>
      withoutV1Chrome(
        <>
          <Header />
          <main />
        </>,
      ),
    ).toThrow(/found 1 and 0/);
  });

  it('leaves the element it was given as it was', () => {
    const page = (
      <>
        <Header />
        <main>x</main>
        <Footer />
      </>
    );
    withoutV1Chrome(page);
    expect(html(page)).toBe('<header>v1 header</header><main>x</main><footer>v1 footer</footer>');
  });
});
