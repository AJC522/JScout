import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { type BuiltApp, buildApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';
import { isJScoutRunning } from './running-instance';

const cleanUps: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanUp of cleanUps.splice(0)) await cleanUp();
});

/** Some other program on the port: a plain HTTP server with this handler. */
async function otherProgram(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanUps.push(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return (server.address() as AddressInfo).port;
}

describe('isJScoutRunning', () => {
  it('recognises a running JScout', async () => {
    const built: BuiltApp = await buildApp({
      config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
      db: openDb(':memory:'),
    });
    cleanUps.push(() => built.close());
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = built.app.server.address() as AddressInfo;
    expect(await isJScoutRunning('127.0.0.1', port)).toBe(true);
  });

  it('is false when nothing is listening', async () => {
    const port = await otherProgram(() => undefined);
    await cleanUps.pop()!();
    expect(await isJScoutRunning('127.0.0.1', port)).toBe(false);
  });

  it('is false for another program on the port', async () => {
    const page = await otherProgram((_req, res) => res.end('<!doctype html><title>Something else</title>'));
    expect(await isJScoutRunning('127.0.0.1', page)).toBe(false);
    const otherApi = await otherProgram((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"up"}'));
    expect(await isJScoutRunning('127.0.0.1', otherApi)).toBe(false);
    const notFound = await otherProgram((_req, res) => res.writeHead(404).end('{"ok":true,"version":"1"}'));
    expect(await isJScoutRunning('127.0.0.1', notFound)).toBe(false);
  });

  it('gives up on a program that never answers', async () => {
    const silent = await otherProgram(() => undefined);
    const started = Date.now();
    expect(await isJScoutRunning('127.0.0.1', silent, 200)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
