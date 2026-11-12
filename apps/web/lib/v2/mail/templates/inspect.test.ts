import { describe, expect, it } from 'vitest';
import { anchorCount, foreignTargets, htmlTargets, startTags } from './inspect';

const EVIL = 'https://evil.example/x';
const mail = (html: string) => ({ subject: 's', text: 't', html });

describe('htmlTargets reads a link in any spelling a browser follows (§10: vary what the matcher keys on)', () => {
  it.each([
    ['double-quoted', `<a href="${EVIL}">x</a>`],
    ['single-quoted', `<a href='${EVIL}'>x</a>`],
    ['unquoted', `<a href=${EVIL}>x</a>`],
    ['upper-case tag and attribute', `<A HREF="${EVIL}">x</A>`],
    ['mixed case', `<a hReF='${EVIL}'>x</a>`],
    ['spaces around =', `<a href = "${EVIL}">x</a>`],
    ['line breaks and tabs around =', `<a\nhref\t=\n'${EVIL}'>x</a>`],
    ['after other attributes', `<a style="color:red" title='t' href=${EVIL} >x</a>`],
    ['a slash before the attribute', `<a/href="${EVIL}">x</a>`],
    ['decimal references', `<a href="&#104;ttps://evil.example/x">x</a>`],
    ['hex references', `<a href="&#x68;ttps&#x3A;//evil.example/x">x</a>`],
    ['named references', `<a href="https&colon;&sol;&sol;evil&period;example/x">x</a>`],
    ['src', `<img src='${EVIL}'>`],
    ['background, unquoted', `<td background=${EVIL}>`],
    ['srcset', `<img srcset="${EVIL} 2x">`],
    ['form action', `<form ACTION=${EVIL}>`],
  ])('%s', (_, html) => {
    const targets = htmlTargets(html);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.startsWith('https://evil.example/x')).toBe(true);
    expect(foreignTargets(mail(html))).toHaveLength(1);
  });

  it('reads a target with a tab or line break inside it as the browser does', () => {
    expect(
      foreignTargets(mail(`<a href="https://crawlmouse.com.evil.example/">x</a>`)),
    ).toHaveLength(1);
    expect(foreignTargets(mail(`<a href=" https://crawl\tmouse.com/audit/x">x</a>`))).toEqual([]);
    expect(foreignTargets(mail(`<a href="javascript:alert(1)">x</a>`))).toHaveLength(1);
  });

  it('accepts our origin only, and reads text, comments and escaped markup as no link', () => {
    const ours = `<a href='https://crawlmouse.com/audit/1'>a</a><a HREF=https://crawlmouse.com/alerts>b</a>`;
    expect(foreignTargets(mail(ours))).toEqual([]);
    expect(htmlTargets(ours)).toEqual([
      'https://crawlmouse.com/audit/1',
      'https://crawlmouse.com/alerts',
    ]);
    const text = `<p>&lt;a href="${EVIL}"&gt;x&lt;/a&gt; and href=${EVIL} and a < b</p><!-- <a href="${EVIL}"> -->`;
    expect(htmlTargets(text)).toEqual([]);
    expect(anchorCount(text)).toBe(0);
  });

  it('counts every anchor, with or without a target', () => {
    expect(anchorCount(`<a>x</a><A name=y>y</A><area href=z>`)).toBe(3);
    expect(startTags(`<a b c=d>`)).toEqual([
      {
        name: 'a',
        attributes: [
          ['b', ''],
          ['c', 'd'],
        ],
      },
    ]);
  });
});
