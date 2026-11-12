import { notFound } from 'next/navigation';
import { mailPreview } from '../../../../lib/v2/mail/templates/previews';
import { previewOnly } from '../../v2-preview/_preview/guard';
import { MailPreviewPage } from '../_lib/MailPreviewPage';

async function Body({ params }: { params: Promise<{ slug: string }> }) {
  const preview = mailPreview((await params).slug);
  if (!preview) notFound();
  return <MailPreviewPage preview={preview} />;
}

/** One email template on fixture data (CC-28 D2). Development only: the guard runs before anything. */
export default function MailPreviewSlug(props: { params: Promise<{ slug: string }> }) {
  previewOnly();
  return <Body params={props.params} />;
}
