import { test } from './pw';

/**
 * Journey 6 (CC-38 D4): each retired v1 URL in CC-36's cutover table answers as that table designs it
 * (a permanent redirect to its v2 page, or 410). CC-36 is not on origin/main yet; this journey is
 * written against its table once it is, and reads that table rather than a copy of it.
 */
test.fixme('the retired v1 URLs answer as CC-36 designs (needs CC-36 on origin/main)', () => {});
