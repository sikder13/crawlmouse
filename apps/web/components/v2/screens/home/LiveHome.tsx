import '../../../../styles/v2/tokens.css';
import { accountDoorEnabled } from '../../../../lib/auth/flags';
import { fixture } from '../../../../lib/v2/fixtures';
import { stateAt } from '../../../../lib/v2/progress';
import { CHECKS, recording } from '../../../../lib/v2/recordings';
import { homeView } from '../../../../lib/v2/view/home';
import { mapDrawing } from '../../../../lib/v2/view/map';
import { HomeScreen } from './HomeScreen';

/**
 * Home as `/` serves it under V2_CHECKS_PUBLIC (CC-22b D10): the locked Home screen, its forms
 * starting a real audit. The example audit on the page is the bad-site fixture's first audit, as in
 * the preview; the screen labels it an example.
 *
 * The plan buttons lead to Sign-up while the account door is open (V2_ACCOUNT_DOOR); the Agency
 * trial has no page yet, so it has no button. The page is rendered when the site is built, so both
 * flags are read then.
 */
export function LiveHome() {
  const data = homeView(fixture('bad-site'), CHECKS.badFirstAudit, {
    map: mapDrawing('bad-site'),
    end: stateAt(recording('bad-site').events, Infinity),
  });
  const planHref = accountDoorEnabled() ? { Free: '/signup', Pro: '/signup' } : {};
  return <HomeScreen data={data} start planHref={planHref} />;
}
