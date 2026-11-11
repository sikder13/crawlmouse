import { DashboardScreen } from '../../../../../../components/v2/screens/dashboard/DashboardScreen';
import { previewOnly } from '../../../_preview/guard';
import { noSitePreview } from '../../../_preview/accounts';

export default function DashboardNoSitePreview() {
  previewOnly();
  return <DashboardScreen data={noSitePreview()} />;
}
