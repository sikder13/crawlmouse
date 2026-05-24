interface Props { size?: number; className?: string }

export function CrawlmouseMark({ size = 32, className = '' }: Props) {
  const w = size;
  const h = Math.round(size * (44 / 48));
  return (
    <svg width={w} height={h} viewBox="0 0 48 44" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="10" x2="24" y2="26" stroke="#1a1a18" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="36" y1="10" x2="24" y2="26" stroke="#1a1a18" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M 32 31 Q 42 33, 45 42" stroke="#1a1a18" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="10" r="5" fill="#ff7849" />
      <circle cx="36" cy="10" r="5" fill="#ff7849" />
      <circle cx="24" cy="26" r="9" fill="#ff7849" />
      <circle cx="20.5" cy="24" r="1.3" fill="#fdfaf5" />
      <circle cx="27.5" cy="24" r="1.3" fill="#fdfaf5" />
    </svg>
  );
}
