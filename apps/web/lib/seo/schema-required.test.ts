import { describe, expect, it } from 'vitest';
import { REQUIRED, schemaProblems } from './schema-required';

describe('schemaProblems', () => {
  it('passes a node with its required set, nested nodes included', () => {
    expect(
      schemaProblems({
        '@type': 'BreadcrumbList',
        itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://x/' }],
      }),
    ).toEqual([]);
  });
  it('names each missing or empty property, at any depth', () => {
    expect(
      schemaProblems({
        '@type': 'FAQPage',
        mainEntity: [{ '@type': 'Question', name: '', acceptedAnswer: { '@type': 'Answer' } }],
      }),
    ).toEqual([
      { type: 'Question', missing: 'name' },
      { type: 'Answer', missing: 'text' },
    ]);
  });
  it('skips a node that only references another by @id, and checks one that says more', () => {
    expect(schemaProblems({ '@type': 'WebPage', '@id': 'https://x/a' })).toEqual([]);
    expect(schemaProblems({ '@type': 'WebPage', '@id': 'https://x/a', name: 'A' })).toEqual([
      { type: 'WebPage', missing: 'url' },
    ]);
  });
  it('fails a type with no required set, and does not read inherited keys as one', () => {
    expect(schemaProblems({ '@type': 'Recipe', name: 'x' })).toEqual([
      { type: 'Recipe', missing: '@type' },
    ]);
    expect(schemaProblems({ '@type': 'toString' })).toEqual([
      { type: 'toString', missing: '@type' },
    ]);
  });
  it('does not check a node reference ({@type, @id} only); a node with any other property is checked', () => {
    const ref = { '@type': 'WebPage', '@id': 'https://crawlmouse.com/blog/x' };
    expect(schemaProblems({ '@type': 'Person', name: 'p', mainEntityOfPage: ref })).toEqual([]);
    expect(schemaProblems({ ...ref, description: 'd' })).toEqual([
      { type: 'WebPage', missing: 'name' },
      { type: 'WebPage', missing: 'url' },
    ]);
    expect(schemaProblems({ '@type': 'WebPage' })).toEqual([
      { type: 'WebPage', missing: 'name' },
      { type: 'WebPage', missing: 'url' },
    ]);
  });
  it('declares a set for every type the site emits today', () => {
    for (const t of [
      'Organization',
      'WebSite',
      'WebPage',
      'SoftwareApplication',
      'Offer',
      'FAQPage',
      'Article',
      'BreadcrumbList',
      'Person',
    ]) {
      expect(Object.hasOwn(REQUIRED, t), t).toBe(true);
    }
  });
});
