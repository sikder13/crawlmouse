import { AlertsScreen } from '../../../../../components/v2/screens/alerts/AlertsScreen';
import { previewOnly } from '../../_preview/guard';
import { alertsPreview } from '../../_preview/screens';

export default function AlertsPreview() {
  previewOnly();
  return <AlertsScreen data={alertsPreview('home')} />;
}
