import { describe, expect, it } from 'vitest';
import {
  changeProblems,
  fingerprintFromJson,
  fingerprintToJson,
  type Fingerprint,
} from './fingerprint';

const fp = (sections: Record<string, string[]>): Fingerprint =>
  new Map(
    Object.entries(sections).map(([name, lines]) => [
      name,
      { md5: lines.join('|'), items: lines.length, lines },
    ]),
  );

const before = fp({ acls: ['a', 'b', 'c'], roles: ['r'] });

describe('changeProblems: what changed, against what was expected to', () => {
  it('passes when nothing changed and nothing was expected to', () => {
    expect(changeProblems(before, fp({ acls: ['a', 'b', 'c'], roles: ['r'] }))).toEqual([]);
  });

  it('names each line that changed when nothing was expected to', () => {
    expect(changeProblems(before, fp({ acls: ['a', 'c', 'd'], roles: ['r'] }))).toEqual([
      'acls: added unexpectedly: d',
      'acls: removed unexpectedly: b',
    ]);
  });

  it('passes when exactly the expected lines were added and removed', () => {
    const after = fp({ acls: ['a', 'd'], roles: ['r'] });
    expect(
      changeProblems(before, after, { added: { acls: ['d'] }, removed: { acls: ['b', 'c'] } }),
    ).toEqual([]);
  });

  it('names an expected line that did not change, in each direction', () => {
    const after = fp({ acls: ['a', 'c'], roles: ['r'] });
    expect(
      changeProblems(before, after, { added: { acls: ['d'] }, removed: { acls: ['b', 'c'] } }),
    ).toEqual([
      'acls: expected to be added but was not: d',
      'acls: expected to be removed but was not: c',
    ]);
  });

  it('checks a section the expectation names even when that section did not change', () => {
    expect(changeProblems(before, before, { removed: { roles: ['r'] } })).toEqual([
      'roles: expected to be removed but was not: r',
    ]);
  });

  it('reads back what it writes', () => {
    expect(fingerprintFromJson(fingerprintToJson(before))).toEqual(before);
  });
});
