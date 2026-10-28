import { HomeScreen } from '../../../../../components/v2/screens/home/HomeScreen';
import { HOME_FIXTURE } from '../../_fixtures/home';
import { previewOnly } from '../../_preview/guard';

export default function HomeScreenPreview() {
  previewOnly();
  return <HomeScreen data={HOME_FIXTURE} />;
}
