import { ProofScreen } from '../../../../../../components/v2/screens/proof/ProofScreen';
import { previewOnly } from '../../../_preview/guard';
import { proofPreview } from '../../../_preview/proof';

export default function ProofBaselinePreviewPage() {
  previewOnly();
  return <ProofScreen data={proofPreview('/v2-preview/screens/proof/baseline')} />;
}
