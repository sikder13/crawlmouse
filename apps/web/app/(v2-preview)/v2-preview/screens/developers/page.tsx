import { DevelopersScreen } from '../../../../../components/v2/screens/developers/DevelopersScreen';
import { developersView } from '../../../../../lib/v2/view/developers';
import { previewOnly } from '../../_preview/guard';

export default function DevelopersPreview() {
  previewOnly();
  return <DevelopersScreen data={developersView()} />;
}
