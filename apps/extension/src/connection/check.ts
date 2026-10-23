import { PROTOCOL_VERSION, APP_VERSION, aiSetupProblem, type Settings } from '@noclue/shared';
import { verifyKeys } from '@noclue/core';
import { openHub } from './transport';
export type ConnectionCheck = { ok: boolean; message: string };
/**
 * A user-triggered preflight. It never opens a microphone or tab stream. First a free key
 * test, then one short synthetic transcription connection and answer (a small API charge).
 */
export async function checkConnection(
  settings: Settings,
  signal?: AbortSignal,
): Promise<ConnectionCheck> {
  const problem = aiSetupProblem(settings);
  if (problem) return { ok: false, message: problem };
  // Test builds talk to a local fake hub; there is no real account to verify.
  const keys = __TEST_HUB_URL__
    ? []
    : await verifyKeys(settings, signal).catch((error: unknown) => {
        console.warn('[noclue] key check skipped', error);
        return [];
      });
  const failed = keys.find((k) => !k.ok);
  if (signal?.aborted) return { ok: false, message: 'Check cancelled.' };
  if (failed) return { ok: false, message: failed.message };
  return new Promise((resolve) => {
    const ws = openHub(settings);
    let settled = false;
    const finish = (result: ConnectionCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      ws.close();
      resolve(result);
    };
    const abort = () => finish({ ok: false, message: 'Check cancelled.' });
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          message: 'The check took too long. Check your internet connection and try again.',
        }),
      30000,
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION }));
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        finish({ ok: false, message: 'Something went wrong inside noclue. Try again.' });
        return;
      }
      if (message.type === 'authenticated') {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          finish({
            ok: false,
            message: `Reload noclue in chrome://extensions to finish updating to version ${APP_VERSION}.`,
          });
          return;
        }
        ws.send(JSON.stringify({ type: 'connection.check' }));
      }
      if (message.type === 'connection.checked')
        finish({ ok: true, message: 'Ready. Transcription and answers both work.' });
      if (message.type === 'session.error') finish({ ok: false, message: message.message });
    };
    ws.onclose = () => {
      if (!settled) finish({ ok: false, message: 'The check ended early. Try again in a moment.' });
    };
  });
}
