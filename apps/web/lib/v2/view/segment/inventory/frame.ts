import { entry } from './types';

/** What every segment page reads for its frame. */
export const FRAME_INVENTORY = [
  entry(
    'segment-domain',
    ['access', 'nojs', 'structure', 'content', 'signals', 'changes'],
    'The site, in the crumb',
    ['sites[].host'],
  ),
  entry(
    'segment-kept-until',
    ['access', 'nojs', 'structure', 'content', 'signals', 'changes'],
    'Until when an unkept audit is kept, in the crumb (expires_at, or finished_at + 24 h)',
    ['checks[].expires_at', 'checks[].finished_at'],
  ),
  entry('segment-next-js', ['access'], 'The next link’s figure: text without JavaScript', [
    'checks[].without_js.site_text_share',
  ]),
  entry('segment-next-structure', ['nojs'], 'The next link’s figure: the site-structure score', [
    'checks[].technical_seo.site_structure_score',
  ]),
  entry('segment-next-content', ['structure'], 'The next link’s figure: the content score', [
    'checks[].content.score',
  ]),
  entry('segment-next-signals', ['content'], 'The next link’s figure: signals present', [
    'checks[].signals[].state',
  ]),
];
