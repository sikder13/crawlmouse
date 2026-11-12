import { PricingScreen } from '../../../../../../components/v2/screens/pricing/PricingScreen';
import { previewOnly } from '../../../_preview/guard';
import { pricingSignedIn } from '../../../_preview/pricing';

export default function PricingSignedInPreview() {
  previewOnly();
  return <PricingScreen view={pricingSignedIn()} />;
}
