import { AccountStateScreen } from '../../../../../../components/v2/screens/account/AccountStateScreen';
import { previewOnly } from '../../../_preview/guard';

export default function DashboardAmbiguousPreview() {
  previewOnly();
  return <AccountStateScreen state="ambiguous" />;
}
