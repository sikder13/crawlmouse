import { AlertsScreen } from '../../../../../../components/v2/screens/alerts/AlertsScreen';
import { previewOnly } from '../../../_preview/guard';
import { alertsPreview } from '../../../_preview/screens';

export default function AlertsFreePreview() {
  previewOnly();
  return <AlertsScreen data={alertsPreview('clean')} />;
}
