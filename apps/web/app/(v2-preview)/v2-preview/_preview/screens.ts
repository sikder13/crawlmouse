/**
 * What each screen preview renders, from the contract fixtures. Kept in one place so the preview
 * pages are one line each and the tests can render exactly what the pages render.
 */
import { fixture } from '../../../../lib/v2/fixtures';
import { CHECKS } from '../../../../lib/v2/recordings';
import { mapDrawing } from '../../../../lib/v2/view/map';
import { resultStateView, resultView, type ResultPageView } from '../../../../lib/v2/view/result';

/** The challenged-site fixture's other checks, which stand in for the Result page's states. */
export const STATE_CHECKS = {
  /** Kestrel Creative's first site, queued for its first audit. */
  empty: 'c0000000-0000-4000-8000-0000000000dd',
  /** granitepeak.example's scheduled re-check, which failed. */
  error: 'c0000000-0000-4000-8000-0000000000cb',
} as const;

export const RESULT_PREVIEWS = {
  'bad-site': () =>
    resultView(fixture('bad-site'), CHECKS.badFirstAudit, {
      map: mapDrawing('bad-site'),
      asFirstSeen: true,
    }),
  clean: () =>
    resultView(fixture('clean-site'), CHECKS.cleanFirstAudit, { map: mapDrawing('clean-site') }),
  challenged: () =>
    resultView(fixture('challenged-site'), CHECKS.challengedFirstAudit, {
      map: mapDrawing('challenged-site'),
    }),
  loading: (): ResultPageView => ({ state: 'loading' }),
  empty: () => resultStateView(fixture('challenged-site'), STATE_CHECKS.empty),
  error: () => resultStateView(fixture('challenged-site'), STATE_CHECKS.error),
  // The clean-site result viewed at the moment it expires.
  expired: () => {
    const d = fixture('clean-site');
    const at = d.checks.find((c) => c.id === CHECKS.cleanFirstAudit)!.expires_at!;
    return resultStateView(d, CHECKS.cleanFirstAudit, at);
  },
} satisfies Record<string, () => ResultPageView>;

export type ResultPreview = keyof typeof RESULT_PREVIEWS;
