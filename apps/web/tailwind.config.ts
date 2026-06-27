import type { Config } from 'tailwindcss';
import { BRAND } from './lib/brand';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand class names — PRESERVED. Non-owned surfaces (r/[slug], OG, embed, blog)
        // depend on these exact names; never rename them.
        cream: BRAND.cream,
        oat: BRAND.oat,
        warning: { DEFAULT: BRAND.warning, fill: BRAND.warningFill },
        ink: { DEFAULT: BRAND.ink, muted: BRAND.inkMuted }, // text-ink (DEFAULT) + text-ink-muted
        peach: { DEFAULT: BRAND.peach, light: BRAND.peachLight, text: BRAND.peachText },
        sage: { DEFAULT: BRAND.sage, light: BRAND.sageLight, fill: BRAND.sageFill },
        // Semantic roles — prefer these in new code so a component never hardcodes a hex.
        surface: BRAND.cream,
        'surface-raised': BRAND.white,
        accent: { DEFAULT: BRAND.peach, text: BRAND.peachText, fill: BRAND.accentFill },
        positive: BRAND.sage,
        locked: BRAND.inkMuted,
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Charter', 'Georgia', 'serif'],
        sans: ['var(--font-geist)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
      },
      // One deliberate type scale [size, { lineHeight, letterSpacing?, fontWeight? }],
      // used everywhere — no ad-hoc font sizes in page code.
      fontSize: {
        display: ['3.5rem', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.015em', fontWeight: '700' }],
        h2: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '700' }],
        h3: ['1.375rem', { lineHeight: '1.3', fontWeight: '600' }],
        'body-lg': ['1.125rem', { lineHeight: '1.7' }],
        body: ['1rem', { lineHeight: '1.6' }],
        caption: ['0.8125rem', { lineHeight: '1.4' }],
        overline: ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      borderRadius: {
        control: '0.625rem', // buttons / inputs
        card: '1rem', // standard cards
        'card-lg': '1.5rem', // feature cards / grade card
      },
      boxShadow: {
        // Ink-tinted elevation (rgb of #1a1a18) — surface < raised < overlay.
        surface: '0 1px 2px rgba(26, 26, 24, 0.04), 0 1px 1px rgba(26, 26, 24, 0.03)',
        raised: '0 4px 16px rgba(26, 26, 24, 0.06), 0 1px 3px rgba(26, 26, 24, 0.05)',
        overlay: '0 12px 40px rgba(26, 26, 24, 0.12)',
      },
      keyframes: {
        'reveal-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'grade-pop': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '60%': { transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'reveal-up': 'reveal-up 0.4s ease-out both',
        'grade-pop': 'grade-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
export default config;
