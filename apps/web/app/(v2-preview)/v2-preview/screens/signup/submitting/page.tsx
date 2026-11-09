import { SignupScreen } from '../../../../../../components/v2/screens/signup/SignupScreen';
import { previewOnly } from '../../../_preview/guard';

export default function SignupSubmittingPreview() {
  previewOnly();
  return <SignupScreen checksPublic={false} initial="sending" />;
}
