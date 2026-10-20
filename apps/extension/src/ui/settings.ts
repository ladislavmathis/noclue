import { emptyProject, type Settings } from '@noclue/shared';

/** Defaults for a new install. Not validated: an empty project is valid only as a draft. */
export const blank: Settings = {
  openaiKey: '',
  anthropicKey: '',
  answerProvider: 'openai',
  answerModel: '',
  microphoneId: '',
  project: emptyProject,
};

/** Stored settings from any version, with new fields defaulted and the old pairing token dropped. */
export function withDefaults(stored: unknown): Settings {
  const { token: _token, ...rest } = (stored ?? {}) as Record<string, unknown>;
  return { ...blank, ...rest } as Settings;
}

/** Reads settings from chrome.storage.local, defaulted. */
export async function loadSettings(): Promise<Settings | undefined> {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ? withDefaults(settings) : undefined;
}

/** Merges a patch into the stored settings without touching other fields. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...((await loadSettings()) ?? blank), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
