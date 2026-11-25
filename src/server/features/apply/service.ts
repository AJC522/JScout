/**
 * Applying by email from inside JScout: a draft (recipient from the posting or the application's
 * contacts, a subject, a cover letter as the body, the résumé attached), then sending it through the
 * user's own email account and recording it in the tracker as an application made.
 */
import type {
  ApplicationDetail,
  EmailApplicationDraft,
  EmailApplicationResult,
  EmailApplicationSend,
  EmailAttachmentInfo,
  Profile,
} from '../../../shared/types';
import { badRequest, notFound } from '../../errors';
import { isAtsSource } from '../../ingest/store-rows';
import { postingApplyEmail } from '../../lib/apply-email';
import type { AppContext, EmailApplyService } from '../../services';
import { type Mailer, type OutgoingAttachment, createMailer, type TransportFactory } from './mailer';

const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const MAX_RECIPIENTS = 5;
const MAX_SUBJECT = 200;
const MAX_BODY = 20_000;

/** "a@x.com, b@y.com" → the addresses, or a 400 naming the bad one. */
export function parseRecipients(value: string | undefined, field: string, required: boolean): string[] {
  const list = (value ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (required && list.length === 0) throw badRequest(`Enter the address to send the application to (${field}).`);
  if (list.length > MAX_RECIPIENTS) throw badRequest(`At most ${MAX_RECIPIENTS} addresses in ${field}.`);
  const bad = list.find((a) => !ADDRESS.test(a));
  if (bad) throw badRequest(`“${bad}” in ${field} is not an email address.`);
  return list;
}

/** "Sincerely,\nAda Lovelace" plus the ways to reach her, for the end of an email. */
function signature(profile: Profile): string {
  const { phone, email, linkedin, website, portfolio } = profile.personal;
  return [phone, email, linkedin || portfolio || website].map((s) => s.trim()).filter(Boolean).join(' · ');
}

function resumeAttachment(ctx: AppContext): { info: EmailAttachmentInfo; file: OutgoingAttachment } | undefined {
  const profile = ctx.services.profile;
  const name = profile.get().personal.fullName.trim();
  const file = profile.resumeFile();
  if (file) {
    return {
      info: { kind: 'resume', fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.bytes.length, fromText: false },
      file: { filename: file.fileName, content: file.bytes, contentType: file.mimeType },
    };
  }
  const text = profile.resumeText().trim();
  if (!text) return undefined;
  const fileName = `${name ? `${name} ` : ''}Resume.txt`.replace(/[\\/:*?"<>|]+/g, '');
  const bytes = Buffer.from(text, 'utf8');
  return {
    info: { kind: 'resume', fileName, mimeType: 'text/plain', sizeBytes: bytes.length, fromText: true },
    file: { filename: fileName, content: bytes, contentType: 'text/plain; charset=utf-8' },
  };
}

interface Resolved {
  title: string;
  company: string;
  descriptionHtml: string;
  source?: string;
  application?: ApplicationDetail;
}

export function createEmailApplyService(ctx: AppContext, opts: { transport?: TransportFactory } = {}): EmailApplyService {
  let mailer: Mailer | undefined;
  const getMailer = (): Mailer => (mailer ??= createMailer(ctx.services.settings, opts.transport));

  function resolve(target: { jobId?: string; applicationId?: string }): Resolved {
    const { applications, jobs } = ctx.services;
    if (target.applicationId !== undefined) {
      const app = applications.get(target.applicationId);
      if (!app) throw notFound('Application');
      const html = app.job.descriptionHtml || (app.jobId ? jobs.getDescriptionHtml(app.jobId) : '');
      return { title: app.job.title, company: app.job.company, descriptionHtml: html, source: app.job.source, application: app };
    }
    if (target.jobId !== undefined) {
      const job = jobs.getPosting(target.jobId);
      if (!job) throw notFound('Job');
      const tracked = ctx.services.userState.forCluster(job.clusterKey).applicationId;
      return {
        title: job.title,
        company: job.company,
        descriptionHtml: jobs.getDescriptionHtml(job.id),
        source: job.source,
        application: tracked ? applications.get(tracked) : undefined,
      };
    }
    throw badRequest('jobId or applicationId is required');
  }

  return {
    async draft(target) {
      const r = resolve(target);
      const profile = ctx.services.profile.get();
      const applyEmail = postingApplyEmail(r.descriptionHtml, { hasForm: r.source !== undefined && isAtsSource(r.source) });

      const suggestions: EmailApplicationDraft['suggestions'] = [];
      if (applyEmail) suggestions.push({ address: applyEmail.address, label: 'From the posting' });
      for (const c of r.application?.contacts ?? []) {
        const address = c.email.trim();
        if (!ADDRESS.test(address) || suggestions.some((s) => s.address.toLowerCase() === address.toLowerCase())) continue;
        suggestions.push({ address, label: [c.name, c.role].filter(Boolean).join(', ') || 'Contact' });
      }

      const name = profile.personal.fullName.trim();
      const subject = applyEmail?.subject ?? [`Application for ${r.title}${r.company ? ` at ${r.company}` : ''}`, name].filter(Boolean).join(' – ');

      // A cover letter saved on the application is what the user chose; otherwise a fresh template letter.
      const saved = r.application?.documents.filter((d) => d.kind === 'cover-letter').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const letter = saved
        ? saved.content
        : (
            await ctx.services.applyKit.coverLetter({
              ...(r.application ? { applicationId: r.application.id } : { jobId: target.jobId }),
              tone: 'professional',
              length: 'short',
              mode: 'template',
            })
          ).content;
      const sig = signature(profile);
      const body = sig && !letter.includes(sig) ? `${letter.trimEnd()}\n${sig}` : letter;

      const account = ctx.services.settings.getApp().email;
      const resume = resumeAttachment(ctx);
      return {
        to: suggestions[0]?.address ?? '',
        suggestions,
        ...(applyEmail ? { applyEmail } : {}),
        subject,
        body,
        bodySource: saved ? 'saved-letter' : 'template',
        ...(resume ? { resume: resume.info } : {}),
        canSend: Boolean(account?.hasPassword),
        ...(account ? { fromAddress: account.fromAddress } : {}),
      };
    },

    async send(request: EmailApplicationSend): Promise<EmailApplicationResult> {
      const to = parseRecipients(request.to, 'To', true);
      const cc = parseRecipients(request.cc, 'Cc', false);
      const subject = request.subject.replace(/[\r\n]+/g, ' ').trim();
      if (!subject) throw badRequest('Add a subject line.');
      if (subject.length > MAX_SUBJECT) throw badRequest(`Keep the subject under ${MAX_SUBJECT} characters.`);
      const body = request.body.trim();
      if (!body) throw badRequest('The email is empty.');
      if (body.length > MAX_BODY) throw badRequest(`Keep the email under ${MAX_BODY.toLocaleString('en-US')} characters.`);
      const r = resolve(request);
      const resume = request.attachResume ? resumeAttachment(ctx) : undefined;
      if (request.attachResume && !resume) throw badRequest('There is no résumé to attach. Add one on the Profile page, or send without it.');

      const profile = ctx.services.profile.get();
      const mail = getMailer();
      const account = mail.account();
      const replyTo = profile.personal.email.trim();
      await mail.send({
        fromName: profile.personal.fullName.trim(),
        to: to.join(', '),
        ...(cc.length ? { cc: cc.join(', ') } : {}),
        ...(replyTo && replyTo.toLowerCase() !== account.fromAddress.toLowerCase() ? { replyTo } : {}),
        subject,
        text: body,
        attachments: resume ? [resume.file] : [],
      });
      const sentAt = ctx.now().toISOString();

      // Sent: record it as an application made. Saving a job is idempotent, so a tracked copy is reused.
      const { applications } = ctx.services;
      let app = r.application ?? applications.create({ jobId: request.jobId, status: 'applied' });
      if (app.status === 'saved') app = applications.patch(app.id, { status: 'applied' });
      const recipients = [...to, ...cc].join(', ');
      applications.addEvent(app.id, {
        type: 'note',
        title: `Applied by email to ${to.join(', ')}`,
        detail: `Sent from ${account.fromAddress} by JScout${resume ? `, with ${resume.info.fileName} attached` : ''}. Subject: ${subject}`,
        at: sentAt,
      });
      applications.addDocument(app.id, {
        kind: 'email',
        title: `Application email to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}`,
        content: [
          `To: ${to.join(', ')}`,
          ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
          `From: ${account.fromAddress}`,
          `Subject: ${subject}`,
          ...(resume ? [`Attachment: ${resume.info.fileName}`] : []),
          `Sent: ${sentAt}`,
          '',
          body,
        ].join('\n'),
        generatedBy: 'manual',
      });
      ctx.log.info('application sent by email', { applicationId: app.id, recipients: recipients.split(', ').length });
      return { application: applications.get(app.id)!, to: to.join(', '), sentAt };
    },

    async test() {
      const mail = getMailer();
      const account = mail.account();
      await mail.send({
        fromName: ctx.services.profile.get().personal.fullName.trim(),
        to: account.fromAddress,
        subject: 'JScout can send applications from this account',
        text: 'This is a test message from JScout. Applications you send by email will come from this address.',
        attachments: [],
      });
      return { to: account.fromAddress };
    },
  };
}
