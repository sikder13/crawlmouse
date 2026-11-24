/**
 * The large lab site: about 2,500 pages of an invented garden-supply business, rendered from the request
 * path by this one function rather than committed as files. `vercel.json` rewrites four hosts here, and
 * they serve the same pages, differing only in how they answer:
 *
 *   large.lab.crawlmouse.com                at once
 *   large-slow.lab.crawlmouse.com           each HTML page after SLOW_DELAY_MS
 *   large-throttle.lab.crawlmouse.com       429 with Retry-After above the throttle rule
 *   large-throttle-bare.lab.crawlmouse.com  429 without Retry-After above the same rule
 *
 * THE THROTTLE RULE. Requests are counted per client address and per host, in fixed windows of
 * THROTTLE_WINDOW_MS that start at whole multiples of ten seconds of Unix time. A request whose count in
 * its window is above THROTTLE_LIMIT is answered 429; every request counts, the 429s, 404s, robots.txt
 * and sitemap included. Retry-After, on the throttle host only, is the seconds left in the window, rounded
 * up. A client recovers at the next window boundary: the count starts again from one. A count from a
 * past window is never read (the first request in a later window deletes it), so there is no ban. The
 * count lives in this function instance's memory and is not shared between instances, so each request's
 * decision is written as one JSON line to the function's output (`log` below), and the runtime logs are
 * the record of what the site did.
 *
 * Every page is built from its path and fixed tables, with a seeded generator for the prose, so it is the
 * same on every request. The request path is looked up in the site's own page map; this module imports
 * no file-system API, so no path can reach a file.
 */
import { createHash, randomUUID } from 'node:crypto';

export const HOSTS = {
  fast: 'large.lab.crawlmouse.com',
  slow: 'large-slow.lab.crawlmouse.com',
  throttle: 'large-throttle.lab.crawlmouse.com',
  throttleBare: 'large-throttle-bare.lab.crawlmouse.com',
};
const VARIANT = Object.fromEntries(Object.entries(HOSTS).map(([k, h]) => [h, k]));

export const SLOW_DELAY_MS = 1000;
/** 18 in 10 s is 1.8 a second: a client at a steady 2 a second gets 429 on 2 requests in every 20. */
export const THROTTLE_LIMIT = 18;
export const THROTTLE_WINDOW_MS = 10_000;

const NAME = 'Brackenmoor Garden Supply';
const TOWN = 'Fennick Vale';
const FOOTER = `${NAME}, ${TOWN} · A fictional business: a Crawlmouse QA test site. Nothing here is real.`;
const PER_PAGE = 12;

// ── Deterministic helpers ─────────────────────────────────────────────────────────────────────────

const seedOf = (s) => createHash('sha256').update(s).digest().readUInt32LE(0);

/** mulberry32, as in generate.mjs: the same seed gives the same sequence on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── The catalogue ─────────────────────────────────────────────────────────────────────────────────

/** Title patterns: `plant` for living things, `kit` for equipment and projects. */
const PATTERNS = {
  plant: [
    'How to grow {s}',
    '{S} for beginners',
    'When to plant {s}',
    'Common problems with {s}',
    'Feeding and watering {s}',
    'Growing {s} in pots',
    'The best {s} for a small garden',
    'Looking after {s} in winter',
    'Propagating {s}',
    'Pruning and tidying {s}',
    'Pests that go for {s}',
    'A year with {s}',
  ],
  kit: [
    'Choosing {s}',
    "{S}: a buyer's guide",
    'Getting started with {s}',
    'Common mistakes with {s}',
    'Looking after {s}',
    '{S} on a budget',
    '{S} through the seasons',
    'Our favourite {s}',
    '{S} questions answered',
    'Storing {s} over winter',
    'Making the most of {s}',
    '{S} for small gardens',
  ],
};

/** Eight departments, five sections each, six subjects a section. Subjects are unique site-wide. */
const CATALOGUE = [
  {
    title: 'Fruit and veg',
    kind: 'plant',
    words: ['sowing', 'harvest', 'crop rotation', 'seedlings', 'netting', 'feeding'],
    sections: {
      Tomatoes:
        'cherry tomatoes|beefsteak tomatoes|plum tomatoes|bush tomatoes|cordon tomatoes|yellow tomatoes',
      Potatoes:
        'early potatoes|maincrop potatoes|salad potatoes|seed potatoes|sweet potatoes|blue potatoes',
      'Salad leaves': 'lettuce|rocket|spinach|chard|mizuna|lamb’s lettuce',
      'Soft fruit': 'strawberries|raspberries|blackcurrants|gooseberries|blueberries|tayberries',
      'Root vegetables': 'carrots|beetroot|parsnips|radishes|turnips|celeriac',
    },
  },
  {
    title: 'Flowers',
    kind: 'plant',
    words: ['deadheading', 'staking', 'colour', 'scent', 'borders', 'cutting'],
    sections: {
      Roses:
        'climbing roses|shrub roses|rambling roses|patio roses|floribunda roses|old garden roses',
      Perennials: 'hardy geraniums|salvias|echinaceas|asters|lupins|delphiniums',
      Annuals: 'sweet peas|cosmos|zinnias|nasturtiums|marigolds|sunflowers',
      Bulbs: 'tulips|daffodils|alliums|crocuses|snowdrops|dahlias',
      Climbers: 'clematis|honeysuckle|jasmine|wisteria|climbing hydrangeas|passion flowers',
    },
  },
  {
    title: 'Trees and shrubs',
    kind: 'plant',
    words: ['roots', 'pruning', 'shape', 'shelter', 'planting holes', 'staking'],
    sections: {
      Hedging: 'beech hedges|yew hedges|privet hedges|hawthorn hedges|box hedges|holly hedges',
      'Fruit trees': 'apple trees|pear trees|plum trees|cherry trees|fig trees|quince trees',
      'Flowering shrubs': 'lilacs|buddleias|camellias|rhododendrons|hydrangeas|forsythias',
      Conifers: 'dwarf pines|junipers|cedars|spruces|cypresses|larches',
      'Small trees': 'rowans|crab apples|silver birches|Japanese maples|amelanchiers|magnolias',
    },
  },
  {
    title: 'Houseplants',
    kind: 'plant',
    words: ['light', 'humidity', 'repotting', 'drainage', 'leaf drop', 'watering'],
    sections: {
      Ferns:
        'Boston ferns|maidenhair ferns|bird’s nest ferns|staghorn ferns|asparagus ferns|button ferns',
      Succulents: 'aloes|echeverias|jade plants|haworthias|string of pearls|sedums',
      Orchids: 'moth orchids|cymbidiums|dendrobiums|oncidiums|vanda orchids|slipper orchids',
      'Trailing plants':
        'pothos|trailing ivy|string of hearts|tradescantias|heartleaf philodendrons|creeping figs',
      Palms: 'kentia palms|parlour palms|areca palms|fan palms|ponytail palms|lady palms',
    },
  },
  {
    title: 'Tools',
    kind: 'kit',
    words: ['grip', 'steel', 'sharpening', 'storage', 'weight', 'handles'],
    sections: {
      'Hand tools': 'trowels|hand forks|dibbers|kneeling pads|garden gloves|potting scoops',
      'Pruning tools':
        'secateurs|loppers|pruning saws|hedge shears|topiary shears|long-reach pruners',
      'Digging tools': 'spades|border forks|hoes|rakes|mattocks|edging irons',
      'Watering kit': 'watering cans|soaker hoses|hose reels|water butts|drip kits|spray nozzles',
      'Tool care': 'sharpening stones|tool oils|tool racks|rust removers|handle repairs|tool bags',
    },
  },
  {
    title: 'Lawn care',
    kind: 'kit',
    words: ['mowing height', 'drainage', 'thatch', 'seed', 'edges', 'shade'],
    sections: {
      Mowing: 'push mowers|cylinder mowers|rotary mowers|grass boxes|mower blades|mowing stripes',
      'Seed and turf':
        'lawn seed|turf rolls|shade seed mixes|hard-wearing seed|overseeding mixes|turf laying',
      'Lawn feed':
        'spring lawn feed|autumn lawn feed|liquid lawn feed|slow-release granules|seaweed tonics|lawn sand',
      'Moss and weeds':
        'moss rakes|scarifiers|daisy grubbers|weeding knives|lawn aerators|hollow tine forks',
      Edging:
        'lawn edging strips|edging shears|half-moon edgers|brick mowing edges|steel edging|lawn borders',
    },
  },
  {
    title: 'Soil and compost',
    kind: 'kit',
    words: ['worms', 'structure', 'moisture', 'nutrients', 'organic matter', 'pH'],
    sections: {
      'Compost bins':
        'wooden compost bins|hot composters|wormeries|compost tumblers|leaf bins|kitchen caddies',
      Mulches: 'bark mulch|straw mulch|cocoa shell mulch|gravel mulch|wool mulch|mulch mats',
      'Soil testing':
        'soil test kits|pH meters|moisture meters|soil sieves|soil thermometers|drainage tests',
      'Raised beds':
        'timber raised beds|metal raised beds|raised bed liners|raised bed soil|bed covers|cold frames',
      'Leaf mould':
        'leaf mould sacks|leaf sweepers|leaf blowers|leaf rakes|leaf shredders|leaf mould cages',
    },
  },
  {
    title: 'Wildlife garden',
    kind: 'kit',
    words: ['nesting', 'shelter', 'water', 'pollen', 'cover', 'food'],
    sections: {
      'Bird feeders': 'seed feeders|suet feeders|bird tables|nest boxes|bird baths|feeder poles',
      Ponds: 'pond liners|pond pumps|marginal plants|wildlife ponds|pond nets|container ponds',
      'Bee hotels':
        'bee hotels|bee bricks|bee-friendly seed|bee waterers|bee banks|solitary bee tubes',
      'Hedgehog homes':
        'hedgehog houses|hedgehog highways|hedgehog food|log piles|leaf shelters|hedgehog feeders',
      'Wildflower meadows':
        'wildflower seed|wildflower turf|meadow mowing|yellow rattle|plug plants|meadow edges',
    },
  },
];

/** Topic tags. Each article carries two; a topic page lists its newest TAG_LIST. */
const TAGS = [
  'Beginners',
  'Small spaces',
  'Shade',
  'Full sun',
  'Clay soil',
  'Sandy soil',
  'Drought',
  'Wet ground',
  'Pollinators',
  'Birds',
  'Containers',
  'Balconies',
  'Budget',
  'Organic',
  'Peat free',
  'No dig',
  'Spring jobs',
  'Summer jobs',
  'Autumn jobs',
  'Winter jobs',
  'Frost',
  'Wind',
  'Coastal',
  'Allotments',
  'Children',
  'Pets',
  'Scent',
  'Colour',
  'Evergreen',
  'Fast growing',
  'Low maintenance',
  'Cut flowers',
  'Edible',
  'Heritage',
  'Native plants',
  'Water saving',
  'Recycling',
  'Tools we use',
  'Repairs',
  'Storage',
  'Greenhouses',
  'Windowsills',
  'Pests',
  'Diseases',
  'Weeds',
  'Soil health',
  'Seasonal planner',
  'Gifts',
];
const TAG_LIST = 12;

// ── Prose ─────────────────────────────────────────────────────────────────────────────────────────

/** `{t}` the page topic, `{n}` the business, `{p}` its town, `{a}`/`{b}` two of the department's words. */
const BANK = [
  'Most questions we hear about {t} start with {a}, so that is where this page begins.',
  'At {n} we have spent years working out what actually matters for {t}, and it is rarely the obvious part.',
  'If you only remember one thing about {t}, make it this: {a} comes before {b}.',
  'Gardeners around {p} often ask whether {t} is worth the effort; the honest answer depends on {a}.',
  'The short version is that {t} rewards patience more than spending.',
  'We keep a written checklist for {t} and change it each season as {b} changes.',
  'A common mistake with {t} is to treat {a} and {b} as the same problem.',
  'Below is the routine our staff follow for {t}, written plainly so you can follow it at home.',
  'You do not need anything special for {t}; a little attention to {a} goes a long way.',
  'When something goes wrong with {t}, check {b} first, because it is the cause more often than not.',
  'Customers in {p} have taught us more about {t} than any catalogue ever did.',
  'There is no single right answer for {t}, but there are a few reliably wrong ones.',
  'Start small with {t}, note what you changed, and give {a} a fortnight to show a difference.',
  'Getting {t} wrong usually costs time rather than money, which is good news.',
  'We go back over our advice on {t} every spring, when {b} is easiest to judge.',
  'If you are unsure about {t}, ask at the counter; five minutes saves a lot of guessing about {a}.',
  'For {t}, the weather in {p} matters more than most guides admit.',
  'Treat {t} as a habit rather than a project, and {b} becomes much easier.',
  'Our notes on {t} come from real gardens, including the ones that did not go to plan.',
  'Good results with {t} follow from steady {a}, not from one big change.',
  'One quick test for {t}: look at {b} after a week and compare it with your first note.',
  'Everything we suggest here about {t} is something we do in our own gardens.',
  'The details of {t} vary, yet the principle holds: protect {a}, then improve {b}.',
  'Newcomers to {t} tend to overdo {a}; old hands do a little less, more often.',
  'This guide to {t} is for people who would rather do it once and do it well.',
  'If {t} feels like a lot, pick the step about {b} and leave the rest for now.',
  'Questions about {t} reach {n} nearly every day, and the answers below are the ones we give.',
  'A tidy record of {a} is the most useful thing you can keep for {t}.',
  'Conditions around {p} make {b} the deciding factor for {t}.',
  'What separates a good result with {t} from a great one is usually {a}.',
  'Skip the shortcuts with {t}; they tend to cost more in {b} later.',
  'Our team argues about most things, but not about how to approach {t}.',
  'Expect {t} to take a couple of attempts before {a} feels natural.',
  'The best time to think about {t} is before you need to, while {b} is still easy to change.',
  'Once {t} is under control, the rest of the garden gets noticeably easier.',
  'We would rather explain {t} properly than sell you something you do not need.',
];

function prose(seed, topic, words) {
  const rand = rng(seedOf(seed));
  const pick = () => words[Math.floor(rand() * words.length)];
  const s = shuffled(BANK, rand)
    .slice(0, 12)
    .map((tpl) =>
      tpl
        .replaceAll('{t}', topic)
        .replaceAll('{n}', NAME)
        .replaceAll('{p}', TOWN)
        .replaceAll('{a}', pick())
        .replaceAll('{b}', pick()),
    );
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12)].map((x) => x.join(' '));
}

// ── The site model ────────────────────────────────────────────────────────────────────────────────

const MONTHS =
  'January February March April May June July August September October November December'.split(
    ' ',
  );
const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 9, 31);
const dateText = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/**
 * Every page, keyed by path. Built once per instance. A section's article count varies (42 to 72), so
 * its listing runs to four to six pages, and the pagination shows three pages either side of the current
 * one: a section's oldest page sits a click deeper than its first, as on a real blog. The deep tail is the
 * shop diary: its index lists the newest DIARY_LISTED entries, and each entry links only to its neighbours,
 * so the oldest sit several clicks down a chain.
 */
function build() {
  const pages = new Map();
  const add = (p) => {
    if (pages.has(p.path)) throw new Error(`duplicate path ${p.path}`);
    pages.set(p.path, p);
    return p;
  };
  const tagPath = (t) => `/topics/${slug(t)}/`;
  const departments = [];
  const articles = [];

  for (const dep of CATALOGUE) {
    const depPath = `/${slug(dep.title)}/`;
    const d = { ...dep, path: depPath, sectionList: [] };
    departments.push(d);
    for (const [secTitle, subjectText] of Object.entries(dep.sections)) {
      const secPath = `${depPath}${slug(secTitle)}/`;
      const subjects = subjectText.split('|');
      const rand = rng(seedOf(`section ${secPath}`));
      const count = 42 + Math.floor(rand() * 31);
      const combos = [];
      PATTERNS[dep.kind].forEach((pat) => subjects.forEach((s) => combos.push([pat, s])));
      const chosen = shuffled(combos, rand).slice(0, count);
      const sec = { title: secTitle, path: secPath, dep: d, articles: [] };
      d.sectionList.push(sec);
      chosen.forEach(([pat, subject], i) => {
        const title = pat.replace('{s}', subject).replace('{S}', cap(subject));
        const ar = {
          type: 'article',
          title,
          subject,
          path: `${secPath}${slug(title)}/`,
          sec,
          index: i,
          // Newest first within a section; sections interleave across the calendar.
          published: EPOCH - (i * 6 + Math.floor(rand() * 6)) * DAY,
          tags: [],
        };
        const t1 = Math.floor(rand() * TAGS.length);
        const t2 = (t1 + 1 + Math.floor(rand() * (TAGS.length - 1))) % TAGS.length;
        ar.tags = [TAGS[t1], TAGS[t2]];
        sec.articles.push(ar);
        articles.push(ar);
      });
      sec.pageCount = Math.ceil(sec.articles.length / PER_PAGE);
    }
  }

  const byTag = new Map(TAGS.map((t) => [t, []]));
  for (const ar of articles) for (const t of ar.tags) byTag.get(t).push(ar);
  for (const list of byTag.values())
    list.sort((a, b) => b.published - a.published || a.path.localeCompare(b.path));
  const newest = [...articles].sort(
    (a, b) => b.published - a.published || a.path.localeCompare(b.path),
  );

  const model = { departments, articles, byTag, newest, tagPath };
  add({ type: 'home', path: '/', title: 'Garden supplies and advice from Fennick Vale' });
  add({ type: 'about', path: '/about/', title: `About ${NAME}` });
  add({ type: 'contact', path: '/contact/', title: 'Contact and opening hours' });
  add({ type: 'topics', path: '/topics/', title: 'All topics' });
  add({ type: 'diary-index', path: '/diary/', title: 'The shop diary' });
  DIARY.forEach((month, i) =>
    add({ type: 'diary', path: `/diary/${month.slug}/`, title: `Shop diary: ${month.name}`, i }),
  );
  for (const t of TAGS) add({ type: 'tag', path: tagPath(t), title: t, tag: t });
  for (const d of departments) {
    add({ type: 'department', path: d.path, title: d.title, dep: d });
    for (const sec of d.sectionList) {
      for (let k = 1; k <= sec.pageCount; k++) {
        add({
          type: 'listing',
          path: k === 1 ? sec.path : `${sec.path}page/${k}/`,
          title: k === 1 ? sec.title : `${sec.title}, page ${k}`,
          sec,
          k,
        });
      }
    }
  }
  for (const ar of articles) add(ar);
  return { pages, model };
}

let site;
const getSite = () => (site ??= build());

/** Every page path the site serves, in the order the model built them. */
export function paths() {
  return [...getSite().pages.keys()];
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────────

/** The shop diary, newest first: eight months of 2026. */
const DIARY = ['October', 'September', 'August', 'July', 'June', 'May', 'April', 'March'].map(
  (m) => ({
    name: `${m} 2026`,
    slug: `2026-${String(MONTHS.indexOf(m) + 1).padStart(2, '0')}`,
  }),
);
const DIARY_LISTED = 3;
const diaryPath = (i) => `/diary/${DIARY[i].slug}/`;

const listingPath = (sec, k) => (k === 1 ? sec.path : `${sec.path}page/${k}/`);
const link = (href, text) => `<a href="${href}">${esc(text)}</a>`;

/** How an article names its section when it links back: varied, so the section's anchors are not one. */
const BACK = [
  'more {s} guides',
  'all of our {s} advice',
  'the {s} section',
  'back to {s}',
  'everything on {s}',
  'other {s} pages',
];

function cards(list) {
  return `<ul class="cards">${list
    .map(
      (ar) =>
        `<li>${link(ar.path, ar.title)}<span class="meta">${esc(ar.sec.title)} · ${dateText(ar.published)}</span></li>`,
    )
    .join('')}</ul>`;
}

function crumbs(trail) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${trail
    .map(([href, text], i) =>
      i === trail.length - 1 ? `<span>${esc(text)}</span>` : link(href, text),
    )
    .join(' › ')}</nav>`;
}

function pager(sec, k) {
  const items = [];
  if (k > 1) items.push(link(listingPath(sec, k - 1), 'Newer guides'));
  for (let j = Math.max(1, k - 3); j <= Math.min(sec.pageCount, k + 3); j++) {
    items.push(
      j === k ? `<span aria-current="page">${j}</span>` : link(listingPath(sec, j), String(j)),
    );
  }
  if (k < sec.pageCount) items.push(link(listingPath(sec, k + 1), 'Older guides'));
  return `<nav class="pager" aria-label="Pages">${items.join(' ')}</nav>`;
}

function body(page, model) {
  const { departments, byTag, newest, tagPath } = model;
  const words = (dep) =>
    dep?.words ?? ['seasons', 'soil', 'light', 'water', 'patience', 'planning'];
  switch (page.type) {
    case 'home': {
      const [p1, p2, p3] = prose('home', 'gardening in Fennick Vale', words());
      return `<p>${esc(p1)}</p>
<h2>Shop and advice by department</h2>
<ul class="cards">${departments.map((d) => `<li>${link(d.path, `${d.title} guides`)}</li>`).join('')}</ul>
<h2>New this month</h2>
${cards(newest.slice(0, 8))}
<p>${esc(p2)}</p>
<h2>Popular topics</h2>
<p class="tags">${TAGS.slice(0, 8)
        .map((t) => link(tagPath(t), t))
        .join(' ')}</p>
<p>${esc(p3)} ${link('/about/', 'Read how the shop started')}.</p>`;
    }
    case 'about': {
      const [p1, p2, p3] = prose('about', 'a family garden shop', words());
      return `<p>${esc(p1)}</p><p>${esc(p2)}</p><p>${esc(p3)}</p>
<p>What we have been up to: ${link('/diary/', 'the shop diary')}. Questions? ${link('/contact/', 'Find our opening hours')}.</p>`;
    }
    case 'diary-index': {
      const [p1, p2] = prose('diary', 'a year in the shop', words());
      return `${crumbs([
        ['/', 'Home'],
        ['/about/', 'About'],
        ['/diary/', 'Diary'],
      ])}
<p>${esc(p1)}</p>
<ul class="cards">${DIARY.slice(0, DIARY_LISTED)
        .map((m, i) => `<li>${link(diaryPath(i), m.name)}</li>`)
        .join('')}</ul>
<p>${esc(p2)} Older entries are linked from each month’s page.</p>`;
    }
    case 'diary': {
      const [p1, p2, p3] = prose(
        `diary ${page.path}`,
        `the shop in ${DIARY[page.i].name}`,
        words(),
      );
      const around = [
        page.i > 0 && link(diaryPath(page.i - 1), `Later: ${DIARY[page.i - 1].name}`),
        page.i < DIARY.length - 1 &&
          link(diaryPath(page.i + 1), `Earlier: ${DIARY[page.i + 1].name}`),
      ].filter(Boolean);
      return `${crumbs([
        ['/', 'Home'],
        ['/diary/', 'Diary'],
        [page.path, DIARY[page.i].name],
      ])}
<p>${esc(p1)}</p><p>${esc(p2)}</p>
<p class="related">${around.join(' · ')}</p>
<p>${esc(p3)}</p>`;
    }
    case 'contact': {
      const [p1, p2] = prose('contact', 'visiting the shop', words());
      return `<p>${esc(p1)}</p>
<p>The shop on Mill Lane, ${TOWN}, is open Tuesday to Sunday, nine till five. The address and telephone number are invented.</p>
<p>${esc(p2)}</p>`;
    }
    case 'topics': {
      const [p1, p2] = prose('topics', 'finding a guide by topic', words());
      return `<p>${esc(p1)}</p>
<p class="tags">${TAGS.map((t) => link(tagPath(t), `${t} (${byTag.get(t).length})`)).join(' ')}</p>
<p>${esc(p2)}</p>`;
    }
    case 'tag': {
      const list = byTag.get(page.tag);
      const [p1, p2] = prose(`tag ${page.tag}`, `${page.tag.toLowerCase()} gardening`, words());
      return `${crumbs([
        ['/', 'Home'],
        ['/topics/', 'Topics'],
        [page.path, page.tag],
      ])}
<p>${esc(p1)}</p>
<h2>The newest ${Math.min(TAG_LIST, list.length)} of ${list.length} guides on ${esc(page.tag.toLowerCase())}</h2>
${cards(list.slice(0, TAG_LIST))}
<p>${esc(p2)}</p>`;
    }
    case 'department': {
      const d = page.dep;
      const [p1, p2, p3] = prose(`dep ${d.path}`, d.title.toLowerCase(), d.words);
      return `${crumbs([
        ['/', 'Home'],
        [d.path, d.title],
      ])}
<p>${esc(p1)}</p>
<h2>Sections</h2>
<ul class="cards">${d.sectionList.map((s) => `<li>${link(s.path, s.title)}<span class="meta">${s.articles.length} guides</span></li>`).join('')}</ul>
<p>${esc(p2)}</p>
<h2>Editor’s picks</h2>
${cards(d.sectionList.map((s) => s.articles[0]))}
<p>${esc(p3)}</p>`;
    }
    case 'listing': {
      const { sec, k } = page;
      const [p1, p2] = prose(`listing ${page.path}`, sec.title.toLowerCase(), sec.dep.words);
      const list = sec.articles.slice((k - 1) * PER_PAGE, k * PER_PAGE);
      return `${crumbs([
        ['/', 'Home'],
        [sec.dep.path, sec.dep.title],
        [sec.path, sec.title],
      ])}
<p>${esc(p1)}</p>
${cards(list)}
${pager(sec, k)}
<p>${esc(p2)}</p>`;
    }
    case 'article': {
      const { sec } = page;
      const [p1, p2, p3] = prose(`article ${page.path}`, page.subject, sec.dep.words);
      const prev = sec.articles[page.index - 1];
      const next = sec.articles[page.index + 1];
      const same = sec.articles.find(
        (a) => a !== page && a.subject === page.subject && a.index > page.index,
      );
      const related = [
        next && link(next.path, `Next: ${next.title}`),
        prev && link(prev.path, `Previous: ${prev.title}`),
        same && link(same.path, `More on ${page.subject}`),
      ].filter(Boolean);
      return `${crumbs([
        ['/', 'Home'],
        [sec.dep.path, sec.dep.title],
        [sec.path, sec.title],
        [page.path, page.title],
      ])}
<p class="meta">Published ${dateText(page.published)} · Filed under ${page.tags.map((t) => link(tagPath(t), t)).join(', ')}</p>
<p>${esc(p1)}</p>
<p>${esc(p2)}</p>
<p class="related">${related.join(' · ')}</p>
<p>${esc(p3)}</p>
<p>${link(sec.path, BACK[page.index % BACK.length].replace('{s}', sec.title.toLowerCase()))}</p>`;
    }
    default:
      throw new Error(`no template for ${page.type}`);
  }
}

const CSS = `:root{--accent:#3d6b2f;--soft:#e9f0e4;--ink:#1e2a1a;--paper:#fcfdfa}
*{box-sizing:border-box}
body{margin:0;font:17px/1.65 Georgia,serif;color:var(--ink);background:var(--paper)}
a{color:var(--accent)}
header.site{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding:14px 24px;border-bottom:1px solid var(--soft);background:#fff;font:500 15px/1.3 system-ui,sans-serif}
header.site .brand{font-weight:700;font-size:18px;text-decoration:none;margin-right:auto}
main{max-width:780px;margin:0 auto;padding:28px 24px 48px}
.crumbs,.meta,.pager{font:14px/1.5 system-ui,sans-serif;color:#555}
.cards{list-style:none;padding:0;display:grid;gap:10px}
.cards li{padding:12px 14px;border:1px solid var(--soft);border-radius:8px;background:#fff}
.cards .meta{display:block}
.tags a{margin-right:10px}
footer.site{border-top:1px solid var(--soft);padding:20px 24px;font:14px/1.5 system-ui,sans-serif;color:#555;text-align:center}
`;

function renderPage(page, host) {
  const { model } = getSite();
  const url = `https://${host}${page.path}`;
  const nav = model.departments.map((d) => link(d.path, d.title)).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | ${esc(NAME)}</title>
<meta name="description" content="${esc(`${page.title}: guides and supplies from ${NAME}, ${TOWN}.`)}">
<link rel="canonical" href="${url}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site"><a class="brand" href="/">${esc(NAME)}</a><nav>${nav}</nav></header>
<main>
<h1>${esc(page.title)}</h1>
${body(page, model)}
</main>
<footer class="site"><p>${link('/about/', 'About us')} · ${link('/contact/', 'Contact')} · ${link('/topics/', 'Browse by topic')}</p><p>${esc(FOOTER)}</p></footer>
</body>
</html>
`;
}

const robotsTxt = (host) => `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;

const sitemapXml = (host) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths()
    .map((p) => `  <url><loc>https://${host}${p}</loc></url>`)
    .join('\n')}\n</urlset>\n`;

const NOT_FOUND =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>' +
  '<body><h1>Page not found</h1><p>There is no page at this address.</p></body></html>\n';
const TOO_MANY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Too many requests</title></head>' +
  '<body><h1>Too many requests</h1><p>Please slow down and try again shortly.</p></body></html>\n';

const HTML = 'text/html; charset=utf-8';

/** What a path names: a page, a fixed file, or nothing. */
function resolve(path, host) {
  if (typeof path !== 'string') return null;
  if (path === '/robots.txt')
    return { type: 'text/plain; charset=utf-8', body: robotsTxt(host), page: false };
  if (path === '/sitemap.xml')
    return { type: 'application/xml; charset=utf-8', body: sitemapXml(host), page: false };
  if (path === '/style.css') return { type: 'text/css; charset=utf-8', body: CSS, page: false };
  const page = getSite().pages.get(path);
  return page ? { type: HTML, body: renderPage(page, host), page: true } : null;
}

// ── Answering ─────────────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hashClient = (address) =>
  createHash('sha256').update(String(address)).digest('hex').slice(0, 16);

/**
 * A lab with its own throttle counts. `now`, `wait` and `log` are parameters so the rule can be tested;
 * the handler uses one lab per function instance.
 */
export function createLab({
  now = Date.now,
  wait = sleep,
  log = (line) => console.log(line),
  instance = randomUUID(),
} = {}) {
  /** "host client-hash" → { window, count }: each throttle host counts on its own. Only the current window's count is kept. */
  const counts = new Map();

  function count(client, t) {
    const window = Math.floor(t / THROTTLE_WINDOW_MS) * THROTTLE_WINDOW_MS;
    // Forget every client whose window has passed, so nothing outlives its window.
    for (const [k, v] of counts) if (v.window !== window) counts.delete(k);
    const entry = counts.get(client) ?? { window, count: 0 };
    entry.count += 1;
    counts.set(client, entry);
    return { window, n: entry.count };
  }

  async function answer({ host, path, client }) {
    const t = now();
    const variant = VARIANT[host];
    const hashed = hashClient(client);
    const throttles = variant === 'throttle' || variant === 'throttleBare';
    let out;
    let window = null;
    let n = null;
    let delayMs = 0;
    let retryAfter = null;
    if (throttles) ({ window, n } = count(`${host} ${hashed}`, t));
    if (!variant) {
      out = { status: 404, headers: { 'content-type': HTML }, body: NOT_FOUND };
    } else if (throttles && n > THROTTLE_LIMIT) {
      out = { status: 429, headers: { 'content-type': HTML }, body: TOO_MANY };
      if (variant === 'throttle') {
        retryAfter = Math.max(1, Math.ceil((window + THROTTLE_WINDOW_MS - t) / 1000));
        out.headers['retry-after'] = String(retryAfter);
      }
    } else {
      const found = resolve(path, host);
      if (!found) {
        out = { status: 404, headers: { 'content-type': HTML }, body: NOT_FOUND };
      } else {
        if (variant === 'slow' && found.page) {
          delayMs = SLOW_DELAY_MS;
          await wait(SLOW_DELAY_MS);
        }
        out = { status: 200, headers: { 'content-type': found.type }, body: found.body };
      }
    }
    log(
      JSON.stringify({
        lab: 'large',
        t: new Date(t).toISOString(),
        host: String(host),
        variant: variant ?? null,
        path: typeof path === 'string' ? path : null,
        client: hashed,
        instance,
        window: window === null ? null : new Date(window).toISOString(),
        count: n,
        limit: throttles ? THROTTLE_LIMIT : null,
        status: out.status,
        retryAfter,
        delayMs,
      }),
    );
    return out;
  }

  return { answer };
}

let lab;

/** The client address Vercel reports: the first `x-forwarded-for` entry, then `x-real-ip`, then the socket. */
function clientOf(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** The host the request was made to: `host`, or `x-forwarded-host` when `host` is not one of ours. */
function hostOf(req) {
  const clean = (h) =>
    String(h ?? '')
      .toLowerCase()
      .split(':')[0];
  const host = clean(req.headers.host);
  return VARIANT[host] ? host : clean(req.headers['x-forwarded-host']);
}

export default async function handler(req, res) {
  lab ??= createLab();
  const path = new URL(req.url, 'https://large.lab.crawlmouse.com').searchParams.get('path');
  const out = await lab.answer({ host: hostOf(req), path, client: clientOf(req) });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.setHeader('cache-control', 'no-store');
  res.end(out.body);
}
