import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_FOLDERS } from './app-surfaces';

const APP = join(__dirname, '..', '..', 'app');

describe('ROUTE_FOLDERS', () => {
  it('classifies every top-level route folder under app/, and names no folder that is gone', () => {
    const folders = readdirSync(APP)
      .filter((f) => statSync(join(APP, f)).isDirectory())
      .sort();
    expect(folders.filter((f) => !Object.hasOwn(ROUTE_FOLDERS, f))).toEqual([]);
    expect(Object.keys(ROUTE_FOLDERS).filter((f) => !folders.includes(f))).toEqual([]);
  });
});
