import { loadConfig } from './config.js';
import { createWorker } from './server.js';

const config = loadConfig(process.env);
const worker = createWorker({ config });

worker.server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(
    `${JSON.stringify({ event: 'listening', port: config.port, paused: config.paused })}\n`,
  );
});

// A stop drops any batch still running; polls for it then answer 404 and the caller sends it again.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    process.stdout.write(
      `${JSON.stringify({ event: 'stopping', signal, batches_running: worker.running() })}\n`,
    );
    worker.server.close();
    process.exit(0);
  });
}
