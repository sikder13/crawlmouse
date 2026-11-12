import { afterEach, describe, expect, it } from 'vitest';
import { commandOf, sh, url, word } from '../shell.js';
import { inBothStates, runCommand, twoStateSite, type TwoStateSite } from './verify.js';

let site: TwoStateSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

describe('the verify harness', () => {
  it('reports a command’s own exit status', async () => {
    expect((await runCommand('exit 3')).status).toBe(3);
    expect(await runCommand('printf ok')).toMatchObject({ status: 0, stdout: 'ok' });
  });

  it('runs a command against the site as it stands: failing while broken, passing once fixed', async () => {
    site = await twoStateSite({
      broken: (_req, res) => void res.end('<html><body><div id="app"></div></body></html>'),
      fixed: (_req, res) => void res.end('<html><body><h1>Ridge tent</h1></body></html>'),
    });
    const command = commandOf(
      sh`curl -sS -A ${word('GPTBot/1.4')} ${url(`${site.base}/products/ridge`)} | grep -q ${word('<h1')}`,
    );
    const { broken, fixed } = await inBothStates(site, command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(site.userAgents()).toEqual(['GPTBot/1.4', 'GPTBot/1.4']);
  });

  it('fails a command whose site is not there, rather than passing it', async () => {
    site = await twoStateSite({
      broken: (_req, res) => void res.end('x'),
      fixed: (_req, res) => void res.end('x'),
    });
    const gone = site.base;
    await site.close();
    site = null;
    expect((await runCommand(commandOf(sh`curl -sS ${url(gone)}`))).status).not.toBe(0);
  });
});
