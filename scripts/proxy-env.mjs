// Runs a command with NODE_USE_ENV_PROXY=1 when an HTTP(S) proxy is configured, so
// Node's built-in fetch honours HTTPS_PROXY (it ignores it otherwise). Used by the dev scripts.
import { spawn } from 'node:child_process';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/proxy-env.mjs <command> [args...]');
  process.exit(2);
}
const env = { ...process.env };
const proxied = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => env[k]);
if (proxied && env.NODE_USE_ENV_PROXY === undefined) env.NODE_USE_ENV_PROXY = '1';

const child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
