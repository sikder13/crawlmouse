import { entry } from './types';

/** What the Links and pages page reads from a check's page and link records. */
export const LINKS_INVENTORY = [
  entry(
    'links-broken',
    ['links'],
    'A missing page (404 or 410), or one that answered another error, and its status',
    ['page_results[].status_code'],
  ),
  entry('links-redirect', ['links'], 'A page that redirects, hop by hop', [
    'page_results[].redirect',
  ]),
  entry('links-title', ['links'], 'A title more than one page shares', [
    'page_results[].title.text',
  ]),
  entry('links-description', ['links'], 'The pages with no meta description', [
    'page_results[].meta_description.text',
  ]),
];
