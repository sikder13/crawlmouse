import { previewOnly } from '../../_preview/guard';
import { CrawlPreview, type CrawlSearchParams } from '../../_preview/CrawlPreview';

export default function CrawlScreenPreview(props: { searchParams: CrawlSearchParams }) {
  // The guard runs first, before anything is read from the request.
  previewOnly();
  return <CrawlPreview name="bad-site" searchParams={props.searchParams} />;
}
