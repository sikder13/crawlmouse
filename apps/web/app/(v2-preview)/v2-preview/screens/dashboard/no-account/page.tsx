import { AccountStateScreen } from '../../../../../../components/v2/screens/account/AccountStateScreen';
import { previewOnly } from '../../../_preview/guard';

export default function DashboardNoAccountPreview() {
  previewOnly();
  return <AccountStateScreen state="no_account" />;
}
