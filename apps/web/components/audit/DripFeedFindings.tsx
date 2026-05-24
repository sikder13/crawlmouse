'use client';

import { useState, useEffect } from 'react';

const MESSAGES = [
  'Sniffing around your sitemap...',
  'Counting pages and links...',
  'Building the link graph...',
  'Hunting for orphans...',
  'Measuring click depth from the homepage...',
  'Inspecting anchor text patterns...',
  'Running the grade math...',
];

export function DripFeedFindings({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setIndex((i) => (i + 1) % MESSAGES.length), 3500);
    return () => clearInterval(interval);
  }, [active]);
  if (!active) return null;
  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold mb-2">Working</div>
      <div className="font-display italic text-lg text-ink/80">{MESSAGES[index]}</div>
    </div>
  );
}
