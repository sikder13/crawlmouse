import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FixChecklist } from './FixChecklist';
import type { DashboardFixChecklistItem } from './dashboard-logic';

const items: DashboardFixChecklistItem[] = [
  { fixId: 'a', label: 'Orphan page: Pricing', category: 'orphan', resolved: true, marginalDelta: 8.4 },
  { fixId: 'b', label: 'Buried page: FAQ', category: 'deep_page', resolved: false, marginalDelta: 3.2 },
  { fixId: 'c', label: 'Vague anchors: Blog', category: 'generic_anchor_overuse', resolved: false, marginalDelta: 2.1 },
];

const html = renderToStaticMarkup(
  <FixChecklist items={items} doneCount={1} auditId="aud-1" climb={{ from: 'C', to: 'B', points: 12 }} />,
);

describe('FixChecklist — expandable cure tracker', () => {
  it('summary shows N of M done + remaining + a progressbar, inside a <details> expander', () => {
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('1 of 3 fixes done');
    expect(html).toContain('2 to go');
    expect(html).toContain('role="progressbar"');
  });

  it('done fixes reference the REAL grade climb (honest + provable), and list the done item', () => {
    expect(html).toContain('lifted your grade');
    expect(html).toContain('C → B');
    expect(html).toContain('Orphan page: Pricing');
  });

  it('remaining fixes show an estimated, "est."-marked impact — never a summed total', () => {
    expect(html).toContain('Buried page: FAQ');
    expect(html).toContain('+3 pts est.');
    expect(html).toContain('do not add up'); // the no-sum honesty disclaimer
    expect(html).not.toContain('+5 pts'); // 3.2 + 2.1 must NOT be presented as a sum
  });

  it('each fix links to the cure on the audit page', () => {
    expect(html).toContain('href="/audit/aud-1"');
  });

  it('without a positive climb, done fixes make NO "lifted your grade" claim', () => {
    const noClimb = renderToStaticMarkup(
      <FixChecklist items={items} doneCount={1} auditId="aud-1" climb={null} />,
    );
    expect(noClimb).not.toContain('lifted your grade');
    expect(noClimb).toContain('Already fixed');
  });
});
