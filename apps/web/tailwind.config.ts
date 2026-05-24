import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#fdfaf5',
        ink: '#1a1a18',
        peach: { DEFAULT: '#ff7849', light: '#ffd7c2' },
        sage: { DEFAULT: '#7a9b7e', light: '#c9d6c5' },
        oat: '#e8e2d4',
        warning: '#ff5630',
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Charter', 'Georgia', 'serif'],
        sans: ['var(--font-geist)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
