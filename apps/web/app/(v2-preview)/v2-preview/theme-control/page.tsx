import { ThemeControl } from '../../../../components/v2';
import { ACCOUNT_ACTIONS } from '../../../../lib/v2/view/account-actions';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import { previewOnly } from '../_preview/guard';

/**
 * The theme row, saved as System: pressing a choice applies it to this page. One control only,
 * since each control applies its own saved choice to the page it sits on.
 */
export default function ThemeControlPreview() {
  previewOnly();
  return (
    <PreviewFrame title="ThemeControl">
      <PreviewSection title="Saved: System">
        <PreviewRow>
          <div style={{ width: 200 }}>
            <ThemeControl initial="system" action={ACCOUNT_ACTIONS.theme.route} />
          </div>
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
