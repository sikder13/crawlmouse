import { AgenciesScreen } from '../../../../../components/v2/screens/agencies/AgenciesScreen';
import { agenciesView } from '../../../../../lib/v2/view/agencies';
import { previewOnly } from '../../_preview/guard';

export default function AgenciesPreview() {
  previewOnly();
  return <AgenciesScreen data={agenciesView()} />;
}
