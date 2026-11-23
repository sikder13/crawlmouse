import { LiveActions } from '../../../../../components/v2/screens/account/LiveActions';
import { SiteScreen } from '../../../../../components/v2/screens/site/SiteScreen';
import { previewOnly } from '../../_preview/guard';
import { shellPreview, sitePreview } from '../../_preview/accounts';

type Query = Promise<{ live?: string }>;

/** `?live=1` draws the fields a signed-in page shows, for the settings card's fit (F-110). */
async function Site({ searchParams }: { searchParams: Query }) {
  const { live } = await searchParams;
  const screen = <SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />;
  return live === '1' ? <LiveActions>{screen}</LiveActions> : screen;
}

export default function SitePreview(props: { searchParams: Query }) {
  // The guard runs first, before anything is read from the request.
  previewOnly();
  return <Site searchParams={props.searchParams} />;
}
