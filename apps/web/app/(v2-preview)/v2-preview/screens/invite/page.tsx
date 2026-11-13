import { InviteScreen } from '../../../../../components/v2/screens/invite/InviteScreen';
import { previewOnly } from '../../_preview/guard';
import { INVITE_PREVIEWS } from '../../_preview/seats';

export default function InvitePreviewPage() {
  previewOnly();
  return <InviteScreen data={INVITE_PREVIEWS['/v2-preview/screens/invite']()} />;
}
