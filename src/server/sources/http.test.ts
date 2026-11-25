import { describe, expect, it } from 'vitest';
import { createHttpClient } from './http';
import { SourceError } from './types';

describe('createHttpClient', () => {
  it('never sends a request cancelled while it waits for its turn on the host', async () => {
    const sent: string[] = [];
    const http = createHttpClient({
      userAgent: 'test',
      defaultMinIntervalMs: 300,
      fetchImpl: async (url) => {
        sent.push(String(url));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const first = http.getJson('https://api.example.com/1');
    const controller = new AbortController();
    const second = http.getJson('https://api.example.com/2', { signal: controller.signal });
    const third = http.getJson('https://api.example.com/3');
    setTimeout(() => controller.abort(), 50);
    await first;
    const started = Date.now();
    await expect(second).rejects.toSatisfy((err) => err instanceof SourceError && err.kind === 'aborted');
    // Cancelled right away, not after its pacing gap.
    expect(Date.now() - started).toBeLessThan(250);
    await third;
    expect(sent).toEqual(['https://api.example.com/1', 'https://api.example.com/3']);
  });

  it('stops waiting out a retry when the request is cancelled', async () => {
    let calls = 0;
    const http = createHttpClient({
      userAgent: 'test',
      defaultMinIntervalMs: 0,
      fetchImpl: async () => {
        calls++;
        return new Response('', { status: 429, headers: { 'retry-after': '10' } });
      },
    });
    const controller = new AbortController();
    const started = Date.now();
    const pending = http.getJson('https://api.example.com/x', { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toSatisfy((err) => err instanceof SourceError && err.kind === 'aborted');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
  });
});
