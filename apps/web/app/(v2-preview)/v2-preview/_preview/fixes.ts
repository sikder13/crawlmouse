/**
 * What each fix-page preview renders, from the contract fixtures: the fix the locked screen shows
 * and the bad site's two other free fixes (so every "Open" on its Result leads somewhere), a free
 * fix of the challenged site, a fix behind the Pro wall, and a fix a later check verified resolved. Kept apart from the pages so a test renders exactly what a page renders.
 */
import { findCheck, fixesAsOf, fixture, type FixtureName } from '../../../../lib/v2/fixtures';
import { CHECKS } from '../../../../lib/v2/recordings';
import { fixView, type FixHrefs } from '../../../../lib/v2/view/fix';
import { NO_HREFS } from '../../../../lib/v2/view/segment/frame';
import { segmentHrefs, type SegmentVariant } from './segments';

export type FixVariant = 'bad-site' | 'first' | 'third' | 'challenged' | 'locked' | 'resolved';

interface Source {
  fixture: FixtureName;
  check: string;
  /** Which of the check's fixes: its place in the audit's order, or a fix's id. */
  fix: { at: number } | { id: string };
  path: string;
  /** The segment previews its tabs link to; null for a site with none. */
  segments: SegmentVariant | null;
  asFirstSeen: boolean;
}

export const FIX_SOURCES: Record<FixVariant, Source> = {
  // Final-Fix: fix 2, the second of the bad site's first audit, open on Free.
  'bad-site': {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    fix: { at: 1 },
    path: '/v2-preview/screens/fix',
    segments: 'bad-site',
    asFirstSeen: true,
  },
  first: {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    fix: { at: 0 },
    path: '/v2-preview/screens/fix/first',
    segments: 'bad-site',
    asFirstSeen: true,
  },
  third: {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    fix: { at: 2 },
    path: '/v2-preview/screens/fix/third',
    segments: 'bad-site',
    asFirstSeen: true,
  },
  challenged: {
    fixture: 'challenged-site',
    check: CHECKS.challengedFirstAudit,
    fix: { at: 0 },
    path: '/v2-preview/screens/fix/challenged',
    segments: 'challenged',
    asFirstSeen: false,
  },
  // The fourth in order: the first that Free does not open.
  locked: {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    fix: { at: 3 },
    path: '/v2-preview/screens/fix/locked',
    segments: 'bad-site',
    asFirstSeen: true,
  },
  // nahltech.com's orphan fix, verified resolved by its scheduled check.
  resolved: {
    fixture: 'bad-site',
    check: 'c0000000-0000-4000-8000-00000000000c',
    fix: { id: 'f0000000-0000-4000-8000-000000000014' },
    path: '/v2-preview/screens/fix/resolved',
    segments: null,
    asFirstSeen: false,
  },
};

const VARIANTS = Object.keys(FIX_SOURCES) as FixVariant[];

/** The id of the fix a variant shows. */
export function fixIdOf(variant: FixVariant): string {
  const s = FIX_SOURCES[variant];
  if ('id' in s.fix) return s.fix.id;
  const d = fixture(s.fixture);
  const f = fixesAsOf(d, findCheck(d, s.check))[s.fix.at];
  if (!f) throw new Error(`${variant}: the check has no fix at ${s.fix.at}`);
  return f.id;
}

/**
 * Where a fix of `check` opens: its preview when one shows that fix at that check, otherwise "#"
 * (only the fixes above have a preview page).
 */
export function fixHref(check: string): (fixId: string) => string {
  return (id) => {
    const v = VARIANTS.find((x) => FIX_SOURCES[x].check === check && fixIdOf(x) === id);
    return v ? FIX_SOURCES[v].path : '#';
  };
}

function hrefsOf(variant: FixVariant): FixHrefs {
  const s = FIX_SOURCES[variant];
  return { ...(s.segments ? segmentHrefs(s.segments) : NO_HREFS), fix: fixHref(s.check) };
}

export function fixPreview(variant: FixVariant) {
  const s = FIX_SOURCES[variant];
  return fixView(fixture(s.fixture), s.check, fixIdOf(variant), {
    asFirstSeen: s.asFirstSeen,
    hrefs: hrefsOf(variant),
  });
}
