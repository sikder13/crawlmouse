import { DashboardScreen } from '../../../../../../components/v2/screens/dashboard/DashboardScreen';
import { previewOnly } from '../../../_preview/guard';
import { noSiteEarlierPreview } from '../../../_preview/accounts';

export default function DashboardEarlierPreview() {
  previewOnly();
  return <DashboardScreen data={noSiteEarlierPreview()} />;
}
