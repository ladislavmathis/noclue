import React, { useEffect, useRef, useState } from 'react';
import {
  ANTHROPIC_ANSWER_MODELS,
  OPENAI_ANSWER_MODELS,
  answerModelFor,
  looksLikeAnthropicKey,
  looksLikeOpenAIKey,
  normalizeKey,
  type AnswerProvider,
  type Settings,
} from '@noclue/shared';
import { verifyKeys, type KeyCheck } from '@noclue/core';

export const OPENAI_KEYS_URL = 'https://platform.openai.com/api-keys';
export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';

const MODEL_LABELS: Record<string, string> = {
  'gpt-4.1-mini': 'GPT-4.1 mini · fast, lowest cost',
  'gpt-4.1': 'GPT-4.1 · stronger, higher cost',
  'claude-opus-5-5': 'Claude Opus 5.5 · most capable',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 · balanced',
  'claude-haiku-5-5': 'Claude Haiku 5.5 · fastest, lowest cost',
};

type AiFields = Pick<Settings, 'openaiKey' | 'anthropicKey' | 'answerProvider' | 'answerModel'>;

/** API keys and answer provider. Keys stay in this browser profile only. */
export function AiSettings({
  settings,
  onChange,
  disabled = false,
}: {
  settings: Settings;
  onChange: (patch: Partial<AiFields>) => void;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<KeyCheck[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [show, setShow] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const signature = `${settings.openaiKey}|${settings.anthropicKey}|${settings.answerProvider}|${settings.answerModel}`;
  useEffect(() => {
    controller.current?.abort();
    setResults(null);
    setTesting(false);
  }, [signature]);
  useEffect(() => () => controller.current?.abort(), []);
  const models: readonly string[] =
    settings.answerProvider === 'anthropic' ? ANTHROPIC_ANSWER_MODELS : OPENAI_ANSWER_MODELS;
  const openaiWarning =
    settings.openaiKey && !looksLikeOpenAIKey(settings.openaiKey)
      ? settings.openaiKey.startsWith('sk-ant-')
        ? 'This looks like an Anthropic key. Paste it in the Anthropic field below.'
        : 'This does not look like an OpenAI key. It usually starts with sk-.'
      : '';
  const anthropicWarning =
    settings.anthropicKey && !looksLikeAnthropicKey(settings.anthropicKey)
      ? 'This does not look like an Anthropic key. It usually starts with sk-ant-.'
      : '';
  async function test() {
    controller.current?.abort();
    const current = (controller.current = new AbortController());
    setTesting(true);
    setResults(null);
    try {
      const checked = await verifyKeys(settings, current.signal);
      if (!current.signal.aborted)
        setResults(
          checked.length
            ? checked
            : [{ provider: 'OpenAI', ok: false, message: 'Add a key first, then test it.' }],
        );
    } finally {
      if (controller.current === current) setTesting(false);
    }
  }
  const choose = (provider: AnswerProvider) =>
    onChange({ answerProvider: provider, answerModel: '' });
  return (
    <fieldset className="ai-settings" disabled={disabled}>
      <legend>AI providers</legend>
      <label>
        OpenAI API key
        <span className="key-row">
          <input
            aria-label="OpenAI API key"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={settings.openaiKey}
            onChange={(e) => onChange({ openaiKey: normalizeKey(e.target.value) })}
          />
          <button type="button" onClick={() => setShow(!show)} aria-pressed={show}>
            {show ? 'Hide' : 'Show'}
          </button>
        </span>
        <small>
          Needed for live transcription.{' '}
          <a href={OPENAI_KEYS_URL} target="_blank" rel="noreferrer">
            Get an OpenAI key
          </a>
        </small>
        {openaiWarning && <small role="status">{openaiWarning}</small>}
      </label>
      <div>
        <strong>Answers and fact check by</strong>
        <div className="provider-choice" role="radiogroup" aria-label="Answer provider">
          <label>
            <input
              type="radio"
              name="answer-provider"
              checked={settings.answerProvider === 'openai'}
              onChange={() => choose('openai')}
            />
            OpenAI
          </label>
          <label>
            <input
              type="radio"
              name="answer-provider"
              checked={settings.answerProvider === 'anthropic'}
              onChange={() => choose('anthropic')}
            />
            Anthropic (Claude)
          </label>
        </div>
      </div>
      {settings.answerProvider === 'anthropic' && (
        <label>
          Anthropic API key
          <input
            aria-label="Anthropic API key"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={settings.anthropicKey}
            onChange={(e) => onChange({ anthropicKey: normalizeKey(e.target.value) })}
          />
          <small>
            <a href={ANTHROPIC_KEYS_URL} target="_blank" rel="noreferrer">
              Get an Anthropic key
            </a>
          </small>
          {anthropicWarning && <small role="status">{anthropicWarning}</small>}
        </label>
      )}
      <label>
        Answer model
        <select
          aria-label="Answer model"
          value={answerModelFor(settings)}
          onChange={(e) => onChange({ answerModel: e.target.value })}
        >
          {models.map((model) => (
            <option key={model} value={model}>
              {MODEL_LABELS[model] ?? model}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => void test()} disabled={testing || !settings.openaiKey}>
        {testing ? 'Testing keys…' : 'Test keys'}
      </button>
      {results?.map((result, i) => (
        <p key={i} className={'key-result' + (result.ok ? '' : ' bad')} role="status">
          {result.ok ? '✓ ' : ''}
          {result.message}
        </p>
      ))}
      <p className="privacy">
        Testing a key is free: it only reads model details. Keys are saved only in this Chrome
        profile and sent only to OpenAI or Anthropic. Chrome does not encrypt extension storage, so
        use a separate key with a monthly spending limit.
      </p>
    </fieldset>
  );
}
