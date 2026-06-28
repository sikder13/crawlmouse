import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FixChecklist } from './FixChecklist';

describe('FixChecklist', () => {
  it('shows done/total + the remaining open loop + an aria progressbar', () => {
    const html = renderToStaticMarkup(<FixChecklist done={3} total={7} />);
    expect(html).toContain('3 of 7 fixes done');
    expect(html).toContain('4 to go');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="3"');
  });

  it('drops "to go" when every fix is done', () => {
    const html = renderToStaticMarkup(<FixChecklist done={5} total={5} />);
    expect(html).toContain('5 of 5 fixes done');
    expect(html).not.toContain('to go');
  });
});
