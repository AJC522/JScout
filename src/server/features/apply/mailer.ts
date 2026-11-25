/**
 * Sends email through the user's own account (SMTP), for applications that are made by email.
 * Nothing is sent unless the user presses Send; the password stays in the local database.
 */
import { createTransport } from 'nodemailer';
import type { EmailAccount } from '../../../shared/types';
import { ApiError, badRequest, upstreamError } from '../../errors';
import type { SettingsService } from '../../services';

export interface OutgoingAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMessage {
  /** Display name for the From header. */
  fromName: string;
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  attachments: OutgoingAttachment[];
}

/** The part of a nodemailer transport the mailer uses (tests pass a fake). */
export interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string; rejected?: unknown[] }>;
  close?(): void;
}

export type TransportFactory = (account: EmailAccount, password: string | undefined) => MailTransport;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SEND_TIMEOUT_MS = 30_000;

/** SMTP over TLS: implicit on `secure` ports, else STARTTLS, which is required for any server not on this computer. */
export const smtpTransport: TransportFactory = (account, password) => {
  const local = LOCAL_HOSTS.has(account.host);
  return createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    requireTLS: !account.secure && !local,
    // Local bridges (Proton Mail Bridge) use self-signed certificates.
    tls: { rejectUnauthorized: !local, minVersion: 'TLSv1.2' },
    auth: account.user && password ? { user: account.user, pass: password } : undefined,
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  }) as unknown as MailTransport;
};

/** Plain-English reasons for the failures people actually hit. */
function explain(err: unknown, account: EmailAccount): ApiError {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const where = `${account.host}:${account.port}`;
  switch (e.code) {
    case 'EAUTH':
      return upstreamError(
        `${account.host} rejected the sign-in. Check the user name and use an app password (Gmail, Outlook, Yahoo and iCloud need one when two-step sign-in is on).`,
      );
    case 'ETLS':
      return upstreamError(`Could not set up a secure connection to ${where}. Check the port and the "secure connection" setting.`);
    case 'ECONNECTION':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EDNS':
    case 'ENOTFOUND':
    case 'ECONNREFUSED':
      return upstreamError(`Could not reach the mail server at ${where}. Check the server name and port.`);
    case 'EENVELOPE':
      return badRequest(`The mail server refused an address: ${e.message ?? 'check the recipient'}`);
    case 'EMESSAGE':
      return upstreamError(`The mail server refused the message${e.responseCode ? ` (${e.responseCode})` : ''}.`);
    default:
      return upstreamError(`Sending failed${e.message ? `: ${e.message}` : '.'}`);
  }
}

export interface Mailer {
  /** The account in use, or a 400 explaining what to set up. */
  account(): EmailAccount;
  send(message: OutgoingMessage): Promise<{ messageId?: string }>;
}

export function createMailer(settings: Pick<SettingsService, 'getApp' | 'getSecret'>, factory: TransportFactory = smtpTransport): Mailer {
  function account(): EmailAccount {
    const view = settings.getApp().email;
    if (!view) throw badRequest('Set up the email account to send from in Settings → Sending applications.');
    if (!view.hasPassword) throw badRequest('Add the password (an app password for most providers) in Settings → Sending applications.');
    const { hasPassword: _hasPassword, ...rest } = view;
    return rest;
  }

  return {
    account,
    async send(message) {
      const acc = account();
      const transport = factory(acc, settings.getSecret('email.password'));
      try {
        const info = await transport.sendMail({
          from: { name: acc.fromName || message.fromName, address: acc.fromAddress },
          to: message.to,
          ...(message.cc ? { cc: message.cc } : {}),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          attachments: message.attachments,
          // No tracking, no HTML: an application reads the same in every mail client.
          disableUrlAccess: true,
          disableFileAccess: true,
        });
        if (Array.isArray(info.rejected) && info.rejected.length > 0) throw Object.assign(new Error(`refused ${info.rejected.join(', ')}`), { code: 'EENVELOPE' });
        return { messageId: info.messageId };
      } catch (err) {
        throw err instanceof ApiError ? err : explain(err, acc);
      } finally {
        transport.close?.();
      }
    },
  };
}
