import { SettingsScreen } from '../../../../../../components/v2/screens/settings/SettingsScreen';
import { previewOnly } from '../../../_preview/guard';
import { settingsPreview } from '../../../_preview/screens';

export default function SettingsFreePreview() {
  previewOnly();
  return <SettingsScreen data={settingsPreview('clean')} />;
}
