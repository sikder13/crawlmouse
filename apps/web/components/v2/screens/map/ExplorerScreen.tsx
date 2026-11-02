import type { LinkMapView } from '../../../../lib/v2/view/link-map';
import { ResultShell } from '../result/ResultScreen';
import { SegmentTabs } from '../segment/SegmentTabs';
import { Explorer } from './Explorer';
import layout from '../../layout.module.css';
import segment from '../segment/SegmentScreen.module.css';

/**
 * The link-map explorer (Final-LinkMap): the crumb and tabs, then the explorer, which holds the
 * keep bar after the evidence and the back and next links, so its one orange element can follow
 * the page selected (Explorer.tsx).
 */
export function ExplorerScreen({ data }: { data: LinkMapView }) {
  const { frame } = data;
  return (
    <ResultShell share={{ keptUntil: frame.keptUntil }} rerun mainClassName={segment.main}>
      <div className={`${layout.row} ${segment.crumbRow}`}>
        <div className={`${layout.row} ${segment.crumb}`}>
          <a href={frame.overview}>{frame.domain}</a>
          <span className={layout.mut}>/</span>
          <a href={frame.section.href}>{frame.section.title}</a>
          <span className={layout.mut}>/</span>
          <span>Link map</span>
          {frame.keptUntil ? (
            <span className={layout.mut}>· kept until {frame.keptUntil}</span>
          ) : null}
        </div>
        <SegmentTabs tabs={frame.tabs} />
      </div>
      <Explorer data={data} />
    </ResultShell>
  );
}
