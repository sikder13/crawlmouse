import { CheckEmailScreen } from '../../../../../../components/v2/screens/check-email/CheckEmailScreen';
import { previewOnly } from '../../../_preview/guard';

export default function CheckEmailSigninPreview() {
  previewOnly();
  return <CheckEmailScreen kind="signin" site={null} pipeline={false} email="you@company.com" />;
}
