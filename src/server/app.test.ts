import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { type BuiltApp, buildApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';

let built: BuiltApp | undefined;

async function start(): Promise<BuiltApp> {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
  });
  return built;
}

afterEach(async () => {
  await built?.close();
  built = undefined;
});

describe('app shell', () => {
  it('answers health checks from localhost', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'localhost:4310' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects requests with a non-loopback Host (DNS rebinding)', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:4310' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects cross-site state-changing requests (CSRF)', async () => {
    const { app } = await start();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { host: '127.0.0.1:4310', origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(403);
    // Through the dev server's proxy the Host stays the dev server's.
    for (const [host, origin] of [
      ['127.0.0.1:4310', 'http://127.0.0.1:4310'],
      ['localhost:5173', 'http://localhost:5173'],
      ['127.0.0.1:4310', 'http://localhost:4310'],
    ]) {
      const sameOrigin = await app.inject({
        method: 'PATCH',
        url: '/api/settings',
        headers: { host, origin, 'content-type': 'application/json' },
        payload: '{"theme":"nope"}',
      });
      expect(sameOrigin.statusCode).toBe(400);
      expect(sameOrigin.json().error.code).toBe('validation');
    }
  });

  it('rejects state-changing requests from other local web servers', async () => {
    const { app } = await start();
    const boundary = '----x';
    for (const origin of ['http://localhost:8000', 'http://127.0.0.1:5173', 'https://localhost:4310', 'null']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sync',
        headers: { host: 'localhost:4310', origin, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: `--${boundary}--\r\n`,
      });
      expect(res.statusCode, origin).toBe(403);
    }
  });

  it('closes promptly while a tab holds the event stream open', async () => {
    const { app, close } = await start();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const ended = new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { host: `localhost:${port}` } }, (res) => {
        res.once('data', () => {
          res.on('end', () => resolve());
          res.resume();
          void close();
        });
      });
      req.on('error', reject);
    });
    const started = Date.now();
    await ended;
    await close();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { host: 'localhost' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
