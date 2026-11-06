import { DashboardScreen } from '../../../../../../components/v2/screens/dashboard/DashboardScreen';
import { previewOnly } from '../../../_preview/guard';
import { dashboardPreview } from '../../../_preview/accounts';

export default function DashboardCleanPreview() {
  previewOnly();
  return <DashboardScreen data={dashboardPreview('clean')} />;
}
