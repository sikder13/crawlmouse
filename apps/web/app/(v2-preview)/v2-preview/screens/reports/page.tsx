import { ReportsScreen } from '../../../../../components/v2/screens/reports/ReportsScreen';
import { previewOnly } from '../../_preview/guard';
import { reportsPreview, type PreviewQuery } from '../../_preview/screens';

async function Reports({ searchParams }: { searchParams: Promise<PreviewQuery> }) {
  return <ReportsScreen data={reportsPreview('home', await searchParams)} />;
}

export default function ReportsPreview(props: { searchParams: Promise<PreviewQuery> }) {
  // The guard runs first, before anything is read from the request.
  previewOnly();
  return <Reports searchParams={props.searchParams} />;
}
