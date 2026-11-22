import { expect, test } from './pw';
import { writeRefusal } from './lib/target';

// The production-write guard (lib/target.ts). Pure: it runs no browser and reaches no server.
const env = (o: Record<string, string>) => ({
  JOURNEY_BASE_URL: 'https://staging.example.test',
  ...o,
});

test.describe('the production-write guard', () => {
  test('refuses production by its host, whatever else the run declares', () => {
    for (const host of ['crawlmouse.com', 'www.crawlmouse.com', 'CRAWLMOUSE.COM']) {
      for (const declared of [host, 'staging.example.test', '']) {
        expect(
          writeRefusal({
            JOURNEY_BASE_URL: `https://${host}`,
            JOURNEY_WRITE_HOSTS: declared,
            JOURNEY_ALLOW_WRITES: '1',
          }),
        ).toMatch(/is production: steps that write never run there/);
      }
    }
  });
  test('refuses a host that is not declared', () => {
    expect(writeRefusal(env({ JOURNEY_ALLOW_WRITES: '1' }))).toMatch(/not declared/);
    expect(
      writeRefusal(env({ JOURNEY_WRITE_HOSTS: 'other.example.test', JOURNEY_ALLOW_WRITES: '1' })),
    ).toMatch(/not declared/);
  });
  test('refuses a declaration list that names production', () => {
    expect(
      writeRefusal(
        env({
          JOURNEY_WRITE_HOSTS: 'staging.example.test,crawlmouse.com',
          JOURNEY_ALLOW_WRITES: '1',
        }),
      ),
    ).toMatch(/names a production host/);
  });
  test('refuses without JOURNEY_ALLOW_WRITES=1', () => {
    for (const v of ['', '0', 'true', 'yes', ' 1']) {
      expect(
        writeRefusal(env({ JOURNEY_WRITE_HOSTS: 'staging.example.test', JOURNEY_ALLOW_WRITES: v })),
      ).toMatch(/ALLOW_WRITES/);
    }
  });
  test('allows a declared, non-production host with writes on', () => {
    expect(
      writeRefusal(
        env({ JOURNEY_WRITE_HOSTS: ' staging.example.test ', JOURNEY_ALLOW_WRITES: '1' }),
      ),
    ).toBeNull();
  });
  test('refuses a base URL that is missing or not https', () => {
    expect(() => writeRefusal({})).toThrow(/required/);
    expect(() => writeRefusal({ JOURNEY_BASE_URL: 'http://staging.example.test' })).toThrow(
      /https/,
    );
  });
});
