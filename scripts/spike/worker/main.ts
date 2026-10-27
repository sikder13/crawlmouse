import { createWorker, loadConfig } from './server.js';

const config = loadConfig(process.env);
const worker = createWorker({ config });
worker.server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(JSON.stringify({ event: 'listening', port: config.port }) + '\n');
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    worker.server.close();
    void worker.idle().then(() => process.exit(0));
  });
}
