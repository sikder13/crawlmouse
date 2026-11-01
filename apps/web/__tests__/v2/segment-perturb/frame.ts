import { siteOf } from '../../../lib/v2/fixtures';
import type { PerturbTable } from './types';

export const FRAME_PERTURB: PerturbTable = {
  'segment-domain': {
    'sites[].host': [
      {
        change: (c, d) => (siteOf(d, c).host = 'example-outdoors.com'),
        expect: {
          access: ['example-outdoors.com'],
          nojs: ['example-outdoors.com'],
          structure: ['example-outdoors.com'],
          content: ['example-outdoors.com'],
          signals: ['example-outdoors.com'],
          changes: ['example-outdoors.com'],
        },
      },
    ],
  },
  'segment-kept-until': {
    'checks[].expires_at': [
      {
        fixture: 'clean-site',
        change: (c) => (c.expires_at = '2026-10-28T09:00:00Z'),
        expect: {
          access: ['kept until 28 Oct, 09:00 UTC'],
          nojs: ['kept until 28 Oct, 09:00 UTC'],
          structure: ['kept until 28 Oct, 09:00 UTC'],
          content: ['kept until 28 Oct, 09:00 UTC'],
          signals: ['kept until 28 Oct, 09:00 UTC'],
          changes: ['kept until 28 Oct, 09:00 UTC'],
        },
      },
    ],
    'checks[].finished_at': [
      {
        change: (c) => (c.finished_at = '2026-10-25T02:36:00Z'),
        expect: {
          access: ['kept until 26 Oct, 02:36 UTC'],
          nojs: ['kept until 26 Oct, 02:36 UTC'],
          structure: ['kept until 26 Oct, 02:36 UTC'],
          content: ['kept until 26 Oct, 02:36 UTC'],
          signals: ['kept until 26 Oct, 02:36 UTC'],
          changes: ['kept until 26 Oct, 02:36 UTC'],
        },
      },
    ],
  },
  'segment-next-js': {
    'checks[].without_js.site_text_share': [
      {
        change: (c) => (c.without_js!.site_text_share = 0.42),
        expect: { access: ['Next: Readable without JavaScript · 42%'] },
      },
    ],
  },
  'segment-next-structure': {
    'checks[].technical_seo.site_structure_score': [
      {
        change: (c) => (c.technical_seo!.site_structure_score = 68.2),
        expect: { nojs: ['Next: Site structure · 68'] },
      },
    ],
  },
  'segment-next-content': {
    'checks[].content.score': [
      {
        change: (c) => (c.content!.score = 61),
        expect: { structure: ['Next: Content an answer engine can quote · 61'] },
      },
    ],
  },
  'segment-next-signals': {
    'checks[].signals[].state': [
      {
        change: (c) => (c.signals.find((s) => s.signal === 'llms_txt')!.state = 'detected'),
        expect: { content: ['Next: Agent-readiness signals · 3 of 7'] },
      },
    ],
  },
};
