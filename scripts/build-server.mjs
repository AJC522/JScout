// Bundles the server into dist/server/main.js and copies reference data next to it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist', 'server');

await build({
  entryPoints: [path.join(root, 'src', 'server', 'main.ts')],
  outfile: path.join(outDir, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external', // dependencies stay in node_modules
  sourcemap: true,
  logLevel: 'info',
});

const dataSrc = path.join(root, 'src', 'server', 'data');
const dataOut = path.join(outDir, 'data');
fs.mkdirSync(dataOut, { recursive: true });
for (const file of fs.readdirSync(dataSrc)) {
  if (file.endsWith('.json')) fs.copyFileSync(path.join(dataSrc, file), path.join(dataOut, file));
}
