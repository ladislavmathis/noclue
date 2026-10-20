import React, { useEffect, useRef, useState } from 'react';
import { SettingsSchema, factsForProject, type Settings, type Decision } from '@noclue/shared';
import { previewContext } from '../connection/preview';
export function Practice({ settings, online }: { settings: Settings; online: boolean }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [result, setResult] = useState<Decision | null>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const signature = JSON.stringify(settings);
  useEffect(() => {
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    setError('');
    return () => controller.current?.abort();
  }, [signature]);
  async function run() {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
      setError('Add a project name and context first.');
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const result = await previewContext(parsed.data, question.trim(), current.signal);
      if (!current.signal.aborted) setResult(result);
    } catch (e) {
      if (!current.signal.aborted) setError((e as Error).message);
    } finally {
      if (controller.current === current) setBusy(false);
    }
  }
  const facts = factsForProject(settings.project);
  return (
    <details className="practice">
      <summary>Try a practice question</summary>
      <p className="privacy">
        See how your context supports an answer before the meeting. No audio is recorded. This sends
        the project context, your profile and the question to{' '}
        {settings.answerProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'}.
      </p>
      <label>
        Practice question
        <textarea
          rows={3}
          maxLength={2000}
          value={question}
          disabled={busy}
          placeholder="What is our planned budget, and what remains unconfirmed?"
          onChange={(e) => {
            setQuestion(e.target.value);
            setResult(null);
            setError('');
          }}
        />
      </label>
      <button
        className="primary"
        disabled={busy || !online || !question.trim()}
        onClick={() => void run()}
      >
        {busy ? 'Preparing an answer…' : 'Try it'}
      </button>
      {busy && (
        <button
          onClick={() => {
            controller.current?.abort();
            setBusy(false);
          }}
        >
          Cancel practice
        </button>
      )}
      {!online && <p className="privacy">Add your API key in Settings to try real answers.</p>}
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      {result && (
        <article className="practice-result" aria-label="Practice result">
          <small>PRACTICE · NOT A LIVE MEETING</small>
          {result.action === 'skip' ? (
            <p>There is no useful answer for this one. Try a specific project question.</p>
          ) : (
            <>
              <h3>Coaching</h3>
              <p>{result.recommendation}</p>
              <h3>Suggested response</h3>
              {result.responseType === 'draft' && (
                <p className="missing">Draft · adapt it to you</p>
              )}
              <p>{result.suggestedResponse}</p>
              {result.missingInformation.length > 0 && (
                <>
                  <h3>Missing information</h3>
                  <ul>
                    {result.missingInformation.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
              <details>
                <summary>Context used ({result.groundedFactIds.length})</summary>
                {facts
                  .filter((f) => result.groundedFactIds.includes(f.id))
                  .map((f) => (
                    <p key={f.id}>{f.text}</p>
                  ))}
              </details>
            </>
          )}
        </article>
      )}
    </details>
  );
}
