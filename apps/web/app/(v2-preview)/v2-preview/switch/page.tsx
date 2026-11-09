import { Switch } from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import { previewOnly } from '../_preview/guard';

export default function SwitchPreview() {
  previewOnly();
  return (
    <PreviewFrame title="Switch">
      <PreviewSection title="On and off, each named by its row text">
        <PreviewRow>
          <Switch
            label="A crawler becomes blocked"
            name="enabled"
            on
            action="/api/alert-rules"
            fields={{ rule: 'crawler_blocked' }}
          />
          <Switch
            label="Any change at all, including content"
            name="enabled"
            on={false}
            action="/api/alert-rules"
            fields={{ rule: 'any_change' }}
          />
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
