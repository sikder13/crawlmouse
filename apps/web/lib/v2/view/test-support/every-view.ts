/**
 * Each view model an audit page builds for one check, in one call: the result (with and without a
 * drawing), the six segments, the map in both scopes and each fix on both plans. A test that asks
 * "does any view throw on this data" calls this.
 */
import { checkMap } from '@crawlmouse/engine/v2/pipeline';
import { fixView } from '../fix';
import { linkMapView } from '../link-map';
import { resultView } from '../result';
import { accessView } from '../segment/access';
import { changesView } from '../segment/changes';
import { contentView } from '../segment/content';
import { nojsView } from '../segment/nojs';
import { signalsView } from '../segment/signals';
import { structureView } from '../segment/structure';
import type { ViewDataset } from '../dataset';

export function everyView(d: ViewDataset, checkId: string) {
  const pages = d.page_results.filter((p) => p.check_id === checkId);
  const links = d.link_edges.filter((e) => e.check_id === checkId);
  const drawing = checkMap(pages, links);
  return {
    result: resultView(d, checkId, { map: drawing }),
    resultUndrawn: resultView(d, checkId, { map: null }),
    resultPro: resultView(d, checkId, { map: drawing, plan: 'pro' }),
    access: accessView(d, checkId),
    nojs: nojsView(d, checkId),
    signals: signalsView(d, checkId),
    content: contentView(d, checkId),
    structure: structureView(d, checkId, {}, drawing),
    structureUndrawn: structureView(d, checkId, {}, null),
    changes: changesView(d, checkId),
    mapHubs: linkMapView(d, checkId, { scope: 'hubs', drawing }),
    mapAll: linkMapView(d, checkId, { scope: 'all' }),
    fixes: d.fixes.flatMap((f) => [
      fixView(d, checkId, f.id),
      fixView(d, checkId, f.id, { plan: 'pro' }),
    ]),
  };
}
