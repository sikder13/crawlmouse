import { describe, expect, it } from 'vitest';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, type FixtureName } from '../fixtures';
import { CHECKS } from '../recordings';
import { resultView, type DoorView, type ResultView } from './result';

const NO_MAP = { nodes: [], positions: {} };

const CHECK_OF: Record<FixtureName, string> = {
  'bad-site': CHECKS.badFirstAudit,
  'clean-site': CHECKS.cleanFirstAudit,
  'challenged-site': CHECKS.challengedFirstAudit,
};

/** The Result view of a fixture's first audit, after `edit` is applied to a copy of its check. */
function view(name: FixtureName, edit: (c: Check, d: FixtureDataset) => void = () => {}) {
  const d = structuredClone(fixture(name));
  edit(findCheck(d, CHECK_OF[name]), d);
  return resultView(d, CHECK_OF[name], { map: NO_MAP, asFirstSeen: name === 'bad-site' });
}

const door = (v: ResultView, title: string): DoorView => v.doors.find((x) => x.title === title)!;

/** Every sentence and label the view hands the screen, as one string. */
const allText = (v: ResultView) =>
  JSON.stringify({ grades: v.grades, first: v.first, doors: v.doors, crawlers: v.crawlers });

describe('the edge that blocks all automation', () => {
  it('is said in one wording, the access pill’s, wherever the challenged result mentions it', () => {
    const v = view('challenged-site');
    expect(door(v, 'Crawler access').pill.label).toBe('blocks all automation');
    expect(door(v, 'Crawler access').body).toMatch(/^The site’s edge blocks all automation/);
    expect(v.grades[1].summary).toMatch(/^The site’s edge blocks all automation/);
    expect(allText(v)).not.toMatch(/\brefused\b|lets through|challenges every|whoever we said/);
  });

  it('is named as the reason content was not measured only when a crawler met it', () => {
    const content = 'Content an answer engine can quote';
    expect(door(view('challenged-site'), content).body).toBe(
      'The site’s edge blocks all automation, so whether the pages open with a quotable answer could not be measured.',
    );
    const unmeasured = view('clean-site', (c) => (c.content = null));
    expect(door(unmeasured, content).body).toBe(
      'Whether the pages open with a quotable answer was not measured in this audit.',
    );
    expect(door(unmeasured, content).body).not.toMatch(/edge/);
  });
});
