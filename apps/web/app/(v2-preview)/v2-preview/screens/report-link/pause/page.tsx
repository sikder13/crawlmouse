import { RecipientLinkScreen } from '../../../../../../components/v2/screens/share/RecipientLinkScreen';
import { previewOnly } from '../../../_preview/guard';
import { REPORT_LINK_PREVIEWS } from '../../../_preview/report-link';

export default function ReportLinkPausePreviewPage() {
  previewOnly();
  return (
    <RecipientLinkScreen data={REPORT_LINK_PREVIEWS['/v2-preview/screens/report-link/pause']()} />
  );
}
