// `npm start`: build if needed (first run or sources changed), then run the server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverOut = path.join(root, 'dist', 'server', 'main.js');
const clientOut = path.join(root, 'dist', 'client', 'index.html');

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`JScout needs Node.js 22.13 or newer (you have ${process.versions.node}). Get it from https://nodejs.org/.`);
  process.exit(1);
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

function needsBuild() {
  if (process.argv.includes('--rebuild')) return true;
  if (!fs.existsSync(serverOut) || !fs.existsSync(clientOut)) return true;
  const built = Math.min(fs.statSync(serverOut).mtimeMs, fs.statSync(clientOut).mtimeMs);
  const sources = Math.max(newestMtime(path.join(root, 'src')), fs.statSync(path.join(root, 'package.json')).mtimeMs);
  return sources > built;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('Installing dependencies (first run)…');
  const install = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

if (needsBuild()) {
  console.log('Building JScout…');
  const result = spawnSync(npm, ['run', 'build', '--silent'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Node's built-in fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY is set at
// startup; set it for people behind a proxy so syncing works without extra steps.
const env = { ...process.env };
const proxied = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => env[k]);
if (proxied && env.NODE_USE_ENV_PROXY === undefined) env.NODE_USE_ENV_PROXY = '1';

const run = spawnSync(process.execPath, ['--enable-source-maps', serverOut], { cwd: root, stdio: 'inherit', env });
process.exit(run.status ?? 0);
