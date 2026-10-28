import { previewOnly } from '../../../_preview/guard';
import { CrawlPreview, type CrawlSearchParams } from '../../../_preview/CrawlPreview';

/** The clean site's free re-run, still crawling at the fixture's "now": the stream stops there. */
export default function CrawlCleanPreview(props: { searchParams: CrawlSearchParams }) {
  // The guard runs first, before anything is read from the request.
  previewOnly();
  return <CrawlPreview name="clean-site-rerun" searchParams={props.searchParams} />;
}
