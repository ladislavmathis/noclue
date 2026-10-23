import type { TestLog, TimelineEvent } from '@noclue/shared';
export const monotonicEpoch = () => performance.timeOrigin + performance.now();
export class SessionRecorder {
  log?: TestLog;
  private chars = 0;
  readonly diagnostics: TimelineEvent[] = [];
  start(enabled: boolean, at: number) {
    this.clear();
    if (enabled) this.log = { version: 2, startedAt: at, events: [], truncated: false };
  }
  add(event: TimelineEvent) {
    const { question, answer, facts, claims, reason, ...metadata } = event;
    this.diagnostics.push(metadata);
    if (this.diagnostics.length > 2000) this.diagnostics.shift();
    if (!this.log || this.log.truncated) return;
    const size = JSON.stringify(event).length;
    if (this.log.events.length >= 6000 || this.chars + size > 4_000_000) {
      this.log.truncated = true;
      return;
    }
    this.chars += size;
    this.log.events.push(event);
  }
  stop() {
    this.clear();
  }
  clear() {
    this.diagnostics.length = 0;
    this.log = undefined;
    this.chars = 0;
  }
}
// One request/reply establishes a server-to-extension offset. RTT/2 is the
// uncertainty of backend timestamps; speech and render use the browser epoch.
export class ClockSync {
  offset = 0;
  uncertainty = Infinity;
  receive(sentAt: number, serverAt: number, receivedAt: number) {
    const half = (receivedAt - sentAt) / 2;
    if (half >= 0 && half < this.uncertainty) {
      this.offset = serverAt - (sentAt + receivedAt) / 2;
      this.uncertainty = half;
    }
  }
  local(serverAt: number) {
    return serverAt - this.offset;
  }
  server(localAt: number) {
    return localAt + this.offset;
  }
}
