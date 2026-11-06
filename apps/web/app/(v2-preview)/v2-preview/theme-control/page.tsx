import { THEME_CHOICES, ThemeControl } from '../../../../components/v2';
import { ACCOUNT_ACTIONS } from '../../../../lib/v2/view/account-actions';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import { previewOnly } from '../_preview/guard';

/** The theme row with each choice saved; pressing one applies it to this page. */
export default function ThemeControlPreview() {
  previewOnly();
  return (
    <PreviewFrame title="ThemeControl">
      {THEME_CHOICES.map((c) => (
        <PreviewSection key={c} title={`Saved: ${c}`}>
          <PreviewRow>
            <div style={{ width: 200 }}>
              <ThemeControl initial={c} action={ACCOUNT_ACTIONS.theme.route} />
            </div>
          </PreviewRow>
        </PreviewSection>
      ))}
    </PreviewFrame>
  );
}
