import { PricingScreen } from '../../../../../components/v2/screens/pricing/PricingScreen';
import { previewOnly } from '../../_preview/guard';
import { pricingSignedOut } from '../../_preview/pricing';

export default function PricingPreview() {
  previewOnly();
  return <PricingScreen view={pricingSignedOut()} />;
}
