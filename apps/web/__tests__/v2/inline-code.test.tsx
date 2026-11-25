/**
 * D-30: the fix page drew the engine's Markdown backticks as they are ("the template `/x/{slug}`").
 * Its prose now draws each backticked span as code; the packet keeps its Markdown in its <pre>.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InlineCode } from '../../components/v2/InlineCode';
import { FixScreen } from '../../components/v2/screens/fix/FixScreen';
import { FIX_SOURCES, fixIdOf } from '../../app/(v2-preview)/v2-preview/_preview/fixes';
import { fixture } from '../../lib/v2/fixtures';
import { fixView } from '../../lib/v2/view/fix';

const html = (text: string) => renderToStaticMarkup(<InlineCode text={text} />);

describe('InlineCode', () => {
  it.each([
    ['the template `/services/{slug}`', 'the template <code>/services/{slug}</code>'],
    ['`author` on the Article node', '<code>author</code> on the Article node'],
    ['`a` and `b`', '<code>a</code> and <code>b</code>'],
    ['no code here', 'no code here'],
    ['one ` alone', 'one ` alone'],
    ['`a` and one `', '`a` and one `'],
    ['<b>`x`</b>', '&lt;b&gt;<code>x</code>&lt;/b&gt;'],
  ])('%j', (text, out) => {
    expect(html(text)).toBe(out);
  });
});

describe('the fix page’s prose (D-30)', () => {
  it('draws a backticked span of its lede as code, and keeps the packet’s Markdown', () => {
    const d = structuredClone(fixture('bad-site'));
    const { check, asFirstSeen } = FIX_SOURCES['bad-site'];
    const view = fixView(d, check, fixIdOf('bad-site'), { asFirstSeen });
    const withCode = {
      ...view,
      head: { ...view.head, lede: ['Add an author on the template `/services/{slug}`.'] },
    } as typeof view;
    const markup = renderToStaticMarkup(<FixScreen data={withCode} />);
    expect(markup).toContain('the template <code>/services/{slug}</code>.');
    expect(markup).not.toContain('`/services/{slug}`');
  });
});
