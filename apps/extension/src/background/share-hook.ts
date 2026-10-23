/**
 * Runs at document_start in the meeting page's MAIN world so it sees the same
 * navigator.mediaDevices that Google Meet and Teams call when the user presents. It only
 * observes: the page gets the identical stream back, nothing is recorded or sent anywhere.
 * Each share start and end is announced as a 'noclue:share' DOM event carrying a JSON string
 * (strings cross from the MAIN world to the extension's isolated world unchanged), which the
 * cue window uses to hide itself. Serialized by chrome.scripting: keep it self-contained.
 */
export function hookDisplayMedia() {
  const page = window as unknown as { __noclueShareHook?: boolean };
  const media = navigator.mediaDevices;
  if (page.__noclueShareHook || typeof media?.getDisplayMedia !== 'function') return;
  page.__noclueShareHook = true;
  const original = media.getDisplayMedia.bind(media);
  const active = new Map<number, string>();
  let next = 0;
  const notify = (detail: { id: number; active: boolean; surface: string }) =>
    document.dispatchEvent(new CustomEvent('noclue:share', { detail: JSON.stringify(detail) }));
  // The observer outlives the cue. Replay active shares whenever a cue is opened again.
  document.addEventListener('noclue:share-query', () => {
    document.dispatchEvent(
      new CustomEvent('noclue:share-state', { detail: JSON.stringify([...active]) }),
    );
  });
  media.getDisplayMedia = async (...args: Parameters<MediaDevices['getDisplayMedia']>) => {
    const stream = await original(...args);
    const track = stream.getVideoTracks()[0];
    if (!track) return stream;
    const id = ++next;
    // Unknown surfaces are treated like a whole-screen share by the cue.
    const surface = String(
      (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface ??
        'unknown',
    );
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      active.delete(id);
      notify({ id, active: false, surface });
    };
    active.set(id, surface);
    notify({ id, active: true, surface });
    // 'ended' fires when the user stops sharing from Chrome's bar; stop() is how the meeting
    // app ends it itself, and fires no event.
    track.addEventListener('ended', end, { once: true });
    const stop = track.stop.bind(track);
    track.stop = () => {
      stop();
      end();
    };
    return stream;
  };
}
