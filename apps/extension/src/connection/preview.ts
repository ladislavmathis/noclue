import { PROTOCOL_VERSION, APP_VERSION, aiSetupProblem } from '@noclue/shared';
import { openHub } from './transport';
import { QuickDecisionSchema, DecisionSchema, type Decision, type Settings } from '@noclue/shared';
export function previewContext(
  settings: Settings,
  question: string,
  signal: AbortSignal,
): Promise<Decision> {
  return new Promise((resolve, reject) => {
    const problem = aiSetupProblem(settings);
    if (problem) {
      reject(new Error(problem));
      return;
    }
    const ws = openHub(settings);
    let settled = false;
    const finish = (error?: Error, decision?: Decision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      ws.close();
      if (error) reject(error);
      else resolve(decision!);
    };
    const abort = () => finish(new Error('Practice cancelled.'));
    const timer = setTimeout(
      () =>
        finish(new Error('Practice took too long. Check your internet connection and try again.')),
      20000,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: 'authenticate',
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'authenticated' && message.protocolVersion !== PROTOCOL_VERSION) {
          finish(
            new Error(
              `Reload noclue in chrome://extensions to finish updating to version ${APP_VERSION}.`,
            ),
          );
          return;
        }
        if (message.type === 'authenticated')
          ws.send(JSON.stringify({ type: 'context.preview', project: settings.project, question }));
        if (message.type === 'context.preview.ready')
          finish(undefined, DecisionSchema.or(QuickDecisionSchema).parse(message.decision));
        if (message.type === 'session.error') finish(new Error(message.message));
      } catch {
        finish(new Error('Unexpected practice response. Try again.'));
      }
    };
    ws.onclose = () => finish(new Error('Practice ended before the answer was ready. Try again.'));
  });
}
