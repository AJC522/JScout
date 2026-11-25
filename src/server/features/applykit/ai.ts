/**
 * Optional AI drafting through the Anthropic Messages API.
 *
 * Nothing is sent unless a key is configured and the caller explicitly asked for AI.
 * Failures never throw: they come back as a short human sentence the caller shows while
 * falling back to a template, and are remembered as `ai.lastError` for the status panel.
 * Prompts and the key are never logged.
 */
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { DEFAULT_AI_MODEL } from '../../../shared/constants';
import type { AiStatus } from '../../../shared/types';
import { truncate } from '../../lib/text';
import type { Logger, SettingsService } from '../../services';

export const AI_TIMEOUT_MS = 60_000;
export const LAST_ERROR_KEY = 'ai.lastError';
export const NO_KEY_REASON = 'No AI key is configured; add one in Settings to use AI drafting.';

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export type AiOutcome = { ok: true; text: string } | { ok: false; reason: string };

export interface AiClient {
  status(): AiStatus;
  generate(request: AiRequest): Promise<AiOutcome>;
  test(): Promise<AiStatus>;
}

/**
 * Models known to accept `output_config.effort`. Drafting asks for low effort to stay well
 * inside the timeout; older models reject the field, so it is only sent to these families.
 */
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-([5-9]|4-[6-9])/;

export function describeAiError(err: unknown, model: string): string {
  if (err instanceof APIConnectionTimeoutError) return "The AI provider didn't respond in time. Try again shortly.";
  if (err instanceof APIConnectionError) return "Couldn't reach the AI provider. Check your internet connection.";
  if (err instanceof AuthenticationError) return 'The AI provider rejected the API key. Check it in Settings.';
  if (err instanceof PermissionDeniedError) return `The API key isn't allowed to use the model "${model}".`;
  if (err instanceof NotFoundError) return `The model "${model}" wasn't found. Check the model name in Settings.`;
  if (err instanceof RateLimitError) return "The AI provider's rate limit was reached. Try again in a minute.";
  if (err instanceof BadRequestError) {
    return `The AI provider rejected the request${err.apiMessage ? `: ${truncate(err.apiMessage, 160)}` : '.'}`;
  }
  if (err instanceof APIError) {
    if (err.status === 402) return 'The AI provider reports a billing problem with this account.';
    if (err.status === 529 || err.status === 503) return 'The AI provider is overloaded right now. Try again shortly.';
    if (typeof err.status === 'number' && err.status >= 500) return 'The AI provider had a server error. Try again shortly.';
    return `The AI request failed${err.status ? ` (HTTP ${err.status})` : ''}.`;
  }
  return 'The AI request failed unexpectedly.';
}

/** Plain text from the model: no subject line, no markdown emphasis or headings. */
export function cleanDraft(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\s*subject:.*\n+/i, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a?: string, b?: string) => a ?? b ?? '')
    .trim();
}

/**
 * The connection test only needs the request to succeed. A few tokens are enough; models that
 * think before answering may stop at the limit, which still proves the key and model work.
 */
const TEST_MAX_TOKENS = 16;

export function createAiClient(getSettings: () => SettingsService, log: Logger): AiClient {
  const modelOf = (settings: SettingsService) => settings.getApp().ai.model.trim() || DEFAULT_AI_MODEL;

  function status(): AiStatus {
    const settings = getSettings();
    const lastError = settings.getJson<string>(LAST_ERROR_KEY);
    return {
      configured: Boolean(settings.getSecret('ai.apiKey')),
      model: modelOf(settings),
      ...(lastError ? { lastError } : {}),
    };
  }

  /** Sends one request; on failure records and returns the reason instead of throwing. */
  async function send(request: AiRequest): Promise<{ message: Anthropic.Message } | { reason: string }> {
    const settings = getSettings();
    const apiKey = settings.getSecret('ai.apiKey');
    if (!apiKey) return { reason: NO_KEY_REASON };
    const model = modelOf(settings);
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: request.maxTokens,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: 'user', content: request.user }],
      ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' } } : {}),
    };
    try {
      const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS });
      return { message: await client.messages.create(params) };
    } catch (err) {
      log.warn('AI request failed', {
        error: err instanceof Error ? err.name : typeof err,
        status: err instanceof APIError ? err.status : undefined,
      });
      const reason = describeAiError(err, model);
      settings.setJson(LAST_ERROR_KEY, reason);
      return { reason };
    }
  }

  return {
    status,

    async generate(request) {
      const sent = await send(request);
      if ('reason' in sent) return { ok: false, reason: sent.reason };
      const { message } = sent;
      const text = cleanDraft(
        message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      );
      const problem =
        message.stop_reason === 'refusal'
          ? 'The AI declined to write this draft.'
          : message.stop_reason === 'max_tokens'
            ? 'The AI draft was cut off before it finished.'
            : text === ''
              ? 'The AI returned an empty draft.'
              : undefined;
      const settings = getSettings();
      if (problem) {
        settings.setJson(LAST_ERROR_KEY, problem);
        return { ok: false, reason: problem };
      }
      settings.remove(LAST_ERROR_KEY);
      return { ok: true, text };
    },

    async test() {
      const sent = await send({ system: '', user: 'Reply with the single word: OK', maxTokens: TEST_MAX_TOKENS });
      if ('reason' in sent) return { ...status(), lastError: sent.reason };
      getSettings().remove(LAST_ERROR_KEY);
      return status();
    },
  };
}
