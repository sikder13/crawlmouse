import { ChangesLogScreen } from '../../../../../components/v2/screens/changes-log/ChangesLogScreen';
import { previewOnly } from '../../_preview/guard';
import { changesLogPreview, type PreviewQuery } from '../../_preview/screens';

async function ChangesLog({ searchParams }: { searchParams: Promise<PreviewQuery> }) {
  return <ChangesLogScreen data={changesLogPreview(await searchParams)} />;
}

export default function ChangesLogPreview(props: { searchParams: Promise<PreviewQuery> }) {
  // The guard runs first, before anything is read from the request.
  previewOnly();
  return <ChangesLog searchParams={props.searchParams} />;
}
