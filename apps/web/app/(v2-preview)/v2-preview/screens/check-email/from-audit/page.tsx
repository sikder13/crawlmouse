import { CheckEmailScreen } from '../../../../../../components/v2/screens/check-email/CheckEmailScreen';
import { previewOnly } from '../../../_preview/guard';

export default function CheckEmailFromAuditPreview() {
  previewOnly();
  return (
    <CheckEmailScreen
      kind="from-audit"
      site={'example-outfitter.com'}
      checksPublic={false}
      email="you@company.com"
    />
  );
}
