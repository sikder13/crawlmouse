import { HomeScreen } from '../../../../../components/v2/screens/home/HomeScreen';
import { previewOnly } from '../../_preview/guard';
import { homePreview } from '../../_preview/screens';

export default function HomeScreenPreview() {
  previewOnly();
  return <HomeScreen data={homePreview()} />;
}
