import { Button, Field } from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';

export default function FieldPreview() {
  return (
    <PreviewFrame title="Field">
      <PreviewSection title="Hidden label, as on the locked screens">
        <PreviewRow>
          <Field
            id="pv-url"
            label="Website URL"
            hideLabel
            type="url"
            placeholder="yourdomain.com"
            autoComplete="url"
          />
          <Field
            id="pv-url-lg"
            label="Website URL, large"
            hideLabel
            type="url"
            placeholder="yourdomain.com"
            size="lg"
          />
          <Button size="lg">Start the audit</Button>
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Visible label">
        <Field
          id="pv-email"
          label="Email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
        />
      </PreviewSection>
    </PreviewFrame>
  );
}
