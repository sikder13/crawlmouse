import { SignupScreen } from '../../../../../../components/v2/screens/signup/SignupScreen';
import { previewOnly } from '../../../_preview/guard';

export default function SignupRateLimitedPreview() {
  previewOnly();
  return <SignupScreen pipeline={false} initial="rate_limited" />;
}
