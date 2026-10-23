import {
  PROTOCOL_VERSION,
  APP_VERSION,
  initialState,
  pruneSegments,
  appendTranscript,
  LIMITS,
  type ExtensionCommand,
  type PanelState,
  type ServerEvent,
  type Settings,
  visibleCue,
} from '@noclue/shared';
import { ClockSync, SessionRecorder, monotonicEpoch } from '../connection/telemetry';
import { openHub, SOCKET_OPEN, type HubSocket } from '../connection/transport';
const recorder = new SessionRecorder();
let clock = new ClockSync();
const rendered = new Set<string>();
const validRequests = new Set<string>();
import { AudioGate } from '../audio/dsp';
import { createVAD } from '../audio/vad';
import type { MicVAD } from '@ricky0123/vad-web';
let state: PanelState = initialState(),
  generation = 0;
let tabStream: MediaStream | undefined,
  micStream: MediaStream | undefined,
  context: AudioContext | undefined;
let tabVAD: MicVAD | undefined,
  micVAD: MicVAD | undefined,
  worklet: AudioWorkletNode | undefined,
  gate: AudioGate | undefined;
let socket: HubSocket | undefined,
  ready = false,
  settings: Settings | undefined,
  attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined,
  connectTimer: ReturnType<typeof setTimeout> | undefined,
  stableTimer: ReturnType<typeof setTimeout> | undefined;
let requestId: string | undefined,
  /** The Answer Now request the user started; its result is shown even if the question moved on. */
  manualRequestId: string | undefined,
  retryable = true,
  retryAfterMs = 0,
  tabSpeaking = false;
const short = (id?: string) => id?.slice(0, 8);
let lastCueLog = '';
/** Logs what the cue surfaces show after each meeting event: identities only, never text. */
function debugCue(event: string, ids: Record<string, unknown>) {
  const { cue: shown, preview } = visibleCue(state);
  const cue = shown
    ? `answer ${short(shown.requestId)}`
    : preview
      ? `preview ${short(preview.requestId)}`
      : state.cueDismissed
        ? 'hidden (dismissed)'
        : 'empty';
  console.log('[noclue]', event, JSON.stringify(ids), cue === lastCueLog ? '' : '→ cue ' + cue);
  lastCueLog = cue;
}
function publish() {
  state.testLogCount = recorder.log?.events.length ?? 0;
  state.testLogTruncated = recorder.log?.truncated ?? false;
  void chrome.runtime.sendMessage({ target: 'panel', type: 'state', state }).catch(() => {});
}
function message(type: string, fields: Record<string, unknown> = {}) {
  if (socket?.readyState === SOCKET_OPEN)
    socket.send(JSON.stringify({ type, sessionId: state.sessionId, ...fields }));
}
function speaking(value: boolean, available = state.micAvailable) {
  if (!state.active) return;
  state.speaking = value;
  state.micAvailable = available;
  if (ready) {
    state.status = value ? 'You are speaking' : 'Listening';
    message('self_speech.changed', { speaking: value, available });
  }
  if (!available)
    state.message =
      'Microphone unavailable. Automatic suggestions are off; Answer Now still works.';
  publish();
}
function teardown() {
  generation++;
  ready = false;
  tabSpeaking = false;
  clearTimeout(retryTimer);
  clearTimeout(connectTimer);
  clearTimeout(stableTimer);
  const oldSocket = socket;
  socket = undefined;
  if (oldSocket) {
    oldSocket.onclose = null;
    oldSocket.onerror = null;
    oldSocket.onmessage = null;
    oldSocket.close();
  }
  tabStream?.getTracks().forEach((t) => t.stop());
  micStream?.getTracks().forEach((t) => t.stop());
  tabStream = undefined;
  micStream = undefined;
  worklet?.disconnect();
  worklet = undefined;
  if (tabVAD) void tabVAD.destroy().catch(() => {});
  if (micVAD) void micVAD.destroy().catch(() => {});
  tabVAD = undefined;
  micVAD = undefined;
  if (context) void context.close().catch(() => {});
  context = undefined;
  gate?.reset();
  gate = undefined;
  settings = undefined;
  requestId = undefined;
  manualRequestId = undefined;
}
function stop(error?: string) {
  if (state.active)
    recorder.add({
      kind: 'session.stopped',
      at: monotonicEpoch(),
      sessionId: state.sessionId ?? '',
      reason: error,
    });
  recorder.stop();
  if (ready) message('session.stop');
  teardown();
  state = {
    ...initialState(),
    tabId: state.tabId,
    status: error ? 'Error' : 'Stopped',
    message: error ?? 'Meeting stopped. Temporary transcript cleared.',
  };
  publish();
}
function connect(expectedGeneration: number) {
  if (expectedGeneration !== generation || !state.active || !settings) return;
  ready = false;
  gate?.reset();
  state.sessionId = crypto.randomUUID();
  state.question = undefined;
  clock = new ClockSync();
  rendered.clear();
  state.generating = false;
  state.generatingMode = undefined;
  state.segments = [];
  state.transcriptHistory = [];
  state.transcriptTruncated = false;
  state.suggestions = [];
  state.preview = undefined;
  requestId = undefined;
  manualRequestId = undefined;
  retryable = true;
  retryAfterMs = 0;
  const ws = (socket = openHub(settings!));
  connectTimer = setTimeout(() => {
    if (socket === ws) {
      state.message = 'Connecting took too long. Check your internet connection and try again.';
      ws.close();
    }
  }, 15_000);
  ws.onopen = () => {
    if (settings)
      ws.send(
        JSON.stringify({
          type: 'authenticate',
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
  };
  ws.onmessage = (event) => {
    if (expectedGeneration !== generation || socket !== ws) return;
    let data: ServerEvent;
    try {
      data = JSON.parse(event.data);
    } catch {
      stop('Something went wrong inside noclue. Start again.');
      return;
    }
    if (data.type === 'authenticated') {
      if (data.protocolVersion !== PROTOCOL_VERSION) {
        stop(`Reload noclue in chrome://extensions to finish updating to version ${APP_VERSION}.`);
        return;
      }
      ws.send(JSON.stringify({ type: 'clock.sync', sentAt: monotonicEpoch() }));
      return;
    }
    if (data.type === 'clock.synced') {
      clock.receive(data.sentAt, data.serverAt, monotonicEpoch());
      recorder.add({
        kind: 'clock.synced',
        at: monotonicEpoch(),
        sessionId: state.sessionId!,
        clockUncertaintyMs: clock.uncertainty,
      });
      message('session.start', {
        project: settings!.project,
        micAvailable: state.micAvailable,
        testMode: settings!.testMode ?? false,
      });
      return;
    }
    if ('sessionId' in data && data.sessionId && data.sessionId !== state.sessionId) return;
    switch (data.type) {
      case 'question.updated':
        if (
          state.question?.id !== data.question.id ||
          state.question?.revision !== data.question.revision
        )
          validRequests.clear();
        state.question = data.question;
        break;
      case 'telemetry.event':
        recorder.add({
          ...data.event,
          at: clock.local(data.event.at),
          sourceAt:
            data.event.sourceAt === undefined ? undefined : clock.local(data.event.sourceAt),
        });
        break;
      case 'session.ready':
        clearTimeout(connectTimer);
        ready = true;
        message('meeting_speech.changed', {
          speaking: tabSpeaking,
          at: clock.server(monotonicEpoch()),
          speechAt: clock.server(monotonicEpoch()),
        });
        gate?.speech(tabSpeaking);
        state.status = state.speaking ? 'You are speaking' : 'Listening';
        state.message = state.micAvailable
          ? attempts
            ? 'Reconnected. Speech during the gap was not transcribed.'
            : 'Listening to this meeting tab.'
          : 'Microphone unavailable. Automatic suggestions are off; Answer Now still works.';
        message('self_speech.changed', { speaking: state.speaking, available: state.micAvailable });
        stableTimer = setTimeout(() => {
          attempts = 0;
        }, 30_000);
        break;
      case 'transcript.delta':
      case 'transcript.final':
        const history = appendTranscript(state.transcriptHistory ?? [], data.segment);
        state.transcriptHistory = history.segments;
        state.transcriptTruncated ||= history.truncated;
        state.segments = pruneSegments([
          ...state.segments.filter((s) => s.id !== data.segment.id),
          data.segment,
        ]);
        break;
      case 'recommendation.started':
        if (data.mode === 'manual') manualRequestId = data.requestId;
        if (data.questionId !== state.question?.id || data.revision !== state.question?.revision)
          break;
        validRequests.clear();
        validRequests.add(data.requestId);
        state.currentRequestId = data.requestId;
        state.preview = undefined;
        requestId = data.requestId;
        state.generating = true;
        state.generatingMode = data.mode;
        break;
      case 'recommendation.finished':
        // A normal finish can hold the checked answer back until speech ends, so the
        // preview stays until that answer, a cancellation (reason) or an error replaces it.
        if (data.reason) {
          validRequests.delete(data.requestId);
          if (manualRequestId === data.requestId) manualRequestId = undefined;
          if (state.preview?.requestId === data.requestId) state.preview = undefined;
        }
        if (requestId === data.requestId) {
          state.generating = false;
          state.generatingMode = undefined;
          requestId = undefined;
        }
        break;
      case 'recommendation.preview':
        if (
          validRequests.has(data.preview.requestId) &&
          data.preview.requestId === state.currentRequestId &&
          data.preview.questionId === state.question?.id &&
          data.preview.revision === state.question?.revision
        )
          state.preview = data.preview;
        break;
      case 'recommendation.ready': {
        const previewed = state.preview?.requestId === data.suggestion.requestId;
        if (previewed) state.preview = undefined;
        // The user's own Answer Now is shown even when the meeting has moved on to another
        // question meanwhile; the suggestion carries the question it answers.
        const manual =
          data.suggestion.mode === 'manual' && data.suggestion.requestId === manualRequestId;
        if (
          !data.suggestion.questionId ||
          (!manual && !validRequests.has(data.suggestion.requestId))
        )
          break;
        if (
          !manual &&
          (data.suggestion.questionId !== state.question?.id ||
            data.suggestion.revision !== state.question?.revision)
        )
          break;
        if (manual) manualRequestId = undefined;
        if (data.suggestion.questionEndedAt !== undefined)
          data.suggestion.questionEndedAt = clock.local(data.suggestion.questionEndedAt);
        validRequests.delete(data.suggestion.requestId);
        state.suggestions = [data.suggestion, ...state.suggestions].slice(0, 3);
        state.cueDismissed = false;
        state.message = '';
        break;
      }
      case 'session.status':
        if (data.message) state.message = data.message;
        break;
      case 'session.error':
        if (
          data.questionId &&
          (data.questionId !== state.question?.id || data.revision !== state.question?.revision)
        )
          break;
        if (!data.requestId || state.preview?.requestId === data.requestId)
          state.preview = undefined;
        if (data.requestId && data.requestId !== state.currentRequestId) break;
        state.message = data.message;
        if (data.fatal) {
          retryable = data.retryable;
          retryAfterMs = data.retryAfterMs ?? 0;
          ws.close();
        }
        break;
      case 'session.stopped':
        stop();
        return;
    }
    if (data.type !== 'transcript.delta' && data.type !== 'telemetry.event') {
      const e = data as Record<string, any>;
      debugCue(data.type, {
        q: short(
          e.question?.id ?? e.suggestion?.questionId ?? e.preview?.questionId ?? e.questionId,
        ),
        rev: e.question?.revision ?? e.suggestion?.revision ?? e.preview?.revision ?? e.revision,
        state: e.question?.state,
        req: short(e.suggestion?.requestId ?? e.preview?.requestId ?? e.requestId),
        reason: e.reason || e.code,
      });
    }
    publish();
  };
  ws.onerror = () => {
    state.message = 'The connection to the AI service failed. Check your internet connection.';
  };
  ws.onclose = (event) => {
    if (expectedGeneration !== generation || socket !== ws) return;
    ready = false;
    gate?.reset();
    clearTimeout(connectTimer);
    clearTimeout(stableTimer);
    if (event.code === 1008) retryable = false;
    if (!retryable || attempts >= 3) {
      stop(state.message || 'The connection ended. Check your API keys in settings.');
      return;
    }
    recorder.add({
      kind: 'session.disconnected',
      at: monotonicEpoch(),
      sessionId: state.sessionId ?? '',
    });
    state.question = undefined;
    state.status = 'Reconnecting';
    state.generating = false;
    state.generatingMode = undefined;
    state.segments = [];
    state.transcriptHistory = [];
    state.transcriptTruncated = false;
    state.suggestions = [];
    state.preview = undefined;
    state.message = 'Connection lost. Reconnecting; speech during this gap is not recorded.';
    publish();
    const delay = Math.max([1000, 2000, 4000][attempts++], retryAfterMs);
    retryTimer = setTimeout(() => connect(expectedGeneration), delay);
  };
}
async function start(command: Extract<ExtensionCommand, { streamId: string }>) {
  if (state.active) throw new Error('A meeting is already active.');
  teardown();
  const current = generation;
  settings = command.settings;
  recorder.start(settings.testMode ?? false, monotonicEpoch());
  attempts = 0;
  state = {
    ...initialState(),
    active: true,
    status: 'Connecting',
    tabId: command.tabId,
    projectName: settings.project.name,
    testMode: settings.testMode ?? false,
  };
  publish();
  const alive = () => current === generation && state.active;
  try {
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: command.streamId },
      } as MediaTrackConstraints,
      video: false,
    });
    if (!alive()) {
      captured.getTracks().forEach((t) => t.stop());
      return;
    }
    tabStream = captured;
    tabStream.getAudioTracks()[0].onended = () =>
      stop('Meeting capture ended. Start again from the meeting tab.');
    const ac = (context = new AudioContext());
    await ac.resume();
    if (!alive()) return;
    const source = ac.createMediaStreamSource(captured);
    source.connect(ac.destination);
    await ac.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
    if (!alive()) return;
    gate = new AudioGate(
      (pcm) => {
        if (!ready || socket?.readyState !== SOCKET_OPEN) return;
        if (socket.bufferedAmount + pcm.byteLength > LIMITS.audioQueueBytes) {
          socket.close();
          return;
        }
        socket.send(pcm);
      },
      () => {
        if (ready) message('audio.commit');
      },
    );
    worklet = new AudioWorkletNode(ac, 'ignition-pcm');
    worklet.port.onmessage = (event) => {
      if (ready) gate?.frame(event.data as ArrayBuffer);
    };
    source.connect(worklet);
    const silent = ac.createGain();
    silent.gain.value = 0;
    worklet.connect(silent).connect(ac.destination);
    const detector = await createVAD(
      captured,
      ac,
      {
        speech: (value, speechAt) => {
          if (alive()) {
            tabSpeaking = value;
            if (ready) {
              // Commit the trailing audio before signaling ended speech. The
              // server must wait for its final transcript, even after a 15s chunk.
              if (!value) gate?.speech(false);
              message('meeting_speech.changed', {
                speaking: value,
                at: clock.server(monotonicEpoch()),
                speechAt: clock.server(speechAt ?? monotonicEpoch()),
              });
              if (value) gate?.speech(true);
            }
          }
        },
        level: (value) => {
          if (alive()) state.meetingLevel = value;
        },
      },
      settings!.project.preferences?.silenceMs ?? 700,
    );
    if (!alive()) {
      await detector.destroy();
      return;
    }
    tabVAD = detector;
    await detector.start();
    if (!alive()) return;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings!.microphoneId ? { exact: settings!.microphoneId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!alive()) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      micStream = mic;
      mic.getAudioTracks()[0].onended = () => {
        if (alive()) speaking(false, false);
      };
      const detector = await createVAD(mic, ac, {
        speech: (value) => {
          if (alive()) speaking(value, true);
        },
        level: (value) => {
          if (alive()) state.micLevel = value;
        },
      });
      if (!alive()) {
        await detector.destroy();
        return;
      }
      micVAD = detector;
      await detector.start();
      state.micAvailable = true;
    } catch {
      micStream?.getTracks().forEach((t) => t.stop());
      micStream = undefined;
      state.micAvailable = false;
    }
    if (alive()) connect(current);
  } catch {
    if (alive())
      stop(
        'Could not capture meeting audio. Check Chrome permissions, then start again from your Google Meet or Microsoft Teams tab.',
      );
  }
}
chrome.runtime.onMessage.addListener((command: ExtensionCommand, sender, respond) => {
  if (sender.id !== chrome.runtime.id || command.target !== 'offscreen') return;
  if (command.type === 'test.export') {
    respond(recorder.log ?? null);
    return;
  }
  if (command.type === 'test.clear') {
    recorder.clear();
    publish();
    respond({ ok: true });
    return;
  }
  if (command.type === 'answer.visible') {
    const cue = state.suggestions.find((s) => s.requestId === command.requestId);
    if (
      state.active &&
      command.sessionId === state.sessionId &&
      cue &&
      cue.questionId === state.question?.id &&
      cue.revision === state.question?.revision &&
      !rendered.has(cue.requestId) &&
      Number.isFinite(command.at)
    ) {
      rendered.add(cue.requestId);
      while (rendered.size > 1000) rendered.delete(rendered.values().next().value!);
      state.quickLatencyMs =
        cue.questionEndedAt === undefined
          ? undefined
          : Math.max(0, command.at - cue.questionEndedAt);
      recorder.add({
        kind: 'quick.visible',
        sessionId: state.sessionId!,
        questionId: cue.questionId,
        revision: cue.revision,
        requestId: cue.requestId,
        at: command.at,
        surface: command.surface,
        sourceAt: cue.questionEndedAt,
      });
      publish();
    }
    respond({ ok: true });
    return;
  }
  if (command.type === 'feedback') {
    const cue = state.suggestions.find((s) => s.requestId === command.requestId);
    if (cue)
      recorder.add({
        kind: 'feedback',
        at: monotonicEpoch(),
        sessionId: state.sessionId ?? '',
        requestId: cue.requestId,
        questionId: cue.questionId,
        revision: cue.revision,
        feedback: command.feedback,
      });
    publish();
    respond({ ok: !!cue });
    return;
  }
  if (command.type === 'snapshot') {
    respond(state);
    return;
  }
  if (command.type === 'stop') {
    stop();
    respond({ ok: true });
    return;
  }
  if (command.type === 'answer') {
    if (ready)
      message('recommendation.request', { questionId: command.questionId ?? state.question?.id });
    respond({ ok: ready });
    return;
  }
  if (command.type === 'dismiss') {
    if (state.suggestions[0]?.requestId === command.requestId) state.cueDismissed = true;
    state.suggestions = state.suggestions.filter((s) => s.requestId !== command.requestId);
    message('recommendation.dismiss', { requestId: command.requestId });
    publish();
    respond({ ok: true });
    return;
  }
  if (command.type === 'start') {
    void start(command)
      .then(() => respond({ ok: state.active }))
      .catch(() => respond({ error: 'Unable to start.' }));
    return true;
  }
});
setInterval(() => {
  if (!state.active) return;
  state.segments = pruneSegments(state.segments);
  if (micVAD?.errored && state.micAvailable) speaking(false, false);
  if (tabVAD?.errored) {
    stop('Meeting speech detector failed. Restart listening.');
    return;
  }
  publish();
}, 250);
