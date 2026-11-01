import { Button } from '../../Button';
import type { LinkMapView } from '../../../../lib/v2/view/link-map';
import { ResultShell } from '../result/ResultScreen';
import { KeepBar } from '../result/KeepBar';
import { SegmentTabs } from '../segment/SegmentTabs';
import { Explorer } from './Explorer';
import layout from '../../layout.module.css';
import segment from '../segment/SegmentScreen.module.css';

/**
 * The link-map explorer (Final-LinkMap): the crumb and tabs, the explorer, the keep bar after it,
 * and the back and next links. The orange element is the selected page's fix link when its
 * template has a fix, or the keep bar's button when no drawn page has one (FACTS orange convention).
 */
export function ExplorerScreen({ data }: { data: LinkMapView }) {
  const { frame, keep, ...explorer } = data;
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
      <Explorer data={explorer} />
      {keep && frame.keptUntil ? (
        <KeepBar domain={frame.domain} expires={frame.keptUntil} inline={keep} />
      ) : null}
      <div className={`${layout.row} ${segment.nav}`}>
        <Button variant="quiet" href={frame.back.href}>
          {frame.back.label}
        </Button>
        <Button href={frame.next.href}>{frame.next.label}</Button>
      </div>
    </ResultShell>
  );
}
