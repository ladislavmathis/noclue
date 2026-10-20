import type { Settings } from '@noclue/shared';
import { LocalSocket } from './local';

/** The WebSocket-shaped surface the meeting, check and practice code uses. */
export type HubSocket = Pick<
  WebSocket,
  | 'readyState'
  | 'bufferedAmount'
  | 'send'
  | 'close'
  | 'onopen'
  | 'onmessage'
  | 'onerror'
  | 'onclose'
>;
export const SOCKET_OPEN = 1;

/**
 * Production: the hub runs in this page (LocalSocket). Test builds only
 * (NOCLUE_TEST_HUB=1) connect to a local test hub that injects fake AI providers, so
 * browser tests exercise real tab capture, VAD and PCM without any API account.
 */
export function openHub(settings: Settings): HubSocket {
  if (__TEST_HUB_URL__) return new WebSocket(__TEST_HUB_URL__);
  return new LocalSocket(settings) as unknown as HubSocket;
}
