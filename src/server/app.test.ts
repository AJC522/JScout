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
    const sameOrigin = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { host: '127.0.0.1:4310', origin: 'http://localhost:5173', 'content-type': 'application/json' },
      payload: '{"theme":"nope"}',
    });
    expect(sameOrigin.statusCode).toBe(400);
    expect(sameOrigin.json().error.code).toBe('validation');
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { host: 'localhost' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
