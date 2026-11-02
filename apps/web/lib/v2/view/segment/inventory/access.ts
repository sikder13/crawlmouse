import { entry } from './types';

/** What Crawler access reads from the check. */
export const ACCESS_INVENTORY = [
  entry(
    'access-verdicts',
    ['access'],
    'Each crawler’s verdict, by section, with its evidence class',
    [
      'checks[].crawlers[].verdict',
      'checks[].crawlers[].by_template',
      'checks[].crawlers[].evidence_class',
      'checks[].crawlers[].scored',
    ],
  ),
  entry('access-text', ['access'], 'Text each crawler can read', [
    'checks[].crawlers[].text_share',
  ]),
  entry('access-cause', ['access'], 'What is in the way of each crawler', [
    'checks[].crawlers[].cause',
  ]),
  entry('access-columns', ['access'], 'The sections of the site, with their page counts', [
    'checks[].coverage.templates[].pages',
  ]),
  entry(
    'access-tiles',
    ['access'],
    'Pages fetched per crawler, of pages found, and the sample’s limit',
    [
      'checks[].coverage.pages_sampled',
      'checks[].coverage.pages_discovered',
      'checks[].coverage.sample_strategy.max_pages',
    ],
  ),
  entry('access-kept', ['access'], 'Responses kept as evidence', ['withheld[].total']),
  entry('access-tested', ['access'], 'When the crawler tests ran', ['checks[].tested_at']),
  entry('access-evidence', ['access'], 'The raw request and response behind a cell', [
    'access_tests[].request_headers',
    'access_tests[].raw_status',
    'access_tests[].headers',
    'access_tests[].body_excerpt',
    'access_tests[].tested_at',
    'access_tests[].limitations',
    'access_tests[].cause',
  ]),
  entry('access-fix', ['access'], 'The open fix: title, effect, effort, class and packet', [
    'fixes[].title',
    'fixes[].effect',
    'fixes[].effort',
    'fixes[].recommendation_class',
    'fixes[].packet',
  ]),
];
