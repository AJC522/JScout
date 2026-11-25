import { useState } from 'react';
import { CheckCircle2, KeyRound, XCircle } from 'lucide-react';
import { DEFAULT_AI_MODEL } from '../../../shared/constants';
import type { AppSettings } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Badge, Button, Field, Input, useConfirm, useToast } from '../../components/ui';
import { SectionCard } from '../profile/SectionCard';
import { useAiStatus, useTestAi, useUpdateSettings } from './settings-api';
import { keyRemovalResult } from './settings-model';

const ENV_KEY_NOTE = 'No key is saved here, but JScout is using the ANTHROPIC_API_KEY environment variable. To turn AI drafting off, unset it and restart JScout.';

export function AiSection({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const status = useAiStatus(settings.ai.hasKey);
  const test = useTestAi();
  const [key, setKey] = useState('');
  // Set when removing the saved key left AI on: the key comes from the ANTHROPIC_API_KEY environment variable.
  const [envKeyInUse, setEnvKeyInUse] = useState(false);
  const usingEnvKey = envKeyInUse && settings.ai.hasKey;
  const [model, setModel] = useState(settings.ai.model);
  const [savedModel, setSavedModel] = useState(settings.ai.model);
  // Follow the stored model when it changes elsewhere, unless the user is editing it.
  if (savedModel !== settings.ai.model) {
    setSavedModel(settings.ai.model);
    if (model === savedModel) setModel(settings.ai.model);
  }
  const lastError = test.data?.lastError ?? (test.isError ? errorMessage(test.error) : status.data?.lastError);
  const tested = test.isSuccess || test.isError;

  const saveKey = () => {
    const apiKey = key.trim();
    if (!apiKey) return;
    update.mutate(
      { ai: { apiKey } },
      {
        onSuccess: () => {
          setKey('');
          setEnvKeyInUse(false);
          test.reset();
          toast.success('API key saved', { description: 'Use Test to check that it works.' });
        },
        onError: (err) => toast.error('Could not save the key', { description: errorMessage(err) }),
      },
    );
  };

  const removeKey = async () => {
    const ok = await confirm({
      title: 'Remove your API key?',
      description: 'Drafting will use JScout’s built-in templates until you add a key again.',
      confirmLabel: 'Remove key',
      tone: 'danger',
    });
    if (!ok) return;
    update.mutate(
      { ai: { apiKey: null } },
      {
        onSuccess: (saved) => {
          test.reset();
          if (keyRemovalResult(saved) === 'removed') {
            setEnvKeyInUse(false);
            toast.success('API key removed');
            return;
          }
          setEnvKeyInUse(true);
          toast.info('AI drafting is still on', { description: ENV_KEY_NOTE });
        },
        onError: (err) => toast.error('Could not remove the key', { description: errorMessage(err) }),
      },
    );
  };

  const saveModel = () => {
    const next = model.trim() || DEFAULT_AI_MODEL;
    setModel(next);
    if (next === settings.ai.model) return;
    update.mutate(
      { ai: { model: next } },
      {
        onSuccess: () => toast.success('Model saved'),
        onError: (err) => toast.error('Could not save the model', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <SectionCard
      id="ai"
      title="AI drafting"
      description="Optional. Cover letters and answers can be drafted with Anthropic’s Claude using your own API key."
      actions={
        settings.ai.hasKey ? (
          <Badge tone="success" dot>
            {usingEnvKey ? 'Key from environment' : 'Key saved'}
          </Badge>
        ) : (
          <Badge>Off</Badge>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          Nothing is sent to Anthropic unless you press a “with AI” button. Without a key, JScout drafts from built-in templates. You can get a key at
          console.anthropic.com; usage is billed to your Anthropic account. When no key is saved here, JScout uses the ANTHROPIC_API_KEY environment
          variable if it is set.
        </p>

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveKey();
          }}
        >
          <Field label={settings.ai.hasKey ? 'Replace API key' : 'Anthropic API key'} hint="Stored only on this computer and never shown again.">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              leadingIcon={<KeyRound />}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={settings.ai.hasKey ? '••••••••  saved' : 'sk-ant-…'}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!key.trim()} loading={update.isPending && key.trim() !== ''}>
              Save key
            </Button>
            {settings.ai.hasKey ? (
              <>
                <Button type="button" size="sm" loading={test.isPending} onClick={() => test.mutate()}>
                  Test
                </Button>
                {usingEnvKey ? null : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void removeKey()}>
                    Remove key
                  </Button>
                )}
              </>
            ) : null}
          </div>
          {usingEnvKey ? <p className="text-sm text-muted">{ENV_KEY_NOTE}</p> : null}
          {settings.ai.hasKey && (tested || lastError) ? (
            lastError ? (
              <p role="status" className="flex items-start gap-1.5 text-sm text-danger">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {lastError}
              </p>
            ) : (
              <p role="status" className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                Connected. Drafting with AI is ready.
              </p>
            )
          ) : null}
        </form>

        <Field label="Model" hint={`The Claude model to draft with. Default: ${DEFAULT_AI_MODEL}`} className="max-w-sm">
          <Input
            value={model}
            spellCheck={false}
            onChange={(event) => setModel(event.target.value)}
            onBlur={saveModel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveModel();
            }}
          />
        </Field>
      </div>
    </SectionCard>
  );
}
