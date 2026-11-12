import type { MailPreview } from '../../../../lib/v2/mail/templates/previews';
import { MailFrame } from './MailFrame';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** A template's preview: its subject, its HTML part in a frame, then its text part. */
export function MailPreviewPage({ preview }: { preview: MailPreview }) {
  const m = preview.render();
  return (
    <main style={{ background: 'var(--v2-bg)', color: 'var(--v2-fg)', padding: '16px 0' }}>
      <p style={{ font: `13px/1.5 ${MONO}`, margin: '0 16px 12px' }}>
        <strong>Subject:</strong> {m.subject}
      </p>
      <MailFrame html={m.html} title={preview.name} />
      <pre
        style={{
          font: `13px/1.5 ${MONO}`,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: '16px',
        }}
      >
        {m.text}
      </pre>
    </main>
  );
}
