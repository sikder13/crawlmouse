import { describe, expect, it } from 'vitest';
import { site } from '../../../fixtures/v2/detectors/builders.js';
import { detectOrphans } from '../detectors/orphans.js';
import { effortOf } from './effort.js';
import { writePacket } from './registry.js';
import { factsFor } from './test-support/facts.js';
import { detected, pageAt, SERVED } from './test-support/structure.js';
import { writtenFrom } from './written.js';

const base = 'https://a.test';
const input = site(
  [
    { path: base, links: [`${base}/hub`] },
    { path: `${base}/hub`, links: [base] },
    { path: `${base}/lantern` },
  ],
  { homepage: base },
);
const facts = factsFor(input, SERVED);
const record = detected(detectOrphans(input), `${base}/lantern`);

describe('writtenFrom', () => {
  it('writes the packet, the effort and the rows of a fix its builder can write', () => {
    const written = writtenFrom(facts)({ family: 'structure', record });
    expect(written.packet).toEqual(writePacket('orphan_pages', record, facts));
    expect(written.packet).not.toBeNull();
    expect(written.effort).toEqual(effortOf({ family: 'structure', record }));
  });

  it.each([
    [
      'a record that names a page the check does not hold',
      { ...record, key: `orphan:${base}/not-crawled` },
      facts,
    ],
    [
      'a record whose URL is not http or https',
      { ...record, key: 'orphan:ftp://a.test/lantern' },
      {
        ...facts,
        pages: new Map([...facts.pages, ['ftp://a.test/lantern', pageAt('ftp://a.test/lantern')]]),
      },
    ],
  ])('leaves a fix without a packet, and does not throw, on %s', (_name, broken, held) => {
    expect(() => writePacket('orphan_pages', broken, held)).toThrow();
    const written = writtenFrom(held)({ family: 'structure', record: broken });
    expect(written.packet).toBeNull();
    expect(written.effort).toEqual(effortOf({ family: 'structure', record }));
    expect(written.before_after).toEqual([]);
  });
});
