import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FindingsPanel } from '@/components/audit/FindingsPanel';
import type { FindingGroup } from '@/lib/findings';

const render = (groups: FindingGroup[]) => renderToStaticMarkup(<FindingsPanel groups={groups} />);

describe('FindingsPanel informational banners (A4)', () => {
  it('renders js_rendered as a message banner with the honest label and NO "—" placeholder row', () => {
    // A js_rendered group carries no per-page rows (it's a site-wide caveat), so the old
    // generic renderer would have shown a single bare "—" list item. It must render as a
    // clean message banner instead.
    const groups: FindingGroup[] = [{ category: 'js_rendered', total: 1, shown: [], hidden: 0 }];
    const html = render(groups);
    expect(html).toContain('This site renders its links with JavaScript');
    // No bare placeholder dash, no "· N found" count, no upgrade card on an informational banner.
    expect(html).not.toContain('—');
    expect(html).not.toContain('·'); // the "· N found" count line must be absent on a banner
    expect(html).not.toContain('Unlock Pro');
  });

  it('renders incomplete_crawl as a message banner with no bare "—" row (fixes the known nit)', () => {
    const groups: FindingGroup[] = [{ category: 'incomplete_crawl', total: 1, shown: [], hidden: 0 }];
    const html = render(groups);
    expect(html).toContain('Too few pages to grade confidently');
    expect(html).not.toContain('—');
    expect(html).not.toContain('·'); // the "· N found" count line must be absent on a banner
  });

  it('renders a normal finding category EXACTLY as before (count + page rows + upgrade card)', () => {
    const groups: FindingGroup[] = [
      {
        category: 'orphan',
        total: 7,
        shown: [
          { category: 'orphan', severity: 'critical', pages: { url: 'https://x.com/a' } },
          { category: 'orphan', severity: 'critical', pages: { url: 'https://x.com/b' } },
        ],
        hidden: 5,
      },
    ];
    const html = render(groups);
    expect(html).toContain('Orphan pages');
    expect(html).toContain('found'); // the "· N found" count stays for real categories
    expect(html).toContain('https://x.com/a');
    expect(html).toContain('https://x.com/b');
    expect(html).toContain('Unlock Pro'); // upgrade card still shown when rows are hidden
  });

  it('renders informational banners and normal categories together without cross-contamination', () => {
    const groups: FindingGroup[] = [
      { category: 'js_rendered', total: 1, shown: [], hidden: 0 },
      {
        category: 'orphan',
        total: 1,
        shown: [{ category: 'orphan', severity: 'critical', pages: { url: 'https://x.com/a' } }],
        hidden: 0,
      },
    ];
    const html = render(groups);
    expect(html).toContain('This site renders its links with JavaScript');
    expect(html).toContain('Orphan pages');
    expect(html).toContain('https://x.com/a');
  });
});
