import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { aiSetupProblem, type Settings } from '@noclue/shared';
import { createVAD } from '../audio/vad';
import type { MicVAD } from '@ricky0123/vad-web';
import '../sidepanel/style.css';
import { VersionBadge } from '../ui/VersionBadge';
import { Logo } from '../ui/Logo';
import { AiSettings } from '../ui/AiSettings';
import { blank, loadSettings, saveSettings } from '../ui/settings';

type Step = 'keys' | 'microphone' | 'privacy' | 'done';
const STEPS: Step[] = ['keys', 'microphone', 'privacy'];
const STEP_TITLES: Record<Step, string> = {
  keys: 'Connect your AI',
  microphone: 'Check your microphone',
  privacy: 'Where your data goes',
  done: 'You are ready',
};
const initialStep = (): Step => {
  const hash = location.hash.replace('#', '');
  return (['keys', 'microphone', 'privacy'] as string[]).includes(hash) ? (hash as Step) : 'keys';
};

/** First-run guide: API keys, microphone, data-flow notice. Reopened from Settings. */
function Guide() {
  const [step, setStep] = useState<Step>(initialStep);
  const [settings, setSettings] = useState<Settings>(blank);
  const [loaded, setLoaded] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void loadSettings().then((stored) => {
      if (stored) {
        setSettings(stored);
        setUnderstood(!!stored.consentAt);
      }
      setLoaded(true);
    });
    const onHash = () => setStep(initialStep());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (next: Step) => {
    setNotice('');
    setStep(next);
    if (next !== 'done') history.replaceState(null, '', `#${next}`);
  };
  async function saveKeys() {
    const problem = aiSetupProblem(settings);
    if (problem) {
      setNotice(problem);
      return;
    }
    const { openaiKey, anthropicKey, answerProvider, answerModel } = settings;
    setSettings(await saveSettings({ openaiKey, anthropicKey, answerProvider, answerModel }));
    go('microphone');
  }
  async function finish() {
    if (!understood) {
      setNotice('Please confirm that you have read this.');
      return;
    }
    setSettings(await saveSettings({ consentAt: Date.now() }));
    go('done');
  }
  const index = STEPS.indexOf(step);
  return (
    <main className="setup-main">
      <header>
        <Logo icon={40} subtitle />
        <span className="version">Setup</span>
      </header>
      {step !== 'done' && (
        <>
          <ol className="steps" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <li key={s} className={i < index ? 'done' : i === index ? 'current' : ''} />
            ))}
          </ol>
          <span className="step-label">
            Step {index + 1} of {STEPS.length}
          </span>
        </>
      )}
      <h1>{STEP_TITLES[step]}</h1>
      {step === 'keys' && loaded && (
        <>
          <p>
            noclue uses your own API key, so you pay the AI provider directly and only for what you
            use. There is no noclue account and no noclue server.
          </p>
          <AiSettings
            settings={settings}
            onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          />
          <p className="privacy">
            The cost depends on your provider's current prices, how long other people speak and how
            many answers you ask for. See{' '}
            <a href="https://openai.com/api/pricing/" target="_blank" rel="noreferrer">
              OpenAI pricing
            </a>{' '}
            and{' '}
            <a href="https://www.anthropic.com/pricing#api" target="_blank" rel="noreferrer">
              Anthropic pricing
            </a>
            , and set a monthly limit in your provider account to stay in control.
          </p>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <div className="guide-actions">
            <button className="primary" onClick={() => void saveKeys()}>
              Save and continue
            </button>
          </div>
        </>
      )}
      {step === 'microphone' && (
        <>
          <Setup />
          <div className="guide-actions">
            <button onClick={() => go('keys')}>Back</button>
            <button className="primary" onClick={() => go('privacy')}>
              Continue
            </button>
          </div>
        </>
      )}
      {step === 'privacy' && (
        <>
          <div className="guide-card">
            <ul>
              <li>
                Meeting audio from the selected tab goes to OpenAI for live transcription while you
                listen. It is never saved to disk.
              </li>
              <li>
                Your project facts, profile and the recent transcript go to{' '}
                {settings.answerProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} to prepare
                answers.
              </li>
              <li>Your microphone stays on this device. It only tells noclue when you speak.</li>
              <li>
                Keys, project and settings are stored only in this Chrome profile. Stop clears the
                transcript.
              </li>
              <li>noclue has no server and collects no analytics.</li>
            </ul>
            <p>
              Recording or transcribing other people may need their consent where you live. Tell
              participants when you use noclue if the rules or the situation call for it.
            </p>
            <label className="form checkbox" style={{ padding: 0 }}>
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              I have read this and will use noclue responsibly.
            </label>
          </div>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <div className="guide-actions">
            <button onClick={() => go('microphone')}>Back</button>
            <button className="primary" onClick={() => void finish()}>
              Finish setup
            </button>
          </div>
        </>
      )}
      {step === 'done' && (
        <div className="guide-card">
          <p>
            Open Google Meet or Microsoft Teams in Chrome, click the noclue icon in the toolbar, add
            a few project facts and choose Start Listening.
          </p>
          <p className="privacy">You can change keys and preferences any time in Settings.</p>
          <div className="guide-actions">
            <button onClick={() => window.close()}>Close this tab</button>
          </div>
        </div>
      )}
      <VersionBadge />
    </main>
  );
}

function Setup() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [selected, setSelected] = useState(''),
    [status, setStatus] = useState('Your microphone is used only to detect when you speak.'),
    [testing, setTesting] = useState(false),
    [level, setLevel] = useState(0),
    [speech, setSpeech] = useState(false);
  const speechSeen = useRef(false);
  const checkedDevice = useRef<string | undefined>(undefined);
  const resources = useRef<{
    stream?: MediaStream;
    context?: AudioContext;
    vad?: MicVAD;
    timer?: ReturnType<typeof setTimeout>;
    generation: number;
  }>({ generation: 0 });
  const stop = () => {
    const r = resources.current;
    r.generation++;
    clearTimeout(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    if (r.vad) void r.vad.destroy().catch(() => {});
    if (r.context) void r.context.close().catch(() => {});
    r.stream = undefined;
    r.vad = undefined;
    r.context = undefined;
    setTesting(false);
    setSpeech(false);
    setLevel(0);
  };
  useEffect(() => {
    void chrome.storage.local.get('settings').then(({ settings }) => {
      if (settings) setSelected(settings.microphoneId || '');
    });
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setDevices(devices.filter((d) => d.kind === 'audioinput')))
      .catch(() => {});
    return stop;
  }, []);
  async function test() {
    stop();
    const generation = resources.current.generation;
    setTesting(true);
    speechSeen.current = false;
    checkedDevice.current = undefined;
    setStatus('Requesting microphone permission…');
    try {
      const active = await chrome.runtime
        .sendMessage({ target: 'offscreen', type: 'snapshot' })
        .catch(() => null);
      if (active?.active)
        throw new Error('Stop the active meeting before changing the microphone.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selected ? { exact: selected } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (resources.current.generation !== generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      resources.current.stream = stream;
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput',
      );
      if (resources.current.generation !== generation) return;
      setDevices(devices);
      const context = (resources.current.context = new AudioContext());
      await context.resume();
      if (resources.current.generation !== generation) return;
      const vad = await createVAD(stream, context, {
        speech: (v) => {
          if (resources.current.generation === generation) {
            setSpeech(v);
            if (v) speechSeen.current = true;
          }
        },
        level: (v) => {
          if (resources.current.generation === generation) setLevel(v);
        },
      });
      if (resources.current.generation !== generation) {
        await vad.destroy();
        return;
      }
      resources.current.vad = vad;
      await vad.start();
      if (resources.current.generation !== generation) return;
      checkedDevice.current = selected;
      setStatus('Speak normally. This local test stops after 10 seconds. No audio is uploaded.');
      resources.current.timer = setTimeout(() => {
        stop();
        void chrome.storage.local.set({
          microphoneCheck: {
            deviceId: selected,
            at: Date.now(),
            speechDetected: speechSeen.current,
          },
        });
        setStatus(
          speechSeen.current
            ? 'Speech detected. Choose Save microphone to use this input.'
            : 'Access works, but no speech was heard. Speak during the test with your headphones on.',
        );
      }, 10_000);
    } catch (e) {
      stop();
      setStatus(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in Chrome and in your system privacy settings, then try again.'
          : e instanceof Error
            ? e.message
            : 'The microphone is not available. Check Chrome and system permissions.',
      );
    }
  }
  async function save() {
    const active = await chrome.runtime
      .sendMessage({ target: 'offscreen', type: 'snapshot' })
      .catch(() => null);
    if (active?.active) {
      setStatus('Stop the active meeting first.');
      return;
    }
    await saveSettings({ microphoneId: selected });
    if (checkedDevice.current === selected)
      await chrome.storage.local.set({
        microphoneCheck: { deviceId: selected, at: Date.now(), speechDetected: speechSeen.current },
      });
    stop();
    setStatus('Microphone saved.');
  }
  return (
    <>
      <p>
        noclue notices when you speak, so automatic answers wait for you. Your microphone is never
        transcribed or uploaded.
      </p>
      <div className="form">
        <label>
          Microphone
          <select disabled={testing} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">System default</option>
            {selected && !devices.some((device) => device.deviceId === selected) && (
              <option value={selected}>Saved microphone (unavailable)</option>
            )}
            {devices
              .filter((d) => d.deviceId !== 'default')
              .map((d) => (
                <option value={d.deviceId} key={d.deviceId}>
                  {d.label || 'Microphone'}
                </option>
              ))}
          </select>
        </label>
        <button className="primary" onClick={() => (testing ? stop() : void test())}>
          {testing ? 'Stop test' : 'Allow microphone & test'}
        </button>
        <meter className="meter-large" min="0" max="1" value={level} />
        <strong>{speech ? 'Speech detected' : 'Not speaking'}</strong>
        <p className="notice" role="status">
          {status}
        </p>
        <button onClick={() => void save()}>Save microphone</button>
      </div>
      <p className="privacy">
        Headphones work best. Meeting audio from speakers may sound like your voice. noclue cannot
        see whether you are muted in Google Meet or Microsoft Teams.
      </p>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Guide />);
