import { notFound } from 'next/navigation';
import { ClientScreen } from '../../../../../../../components/v2/screens/agency/ClientScreen';
import { clientPreview } from '../../../../_preview/agency';
import { previewOnly } from '../../../../_preview/guard';

/** A client with both grades and nothing open. */
export default function AgencyClientCleanPreview() {
  previewOnly();
  const data = clientPreview('/v2-preview/screens/agency/client/clean');
  if (data?.kind !== 'client') notFound();
  return <ClientScreen data={data} />;
}
