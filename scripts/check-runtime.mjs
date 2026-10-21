import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// Exercise the bundled Next server in workerd, not just its static assets.
// No GitHub credentials or external API requests are needed for these checks.
const worker = spawn(
  process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '0'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local Worker startup timed out')), 45000);
    const receive = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    worker.stdout.on('data', receive);
    worker.stderr.on('data', receive);
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local Worker exited (${code})`));
    });
  });
  const denied = await fetch(`${origin}/api/oauth/token`);
  assert.equal(
    denied.status,
    401,
    'Next API must initialize and reject an unauthenticated request',
  );
  assert.deepEqual(await denied.json(), { error: 'State has expired. Please sign in again.' });
  const client = await fetch(`${origin}/client.js`);
  assert.equal(client.status, 200);
  assert.match(await client.text(), /giscus/);
  console.log('Bundled workerd API and client smoke checks passed.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  worker.kill('SIGTERM');
}
