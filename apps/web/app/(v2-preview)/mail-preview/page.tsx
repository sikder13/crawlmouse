import { MAIL_PREVIEWS } from '../../../lib/v2/mail/templates/previews';
import { previewOnly } from '../v2-preview/_preview/guard';

/** The email templates' previews (CC-28 D2), one link each. Development only. */
export default function MailPreviewIndex() {
  previewOnly();
  return (
    <main style={{ padding: 16 }}>
      <h1>Email templates</h1>
      <ul>
        {MAIL_PREVIEWS.map((p) => (
          <li key={p.slug}>
            <a href={`/mail-preview/${p.slug}`}>{p.name}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
