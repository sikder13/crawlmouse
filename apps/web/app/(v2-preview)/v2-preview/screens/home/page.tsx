import { HomeScreen } from '../../../../../components/v2/screens/home/HomeScreen';
import { fixture } from '../../../../../lib/v2/fixtures';
import { stateAt } from '../../../../../lib/v2/progress';
import { CHECKS, recording } from '../../../../../lib/v2/recordings';
import { homeView } from '../../../../../lib/v2/view/home';
import { mapDrawing } from '../../../../../lib/v2/view/map';
import { previewOnly } from '../../_preview/guard';

export default function HomeScreenPreview() {
  previewOnly();
  const end = stateAt(recording('bad-site').events, Infinity);
  const data = homeView(fixture('bad-site'), CHECKS.badFirstAudit, {
    map: mapDrawing('bad-site'),
    end,
  });
  return <HomeScreen data={data} />;
}
