import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  SettingsSchema,
  ProjectSchema,
  aiSetupProblem,
  initialState,
  visibleCue,
  type PanelState,
  type Settings,
} from '@noclue/shared';
import './style.css';
import { Practice } from './Practice';
import { ResponseControls } from './ResponseControls';
import { checkConnection, type ConnectionCheck } from '../connection/check';
import { VersionBadge } from '../ui/VersionBadge';
import { AiSettings } from '../ui/AiSettings';
import { Glyph, Logo } from '../ui/Logo';
import { blank, withDefaults } from '../ui/settings';
const AI_FIELDS = ['openaiKey', 'anthropicKey', 'answerProvider', 'answerModel'] as const;
const providerName = (settings: Settings) =>
  settings.answerProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
function settingsError(issues: { path: (string | number)[]; message: string }[]) {
  const labels: Record<string, string> = {
    'project.name': 'Project name is required (maximum 120 characters).',
    'project.context': 'Project context is required and must be at most 20,000 characters.',
    'project.role': 'Your role must be at most 500 characters.',
    'project.goal': 'Meeting goal must be at most 1,500 characters.',
    'project.keywords': 'Use up to 40 keywords, at most 80 characters each, without < or >.',
    openaiKey: 'Check the OpenAI API key.',
    anthropicKey: 'Check the Anthropic API key.',
    microphoneId: 'Select your microphone again in microphone setup.',
  };
  return [
    ...new Set(
      issues.map((issue) => {
        const path = issue.path.slice(0, issue.path[0] === 'project' ? 2 : 1).join('.');
        return labels[path] ?? 'Check the project settings and try again.';
      }),
    ),
  ].join(' ');
}

function App() {
  const [connection, setConnection] = useState<ConnectionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [micCheck, setMicCheck] = useState<{
    deviceId: string;
    at: number;
    speechDetected: boolean;
  } | null>(null);
  const checkController = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => checkController.current?.abort(), []);

  const [settings, setSettings] = useState<Settings>(blank),
    [state, setState] = useState<PanelState>(initialState);
  const [notice, setNotice] = useState(''),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const aiProblem = aiSetupProblem(settings);
  const aiReady = !aiProblem;
  const guided = !!settings.consentAt;
  useEffect(() => {
    void chrome.storage.local
      .get('microphoneCheck')
      .then((result) => setMicCheck(result.microphoneCheck ?? null));
    void chrome.storage.local.get('settings').then(({ settings: s }) => {
      if (s) setSettings(withDefaults(s));
      else setEditing(true);
    });
    void chrome.runtime
      .sendMessage({ target: 'offscreen', type: 'snapshot' })
      .then((s) => {
        if (s) setState(s);
      })
      .catch(() => {});
    const listener = (m: any) => {
      if (m.target === 'panel' && m.type === 'state') setState(m.state);
      if (m.target === 'panel' && m.type === 'cue.share')
        setNotice(
          m.hidden
            ? 'Cue hidden while you share. It comes back when sharing stops.'
            : 'Sharing stopped. The cue is visible again.',
        );
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.microphoneCheck) setMicCheck(changes.microphoneCheck.newValue ?? null);
      const change = changes.settings;
      if (!change?.newValue) return;
      const incoming = withDefaults(change.newValue);
      const previous = withDefaults(change.oldValue);
      // A microphone save from the setup tab must not overwrite an open editor's draft.
      setSettings((current) => {
        const next: Settings = {
          ...incoming,
          project:
            JSON.stringify(current.project) === JSON.stringify(previous.project)
              ? incoming.project
              : current.project,
        };
        for (const field of AI_FIELDS)
          if (current[field] !== previous[field]) (next as any)[field] = current[field];
        return next;
      });
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.storage.onChanged.addListener(changed);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  useEffect(() => {
    checkController.current?.abort();
    setConnection(null);
  }, [settings.openaiKey, settings.anthropicKey, settings.answerProvider, settings.answerModel]);
  // The current request's first draft shows until its checked answer arrives; the newest
  // answer stays live until a newer answer or draft replaces it.
  const { cue, preview } = visibleCue(state);
  const newestId =
    state.suggestions[0]?.questionId === state.question?.id &&
    state.suggestions[0]?.revision === state.question?.revision &&
    (!state.currentRequestId || state.suggestions[0]?.requestId === state.currentRequestId)
      ? state.suggestions[0]?.requestId
      : undefined;
  useEffect(() => {
    if (!newestId || !state.active || !state.sessionId) return;
    let first = 0,
      second = 0,
      sent = false;
    const visible = () => {
      if (document.visibilityState !== 'visible' || sent) return;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          if (document.visibilityState !== 'visible' || sent) return;
          sent = true;
          void chrome.runtime
            .sendMessage({
              target: 'offscreen',
              type: 'answer.visible',
              sessionId: state.sessionId,
              requestId: newestId,
              at: performance.timeOrigin + performance.now(),
              surface: 'panel',
            })
            .catch(() => {});
        });
      });
    };
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [newestId, state.active, state.sessionId]);
  async function exportTest() {
    try {
      const log = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.export' });
      if (!log) {
        setNotice('No test recording available. Enable test mode before starting.');
        return;
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `noclue-test-${new Date(log.startedAt).toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setNotice('Could not export the test recording.');
    }
  }
  async function verifyConnection() {
    if (checking || state.active) return;
    setChecking(true);
    setConnection(null);
    const controller = (checkController.current = new AbortController());
    const result = await checkConnection(settings, controller.signal);
    if (!controller.signal.aborted) setConnection(result);
    setChecking(false);
  }
  async function command(type: 'start' | 'stop' | 'answer' | 'setup' | 'guide') {
    setNotice('');
    if (type === 'start') setBusy(true);
    try {
      let commandSettings = settings;
      if (type === 'start') {
        const result = SettingsSchema.safeParse({
          ...settings,
          project: {
            ...settings.project,
            keywords: settings.project.keywords.filter((k) => k.trim()),
          },
        });
        if (!result.success) {
          setEditing(true);
          throw new Error(settingsError(result.error.issues));
        }
        await chrome.storage.local.set({ settings: result.data });
        setSettings(result.data);
        commandSettings = result.data;
      }
      const result = await chrome.runtime.sendMessage({
        target:
          type === 'start' || type === 'setup' || type === 'guide' ? 'background' : 'offscreen',
        type,
        ...(type === 'start' ? { settings: commandSettings } : {}),
      });
      if (result?.error) throw new Error(result.error);
      if (type === 'start' && result?.ok) setEditing(false);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Command failed.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const projectResult = ProjectSchema.safeParse({
      ...settings.project,
      keywords: settings.project.keywords.filter((k) => k.trim()),
    });
    const result = projectResult.success
      ? { success: true as const, data: { ...settings, project: projectResult.data } }
      : {
          success: false as const,
          error: {
            issues: projectResult.error.issues.map((issue) => ({
              ...issue,
              path: ['project', ...issue.path],
            })),
          },
        };
    // API keys and provider are saved even before a project exists.
    const { settings: stored } = await chrome.storage.local.get('settings');
    const ai = Object.fromEntries(AI_FIELDS.map((field) => [field, settings[field]]));
    if (!result.success) {
      await chrome.storage.local.set({ settings: { ...withDefaults(stored), ...ai } });
      setNotice(`API settings saved. ${settingsError(result.error.issues)}`);
      return;
    }
    await chrome.storage.local.set({ settings: result.data });
    setSettings(result.data);
    setNotice('Saved on this device.');
    setEditing(false);
  }
  const project = <K extends keyof Settings['project']>(field: K, value: Settings['project'][K]) =>
    setSettings((s) => ({ ...s, project: { ...s.project, [field]: value } }));
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (!/\.(txt|md)$/i.test(file.name)) throw new Error('Choose a .txt or .md file.');
      if (file.size > 80_000)
        throw new Error('File is too large. Maximum context is 20,000 characters.');
      let text: string;
      const bytes = await file.arrayBuffer();
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('This file is not valid UTF-8. Save it as UTF-8 text and import it again.');
      }
      if (text.length > 20_000)
        throw new Error('Context exceeds 20,000 characters. Nothing was imported.');
      project('context', text);
      setNotice('Imported into the editor. Save to keep this context.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <main>
      <header>
        <Logo icon={30} />
        <span className="version">Beta</span>
      </header>
      <section className="session-head">
        <span className="eyebrow">Not knowing is normal</span>
        <h1>{state.active ? state.projectName : settings.project.name || 'Ready when you are.'}</h1>
        <p>A short, calm answer when you need one. The conversation stays yours.</p>
      </section>
      {!state.active && !guided && (
        <section className="guide-card" aria-label="Welcome">
          <h2>Welcome to noclue</h2>
          <p>
            Three short steps get you ready: your API key, your microphone and a note on where your
            data goes.
          </p>
          <button className="primary full" onClick={() => void command('guide')}>
            Open setup guide
          </button>
        </section>
      )}
      {!state.active && (
        <section className="readiness" aria-label="Before your meeting">
          <div className="readiness-title">
            <h2>Before your meeting</h2>
            <span>3 quick checks</span>
          </div>
          <ol>
            <li>
              <span
                className={
                  ProjectSchema.safeParse(settings.project).success ? 'check-ok' : 'check-pending'
                }
              >
                {ProjectSchema.safeParse(settings.project).success ? '✓' : '1'}
              </span>
              <div>
                <strong>Project context</strong>
                <small>
                  {ProjectSchema.safeParse(settings.project).success
                    ? 'Your facts are ready.'
                    : 'Add a few facts and what you want from the meeting.'}
                </small>
              </div>
              <button className="text-button" onClick={() => setEditing(true)}>
                Edit
              </button>
            </li>
            <li>
              <span className={connection?.ok ? 'check-ok' : 'check-pending'}>
                {connection?.ok ? '✓' : '2'}
              </span>
              <div>
                <strong>API keys</strong>
                <small>
                  {connection?.ok
                    ? 'Transcription and answers both work.'
                    : (aiProblem ?? 'Run one short check before the meeting.')}
                </small>
              </div>
              {aiReady ? (
                <button
                  className="text-button"
                  onClick={() => void verifyConnection()}
                  disabled={checking}
                >
                  {checking ? 'Checking…' : 'Check'}
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={() => (guided ? setEditing(true) : void command('guide'))}
                >
                  Add
                </button>
              )}
            </li>
            <li>
              <span
                className={
                  micCheck?.deviceId === settings.microphoneId && micCheck?.speechDetected
                    ? 'check-ok'
                    : 'check-pending'
                }
              >
                {micCheck?.deviceId === settings.microphoneId && micCheck?.speechDetected
                  ? '✓'
                  : '3'}
              </span>
              <div>
                <strong>Your microphone</strong>
                <small>
                  {micCheck?.deviceId === settings.microphoneId
                    ? micCheck.speechDetected
                      ? 'Speech detected in the last test.'
                      : 'Access works. Speak during the test to verify detection.'
                    : 'Test once with your headphones on.'}
                </small>
              </div>
              <button className="text-button" onClick={() => void command('setup')}>
                Test
              </button>
            </li>
          </ol>
          {connection && (
            <p className={connection.ok ? 'connection-ok' : 'notice'} role="status">
              {connection.message}
            </p>
          )}
          <small>
            Check makes one small AI request without recording audio. It may cost a fraction of a
            cent.
          </small>
        </section>
      )}
      <div className="statusline">
        <span className={'dot ' + (state.active ? 'live' : '')} />
        <strong>{state.status}</strong>
        <span className="backend">
          {aiReady ? `Answers by ${providerName(settings)}` : 'API key missing'}
        </span>
      </div>
      {state.active && !state.micAvailable && (
        <p className="mode-banner">
          Manual mode · Your microphone is unavailable. Use Answer Now. Automatic suggestions are
          off.
        </p>
      )}
      {state.active && state.speaking && <p className="mode-banner">You have the floor.</p>}
      {state.active && (
        <div className="meters">
          <label>
            Meeting <meter min="0" max="1" value={state.meetingLevel} />
          </label>
          <label>
            {state.micAvailable ? 'Your mic' : 'Mic unavailable'}{' '}
            <meter min="0" max="1" value={state.micLevel} />
          </label>
        </div>
      )}
      <div className="controls">
        {state.active ? (
          <>
            <button
              className="primary"
              onClick={() => void command('answer')}
              disabled={
                (state.generating && state.generatingMode !== 'automatic') ||
                state.status === 'Connecting' ||
                state.status === 'Reconnecting'
              }
            >
              {state.generating && state.generatingMode !== 'automatic'
                ? 'Thinking…'
                : 'Answer Now'}
            </button>
            <button onClick={() => void command('stop')}>Stop</button>
          </>
        ) : (
          <button
            className="primary full"
            disabled={busy || checking || !aiReady || !guided}
            onClick={() => void command('start')}
          >
            {busy ? 'Connecting…' : 'Start Listening'}
          </button>
        )}
      </div>
      {!state.active && (
        <p className="privacy">
          Meeting audio goes to OpenAI for transcription. Your project context and profile go to{' '}
          {providerName(settings)} for answers. Your microphone stays on this device. Headphones
          help noclue notice when you speak.
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {state.message && (
        <p className="notice" role="status">
          {state.message}
        </p>
      )}
      <section className="test-controls" aria-label="Test recording">
        <label>
          <input
            type="checkbox"
            checked={settings.testMode ?? false}
            disabled={state.active}
            onChange={(e) => setSettings({ ...settings, testMode: e.target.checked })}
          />{' '}
          Test mode · questions and answers stay in memory until export
        </label>
        {!!state.testLogCount && (
          <>
            <button onClick={() => void exportTest()}>Export test JSON</button>
            <button
              onClick={() =>
                void chrome.runtime
                  .sendMessage({ target: 'offscreen', type: 'test.clear' })
                  .catch(() => {})
              }
            >
              Clear test
            </button>
            <small>
              {state.testLogCount} events
              {state.testLogTruncated ? ' · Recording full; export is incomplete' : ''}
            </small>
          </>
        )}
        {state.testMode && state.quickLatencyMs !== undefined && (
          <small>
            Last QUICK: {(state.quickLatencyMs / 1000).toFixed(2)} s from last voiced frame
          </small>
        )}
      </section>
      {state.question && (
        <p className="question-preview">
          <strong>
            {state.generating
              ? 'Preparing QUICK'
              : state.question.state === 'ANSWERING'
                ? 'Answered'
                : state.question.state === 'FAILED'
                  ? 'Could not finish. Try Answer Now.'
                  : state.question.state === 'SKIPPED'
                    ? 'Skipped. Answer Now is available.'
                    : 'Listening to the question'}
          </strong>
          <br />
          {state.question.text}
          {state.question.reason && (
            <>
              <br />
              <small>{state.question.reason}</small>
            </>
          )}
        </p>
      )}
      <section className="suggestions" aria-label="Recommendations" aria-live="polite">
        {preview && (
          <article className="suggestion preview" data-testid="answer-preview">
            <div className="card-top">
              <span className="preview-badge">Checking facts…</span>
              <span>Unverified draft</span>
            </div>
            {preview.responseType === 'draft' && <p className="missing">Draft · adapt it to you</p>}
            <p className="response">{preview.suggestedResponse}</p>
            <p className="coaching">
              You can start speaking. Wait for the checked answer before quoting names, numbers or
              commitments.
            </p>
          </article>
        )}
        {state.suggestions.length === 0 && !preview ? (
          <div className="empty">
            <div className="orbit" style={{ color: 'var(--nc-accent-ui)' }}>
              <Glyph size={48} />
            </div>
            <h2>{state.active ? 'Listening for your moment.' : 'No clue? No problem.'}</h2>
            <p>
              {state.active
                ? 'When someone asks you something, a short answer appears here.'
                : 'Add your project facts, open Google Meet or Microsoft Teams in Chrome, and start listening.'}
            </p>
          </div>
        ) : (
          state.suggestions.map((suggestion) => (
            <article
              className={'suggestion ' + (suggestion !== cue ? 'previous' : '')}
              key={suggestion.requestId}
            >
              <div className="card-top">
                <span>{suggestion.category}</span>
                <span>
                  {suggestion !== cue
                    ? 'Earlier'
                    : suggestion.mode === 'manual'
                      ? 'Answer Now'
                      : 'Live suggestion'}
                </span>
              </div>
              <label>
                QUICK
                {suggestion.answerBasis === 'general'
                  ? ' · General knowledge'
                  : suggestion.answerBasis === 'partial'
                    ? ' · Partial answer'
                    : ''}
              </label>
              <p className="question-preview">{suggestion.question}</p>
              {suggestion.responseType === 'draft' && (
                <p className="missing">Draft · adapt it to you</p>
              )}
              <p className="response">{suggestion.suggestedResponse}</p>
              <p className="coaching">{suggestion.recommendation}</p>
              {!!suggestion.missingInformation.length && (
                <p className="missing">To confirm: {suggestion.missingInformation.join(' · ')}</p>
              )}
              <div className="feedback" aria-label="Answer feedback">
                {(
                  [
                    ['helpful', '👍'],
                    ['unhelpful', '👎'],
                    ['slow', 'Too slow'],
                    ['long', 'Too long'],
                    ['wrong', 'Wrong'],
                  ] as const
                ).map(([feedback, label]) => (
                  <button
                    key={feedback}
                    aria-label={feedback}
                    onClick={() => {
                      void chrome.runtime
                        .sendMessage({
                          target: 'offscreen',
                          type: 'feedback',
                          requestId: suggestion.requestId,
                          feedback,
                        })
                        .catch(() => {});
                      setNotice(
                        state.testMode
                          ? 'Feedback recorded for export.'
                          : 'Enable test mode to record feedback.',
                      );
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="card-actions">
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(suggestion.suggestedResponse)
                      .then(() => setNotice('Response copied.'))
                      .catch(() => setNotice('Copy unavailable. Select and copy the response.'));
                  }}
                >
                  Copy response
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    void chrome.runtime
                      .sendMessage({
                        target: 'offscreen',
                        type: 'dismiss',
                        requestId: suggestion.requestId,
                      })
                      .catch(() => {});
                  }}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      {state.active && (
        <details>
          <summary>
            Live transcript{' '}
            <span>{(state.transcriptHistory ?? state.segments).length} segments</span>
          </summary>
          <div className="transcript">
            {state.transcriptTruncated && (
              <p>
                Older transcript was removed to stay within the local limit. Stop clears the whole
                transcript.
              </p>
            )}
            {(state.transcriptHistory ?? state.segments).length ? (
              (state.transcriptHistory ?? state.segments).map((s) => (
                <p key={s.id} className={s.final ? '' : 'partial'}>
                  <small>
                    Meeting audio ·{' '}
                    {new Date(s.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                    {s.final ? '' : ' · transcribing'}
                  </small>
                  <br />
                  {s.text}
                </p>
              ))
            ) : (
              <p>Waiting for speech from the meeting…</p>
            )}
          </div>
        </details>
      )}
      {!state.active && <Practice settings={settings} online={aiReady} />}
      <button
        onClick={() => {
          void chrome.runtime
            .sendMessage({ target: 'background', type: 'overlay' })
            .then((result) => {
              if (result?.error) setNotice(result.error);
              else
                setNotice(
                  'Cue window opened on your meeting tab. Click Pop out in it to keep it off shared tabs and windows.',
                );
            })
            .catch(() =>
              setNotice(
                'Open your Google Meet or Microsoft Teams tab and click the noclue toolbar icon first.',
              ),
            );
        }}
      >
        Show cue window
      </button>
      <section className="settings">
        <button
          className="settings-toggle"
          disabled={state.active}
          onClick={() => setEditing(!editing)}
        >
          Settings <span>{state.active ? 'Locked during meeting' : editing ? '−' : '+'}</span>
        </button>
        {editing && !state.active && (
          <div className="form">
            <AiSettings
              settings={settings}
              onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            />
            <ResponseControls
              project={settings.project}
              onChange={(value) => project('preferences', value)}
            />
            <label>
              Project name
              <input
                value={settings.project.name}
                maxLength={120}
                placeholder="e.g. Website relaunch"
                onChange={(e) => project('name', e.target.value)}
              />
            </label>
            <label>
              Your role
              <input
                value={settings.project.role}
                maxLength={500}
                placeholder="e.g. Project lead"
                onChange={(e) => project('role', e.target.value)}
              />
            </label>
            <label>
              Meeting goal
              <textarea
                rows={2}
                value={settings.project.goal}
                maxLength={1500}
                placeholder="What would a good outcome look like?"
                onChange={(e) => project('goal', e.target.value)}
              />
            </label>
            <label>
              About me
              <textarea
                rows={5}
                maxLength={5000}
                value={settings.project.aboutMe ?? ''}
                disabled={state.active}
                placeholder="Your identity, experience, motivation, responsibilities and preferred introduction."
                onChange={(e) => project('aboutMe', e.target.value)}
              />
              <small>
                {(settings.project.aboutMe ?? '').length.toLocaleString()} / 5,000 characters
              </small>
            </label>
            <p className="privacy">
              Your profile is saved on this device with the project and sent to{' '}
              {providerName(settings)} when preparing answers. Add only facts you are happy to use.
            </p>
            <label>
              Project context
              <textarea
                rows={9}
                value={settings.project.context}
                placeholder={
                  'Verified facts:\n\nCurrent status:\n\nRisks and unknowns:\n\nWhat I can / cannot commit to:'
                }
                onChange={(e) => project('context', e.target.value)}
              />
              <small>{settings.project.context.length.toLocaleString()} / 20,000 characters</small>
            </label>
            <label className="file">
              Import .txt or .md
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <label>
              Keywords, one per line
              <textarea
                rows={2}
                value={settings.project.keywords.join('\n')}
                onChange={(e) => project('keywords', e.target.value.split('\n'))}
              />
            </label>
            <button onClick={() => void command('setup')}>Set up microphone</button>
            <button onClick={() => void command('guide')}>Open setup guide</button>
            <button
              className="primary"
              onClick={() => {
                setSettings((s) => ({
                  ...s,
                  project: { ...s.project, keywords: s.project.keywords.filter((k) => k.trim()) },
                }));
                void save();
              }}
            >
              Save settings
            </button>
          </div>
        )}
      </section>
      <footer>
        noclue by ignition <span>Your context stays on this device.</span>
      </footer>
      <VersionBadge />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
