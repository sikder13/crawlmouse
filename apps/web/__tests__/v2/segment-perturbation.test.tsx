import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, type FixtureName } from '../../lib/v2/fixtures';
import type { SegmentKey } from '../../lib/v2/view/segment/frame';
import { SEGMENT_INVENTORY } from '../../lib/v2/view/segment/inventory';
import {
  HISTORY_SOURCES,
  SEGMENT_SOURCES,
  type SegmentVariant,
} from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { changesHistoryElement, segmentElement } from './_lib/screens';
import { ACCESS_PERTURB } from './segment-perturb/access';
import { CHANGES_PERTURB } from './segment-perturb/changes';
import { CONTENT_PERTURB } from './segment-perturb/content';
import { FRAME_PERTURB } from './segment-perturb/frame';
import { NOJS_PERTURB } from './segment-perturb/nojs';
import { SIGNALS_PERTURB } from './segment-perturb/signals';
import { STRUCTURE_PERTURB } from './segment-perturb/structure';
import type { PerturbTable, SegmentChange } from './segment-perturb/types';

/**
 * Each field the segment inventory lists is changed, one at a time, in a copy of a contract
 * fixture, and the segment pages are rendered again by the builders the previews use. Each page
 * the change names must show the new value, and must not have shown it before; each inventory
 * field has a change, each page an entry names is shown changing, and no change names a field or
 * page the inventory does not. `fixture()` is mocked to return the copy for the fixture changed.
 */
const perturbed = vi.hoisted(() => ({ name: null as string | null, dataset: null as unknown }));

vi.mock('../../lib/v2/fixtures', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/v2/fixtures')>();
  return {
    ...real,
    fixture: (name: FixtureName) =>
      name === perturbed.name ? (perturbed.dataset as FixtureDataset) : real.fixture(name),
  };
});

const TABLE: PerturbTable = {
  ...FRAME_PERTURB,
  ...ACCESS_PERTURB,
  ...NOJS_PERTURB,
  ...STRUCTURE_PERTURB,
  ...CONTENT_PERTURB,
  ...SIGNALS_PERTURB,
  ...CHANGES_PERTURB,
};

const VARIANT: Record<FixtureName, SegmentVariant> = {
  'bad-site': 'bad-site',
  'clean-site': 'clean',
  'challenged-site': 'challenged',
};

/** The visible text, each text node set apart by a space, as a reader would scan it. */
const text = (markup: string) => {
  const { window } = new JSDOM(`<body>${markup}</body>`);
  const doc = window.document;
  doc.querySelectorAll('svg, [data-v2-sr-only]').forEach((e) => e.remove());
  const walker = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ');
};

function page(segment: SegmentKey, c: SegmentChange, dataset: FixtureDataset | null): string {
  const name = c.history ? HISTORY_SOURCES[c.history].fixture : (c.fixture ?? 'bad-site');
  perturbed.name = dataset ? name : null;
  perturbed.dataset = dataset;
  try {
    return text(
      renderToStaticMarkup(
        c.history ? changesHistoryElement(c.history) : segmentElement(segment, VARIANT[name]),
      ),
    );
  } finally {
    perturbed.name = null;
    perturbed.dataset = null;
  }
}

function changed(c: SegmentChange): FixtureDataset {
  const name = c.history ? HISTORY_SOURCES[c.history].fixture : (c.fixture ?? 'bad-site');
  const d = structuredClone(fixture(name));
  const id = c.history ? HISTORY_SOURCES[c.history].check : SEGMENT_SOURCES[VARIANT[name]].check;
  c.change(findCheck(d, id), d);
  return d;
}

describe('the segment inventory, against the fixture', () => {
  it('has a change for every field of every entry, and none for anything it does not list', () => {
    const listed = new Map(SEGMENT_INVENTORY.map((e) => [e.id, e]));
    expect(Object.keys(TABLE).sort()).toEqual([...listed.keys()].sort());
    for (const [id, fields] of Object.entries(TABLE)) {
      const e = listed.get(id)!;
      expect(Object.keys(fields).sort(), id).toEqual([...e.fields].sort());
      const shown = new Set(
        Object.values(fields).flatMap((cs) => cs.flatMap((c) => Object.keys(c.expect))),
      );
      expect([...shown].sort(), id).toEqual([...e.segments].sort());
    }
  });

  const cases = Object.entries(TABLE).flatMap(([id, fields]) =>
    Object.entries(fields).flatMap(([field, changes]) =>
      changes.map(
        (c, i) => [`${id} · ${field}${changes.length > 1 ? ` (${i + 1})` : ''}`, c] as const,
      ),
    ),
  );

  it.each(cases)('%s: each page named shows the new value, which it did not before', (_, c) => {
    const d = changed(c);
    for (const [segment, wanted] of Object.entries(c.expect) as [SegmentKey, string[]][]) {
      const before = page(segment, c, null);
      const after = page(segment, c, d);
      for (const w of wanted) {
        expect(before, `${segment} already shows "${w}"`).not.toContain(w);
        expect(after, `${segment} does not show "${w}"`).toContain(w);
      }
    }
  });
});
