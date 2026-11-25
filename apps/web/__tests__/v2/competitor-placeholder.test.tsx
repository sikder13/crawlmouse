/** D-36: the competitor field's placeholder was cut ("competitor.example, ano"); it is one host. */
import { describe, expect, it } from 'vitest';
import { SITE_COPY } from '../../lib/v2/copy/site';

describe('the competitor field’s placeholder (D-36)', () => {
  it('is one host, so a narrow field does not cut it into a second', () => {
    const p = SITE_COPY.fields.competitors.placeholder;
    expect(p).toBe('competitor.example');
    expect(p).not.toContain(',');
  });
});
