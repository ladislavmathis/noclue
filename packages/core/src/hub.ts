// The former local backend, now transport-agnostic. It runs inside the extension
// (offscreen document for meetings, side panel for checks) and speaks the same message
// protocol the WebSocket server did, so the UI code is unchanged. There is no port,
// origin or pairing token any more: nothing listens on the network.
import {
  APP_VERSION,
  LIMITS,
  PROTOCOL_VERSION,
  ClientMessageSchema,
  type ServerEvent,
} from '@noclue/shared';
import { MeetingSession } from './sessions/session.js';
import { safeError, type Recommend } from './recommendations/provider.js';
import type { Transcriber, TranscriberFactory } from './realtime/transcriber.js';
export type HubConfig = {
  model?: string;
  configured: boolean;
  /** Plain-language reason shown when configured is false. */
  setupProblem?: string;
  recommend: Recommend;
  transcriber: TranscriberFactory;
  /** Content-free event-flow logging (identities and states only). */
  debug?: boolean;
};
/** What the hub needs from the page side: deliver an event, or end the connection. */
export type HubTransport = {
  send(event: ServerEvent): void;
  close(code: number, reason: string): void;
};
export type HubConnection = {
  /** A JSON text frame or a binary PCM16 frame from the page. */
  receive(data: string | ArrayBuffer | Uint8Array): void;
  /** The page closed the connection. */
  closed(): void;
};
// One meeting or check at a time per extension page, like the single backend before.
let owner: symbol | undefined;
const short = (id?: string) => id?.slice(0, 8);
/** Debug mode: event flow with identities and states only — never transcript or answer text. */
function debugEvent(event: ServerEvent) {
  const e = event as Record<string, any>;
  if (e.type === 'transcript.delta') return;
  const fields: Record<string, unknown> = {};
  if (e.question)
    Object.assign(fields, {
      q: short(e.question.id),
      rev: e.question.revision,
      state: e.question.state,
    });
  if (e.suggestion)
    Object.assign(fields, {
      req: short(e.suggestion.requestId),
      q: short(e.suggestion.questionId),
      rev: e.suggestion.revision,
      mode: e.suggestion.mode,
    });
  if (e.preview)
    Object.assign(fields, {
      req: short(e.preview.requestId),
      q: short(e.preview.questionId),
      rev: e.preview.revision,
    });
  if (e.segment) Object.assign(fields, { seg: short(e.segment.id), final: e.segment.final });
  // Test-mode telemetry reasons can carry review text; keep only short code-like reasons.
  if (e.event)
    Object.assign(fields, {
      kind: e.event.kind,
      req: short(e.event.requestId),
      reason: /^[\w .'-]{1,60}$/.test(e.event.reason ?? '') ? e.event.reason : undefined,
    });
  for (const k of ['requestId', 'questionId'] as const)
    if (e[k]) fields[k === 'requestId' ? 'req' : 'q'] = short(e[k]);
  for (const k of ['revision', 'mode', 'reason', 'code'])
    if (e[k] !== undefined) fields[k === 'revision' ? 'rev' : k] = e[k];
  console.log(new Date().toISOString().slice(11, 23), e.type, JSON.stringify(fields));
}
export function connectHub(config: HubConfig, transport: HubTransport): HubConnection {
  let authenticated = false,
    session: MeetingSession | undefined,
    transcriber: Transcriber | undefined,
    ready = false,
    closed = false,
    checking = false;
  let checkController: AbortController | undefined;
  const identity = Symbol('connection');
  const socket = {
    close(code: number, reason: string) {
      if (closed) return;
      closed = true;
      cleanup();
      transport.close(code, reason);
    },
  };
  const send = (event: ServerEvent) => {
    if (config.debug) debugEvent(event);
    if (!closed) transport.send(event);
  };
  const cleanup = () => {
    ready = false;
    checking = false;
    checkController?.abort();
    checkController = undefined;
    session?.stop();
    session = undefined;
    transcriber?.close();
    transcriber = undefined;
    if (owner === identity) owner = undefined;
  };
  const fatal = (error: unknown) => {
    const problem = safeError(error);
    session?.failPipeline(problem.code, problem.message);
    send({
      type: 'session.error',
      sessionId: session?.id,
      code: problem.code,
      message: problem.message,
      fatal: true,
      retryable: problem.retryable,
      retryAfterMs: problem.retryAfterMs,
    });
    cleanup();
    socket.close(1011, 'Session ended');
  };
  const receive = (raw: string | ArrayBuffer | Uint8Array) => {
    if (closed) return;
    if (typeof raw !== 'string') {
      if (!authenticated || !ready || !transcriber) {
        socket.close(1008, 'Audio not allowed');
        return;
      }
      const audio = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      if (audio.length % 2 || audio.length > 9600) {
        socket.close(1008, 'Invalid PCM frame');
        return;
      }
      transcriber.append(audio);
      return;
    }
    let message;
    try {
      message = ClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      socket.close(1008, 'Invalid message');
      return;
    }
    if (!authenticated) {
      if (message.type !== 'authenticate') {
        socket.close(1008, 'Authentication required');
        return;
      }
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        send({
          type: 'session.error',
          code: 'PROTOCOL_VERSION',
          message: `Reload noclue in chrome://extensions to finish updating to version ${APP_VERSION}.`,
          fatal: true,
          retryable: false,
        });
        socket.close(1008, 'Protocol version mismatch');
        return;
      }
      authenticated = true;
      send({ type: 'authenticated', protocolVersion: PROTOCOL_VERSION });
      return;
    }
    if (message.type === 'authenticate') {
      socket.close(1008, 'Already authenticated');
      return;
    }
    if (message.type === 'clock.sync') {
      send({ type: 'clock.synced', sentAt: message.sentAt, serverAt: Date.now() });
      return;
    }
    if (message.type === 'connection.check' || message.type === 'context.preview') {
      const preview = message.type === 'context.preview';
      const question =
        message.type === 'context.preview'
          ? message.question
          : 'What should we clarify before planning a project?';
      if (owner || checking) {
        send({
          type: 'session.error',
          code: 'SESSION_BUSY',
          message: 'Stop the active meeting before checking the connection.',
          fatal: false,
          retryable: false,
        });
        return;
      }
      if (!config.configured) {
        send({
          type: 'session.error',
          code: 'NOT_CONFIGURED',
          message: config.setupProblem ?? 'Add your API key in noclue settings.',
          fatal: true,
          retryable: false,
        });
        socket.close(1008, 'Not configured');
        return;
      }
      owner = identity;
      checking = true;
      const controller = (checkController = new AbortController());
      const timeout = setTimeout(() => controller.abort(), LIMITS.requestMs);
      const project =
        message.type === 'context.preview'
          ? message.project
          : {
              name: 'Connection check',
              role: '',
              goal: 'Verify API access',
              context: 'Connection check only. No real project facts supplied.',
              keywords: [],
            };
      void (async () => {
        try {
          if (!preview) {
            transcriber = config.transcriber(project, () => {}, fatal);
            await transcriber.connect();
          }
          if (closed || !checking) return;
          const decision = await config.recommend(
            {
              project,
              segments: [
                {
                  id: 'check',
                  sequence: 0,
                  text: question,
                  at: Date.now(),
                  final: true,
                },
              ],
              recent: [],
              mode: 'manual',
              level: 'QUICK',
            },
            controller.signal,
          );
          if (!closed && checking && !controller.signal.aborted)
            send(
              preview
                ? { type: 'context.preview.ready', decision }
                : { type: 'connection.checked' },
            );
          else if (!closed && checking) throw new Error('Preflight timed out');
        } catch (error) {
          if (!closed && checking) fatal(error);
        } finally {
          clearTimeout(timeout);
          cleanup();
          if (!closed) socket.close(1000, 'Check complete');
        }
      })();
      return;
    }
    if (message.type === 'session.start') {
      if (owner || session) {
        send({
          type: 'session.error',
          code: 'SESSION_BUSY',
          message: 'Another meeting is already active.',
          fatal: true,
          retryable: false,
        });
        socket.close(1008, 'Busy');
        return;
      }
      if (!config.configured) {
        send({
          type: 'session.error',
          code: 'NOT_CONFIGURED',
          message: config.setupProblem ?? 'Add your API key in noclue settings.',
          fatal: true,
          retryable: false,
        });
        socket.close(1008, 'Not configured');
        return;
      }
      owner = identity;
      const created = (session = new MeetingSession(
        message.sessionId,
        message.project,
        message.micAvailable,
        config.recommend,
        send,
        message.testMode ?? false,
        config.model,
      ));
      try {
        transcriber = config.transcriber(message.project, (s) => created.transcript(s), fatal);
      } catch (error) {
        fatal(error);
        return;
      }
      void transcriber
        .connect()
        .then(() => {
          if (closed || session !== created) return;
          ready = true;
          send({ type: 'session.ready', sessionId: created.id });
        })
        .catch((error) => {
          if (!closed && session === created) fatal(error);
        });
      return;
    }
    if (!session || message.sessionId !== session.id) {
      socket.close(1008, 'Unknown session');
      return;
    }
    switch (message.type) {
      case 'meeting_speech.changed':
        if (ready) session.meetingSpeech(message.speaking, message.speechAt);
        break;
      case 'audio.commit':
        if (ready) {
          const current = session;
          transcriber?.commit((sequence) => current.audioCommitted(sequence));
        }
        break;
      case 'self_speech.changed':
        session.selfSpeech(message.speaking, message.available);
        break;
      case 'recommendation.request':
        session.answer(message.questionId);
        break;
      case 'recommendation.dismiss':
        session.dismiss(message.requestId);
        break;
      case 'session.stop': {
        const id = session.id;
        cleanup();
        send({ type: 'session.stopped', sessionId: id });
        socket.close(1000, 'Stopped');
        break;
      }
    }
  };
  return {
    receive,
    closed() {
      if (closed) return;
      closed = true;
      cleanup();
    },
  };
}
