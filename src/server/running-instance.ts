import http from 'node:http';

/**
 * Whether a JScout is already answering at this address: one started earlier and left running, or the
 * launcher double-clicked a second time. Asked first thing at startup, so that a second copy opens the
 * running one in the browser instead of failing on the port (and never touches the database).
 */
export function isJScoutRunning(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    // agent: false makes a connection of its own, which a proxy set up for syncing does not apply to.
    const req = http.get({ host, port, path: '/api/health', agent: false, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 10_000) req.destroy();
      });
      res.on('end', () => {
        try {
          const health = JSON.parse(body) as { ok?: unknown; version?: unknown } | null;
          resolve(res.statusCode === 200 && health?.ok === true && typeof health.version === 'string');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    // Whatever else ended the request without an answer.
    req.on('close', () => resolve(false));
  });
}
