import type { FitAnalysis, LetterLength } from '../../../shared/types';
import { foldText } from '../../lib/text';
import type { AppContext, ApplyKitService } from '../../services';
import { createAiClient } from './ai';
import { bankAnswer, rankAnswers } from './answers';
import { type JobContext, type ProfileContext, hasTarget, loadProfile, resolveJob } from './context';
import { analyzeFit } from './fit';
import { templateLetter } from './letter-template';
import { answerSystemPrompt, answerUserPrompt, letterSystemPrompt, letterUserPrompt, profileBlock } from './prompts';
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

    aiStatus: () => ai.status(),
    aiTest: () => ai.test(),
  };
}
