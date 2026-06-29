export interface FaqItem {
  question: string;
  answer: string;
}

// Homepage FAQ. Rendered BOTH as visible content and as FAQPage JSON-LD from this one source, so the
// structured data always matches what's on the page (a Google requirement for FAQ rich results).
export const HOMEPAGE_FAQ: readonly FaqItem[] = [
  {
    question: 'What is Crawlmouse?',
    answer:
      "Crawlmouse is a free tool that crawls your website, maps its internal links, and grades the structure — orphan pages, hub strength, click depth, and anchor-text diversity — as a single A–F score you can share.",
  },
  {
    question: 'Is Crawlmouse free?',
    answer:
      'Yes. You can audit any site for free, with no account and nothing to install. A Pro plan ($19/month) adds CSV export and higher limits for people who audit sites regularly.',
  },
  {
    question: 'Do I need to install anything?',
    answer:
      "No. Crawlmouse runs in your browser — you paste a URL and it crawls the live site for you. There's no desktop app, extension, or download.",
  },
  {
    question: 'What does the grade measure?',
    answer:
      'Four things: orphan pages (pages with no internal links pointing to them), click depth (how far pages sit from the homepage), anchor-text diversity, and overall structure quality — how authority flows through your internal links.',
  },
  {
    question: 'Which platforms does it work on?',
    answer:
      "Any website — Shopify, WordPress, Webflow, Wix, Squarespace, Framer, Ghost, or fully custom. Crawlmouse reads the rendered HTML, so the platform doesn't matter.",
  },
  {
    question: 'Can AI crawlers like ChatGPT and Claude see my site?',
    answer:
      "AI crawlers such as GPTBot (ChatGPT), ClaudeBot, and PerplexityBot don't run JavaScript — they read your raw HTML, which is exactly what Crawlmouse grades. If your internal links only appear after JavaScript runs, those crawlers can't follow them. Crawlmouse shows you the site they actually see.",
  },
  {
    question: 'How long does an audit take?',
    answer:
      'Most sites finish in under two minutes. Larger sites with hundreds of pages take a few minutes — and you watch the link graph build in real time while it runs.',
  },
] as const;
