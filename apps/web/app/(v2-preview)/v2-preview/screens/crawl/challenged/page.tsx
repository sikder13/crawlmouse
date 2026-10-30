import { previewOnly } from '../../../_preview/guard';
import { CrawlPreview, type CrawlSearchParams } from '../../../_preview/CrawlPreview';

export default function CrawlChallengedPreview(props: { searchParams: CrawlSearchParams }) {
  // The guard runs first, before anything is read from the request.
  previewOnly();
  return <CrawlPreview name="challenged-site" searchParams={props.searchParams} />;
}
