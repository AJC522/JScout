/**
 * Test support: a minimal SMTP server, so sending goes through nodemailer's real SMTP client.
 * Used by the email-application tests and the end-to-end tests; not by the app.
 */
import net from 'node:net';

export interface Received {
  auth?: string;
  from: string;
  to: string[];
  data: string;
}

export async function fakeSmtp(opts: { password: string }): Promise<{ port: number; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let awaitingAuth = false;
    let current: Received = { from: '', to: [], data: '' };
    let auth: string | undefined;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    const checkAuth = (b64: string) => {
      const [, user, pass] = Buffer.from(b64, 'base64').toString('utf8').split('\u0000');
      if (pass !== opts.password) return reply('535 5.7.8 Authentication credentials invalid');
      auth = user;
      reply('235 2.7.0 Authentication successful');
    };
    reply('220 fake.smtp ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push({ ...current, auth });
            current = { from: '', to: [], data: '' };
            reply('250 2.0.0 queued');
          } else current.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        if (awaitingAuth) {
          awaitingAuth = false;
          checkAuth(line);
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) socket.write('250-fake.smtp\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('AUTH PLAIN')) {
          const arg = line.slice('AUTH PLAIN'.length).trim();
          if (arg) checkAuth(arg);
          else {
            awaitingAuth = true;
            reply('334 ');
          }
        } else if (cmd.startsWith('MAIL FROM:')) {
          current.from = line.slice(10).trim();
          reply('250 OK');
        } else if (cmd.startsWith('RCPT TO:')) {
          current.to.push(line.slice(8).trim());
          reply('250 OK');
        } else if (cmd === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (cmd === 'QUIT') {
          reply('221 Bye');
          socket.end();
        } else reply('250 OK');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
