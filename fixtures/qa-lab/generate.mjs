#!/usr/bin/env node
/**
 * The QA lab's sites, generated (CC-QA). Every `*.lab.crawlmouse.com` host the QA accounts audit is a
 * static site written by this file into `sites/<label>/`, and `vercel.json` routes each host to its
 * folder. The output is committed, so what Vercel serves is what review read. The large lab's four hosts,
 * which no account audits, are not folders: `api/large.mjs` renders their pages, and this file writes
 * only their routes.
 *
 *   node fixtures/qa-lab/generate.mjs           # rewrite sites/ and vercel.json
 *   node fixtures/qa-lab/generate.mjs --check   # exit 1 if the files on disk differ from its output
 *
 * Output goes through the repository's Prettier config, so CI's format check passes on it as written.
 *
 * Every business, person and place here is invented. Each page's footer says so.
 *
 * What each site is built to make the crawler find is in README.md. The shapes that matter to the
 * engine (packages/engine/src), so an edit here does not undo a site's purpose by accident:
 * - A page whose main text is under 80 characters is `thin` and leaves the graded population;
 *   every page here carries several paragraphs.
 * - Pages whose text is near-identical (SimHash distance ≤ 3) collapse into one; the prose is built
 *   from a sentence bank in a per-page order, with the page's own topic words, so no two match.
 * - The anchor score is per target: the same link text into a page from every page scores as badly
 *   as one anchor. The healthy site's logo link carries no text, and its section links vary.
 * - A page listed in the sitemap and linked from nowhere is an orphan.
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { HOSTS as LARGE_HOSTS } from './api/large.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ZONE = 'lab.crawlmouse.com';

// ── Deterministic helpers ─────────────────────────────────────────────────────────────────────────

const seedOf = (s) => createHash('sha256').update(s).digest().readUInt32LE(0);

/** A small seeded PRNG (mulberry32), so a page's prose is the same on every run. */
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── Prose ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Sentence templates. `{t}` is the page's topic, `{n}` the business, `{p}` its town, `{a}`/`{b}` two
 * of the site's detail words, drawn per sentence. Each page takes twelve in its own order.
 */
const BANK = [
  'Most questions we hear about {t} start with {a}, so that is where this page begins.',
  'At {n} we have spent years working out what actually matters for {t}, and it is rarely the obvious part.',
  'If you only remember one thing about {t}, make it this: {a} comes before {b}, every time.',
  'People in {p} often ask whether {t} is worth the effort; in our experience the answer depends on {a}.',
  'The short version is that {t} rewards patience more than spending.',
  'We keep a written checklist for {t} and update it each season as {b} changes.',
  'A common mistake with {t} is to treat {a} and {b} as the same problem.',
  'Below is the routine our team follows for {t}, written plainly so you can follow it at home.',
  'You do not need special equipment for {t}; a little attention to {a} goes a long way.',
  'When something goes wrong with {t}, check {b} first, because it is the cause more often than not.',
  'Our customers in {p} have taught us more about {t} than any manual ever did.',
  'There is no single right answer for {t}, but there are a few reliably wrong ones.',
  'Start small with {t}, write down what you changed, and give {a} a fortnight to show a difference.',
  'The cost of getting {t} wrong is usually time rather than money, which is good news.',
  'We revisit our advice on {t} every spring, when {b} is easiest to judge.',
  'If you are unsure about {t}, ask us; a five-minute conversation saves a lot of guessing about {a}.',
  'For {t}, the weather in {p} matters more than most guides admit.',
  'Think of {t} as a habit rather than a project, and {b} becomes much easier to manage.',
  'Our notes on {t} come from real jobs, including the ones that did not go to plan.',
  'Good results with {t} tend to follow from steady {a}, not from a single big change.',
  'One quick test for {t}: look at {b} after a week and compare it with your first note.',
  'Every recommendation here about {t} is something we would do ourselves.',
  'The details of {t} vary, yet the principle holds: protect {a}, then improve {b}.',
  'Newcomers to {t} usually overdo {a}; experienced hands do a little less, more often.',
  'We have written this guide to {t} for people who would rather do it once and do it well.',
  'If {t} feels overwhelming, pick the step about {b} and ignore the rest for now.',
  'Questions about {t} arrive at {n} almost daily, and the answers below are the ones we give.',
  'A tidy record of {a} is the most useful tool you can have for {t}.',
  'Local conditions around {p} make {b} the deciding factor for {t}.',
  'What separates a good outcome for {t} from a great one is usually attention to {a}.',
  'Skip the shortcuts for {t}; they tend to cost more in {b} later.',
  'Our team agrees on very little, but we all agree on how to approach {t}.',
  'Expect {t} to take a few attempts before {a} feels natural.',
  'The best time to think about {t} is before you need to, while {b} is still easy to change.',
  'Once {t} is under control, the rest of the work gets noticeably lighter.',
  'We would rather explain {t} properly than sell you something you do not need.',
];

function prose(page, site) {
  const rand = rng(seedOf(`${site.label}${page.path}`));
  const words = site.words;
  const pick = () => words[Math.floor(rand() * words.length)];
  const sentences = shuffled(BANK, rand)
    .slice(0, 12)
    .map((tpl) =>
      tpl
        .replaceAll('{t}', page.topic)
        .replaceAll('{n}', site.name)
        .replaceAll('{p}', site.town)
        .replaceAll('{a}', pick())
        .replaceAll('{b}', pick()),
    );
  return [sentences.slice(0, 4), sentences.slice(4, 8), sentences.slice(8, 12)].map((s) =>
    s.join(' '),
  );
}

// ── Site shapes ───────────────────────────────────────────────────────────────────────────────────

/**
 * A home → sections → leaves site. Returns pages with their links in DOM order (first link per
 * target is the one the graph keeps).
 * opts.hubPhrases: how each leaf names its section (varied, so the section's anchors stay diverse).
 * opts.leafNext: link each leaf to the next leaf in its section.
 * opts.generic: replace every leaf→leaf link text with this (e.g. "Read more").
 */
function hierarchy(site, sections, opts = {}) {
  const pages = [];
  const home = {
    path: '/',
    title: site.homeTitle,
    topic: site.homeTopic,
    lead: site.tagline,
    links: [],
    schemaType: 'home',
  };
  pages.push(home);
  const phrases = opts.hubPhrases ?? [
    'all of our {s} notes',
    'the full {s} section',
    'more about {s}',
    'every {s} guide we have written',
    'the {s} overview',
    'other {s} pages',
    'our {s} hub',
    'the rest of {s}',
  ];
  for (const sec of sections) {
    const secPath = `/${slug(sec.title)}/`;
    const secPage = {
      path: secPath,
      title: sec.title,
      topic: sec.topic ?? sec.title.toLowerCase(),
      lead: sec.lead ?? `Everything we know about ${sec.title.toLowerCase()}, in one place.`,
      links: [],
      schemaType: 'collection',
    };
    home.links.push({ href: secPath, text: sec.homeText ?? sec.title });
    pages.push(secPage);
    sec.leaves.forEach((leafTitle, i) => {
      const leafPath = `${secPath}${slug(leafTitle)}/`;
      const leaf = {
        path: leafPath,
        title: leafTitle,
        topic: leafTitle.toLowerCase(),
        lead: `${leafTitle}: what we recommend, and why.`,
        links: [],
        schemaType: 'article',
      };
      secPage.links.push({ href: leafPath, text: leafTitle });
      leaf.links.push({
        href: secPath,
        text: phrases[i % phrases.length].replace('{s}', sec.title.toLowerCase()),
      });
      pages.push(leaf);
    });
    if (opts.leafNext !== false) {
      const leaves = pages.filter((p) => p.path.startsWith(secPath) && p.path !== secPath);
      leaves.forEach((leaf, i) => {
        const next = leaves[(i + 1) % leaves.length];
        if (next !== leaf) leaf.links.push({ href: next.path, text: opts.generic ?? next.title });
      });
    }
  }
  return pages;
}

/** Pages listed in the sitemap and linked from nowhere: the crawler reaches them only as seeds. */
function orphans(site, titles, under = '/', { linkHome = true } = {}) {
  return titles.map((t) => ({
    path: `${under}${slug(t)}/`,
    title: t,
    topic: t.toLowerCase(),
    lead: `${t}, from our archive.`,
    links: linkHome ? [{ href: '/', text: `${site.name} home` }] : [],
    schemaType: 'article',
  }));
}

/** A chain hanging off `from`: each page links only to the next, so the tail sits deep. */
function chain(pages, fromPath, titles, generic) {
  let prev = pages.find((p) => p.path === fromPath);
  const base = fromPath;
  const out = [];
  for (const t of titles) {
    const page = {
      path: `${base}${slug(t)}/`,
      title: t,
      topic: t.toLowerCase(),
      lead: `${t}, step by step.`,
      links: [],
      schemaType: 'article',
    };
    prev.links.push({ href: page.path, text: generic ?? t });
    out.push(page);
    prev = page;
  }
  return out;
}

// ── The sites ─────────────────────────────────────────────────────────────────────────────────────

const PALETTES = {
  moss: { accent: '#2f6b4f', soft: '#e7f1ea', ink: '#1d2a23', paper: '#fbfcfa' },
  rust: { accent: '#a4462b', soft: '#f6e7df', ink: '#2b1c17', paper: '#fffaf6' },
  navy: { accent: '#24456e', soft: '#e3ebf5', ink: '#172231', paper: '#f9fbfd' },
  plum: { accent: '#6b3a6e', soft: '#f1e6f1', ink: '#2a1a2b', paper: '#fdf9fd' },
  ochre: { accent: '#8a6416', soft: '#f6eed9', ink: '#2a2312', paper: '#fffdf6' },
  teal: { accent: '#1f6b6b', soft: '#e0f0ef', ink: '#152626', paper: '#f8fcfc' },
  slate: { accent: '#4a5563', soft: '#eceef1', ink: '#1f242b', paper: '#fbfbfc' },
  coffee: { accent: '#6f4a2f', soft: '#f3ebe3', ink: '#2a1e15', paper: '#fffcf8' },
  sky: { accent: '#2463a8', soft: '#e2eef9', ink: '#152437', paper: '#f9fcff' },
};

/** Each site: its identity, its pages, and which signals it gets right or wrong. */
function buildSites() {
  const sites = [];

  // healthy — a well-linked guide site: no orphans, depth ≤ 3, varied anchors, every signal right.
  {
    const site = {
      label: 'healthy',
      name: 'Quillmoss Plant Notes',
      town: 'Tarrowmere',
      tagline: 'Plain, tested advice for keeping houseplants alive and well.',
      homeTitle: 'Houseplant care, written down properly',
      homeTopic: 'houseplant care',
      palette: 'moss',
      words: [
        'drainage',
        'light levels',
        'root health',
        'humidity',
        'soil texture',
        'watering rhythm',
        'pot size',
        'airflow',
        'leaf colour',
        'seasonal growth',
      ],
      sitemap: true,
      llms: true,
      schema: true,
      robots: 'open',
      logoOnly: true,
    };
    site.pages = hierarchy(
      site,
      [
        {
          title: 'Watering',
          leaves: [
            'Watering ferns',
            'Watering succulents',
            'Bottom watering',
            'Overwatering signs',
            'Watering in winter',
            'Humidity trays',
            'Self-watering pots',
          ],
        },
        {
          title: 'Light and potting',
          leaves: [
            'North-facing windows',
            'Grow lamps',
            'Low-light plants',
            'Choosing a pot',
            'Repotting season',
            'Mixing potting soil',
            'Root-bound plants',
          ],
        },
        {
          title: 'Pests',
          leaves: [
            'Fungus gnats',
            'Spider mites',
            'Mealybugs',
            'Scale insects',
            'Neem oil',
            'Quarantining new plants',
            'Sticky traps',
          ],
        },
      ],
      { leafNext: false },
    );
    sites.push(site);
  }

  // app-shell — client-rendered: the served HTML is an empty #root and a script.
  sites.push({
    label: 'app-shell',
    name: 'Lumenboard',
    shell: true,
    palette: 'slate',
    robots: 'open',
    sitemap: false,
  });

  // cf-blocked — a normal small site; vercel.json answers the crawler 403 here.
  {
    const site = {
      label: 'cf-blocked',
      name: 'Ostrick Vale Ironworks',
      town: 'Ostrick Vale',
      tagline: 'Gates, railings and repairs, forged by hand.',
      homeTitle: 'Hand-forged ironwork',
      homeTopic: 'decorative ironwork',
      palette: 'slate',
      words: [
        'forge heat',
        'finish',
        'hinge alignment',
        'rust protection',
        'measurements',
        'paint system',
      ],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      logoOnly: true,
    };
    site.pages = hierarchy(site, [
      { title: 'Gates', leaves: ['Garden gates', 'Driveway gates'] },
      { title: 'Railings', leaves: ['Stair railings'] },
    ]);
    sites.push(site);
  }

  // client-1 — a bakery: nine sitemap-only orphan pages, one "Back to the menu" anchor into each section, no structured data, no llms.txt.
  {
    const site = {
      label: 'client-1',
      name: 'Tarrowmere Bakehouse',
      town: 'Tarrowmere',
      tagline: 'Sourdough, pastries and celebration cakes, baked before dawn.',
      homeTitle: 'Fresh bread every morning',
      homeTopic: 'baking bread',
      palette: 'ochre',
      words: [
        'proving time',
        'oven temperature',
        'flour blend',
        'crust colour',
        'hydration',
        'starter strength',
        'butter quality',
      ],
      sitemap: true,
      llms: false,
      schema: false,
      robots: 'open',
      logoOnly: true,
    };
    site.pages = hierarchy(
      site,
      [
        { title: 'Breads', leaves: ['Country sourdough', 'Seeded rye', 'Milk loaf'] },
        { title: 'Pastries', leaves: ['Almond croissants', 'Cardamom buns', 'Fruit danishes'] },
        { title: 'Cakes', leaves: ['Celebration cakes', 'Lemon drizzle'] },
      ],
      { hubPhrases: ['Back to the menu'] },
    );
    site.pages.push(
      ...orphans(
        site,
        [
          'Summer opening hours',
          'Wholesale enquiries',
          'Our old menu',
          'Christmas orders',
          'Bread classes',
          'Allergen list',
          'New oven',
          'Gluten-free trial',
          'Market stall dates',
        ],
        '/news/',
      ),
    );
    sites.push(site);
  }

  // client-2 — a cycle workshop: a deep chain of repair guides and "Read more" links throughout.
  {
    const site = {
      label: 'client-2',
      name: 'Corranwick Cycle Works',
      town: 'Corranwick Bay',
      tagline: 'Repairs, servicing and fitting for every kind of bicycle.',
      homeTitle: 'Bike repairs you can trust',
      homeTopic: 'bicycle maintenance',
      palette: 'rust',
      words: [
        'chain wear',
        'tyre pressure',
        'brake pads',
        'gear indexing',
        'bearing play',
        'cable tension',
        'wheel truing',
      ],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      logoOnly: true,
    };
    site.pages = hierarchy(
      site,
      [
        {
          title: 'Servicing',
          leaves: [
            'Basic service',
            'Full service',
            'Winter service',
            'E-bike service',
            'Service intervals',
          ],
        },
        {
          title: 'Repairs',
          leaves: [
            'Puncture repair',
            'Brake bleeding',
            'Wheel truing',
            'Gear tuning',
            'Bottom bracket',
          ],
        },
        {
          title: 'Fitting',
          leaves: ['Saddle height', 'Handlebar reach', 'Cleat setup', 'Frame sizing'],
        },
        {
          title: 'Advice',
          leaves: ['Commuting kit', 'Riding in rain', 'Locking your bike', 'Buying second hand'],
        },
      ],
      { generic: 'Read more' },
    );
    site.pages.push(
      ...chain(
        site.pages,
        '/repairs/bottom-bracket/',
        [
          'Removing the cranks',
          'Extracting the cups',
          'Cleaning the shell',
          'Fitting new bearings',
          'Torque settings',
          'Refitting the cranks',
          'Adjusting the front mech',
          'Test ride',
          'Final checks',
        ],
        'Read more',
      ),
    );
    site.pages.push(
      ...orphans(site, ['Old opening hours', 'Spring tune-up offer', 'Workshop move'], '/news/'),
    );
    sites.push(site);
  }

  // client-3 — a dental practice: broken internal links, a deep chain, no sitemap, robots.txt blocks GPTBot.
  {
    const site = {
      label: 'client-3',
      name: 'Quenmere Fold Dental',
      town: 'Quenmere Fold',
      tagline: 'Calm, unhurried dental care for the whole family.',
      homeTitle: 'Family dentistry in Quenmere Fold',
      homeTopic: 'dental care',
      palette: 'teal',
      words: [
        'gum health',
        'brushing technique',
        'flossing',
        'enamel',
        'check-up timing',
        'diet',
        'sensitivity',
      ],
      sitemap: false,
      llms: false,
      schema: true,
      robots: 'gptbot-blocked',
      logoOnly: true,
    };
    site.pages = hierarchy(site, [
      {
        title: 'Treatments',
        leaves: ['Check-ups', 'Hygienist visits', 'Fillings', 'Root canals', 'Crowns'],
      },
      { title: 'Cosmetic', leaves: ['Whitening', 'Veneers', 'Invisible braces'] },
      { title: 'Patients', leaves: ['Nervous patients', 'Children', 'Emergency care', 'Fees'] },
    ]);
    // The broken link: a page that was renamed and never redirected.
    site.pages
      .find((p) => p.path === '/treatments/')
      .links.push({ href: '/treatments/dental-implants/', text: 'Dental implants' });
    site.pages
      .find((p) => p.path === '/patients/fees/')
      .links.push({ href: '/payment-plans/', text: 'Payment plans' });
    site.pages.push(
      ...chain(site.pages, '/patients/children/', [
        'First visit for toddlers',
        'Fissure sealants',
        'Orthodontic assessment',
        'Brace aftercare',
        'Retainers',
      ]),
    );
    sites.push(site);
  }

  // client-4 — an accountancy firm: large and mostly sound; a text nav repeats one anchor per page.
  {
    const site = {
      label: 'client-4',
      name: 'Ashmarrow Ledger & Co',
      town: 'Ashmarrow',
      tagline: 'Bookkeeping, tax returns and payroll for small firms.',
      homeTitle: 'Accountants for small businesses',
      homeTopic: 'small business finance',
      palette: 'navy',
      words: [
        'cash flow',
        'receipts',
        'deadlines',
        'allowable expenses',
        'payroll records',
        'VAT periods',
        'invoices',
        'year-end',
      ],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      nav: [
        { href: '/services/', text: 'Services' },
        { href: '/guides/', text: 'Guides' },
        { href: '/sectors/', text: 'Sectors' },
      ],
    };
    const leaves = (prefix, list) => list.map((x) => `${prefix} ${x}`);
    site.pages = hierarchy(site, [
      {
        title: 'Services',
        leaves: [
          'Bookkeeping',
          'Payroll',
          'Annual accounts',
          'Self assessment',
          'VAT returns',
          'Company formation',
          'Management reports',
          'Cloud software setup',
          'Pension filings',
          'Tax planning',
        ],
      },
      {
        title: 'Guides',
        leaves: leaves('Guide to', [
          'expenses',
          'mileage',
          'home office costs',
          'dividends',
          'payroll deadlines',
          'invoicing',
          'record keeping',
          'sole trader tax',
          'limited companies',
          'VAT schemes',
          'capital allowances',
          'year-end planning',
        ]),
      },
      {
        title: 'Sectors',
        leaves: [
          'Builders',
          'Cafes',
          'Consultants',
          'Designers',
          'Landlords',
          'Retailers',
          'Therapists',
          'Charities',
        ],
      },
      {
        title: 'Firm',
        leaves: [
          'Our team',
          'Fees and packages',
          'How we work',
          'Careers',
          'Contact the office',
          'Client stories',
          'Privacy notice',
          'Complaints',
        ],
      },
    ]);
    sites.push(site);
  }

  // client-5 — a pet groomer: orphans, generic anchors and a deep chain on a small site.
  {
    const site = {
      label: 'client-5',
      name: 'Fennowmere Paws Grooming',
      town: 'Fennowmere',
      tagline: 'Bath, brush and trim for dogs of every size.',
      homeTitle: 'Dog grooming in Fennowmere',
      homeTopic: 'dog grooming',
      palette: 'plum',
      words: [
        'coat type',
        'nail length',
        'shampoo choice',
        'matting',
        'ear cleaning',
        'drying time',
      ],
      sitemap: true,
      llms: false,
      schema: false,
      robots: 'open',
      logoOnly: true,
    };
    site.pages = hierarchy(
      site,
      [
        { title: 'Grooming', homeText: 'Click here', leaves: ['Full groom', 'Bath and brush'] },
        { title: 'Prices', homeText: 'Learn more', leaves: ['Small dogs'] },
      ],
      { generic: 'Read more', hubPhrases: ['Go back', 'Go back'] },
    );
    site.pages.push(
      ...chain(
        site.pages,
        '/grooming/full-groom/',
        [
          'Puppy first visit',
          'Puppy second visit',
          'Puppy coat change',
          'Adult coat care',
          'Senior dog grooming',
        ],
        'click here',
      ),
    );
    site.pages.push(
      ...orphans(
        site,
        [
          'Old price list',
          'Spring offer',
          'Gift vouchers',
          'Grooming tips archive',
          'Staff photos',
          'Summer clip offer',
          'Muddy paws advice',
          'Holiday closures',
          'Loyalty card',
          'Cat grooming trial',
          'Van booking form',
          'Shampoo stockists',
          'Christmas bandanas',
          'New premises',
          'Parking notes',
        ],
        '/',
        { linkHome: false },
      ),
    );
    sites.push(site);
  }

  // client-6 — a roofer: the largest client (57 pages), a five-item text nav on every page, deep pages, GPTBot blocked.
  {
    const site = {
      label: 'client-6',
      name: 'Brackenhythe Roofing',
      town: 'Brackenhythe',
      tagline: 'Slate, tile and flat roofs, repaired and replaced.',
      homeTitle: 'Roofers serving Brackenhythe',
      homeTopic: 'roof repair',
      palette: 'slate',
      words: [
        'flashing',
        'ridge tiles',
        'gutters',
        'felt underlay',
        'ventilation',
        'moss growth',
        'storm damage',
        'lead work',
      ],
      sitemap: true,
      llms: false,
      schema: false,
      robots: 'gptbot-blocked',
      nav: [
        { href: '/roof-repairs/', text: 'Repairs' },
        { href: '/new-roofs/', text: 'New roofs' },
        { href: '/flat-roofs/', text: 'Flat roofs' },
        { href: '/areas/', text: 'Areas' },
        { href: '/about-us/', text: 'About' },
      ],
    };
    const areas = [
      'Brackenhythe',
      'Ostrick Vale',
      'Tarrowmere',
      'Ashmarrow',
      'Fennowmere',
      'Corranwick Bay',
      'Quenmere Fold',
      'Marrowgate',
      'Kelderby',
      'Wyndle Cross',
      'Pellham Moor',
      'Oakquill Rise',
      'Thornquill Lane',
      'Sallow End',
    ];
    site.pages = hierarchy(site, [
      {
        title: 'Roof repairs',
        leaves: [
          'Slipped tiles',
          'Leaking valleys',
          'Chimney flashing',
          'Ridge repointing',
          'Storm damage repairs',
          'Gutter repairs',
          'Fascia boards',
          'Emergency call-outs',
        ],
      },
      {
        title: 'New roofs',
        leaves: [
          'Slate roofs',
          'Clay tile roofs',
          'Concrete tile roofs',
          'Roof insulation',
          'Skylights',
          'Re-roofing costs',
        ],
      },
      {
        title: 'Flat roofs',
        leaves: [
          'Rubber membranes',
          'Felt roofs',
          'Fibreglass roofs',
          'Garage roofs',
          'Balcony roofs',
        ],
      },
      { title: 'Areas', leaves: areas.map((a) => `Roofers in ${a}`) },
      { title: 'About us', leaves: ['Our roofers', 'Guarantees', 'Reviews', 'Get a quote'] },
    ]);
    site.pages.push(
      ...chain(site.pages, '/flat-roofs/garage-roofs/', [
        'Garage roof survey',
        'Garage roof stripping',
        'Garage roof decking',
        'Garage roof membrane',
        'Garage roof edging',
        'Garage roof drainage',
        'Garage roof aftercare',
        'Garage roof warranty',
        'Garage roof inspections',
        'Garage roof repairs later',
        'Garage roof replacement',
      ]),
    );
    site.pages.push(
      ...orphans(site, ['Roofing glossary', 'Winter checklist', 'Old projects gallery'], '/blog/'),
    );
    sites.push(site);
  }

  // trial-client-1 — a yoga studio of middling quality, for the Agency trial.
  {
    const site = {
      label: 'trial-client-1',
      name: 'Marrowgate Yoga Loft',
      town: 'Marrowgate',
      tagline: 'Small classes, patient teachers, a warm room.',
      homeTitle: 'Yoga classes in Marrowgate',
      homeTopic: 'yoga practice',
      palette: 'plum',
      words: [
        'breathing',
        'balance',
        'flexibility',
        'posture',
        'class size',
        'rest',
        'core strength',
      ],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      nav: [{ href: '/classes/', text: 'Classes' }],
    };
    site.pages = hierarchy(
      site,
      [
        {
          title: 'Classes',
          leaves: [
            'Beginners yoga',
            'Vinyasa flow',
            'Yin yoga',
            'Pregnancy yoga',
            'Chair yoga',
            'Hot yoga',
          ],
        },
        { title: 'Teachers', leaves: ['Teacher training', 'Our teachers', 'Guest teachers'] },
        {
          title: 'Visiting',
          leaves: [
            'Timetable',
            'Prices',
            'What to bring',
            'Getting here',
            'Studio rules',
            'Gift cards',
          ],
        },
        {
          title: 'Journal',
          leaves: [
            'Breathing basics',
            'Yoga for runners',
            'Morning routines',
            'Stretching at a desk',
          ],
        },
      ],
      { generic: 'Learn more' },
    );
    site.pages.push(
      ...orphans(
        site,
        [
          'Summer retreat',
          'Old timetable',
          'Workshop recap',
          'Teacher news',
          'Autumn courses',
          'Mat cleaning',
        ],
        '/journal/',
      ),
    );
    sites.push(site);
  }

  // demo-1..3 — polished fictional businesses that grade B to C, with fixes that read well.
  {
    const site = {
      label: 'demo-1',
      name: 'Fernhollow Coffee Roasters',
      town: 'Fernhollow',
      tagline: 'Small-batch coffee, roasted on Tuesdays and shipped on Wednesdays.',
      homeTitle: 'Coffee roasted this week, not this year',
      homeTopic: 'fresh coffee',
      palette: 'coffee',
      words: [
        'roast date',
        'grind size',
        'water temperature',
        'brew ratio',
        'origin',
        'acidity',
        'storage',
        'freshness',
      ],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      demo: true,
      nav: [
        { href: '/shop/', text: 'Shop' },
        { href: '/brew-guides/', text: 'Brew guides' },
      ],
    };
    site.pages = hierarchy(site, [
      {
        title: 'Shop',
        leaves: [
          'House espresso',
          'Ethiopia washed',
          'Colombia honey',
          'Decaf',
          'Subscription',
          'Gift boxes',
        ],
      },
      {
        title: 'Brew guides',
        leaves: [
          'Pour over',
          'French press',
          'Espresso at home',
          'Cold brew',
          'Moka pot',
          'Aeropress',
        ],
      },
      {
        title: 'Our story',
        leaves: ['How we roast', 'Where we buy', 'Visit the roastery', 'Wholesale'],
      },
    ]);
    site.pages.push(
      ...chain(site.pages, '/brew-guides/espresso-at-home/', [
        'Dialling in espresso',
        'Steaming milk',
        'Latte art basics',
      ]),
    );
    site.pages.push(...orphans(site, ['Spring blend', 'Holiday opening'], '/news/'));
    sites.push(site);
  }
  {
    const site = {
      label: 'demo-2',
      name: 'Silverquill Physio',
      town: 'Kelderby',
      tagline: 'Physiotherapy that gets you back to what you love.',
      homeTitle: 'Physiotherapy in Kelderby',
      homeTopic: 'physiotherapy',
      palette: 'teal',
      words: [
        'mobility',
        'recovery time',
        'posture',
        'strength work',
        'pain levels',
        'sleep',
        'exercise plan',
      ],
      sitemap: true,
      llms: false,
      schema: false,
      robots: 'open',
      demo: true,
      nav: [
        { href: '/conditions/', text: 'Conditions' },
        { href: '/treatments/', text: 'Treatments' },
        { href: '/book/', text: 'Book' },
      ],
    };
    site.pages = hierarchy(
      site,
      [
        {
          title: 'Conditions',
          leaves: [
            'Back pain',
            'Neck pain',
            'Knee injuries',
            'Shoulder pain',
            'Running injuries',
            'Ankle sprains',
          ],
        },
        {
          title: 'Treatments',
          leaves: [
            'Sports massage',
            'Acupuncture',
            'Rehabilitation',
            'Pilates sessions',
            'Home visits',
          ],
        },
        { title: 'Book', leaves: ['First appointment', 'Prices', 'Insurance', 'Finding us'] },
      ],
      { generic: 'Learn more' },
    );
    site.pages.push(
      ...chain(site.pages, '/conditions/knee-injuries/', [
        'Knee rehab week one',
        'Knee rehab week two',
        'Knee rehab week three',
      ]),
    );
    site.pages.push(
      ...orphans(
        site,
        [
          'New clinic hours',
          'Running club talk',
          'Desk posture workshop',
          'Holiday cover',
          'Team charity run',
          'Old price list',
        ],
        '/news/',
      ),
    );
    sites.push(site);
  }
  {
    const site = {
      label: 'demo-3',
      name: 'Kestrel & Vane Cycle Tours',
      town: 'Wyndle Cross',
      tagline: 'Guided bike tours on quiet lanes, with good lunches.',
      homeTitle: 'Guided cycle tours through the Wyndle hills',
      homeTopic: 'cycle touring',
      palette: 'sky',
      words: [
        'route length',
        'climbing',
        'pace',
        'luggage transfer',
        'weather',
        'lunch stops',
        'bike fit',
      ],
      sitemap: true,
      llms: true,
      schema: true,
      robots: 'open',
      demo: true,
      nav: [
        { href: '/tours/', text: 'Tours' },
        { href: '/plan-your-trip/', text: 'Plan your trip' },
      ],
    };
    site.pages = hierarchy(site, [
      {
        title: 'Tours',
        leaves: [
          'Three-day valley loop',
          'Weekend coast ride',
          'Hill villages tour',
          'Family day ride',
          'Gravel explorer',
          'Autumn colours tour',
        ],
      },
      {
        title: 'Plan your trip',
        leaves: [
          'Choosing a tour',
          'Fitness levels',
          'Bike hire',
          'What to pack',
          'Getting here',
          'Booking terms',
        ],
      },
      { title: 'About the guides', leaves: ['Meet the guides', 'Reviews', 'Safety'] },
    ]);
    site.pages.push(
      ...orphans(
        site,
        ['Spring dates', 'Private groups', 'Route updates', 'Winter rides', 'Guide recruitment'],
        '/news/',
      ),
    );
    sites.push(site);
  }

  // slow — an ordinary small site served late: each page answers after a fixed delay (api/slow.mjs), for
  // the journey step that a slow site still finishes inside its stated time, with progress throughout.
  {
    const site = {
      label: 'slow',
      name: 'Tidewell Pottery',
      town: 'Tidewell',
      tagline: 'Thrown by hand, fired slowly, made to be used.',
      homeTitle: 'Handmade pottery in Tidewell',
      homeTopic: 'handmade pottery',
      palette: 'plum',
      words: ['stoneware', 'glaze', 'kiln', 'clay body', 'wheel', 'firing', 'throwing'],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      nav: [{ href: '/shop/', text: 'Shop' }],
    };
    site.pages = hierarchy(
      site,
      [
        { title: 'Shop', leaves: ['Mugs', 'Bowls', 'Plates', 'Vases'] },
        { title: 'Classes', leaves: ['Beginners wheel', 'Hand building', 'Glazing day'] },
        { title: 'Studio', leaves: ['Our kiln', 'Visiting', 'Care of your pots'] },
      ],
      {},
    );
    sites.push(site);
  }

  // sentinel — an ordinary small site whose robots.txt changes with the clock (api/sentinel.mjs): it
  // disallows GPTBot during odd UTC hours and allows it during even ones, for the daily sentinel's
  // journey step (J2.4i). Its pages are served as they are, at once.
  {
    const site = {
      label: 'sentinel',
      name: 'Harrowgate Lamps',
      town: 'Harrowgate',
      tagline: 'Lamps mended, rewired and made to last.',
      homeTitle: 'Lamp repair in Harrowgate',
      homeTopic: 'lamp repair',
      palette: 'plum',
      words: ['rewiring', 'brass', 'shade', 'switch', 'bulb holder', 'flex', 'base'],
      sitemap: true,
      llms: false,
      schema: true,
      robots: 'open',
      nav: [{ href: '/repairs/', text: 'Repairs' }],
    };
    site.pages = hierarchy(
      site,
      [
        { title: 'Repairs', leaves: ['Rewiring', 'New switches', 'Shade making'] },
        { title: 'Lamps', leaves: ['Table lamps', 'Floor lamps', 'Desk lamps'] },
        { title: 'Visit', leaves: ['Opening hours', 'Finding us'] },
      ],
      {},
    );
    sites.push(site);
  }
  return sites;
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────────

const LOGO = (accent) =>
  `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="${accent}"/><path d="M8 17c3-7 9-7 12 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;

function css(site) {
  const p = PALETTES[site.palette];
  return `:root{--accent:${p.accent};--soft:${p.soft};--ink:${p.ink};--paper:${p.paper}}
*{box-sizing:border-box}
body{margin:0;font:17px/1.65 Georgia,'Iowan Old Style',serif;color:var(--ink);background:var(--paper)}
a{color:var(--accent)}
header.site{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 24px;border-bottom:1px solid var(--soft);background:#fff}
header.site .brand{font:600 18px/1.2 system-ui,sans-serif;letter-spacing:.01em}
header.site nav{margin-left:auto;display:flex;gap:18px;font:500 15px/1 system-ui,sans-serif}
header.site nav a{text-decoration:none}
.hero{background:var(--soft);padding:48px 24px 40px}
.hero h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:0 auto;max-width:760px}
.hero p{max-width:760px;margin:12px auto 0;font-size:19px}
main{max-width:760px;margin:0 auto;padding:32px 24px 48px}
main p.related{border-left:3px solid var(--accent);padding-left:14px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:24px 0}
.cards a{display:block;padding:16px;border-radius:10px;background:#fff;border:1px solid var(--soft);text-decoration:none;font:600 16px/1.3 system-ui,sans-serif}
footer.site{border-top:1px solid var(--soft);padding:20px 24px;font:14px/1.5 system-ui,sans-serif;color:#555;text-align:center}
`;
}

function jsonLd(site, page, url) {
  if (!site.schema) return '';
  const base = `https://${site.label}.${ZONE}`;
  let data;
  if (page.schemaType === 'home') {
    data = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${base}/#org`,
          name: site.name,
          url: `${base}/`,
          description: site.tagline,
        },
        {
          '@type': 'WebSite',
          '@id': `${base}/#site`,
          name: site.name,
          url: `${base}/`,
          publisher: { '@id': `${base}/#org` },
        },
      ],
    };
  } else {
    data = {
      '@context': 'https://schema.org',
      '@type': page.schemaType === 'collection' ? 'CollectionPage' : 'Article',
      name: page.title,
      headline: page.title,
      url,
      publisher: { '@type': 'Organization', name: site.name, url: `${base}/` },
    };
  }
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function renderPage(site, page) {
  const base = `https://${site.label}.${ZONE}`;
  const url = `${base}${page.path}`;
  const paras = prose(page, site);
  const nav = site.nav
    ? `<nav>${site.nav.map((l) => `<a href="${l.href}">${esc(l.text)}</a>`).join('')}</nav>`
    : '';
  const isHub = page.schemaType !== 'article';
  const linksHtml = (links) => links.map((l) => `<a href="${l.href}">${esc(l.text)}</a>`);
  const body = isHub
    ? `<p>${esc(paras[0])}</p>
<div class="cards">${linksHtml(page.links).join('')}</div>
<p>${esc(paras[1])}</p>
<p>${esc(paras[2])}</p>`
    : `<p>${esc(paras[0])}</p>
<p>${esc(paras[1])}</p>
${page.links.length ? `<p class="related">Keep reading: ${linksHtml(page.links).join(', or ')}.</p>` : ''}
<p>${esc(paras[2])}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | ${esc(site.name)}</title>
<meta name="description" content="${esc(page.lead)}">
<link rel="canonical" href="${url}">
<link rel="stylesheet" href="/style.css">
${jsonLd(site, page, url)}
</head>
<body>
<header class="site"><a href="/" aria-label="${esc(site.name)}">${LOGO(PALETTES[site.palette].accent)}</a><span class="brand">${esc(site.name)}</span>${nav}</header>
<section class="hero"><h1>${esc(page.title)}</h1><p>${esc(page.lead)}</p></section>
<main>
${body}
</main>
<footer class="site">${esc(site.name)}, ${esc(site.town)} · A fictional business: a Crawlmouse QA test site. Nothing here is real.</footer>
</body>
</html>
`;
}

function robots(site) {
  const lines = ['User-agent: *', 'Allow: /'];
  if (site.robots === 'gptbot-blocked') lines.push('', 'User-agent: GPTBot', 'Disallow: /');
  if (site.sitemap) lines.push('', `Sitemap: https://${site.label}.${ZONE}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

function sitemap(site) {
  const urls = site.pages.map(
    (p) => `  <url><loc>https://${site.label}.${ZONE}${p.path}</loc></url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function llms(site) {
  const lines = [
    `# ${site.name}`,
    '',
    `> ${site.tagline} (A fictional business: a Crawlmouse QA test site.)`,
    '',
  ];
  const hubs = site.pages.filter((p) => p.schemaType === 'collection');
  for (const hub of hubs) {
    lines.push(`## ${hub.title}`, '');
    for (const p of site.pages.filter((x) => x.path.startsWith(hub.path) && x !== hub)) {
      lines.push(`- [${p.title}](https://${site.label}.${ZONE}${p.path}): ${p.lead}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The client-rendered shell: no content in the HTML; the script builds it. */
function shellFiles(site) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.name)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="root"></div>
<script src="/app.js" defer></script>
</body>
</html>
`;
  const js = `// ${site.name}: a fictional product. This page is a Crawlmouse QA fixture whose HTML is an empty
// #root; everything a reader sees is built here, after load, as a client-rendered app would.
(function () {
  var views = {
    '/': ['Plan your week on one board', 'Lumenboard lays out tasks, notes and deadlines on a single page, so a small team can see the week at a glance.'],
    '/features': ['Features', 'Boards, checklists, due dates and a calm weekly summary every Monday morning.'],
    '/pricing': ['Pricing', 'Free for three people. Teams pay a flat monthly fee, with no per-seat surprises.']
  };
  function render() {
    var path = location.pathname.replace(/\\/$/, '') || '/';
    var v = views[path] || ['Not found', 'That page does not exist in this fictional app.'];
    var root = document.getElementById('root');
    root.innerHTML = '';
    var header = document.createElement('header');
    header.className = 'site';
    ['/', '/features', '/pricing'].forEach(function (href) {
      var a = document.createElement('a');
      a.href = href;
      a.textContent = views[href][0];
      a.style.marginRight = '16px';
      header.appendChild(a);
    });
    var main = document.createElement('main');
    var h1 = document.createElement('h1');
    h1.textContent = v[0];
    var p = document.createElement('p');
    p.textContent = v[1];
    main.appendChild(h1);
    main.appendChild(p);
    var foot = document.createElement('footer');
    foot.className = 'site';
    foot.textContent = 'A fictional product: a Crawlmouse QA test site. Nothing here is real.';
    root.appendChild(header);
    root.appendChild(main);
    root.appendChild(foot);
  }
  render();
})();
`;
  return { 'index.html': html, 'app.js': js, 'style.css': css(site), 'robots.txt': robots(site) };
}

function siteFiles(site) {
  if (site.shell) return shellFiles(site);
  const files = { 'style.css': css(site), 'robots.txt': robots(site) };
  for (const page of site.pages) {
    files[`${page.path.slice(1)}index.html`] = renderPage(site, page);
  }
  if (site.sitemap) files['sitemap.xml'] = sitemap(site);
  if (site.llms) files['llms.txt'] = llms(site);
  return files;
}

// ── Routing ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Legacy `routes`, because only they can set a status: cf-blocked answers 403 to any user agent
 * containing "Crawlmouse" (CRAWLMOUSE_UA below), as a WAF rule would. Each host
 * is rewritten into its own folder. A last route answers 404 to everything else, so another host and
 * the bare deployment URL reach no folder (a request no route took would fall through to the files).
 */
function vercelJson(sites) {
  // Vercel serves a file that exists at the requested path ahead of a host rewrite (measured: a
  // lab host answered /sites/<other>/ with the other site), so the lab's own paths are refused first.
  // It also serves a percent-encoded spelling of one (measured: /%73ites/cf-blocked/ on healthy), which
  // `src` does not match, so any path holding a % is refused too; no lab page has one.
  //
  // Every response a route answers carries `X-Robots-Tag: noindex` except to a user agent containing "Crawlmouse"
  // (OPERATING-RULES §13: the lab must never compete with crawlmouse.com in search). robots.txt does
  // not disallow search engines: one kept out by robots.txt never reads the header (owner ruling). The exception is
  // load-bearing: the engine reads the header and drops a noindex page from the graded population, so
  // without it every lab site would be refused a grade.
  const routes = [
    {
      src: '/(.*)',
      missing: [{ type: 'header', key: 'user-agent', value: CRAWLMOUSE_UA }],
      headers: { 'X-Robots-Tag': 'noindex' },
      continue: true,
    },
    {
      src: '/(?:(?:sites|api|blocked\\.html|404\\.html)(?:/.*)?|.*%.*)',
      status: 404,
      dest: '/404.html',
    },
  ];
  for (const s of sites) {
    const host = `${s.label}.${ZONE}`;
    if (s.label === 'cf-blocked') {
      routes.push({
        src: '/(.*)',
        has: [
          { type: 'host', value: host },
          { type: 'header', key: 'user-agent', value: CRAWLMOUSE_UA },
        ],
        status: 403,
        dest: '/blocked.html',
      });
    }
    routes.push({
      src: '/(.*)',
      has: [{ type: 'host', value: host }],
      // The slow site is served by its function, which answers late, and the sentinel site by its
      // own, whose robots.txt changes with the clock; every other site is static files.
      dest: FUNCTION_SITES.has(s.label) ? `/api/${s.label}?path=/$1` : `/sites/${s.label}/$1`,
    });
  }
  // The large lab: one function renders the same ~2,500 pages on four hosts and answers each host its
  // own way (api/large.mjs); it tells them apart by the Host header, so the route is the same for all.
  for (const host of Object.values(LARGE_HOSTS)) {
    routes.push({
      src: '/(.*)',
      has: [{ type: 'host', value: host }],
      dest: '/api/large?path=/$1',
    });
  }
  routes.push({ src: '/(.*)', status: 404, dest: '/404.html' });
  return `${JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      ignoreCommand: IGNORE_COMMAND,
      functions: {
        'api/slow.mjs': { includeFiles: 'sites/slow/**', maxDuration: 10 },
        'api/sentinel.mjs': { includeFiles: 'sites/sentinel/**', maxDuration: 10 },
        'api/large.mjs': { maxDuration: 10 },
      },
      routes,
    },
    null,
    2,
  )}\n`;
}

/** The sites served by a function of their own under `api/`, rather than as static files. */
const FUNCTION_SITES = new Set(['slow', 'sentinel']);

/**
 * A user agent that discloses Crawlmouse: the engine's and the worker's, except the worker's browser
 * control and the engine's render client, which send untagged browser agents.
 */
const CRAWLMOUSE_UA = '.*[Cc]rawlmouse.*';

/**
 * Build only when this folder changed since the last deployed commit; when that commit is unknown or
 * not in the clone (git exits 128), build: any failure becomes exit 1, which builds; exit 0 skips.
 */
const IGNORE_COMMAND =
  'if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . || exit 1; else exit 1; fi';

const BLOCKED = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Access denied</title></head>
<body><h1>Access denied</h1><p>This request was blocked by the site's firewall rules.</p></body></html>
`;

const NOT_FOUND = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>
<body><h1>Page not found</h1><p>There is no page at this address.</p></body></html>
`;

// ── Write or check ────────────────────────────────────────────────────────────────────────────────

const FORMATTED = /\.(html|css|js|json|md)$/;

async function output() {
  const sites = buildSites();
  const raw = { 'vercel.json': vercelJson(sites), 'blocked.html': BLOCKED, '404.html': NOT_FOUND };
  for (const s of sites) {
    for (const [p, body] of Object.entries(siteFiles(s))) raw[`sites/${s.label}/${p}`] = body;
  }
  const files = {};
  for (const [p, body] of Object.entries(raw)) {
    const filepath = join(ROOT, p);
    files[p] = FORMATTED.test(p)
      ? await prettier.format(body, { ...(await prettier.resolveConfig(filepath)), filepath })
      : body;
  }
  return files;
}

function listed(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const full = join(dir, f);
    return statSync(full).isDirectory() ? listed(full) : [relative(ROOT, full)];
  });
}

const files = await output();
/** What is here by hand rather than written by this file; anything else unlisted is stale output. */
const SOURCES = [
  'generate.mjs',
  'README.md',
  '.vercelignore',
  'api/slow.mjs',
  'api/sentinel.mjs',
  'api/large.mjs',
];
// `vercel link` writes .vercel/ and .env.local; both are gitignored and never uploaded.
const generated = listed(ROOT).filter(
  (p) => !SOURCES.includes(p) && !p.startsWith('.vercel/') && p !== '.env.local',
);

if (process.argv.includes('--check')) {
  const stale = Object.entries(files)
    .filter(
      ([p, body]) => !existsSync(join(ROOT, p)) || readFileSync(join(ROOT, p), 'utf8') !== body,
    )
    .map(([p]) => p);
  const extra = generated.filter((p) => !(p in files));
  if (stale.length || extra.length) {
    console.error(
      `qa-lab output is out of date: ${[...stale, ...extra.map((p) => `${p} (not generated)`)].join(', ')}`,
    );
    console.error('run: node fixtures/qa-lab/generate.mjs');
    process.exit(1);
  }
  console.log(`qa-lab output matches the generator (${Object.keys(files).length} files)`);
} else {
  rmSync(join(ROOT, 'sites'), { recursive: true, force: true });
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, p)), { recursive: true });
    writeFileSync(join(ROOT, p), body);
  }
  const pages = Object.keys(files).filter((p) => p.endsWith('index.html')).length;
  console.log(`wrote ${Object.keys(files).length} files, ${pages} pages`);
}
