import { ACTIVE_STATUSES } from '../../../shared/constants';
import type { FitAnalysis, LetterLength, ResumeReviewRequest } from '../../../shared/types';
import { badRequest } from '../../errors';
import { foldText, truncate } from '../../lib/text';
import type { AppContext, ApplyKitService } from '../../services';
import { createAiClient } from './ai';
import { bankAnswer, rankAnswers } from './answers';
import { type JobContext, type ProfileContext, hasTarget, loadProfile, resolveJob, resolveTarget } from './context';
import { analyzeFit } from './fit';
import { templateLetter } from './letter-template';
import {
  answerSystemPrompt,
  answerUserPrompt,
  letterSystemPrompt,
  letterUserPrompt,
  profileBlock,
  resumeSystemPrompt,
  resumeUserPrompt,
} from './prompts';
import { type ResumeDoc, parseResumeDoc } from './resume-doc';
import { type ResumeAnalysisDetail, analyzeResume } from './resume-review';
import { tailorResume } from './resume-tailor';
import { phraseKey } from './text';

export const DEFAULT_MAX_WORDS = 200;
const MAX_STRENGTHS = 6;
const MAX_THEMES = 4;
/** Weight a covered posting term needs before drafts name it. */
const THEME_MIN_WEIGHT = 0.3;
/** Credentials read badly as themes ("the role involves RN license"); the flags cover them. */
const CREDENTIAL_TERM = /licen[cs]|certif|degree|clearance/i;

/**
 * Output budgets: room for the draft itself plus the reasoning that current models do before
 * answering (it counts against max_tokens).
 */
const LETTER_MAX_TOKENS: Record<LetterLength, number> = { short: 3000, medium: 4000, long: 5000 };
const answerMaxTokens = (maxWords: number) => 2500 + maxWords * 3;
/** A whole résumé: room for ~1,500 words of output plus reasoning, and a longer wait. */
const resumeMaxTokens = (words: number) => 5000 + Math.min(words, 1500) * 3;
const RESUME_AI_TIMEOUT_MS = 150_000;

export const NO_RESUME_MESSAGE = 'Add your résumé first: upload it or paste its text on your Profile, then review it against this job.';
/** A description shorter than this makes a score that says little (shown as "limited"). */
const LIMITED_DESCRIPTION_CHARS = 200;

/** What the AI should know from the deterministic review: hints it may act on only where the résumé supports them. */
function resumeFindings(detail: ResumeAnalysisDetail): string[] {
  const { review } = detail;
  const findings: string[] = [];
  const unmet = review.requirements.filter((r) => r.level === 'required' && r.status !== 'met').slice(0, 6);
  if (unmet.length > 0) findings.push(`Requirements the résumé does not clearly show: ${unmet.map((r) => `"${truncate(r.text, 90)}"`).join('; ')}`);
  if (review.skillsInProfileOnly.length > 0) findings.push(`Posting skills listed in the profile but missing from the résumé: ${review.skillsInProfileOnly.join(', ')}`);
  const terms = review.keywords.filter((k) => !k.present && k.weight >= 0.35).slice(0, 6);
  if (terms.length > 0) findings.push(`Posting terms the résumé doesn't use (use them only where accurate): ${terms.map((k) => k.term).join(', ')}`);
  const weak = review.bullets.filter((b) => b.issues.includes('weak-start')).length;
  if (weak > 0) findings.push(`${weak} bullet(s) start with weak phrases such as "Responsible for".`);
  const noNumbers = review.bullets.filter((b) => b.issues.includes('no-metric')).length;
  if (noNumbers > 0) findings.push(`${noNumbers} bullet(s) have no result or number.`);
  return findings;
}

/**
 * What a draft may honestly claim for this posting: the posting's skills the user has, and
 * other important terms their background covers (minus the job title's own words).
 */
function draftFacts(fit: FitAnalysis, job: JobContext) {
  const skills = new Set(fit.skillsMatched.map(foldText));
  const titleWords = new Set(phraseKey(job.title).split(' '));
  const themes = fit.keywords
    .filter((k) => k.present && k.weight >= THEME_MIN_WEIGHT && !skills.has(foldText(k.term)))
    .map((k) => k.term)
    .filter((term) => !phraseKey(term).split(' ').every((t) => titleWords.has(t)) && !CREDENTIAL_TERM.test(term))
    .slice(0, MAX_THEMES);
  return {
    skills: fit.skillsMatched,
    themes,
    missing: fit.skillsMissing,
    locationOk: fit.locationAlignment.ok === true,
    strengths: [...fit.skillsMatched, ...themes].slice(0, MAX_STRENGTHS),
  };
}

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createApplyKitService(ctx: AppContext): ApplyKitService {
  const ai = createAiClient(() => ctx.services.settings, ctx.log);
  const job = (target: { jobId?: string; applicationId?: string }) => resolveJob(ctx.services, target);
  const profileContext = (): ProfileContext => loadProfile(ctx.services.profile);

  /** The résumé to review: a draft sent with the request, or the saved one. */
  function resumeFor(request: ResumeReviewRequest, me: ProfileContext): { doc: ResumeDoc; source: 'saved' | 'draft' } {
    const draft = request.resumeText !== undefined;
    const text = draft ? request.resumeText! : me.resumeText;
    if (!text.trim()) throw badRequest(draft ? 'The résumé draft is empty.' : NO_RESUME_MESSAGE);
    return { doc: parseResumeDoc(text, ctx.now()), source: draft ? 'draft' : 'saved' };
  }

  return {
    analyze(target) {
      return analyzeFit(job(target), profileContext());
    },

    async coverLetter(request) {
      const target = job(request);
      const me = profileContext();
      const facts = draftFacts(analyzeFit(target, me), target);
      const content = templateLetter({
        job: target,
        profile: me.profile,
        skills: facts.skills,
        themes: facts.themes,
        missing: facts.missing,
        locationOk: facts.locationOk,
        tone: request.tone,
        length: request.length,
        notes: request.notes,
      });
      if (request.mode !== 'ai') return { content, generatedBy: 'template' };

      const outcome = await ai.generate({
        system: letterSystemPrompt(request.tone, request.length),
        user: letterUserPrompt(target, profileBlock(me.profile, me.skills, me.resumeText), request.notes),
        maxTokens: LETTER_MAX_TOKENS[request.length],
      });
      return outcome.ok
        ? { content: outcome.text, generatedBy: 'ai' }
        : { content, generatedBy: 'template', fallbackReason: outcome.reason };
    },

    async answer(request) {
      const target: JobContext | undefined = hasTarget(request) ? job(request) : undefined;
      const me = profileContext();
      const ranked = rankAnswers(request.question, me.profile.answers);
      const related = ranked.map((r) => r.answer);
      const bankDraft = () =>
        bankAnswer(
          ranked,
          {
            question: request.question,
            job: target,
            profile: me.profile,
            strengths: target ? draftFacts(analyzeFit(target, me), target).strengths : me.skills.slice(0, MAX_STRENGTHS),
          },
          () => ctx.services.applications.list().map((a) => a.job),
        );
      if (request.mode !== 'ai') return { content: bankDraft(), generatedBy: 'template', related };

      const maxWords = request.maxWords ?? DEFAULT_MAX_WORDS;
      const outcome = await ai.generate({
        system: answerSystemPrompt(maxWords),
        user: answerUserPrompt(
          request.question,
          target,
          profileBlock(me.profile, me.skills, me.resumeText, { applicationFacts: true }),
          related,
        ),
        maxTokens: answerMaxTokens(maxWords),
      });
      return outcome.ok
        ? { content: outcome.text, generatedBy: 'ai', related }
        : { content: bankDraft(), generatedBy: 'template', fallbackReason: outcome.reason, related };
    },

    reviewResume(request) {
      const target = resolveTarget(ctx.services, request);
      const me = profileContext();
      const { doc, source } = resumeFor(request, me);
      return analyzeResume(target, doc, me, { source }).review;
    },

    async reworkResume(request) {
      const target = resolveTarget(ctx.services, request);
      const me = profileContext();
      const { doc, source } = resumeFor(request, me);
      const detail = analyzeResume(target, doc, me, { source });
      const template = tailorResume(doc, detail, target, me);
      if (request.mode !== 'ai') return { content: template.content, changes: template.changes, generatedBy: 'template' };

      const outcome = await ai.generate({
        system: resumeSystemPrompt(),
        user: resumeUserPrompt(target, profileBlock(me.profile, me.skills, ''), doc.text, resumeFindings(detail)),
        maxTokens: resumeMaxTokens(doc.words),
        timeoutMs: RESUME_AI_TIMEOUT_MS,
      });
      if (!outcome.ok) return { content: template.content, changes: template.changes, generatedBy: 'template', fallbackReason: outcome.reason };
      const placeholders = (outcome.text.match(/\[[^\]\n]{2,60}\]/g) ?? []).length;
      return {
        content: outcome.text,
        generatedBy: 'ai',
        changes: [
          `Rewritten with AI for ${target.title}${target.company ? ` at ${target.company}` : ''}.`,
          'Read every line before you use it: keep only what is true of your work.',
          ...(placeholders > 0 ? [`Fill in the ${placeholders === 1 ? 'bracketed placeholder' : `${placeholders} bracketed placeholders`} with real figures, or remove ${placeholders === 1 ? 'it' : 'them'}.`] : []),
        ],
      };
    },

    resumeScores() {
      const me = profileContext();
      if (!me.resumeText.trim()) return [];
      const doc = parseResumeDoc(me.resumeText, ctx.now());
      return ctx.services.applications
        .list()
        .filter((app) => ACTIVE_STATUSES.includes(app.status))
        .flatMap((app) => {
          try {
            const target = resolveJob(ctx.services, { applicationId: app.id });
            const { review } = analyzeResume(target, doc, me, { source: 'saved' });
            const required = review.requirements.filter((r) => r.level === 'required');
            return [
              {
                applicationId: app.id,
                ...(app.jobId ? { jobId: app.jobId } : {}),
                title: app.job.title,
                company: app.job.company,
                status: app.status,
                score: review.score,
                band: review.band,
                requiredMet: required.filter((r) => r.status === 'met').length,
                requiredTotal: required.length,
                limited: target.descriptionText.trim().length < LIMITED_DESCRIPTION_CHARS,
              },
            ];
          } catch (err) {
            ctx.log.debug('résumé score failed for application', { applicationId: app.id, err: String(err) });
            return [];
          }
        });
    },

    aiStatus: () => ai.status(),
    aiTest: () => ai.test(),
  };
}
