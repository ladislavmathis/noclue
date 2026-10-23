import {
  SettingsSchema,
  meetingPlatform,
  type ExtensionCommand,
  type PanelState,
} from '@noclue/shared';
import { mountCue } from './overlay';
let creating: Promise<void> | undefined;
const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.url?.startsWith(chrome.runtime.getURL('')) ?? false;
async function offscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification:
          'Capture meeting audio, preserve playback, and detect local microphone speech.',
      })
      .finally(() => {
        creating = undefined;
      });
  await creating;
}
chrome.runtime.onInstalled.addListener((details) => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  // First install: open the three-step setup guide (keys, microphone, data notice).
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL)
    void chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});
// Open from the toolbar event so Chrome grants activeTab to that Meet tab.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void chrome.sidePanel.open({ tabId: tab.id });
});
chrome.runtime.onMessage.addListener((message: ExtensionCommand, sender, respond) => {
  // Only the extension's own pages may drive the service worker. The cue window runs as a
  // content script in the meeting tab (sender.url is the meeting page) and talks to the
  // offscreen page. The side panel also reports a tab, so the URL is the reliable test.
  if (sender.id !== chrome.runtime.id || !fromExtensionPage(sender)) return;
  if (message.target !== 'background') return;
  void (async () => {
    if (message.type === 'setup' || message.type === 'guide') {
      const step = message.type === 'setup' ? '#microphone' : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL(`setup.html${step}`) });
      return { ok: true };
    }
    if (message.type === 'overlay') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !meetingPlatform(tab.url))
        throw new Error(
          'Select your Google Meet or Microsoft Teams tab and click the noclue toolbar icon first.',
        );
      if (await chrome.offscreen.hasDocument()) {
        const current = (await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'snapshot',
        })) as PanelState;
        if (current?.active && current.tabId !== tab.id)
          throw new Error('Open the meeting tab currently being captured to show its cue.');
      }
      // The document_start observer must already be present. mountCue refuses to show
      // content on an old tab that has not been reloaded since installation/update.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mountCue });
      return { ok: true };
    }
    if (message.type !== 'start') return { error: 'Unknown command' };
    const settings = SettingsSchema.parse(message.settings);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !meetingPlatform(tab.url))
      throw new Error(
        'Select your Google Meet or Microsoft Teams tab, then click the noclue toolbar icon.',
      );
    await offscreen();
    const state = (await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'snapshot',
    })) as PanelState;
    if (state?.active) throw new Error('A meeting is already active. Stop it first.');
    const streamId = await new Promise<string>((resolve, reject) =>
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(id);
      }),
    );
    return chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'start',
      settings,
      streamId,
      tabId: tab.id,
    });
  })()
    .then(respond)
    .catch((error) =>
      respond({ error: error instanceof Error ? error.message : 'Unable to start capture.' }),
    );
  return true;
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('offscreen.html'))
    return;
  if (message.target === 'panel' && message.type === 'state' && message.state?.tabId)
    void chrome.tabs
      .sendMessage(message.state.tabId, {
        target: 'cue',
        state: {
          ...message.state,
          segments: [],
          transcriptHistory: [],
          suggestions: message.state.suggestions,
        },
      })
      .catch(() => {});
});
async function stopForTab(tabId: number) {
  if (!(await chrome.offscreen.hasDocument())) return;
  const state = (await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'snapshot',
  })) as PanelState;
  if (state?.tabId === tabId && state.active)
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
}
chrome.tabs.onRemoved.addListener((id) => {
  void stopForTab(id).catch(() => {});
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status === 'loading') void stopForTab(id).catch(() => {});
});
