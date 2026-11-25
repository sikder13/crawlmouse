import { SettingsScreen } from '../../../../../../components/v2/screens/settings/SettingsScreen';
import { previewOnly } from '../../../_preview/guard';
import { settingsPreview } from '../../../_preview/screens';

export default function SettingsAgencyPreview() {
  previewOnly();
  return <SettingsScreen data={settingsPreview('withheld')} />;
}
