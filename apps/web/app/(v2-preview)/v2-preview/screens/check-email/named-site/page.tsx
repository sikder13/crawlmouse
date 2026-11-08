import { CheckEmailScreen } from '../../../../../../components/v2/screens/check-email/CheckEmailScreen';
import { previewOnly } from '../../../_preview/guard';

export default function CheckEmailNamedSitePreview() {
  previewOnly();
  return (
    <CheckEmailScreen
      kind="named-site"
      site={'acme-outdoors.com'}
      pipeline={false}
      email="you@company.com"
    />
  );
}
