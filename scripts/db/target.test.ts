import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './files';
import { PRODUCTION_REF, assertAllowed, openTarget, refOfUrl } from './target';

const OTHER_REF = 'bpzaduqkrldhrizmlncp';

describe('refOfUrl reads the project ref from every spelling a Supabase URL uses', () => {
  it.each([
    [
      `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      PRODUCTION_REF,
    ],
    [
      `postgres://postgres.${PRODUCTION_REF}:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres`,
      PRODUCTION_REF,
    ],
    [
      `postgresql://postgres%2E${PRODUCTION_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      PRODUCTION_REF,
    ],
    [`postgresql://postgres:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`, PRODUCTION_REF],
    [
      `postgresql://cli_login_postgres.${PRODUCTION_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      PRODUCTION_REF,
    ],
    [
      `postgresql://postgres.${OTHER_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      OTHER_REF,
    ],
    ['postgresql://postgres:pw@127.0.0.1:54322/postgres', null],
  ])('%s', (url, ref) => {
    expect(refOfUrl(url)).toBe(ref);
  });
});

describe('the production refusal', () => {
  it('refuses production without --yes-production and allows it with', () => {
    expect(() => assertAllowed(PRODUCTION_REF, false)).toThrow(/--yes-production/);
    expect(() => assertAllowed(PRODUCTION_REF, true)).not.toThrow();
    expect(() => assertAllowed(OTHER_REF, false)).not.toThrow();
    expect(() => assertAllowed(null, false)).not.toThrow();
  });

  it('refuses a production connection string and a production ref before connecting', () => {
    const env = {
      DB_URL: `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      SUPABASE_ACCESS_TOKEN: 'unused',
    };
    expect(() => openTarget({ dbUrlEnv: 'DB_URL', yesProduction: false }, env)).toThrow(
      /--yes-production/,
    );
    expect(() => openTarget({ projectRef: PRODUCTION_REF, yesProduction: false }, env)).toThrow(
      /--yes-production/,
    );
  });

  it('history.ts --repair exits non-zero on production without --yes-production', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(REPO_ROOT, 'scripts/db/history.ts'),
        '--db-url-env',
        'DB_URL',
        '--repair',
        '--applied-through',
        '20261101000001',
      ],
      {
        cwd: join(REPO_ROOT, 'scripts'),
        env: {
          ...process.env,
          // Port 9 on localhost: if the refusal were missing, the connection would fail instead.
          DB_URL: `postgresql://postgres.${PRODUCTION_REF}:pw@127.0.0.1:9/postgres`,
        },
        encoding: 'utf8',
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`refusing to run against production (${PRODUCTION_REF})`);
  });
});
