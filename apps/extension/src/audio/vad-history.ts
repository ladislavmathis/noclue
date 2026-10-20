// vad-web 0.0.31 retains full utterance audio for its onSpeechEnd callback.
// Ignition only consumes activity, never that recording. Keep the last 64
// Silero v5 frames (~2 seconds, 128 KiB), preserving all detector counters.
// This narrow adapter intentionally targets the pinned library version.
// Its private integration is checked at startup and exercised against the
// actual FrameProcessor in tests; revisit it before upgrading vad-web.
export function boundedVADHistory(detector: unknown): () => void {
  const processor = (detector as { frameProcessor?: { audioBuffer?: unknown[] } }).frameProcessor;
  if (!processor || !Array.isArray(processor.audioBuffer))
    throw new Error('Unsupported speech detector runtime. Rebuild with the pinned VAD version.');
  return () => {
    const frames = processor.audioBuffer!;
    // Called before the library appends the current frame.
    if (frames.length >= 64) frames.splice(0, frames.length - 63);
  };
}
