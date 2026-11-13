import { notFound } from 'next/navigation';
import { ClientScreen } from '../../../../../../components/v2/screens/agency/ClientScreen';
import { clientPreview } from '../../../_preview/agency';
import { previewOnly } from '../../../_preview/guard';

/** Final-Ag-Client: granitepeak.example, read by Northwind’s owner. */
export default function AgencyClientPreview() {
  previewOnly();
  const data = clientPreview('/v2-preview/screens/agency/client');
  if (data?.kind !== 'client') notFound();
  return <ClientScreen data={data} />;
}
