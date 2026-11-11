import '../../../../styles/v2/tokens.css';
import { ReferralCapture } from '@/components/analytics/ReferralCapture';
import { TrackView } from '@/components/analytics/TrackView';
import { accountDoorEnabled } from '../../../../lib/auth/flags';
import { fixture } from '../../../../lib/v2/fixtures';
import { stateAt } from '../../../../lib/v2/progress';
import { CHECKS, recording } from '../../../../lib/v2/recordings';
import { homeView } from '../../../../lib/v2/view/home';
import { mapDrawing } from '../../../../lib/v2/view/map';
import { HomeScreen } from './HomeScreen';

/**
 * The v2 home with its forms starting a real audit (CC-22b D10): the locked Home screen, the
 * `home_viewed` event, and v1's referral capture. The example audit on the page is the bad-site
 * fixture's first audit, as in the preview.
 *
 * `app/v2-home/page.tsx` renders it, and `/` is rewritten there under the flag (middleware.ts,
 * `V2_REWRITES`, which says what a production build linked when `app/page.tsx` could reach this
 * module). `app/page.tsx` does not import it; `live-home.test.tsx` holds that.
 *
 * The plan buttons lead to Sign-up while the account door is open (V2_ACCOUNT_DOOR); the Agency
 * trial has no page yet, so it has no button.
 */
export function LiveHome() {
  const data = homeView(fixture('bad-site'), CHECKS.badFirstAudit, {
    map: mapDrawing('bad-site'),
    end: stateAt(recording('bad-site').events, Infinity),
  });
  const planHref = accountDoorEnabled() ? { Free: '/signup', Pro: '/signup' } : {};
  return (
    <>
      <TrackView event="home_viewed" />
      <ReferralCapture />
      <HomeScreen data={data} start planHref={planHref} />
    </>
  );
}
