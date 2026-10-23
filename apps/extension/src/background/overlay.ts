import type { PanelState } from '@noclue/shared';

// Serialized by chrome.scripting: keep all runtime dependencies inside this function.
export async function mountCue() {
  // The isolated world keeps its globals between injections. A popped-out cue lives in the
  // Picture-in-Picture document, where getElementById on the page cannot find it.
  const world = globalThis as unknown as { __noclueCue?: { pip: Window | null } };
  if (world.__noclueCue?.pip && !world.__noclueCue.pip.closed) {
    world.__noclueCue.pip.focus();
    return;
  }
  const existing = document.getElementById('noclue-cue');
  if (existing) {
    existing.style.display = 'block';
    return;
  }
  // Query before adding any UI: a share may already be active when this cue opens.
  // DOM events are synchronous across the MAIN and isolated worlds. A missing reply
  // means this tab predates the observer; do not expose a cue without observation.
  let initialShares: [number, string][] | undefined;
  const snapshot = (event: Event) => {
    try {
      const value: unknown = JSON.parse(String((event as CustomEvent).detail));
      if (
        Array.isArray(value) &&
        value.every(
          (entry) =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            Number.isSafeInteger(entry[0]) &&
            typeof entry[1] === 'string',
        )
      )
        initialShares = value;
    } catch {
      /* Ignore unrelated page events. */
    }
  };
  document.addEventListener('noclue:share-state', snapshot);
  document.dispatchEvent(new CustomEvent('noclue:share-query'));
  document.removeEventListener('noclue:share-state', snapshot);
  if (!initialShares)
    throw new Error(
      'Reload your meeting tab before showing the cue so screen-share detection is active.',
    );
  const cueState: { pip: Window | null } = { pip: null };
  world.__noclueCue = cueState;
  // Fonts declared inside a shadow root are ignored, so Manrope is declared on the page
  // under a private family name. The file is served from the extension (no CDN).
  if (!document.getElementById('noclue-cue-font')) {
    const font = document.createElement('style');
    font.id = 'noclue-cue-font';
    font.textContent = ['latin', 'latin-ext']
      .map(
        (subset) =>
          `@font-face{font-family:'noclue Manrope';font-weight:200 800;font-display:swap;src:url('${chrome.runtime.getURL(`fonts/manrope-${subset}-wght-normal.woff2`)}') format('woff2-variations')}`,
      )
      .join('');
    document.documentElement.append(font);
  }
  const host = document.createElement('div');
  host.id = 'noclue-cue';
  host.style.cssText =
    'position:fixed;top:20px;left:20px;width:400px;height:290px;z-index:2147483647;min-width:260px;min-height:160px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);resize:both;overflow:hidden;border-radius:20px;';
  const root = host.attachShadow({ mode: 'open' });
  // Always dark: the cue sits over meeting video. Tokens from the noclue design manual.
  root.innerHTML = `<style>
    :host{--ink:#171717;--card:#201f1e;--paper:#F5F4F0;--muted:#B8B1AB;--line:#3a3633;--accent:#FF7A3C;font:500 14px/1.5 'noclue Manrope',system-ui,sans-serif;color:var(--paper);color-scheme:dark}
    *{box-sizing:border-box}section{position:relative;height:100%;display:flex;flex-direction:column;background:var(--ink);border:1px solid var(--line);border-radius:20px;overflow:hidden}
    header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:move;user-select:none}
    header strong{flex:1;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;letter-spacing:-.01em;color:var(--paper)}header strong svg{flex:0 0 18px}
    button{font:inherit;font-weight:700;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 10px;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible,header:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    #answer{background:var(--accent);border-color:var(--accent);color:var(--ink)}#pop.suggest{border-color:var(--accent);color:var(--accent)}:host([data-popout]) header{cursor:default}:host([data-popout]) #min{display:none}
    .body{padding:12px 16px;overflow:auto;flex:1}.status{font-size:12px;font-weight:600;color:var(--muted);margin:0 0 8px}.answer{font-size:18px;font-weight:600;line-height:1.45;white-space:pre-wrap;margin:0}.advice{font-size:13px;color:var(--muted);margin:8px 0}
    .draft{font-size:12px;font-weight:700;color:var(--accent);margin:0 0 6px}
    .body{min-height:96px}footer button{font-size:12px;padding:3px 8px;border-radius:8px}footer{flex-shrink:0;padding:6px 10px 12px;display:flex;align-items:center;gap:5px;border-top:1px solid var(--line);flex-wrap:wrap}label{font-size:11px;font-weight:600;color:var(--muted);display:flex;align-items:center;gap:6px}input{width:64px;accent-color:var(--accent)}.privacy{font-size:11px;color:var(--muted);margin:4px 0 0}.ver{position:absolute;right:22px;bottom:4px;font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums;pointer-events:none}.answer.unverified{opacity:.7;font-style:italic}
    .history{list-style:none;margin:12px 0 0;padding:10px 0 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}.history[hidden]{display:none}.history li{opacity:.65;display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:start}.history .h-question{grid-column:1;font-size:12px;color:var(--muted);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history .h-answer{grid-column:1;font-size:13px;line-height:1.4;white-space:pre-wrap;margin:0}.history .h-copy{grid-column:2;grid-row:1/3;font-size:12px;padding:2px 8px}
  </style><section aria-label="noclue cue window"><header tabindex="0" aria-label="Move cue window with arrow keys"><strong><svg viewBox="0 0 100 100" width="18" height="18" aria-hidden="true"><defs><linearGradient id="nc-cue-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7A3C"/><stop offset="1" stop-color="#F35216"/></linearGradient></defs><rect width="100" height="100" rx="25" fill="url(#nc-cue-g)"/><g transform="translate(19 19) scale(.62)"><path d="M30 34 A20 20 0 1 1 58 52 Q50 57 50 66 L50 70" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/><circle cx="50" cy="88" r="9" fill="#fff"/></g></svg>noclue</strong><button id="pop" aria-label="Pop out cue window" title="Open in a separate window that tab and window shares do not show" hidden>Pop out</button><button id="min" aria-label="Minimize cue">−</button><button id="close" aria-label="Hide cue">×</button></header><div class="body"><p class="status">Ready</p><p class="question" style="font-size:12px;color:var(--muted)"></p><p class="draft" hidden>Draft · adapt it to you</p><p class="answer">Your next cue will appear here.</p><p class="advice"></p><ul class="history" hidden aria-label="Earlier answers"></ul></div><footer><button id="answer" disabled>Answer Now</button><button id="stop" disabled>Stop</button><button id="copy" disabled>Copy response</button><button id="dismiss" disabled>Dismiss</button><button data-feedback="helpful" aria-label="Helpful">👍</button><button data-feedback="unhelpful" aria-label="Not helpful">👎</button><button data-feedback="slow">Too slow</button><button data-feedback="long">Too long</button><button data-feedback="wrong">Wrong</button><label>Opacity<input id="opacity" type="range" min="45" max="100" value="90" aria-label="Cue opacity"/></label><p class="privacy">Pop out to keep the cue off shared tabs and windows. Auto-hide is best effort. The meeting page can read this cue; use the side panel for sensitive information.</p></footer><span class="ver" data-testid="cue-version">v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}</span></section>`;
  const el = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  let minimized = false,
    previousHeight = 290,
    closed = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const clamp = () => {
    if (cueState.pip) return;
    const r = host.getBoundingClientRect();
    host.style.left = `${Math.max(8, Math.min(r.left, innerWidth - r.width - 8))}px`;
    host.style.top = `${Math.max(8, Math.min(r.top, innerHeight - r.height - 8))}px`;
  };
  const save = () => {
    if (cueState.pip) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const r = host.getBoundingClientRect();
      void chrome.storage.local.set({
        cueLayout: {
          x: r.left,
          y: r.top,
          width: r.width,
          height: minimized ? previousHeight : r.height,
          opacity: Number(el<HTMLInputElement>('#opacity').value),
          popout: preferPopout,
        },
      });
    }, 250);
  };
  const saved = (await chrome.storage.local.get('cueLayout')).cueLayout;
  let preferPopout = saved?.popout === true;
  if (saved) {
    for (const [key, property, fallback] of [
      ['x', 'left', 20],
      ['y', 'top', 20],
      ['width', 'width', 400],
      ['height', 'height', 290],
    ] as const) {
      const n = Number(saved[key]);
      host.style[property] = `${Number.isFinite(n) ? n : fallback}px`;
    }
    const opacity = Number(saved.opacity);
    el<HTMLInputElement>('#opacity').value = String(
      Number.isFinite(opacity) ? Math.max(45, Math.min(100, opacity)) : 90,
    );
  }
  host.style.opacity = String(Number(el<HTMLInputElement>('#opacity').value) / 100);
  el<HTMLInputElement>('#opacity').oninput = () => {
    host.style.opacity = String(Number(el<HTMLInputElement>('#opacity').value) / 100);
    save();
  };
  const header = el('header');
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  header.onpointerdown = (e) => {
    if (cueState.pip || (e.target as HTMLElement).closest('button')) return;
    const r = host.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    header.setPointerCapture(e.pointerId);
  };
  header.onpointermove = (e) => {
    if (!drag) return;
    host.style.left = `${drag.left + e.clientX - drag.x}px`;
    host.style.top = `${drag.top + e.clientY - drag.y}px`;
    clamp();
  };
  header.onpointerup = () => {
    drag = undefined;
    save();
  };
  header.onpointercancel = () => {
    drag = undefined;
  };
  header.onkeydown = (e) => {
    if (
      cueState.pip ||
      e.target !== header ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    )
      return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const step = e.shiftKey ? 30 : 10;
    host.style.left = `${r.left + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0)}px`;
    host.style.top = `${r.top + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0)}px`;
    clamp();
    save();
  };
  el('#min').onclick = () => {
    minimized = !minimized;
    if (minimized) {
      previousHeight = host.getBoundingClientRect().height;
      host.style.minHeight = '44px';
      host.style.height = '44px';
    } else {
      host.style.minHeight = '160px';
      host.style.height = `${previousHeight}px`;
    }
    el('.body').style.display = minimized ? 'none' : '';
    el('footer').style.display = minimized ? 'none' : '';
    el('#min').textContent = minimized ? '+' : '−';
    el('#min').setAttribute('aria-label', minimized ? 'Expand cue' : 'Minimize cue');
    clamp();
  };
  // Screen shares started from this page, announced by hookDisplayMedia in the MAIN world.
  const shares = new Map<number, string>(initialShares);
  let shareHidden = false;
  const cueVisible = () =>
    !shareHidden && (cueState.pip ? true : document.visibilityState === 'visible');
  const applyShares = () => {
    const surfaces = [...shares.values()];
    // In the page, any share may show the cue (the shared tab could be this one). The PiP
    // window is its own OS window: only a whole-screen share (or an unknown surface) shows it.
    const hide = cueState.pip
      ? surfaces.some((surface) => surface !== 'browser' && surface !== 'window')
      : surfaces.length > 0;
    if (hide === shareHidden) return;
    shareHidden = hide;
    host.style.visibility = hide ? 'hidden' : '';
    if (cueState.pip) cueState.pip.document.body.style.visibility = hide ? 'hidden' : '';
    void chrome.runtime
      .sendMessage({ target: 'panel', type: 'cue.share', hidden: hide })
      .catch(() => {});
    if (!hide) acknowledge();
  };
  const onShare = (event: Event) => {
    try {
      const detail = JSON.parse(String((event as CustomEvent).detail)) as {
        id: number;
        active: boolean;
        surface: string;
      };
      if (
        !Number.isSafeInteger(detail.id) ||
        typeof detail.active !== 'boolean' ||
        typeof detail.surface !== 'string'
      )
        return;
      if (detail.active) shares.set(detail.id, detail.surface);
      else shares.delete(detail.id);
      applyShares();
    } catch {
      // Not ours: ignore.
    }
  };
  document.addEventListener('noclue:share', onShare);
  // Storage reads above yield. Refresh after subscribing to cover shares started or
  // stopped during those reads, before the cue is attached or contains private text.
  document.addEventListener('noclue:share-state', snapshot);
  document.dispatchEvent(new CustomEvent('noclue:share-query'));
  document.removeEventListener('noclue:share-state', snapshot);
  shares.clear();
  for (const [id, surface] of initialShares) shares.set(id, surface);
  // Initial hiding cannot acknowledge an answer: rendering has not started yet.
  shareHidden = shares.size > 0;
  host.style.visibility = shareHidden ? 'hidden' : '';
  document.documentElement.append(host);
  clamp();
  if (shareHidden)
    void chrome.runtime
      .sendMessage({ target: 'panel', type: 'cue.share', hidden: true })
      .catch(() => {});
  // Document Picture-in-Picture: an always-on-top window that is not part of the meeting tab,
  // so tab and window shares do not include it. It needs a click in this page every time.
  const pictureInPicture = (
    window as unknown as {
      documentPictureInPicture?: {
        requestWindow(o: { width: number; height: number }): Promise<Window>;
      };
    }
  ).documentPictureInPicture;
  const popButton = el<HTMLButtonElement>('#pop');
  popButton.hidden = !pictureInPicture;
  popButton.classList.toggle('suggest', preferPopout);
  let pageStyle = '';
  const restore = () => {
    const pip = cueState.pip;
    if (!pip) return;
    cueState.pip = null;
    host.removeAttribute('data-popout');
    if (closed) return;
    host.style.cssText = pageStyle;
    host.style.opacity = String(Number(el<HTMLInputElement>('#opacity').value) / 100);
    document.documentElement.append(host);
    popButton.textContent = 'Pop out';
    popButton.setAttribute('aria-label', 'Pop out cue window');
    clamp();
    applyShares();
  };
  popButton.onclick = async () => {
    if (cueState.pip) {
      cueState.pip.close();
      return;
    }
    if (!pictureInPicture) return;
    const r = host.getBoundingClientRect();
    let pip: Window;
    try {
      pip = await pictureInPicture.requestWindow({
        width: Math.round(r.width),
        height: Math.round(minimized ? previousHeight : r.height),
      });
    } catch {
      el('.status').textContent = 'Could not open a separate window. Try Pop out again.';
      return;
    }
    if (minimized) el<HTMLButtonElement>('#min').click();
    preferPopout = true;
    popButton.classList.remove('suggest');
    clearTimeout(saveTimer);
    void chrome.storage.local
      .get('cueLayout')
      .then(({ cueLayout }) =>
        chrome.storage.local.set({ cueLayout: { ...(cueLayout ?? {}), popout: true } }),
      );
    const font = document.getElementById('noclue-cue-font');
    if (font) pip.document.head.append(font.cloneNode(true));
    pip.document.title = 'noclue cue';
    pip.document.body.style.cssText = 'margin:0;background:#171717;overflow:hidden';
    pageStyle = host.style.cssText;
    host.setAttribute('data-popout', '');
    host.style.cssText = `position:static;width:100vw;height:100vh;resize:none;border-radius:0;overflow:hidden;opacity:${host.style.opacity}`;
    cueState.pip = pip;
    pip.document.body.append(host);
    popButton.textContent = 'Back';
    popButton.setAttribute('aria-label', 'Return cue window to the meeting page');
    pip.addEventListener('pagehide', restore, { once: true });
    applyShares();
    acknowledge();
  };
  let current: PanelState | undefined;
  let lastRendered = '',
    pendingRender = '',
    lastHistoryKey = '';
  const acknowledge = () => {
    const cue = current?.suggestions[0];
    if (
      !cue ||
      (current?.currentRequestId && cue.requestId !== current.currentRequestId) ||
      cue.questionId !== current?.question?.id ||
      cue.revision !== current?.question?.revision ||
      !current?.active ||
      minimized ||
      closed ||
      !cueVisible() ||
      cue.requestId === lastRendered ||
      pendingRender === cue.requestId
    )
      return;
    pendingRender = cue.requestId;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pendingRender = '';
        if (
          closed ||
          minimized ||
          !cueVisible() ||
          current?.suggestions[0]?.requestId !== cue.requestId ||
          current?.question?.id !== cue.questionId ||
          current?.question?.revision !== cue.revision ||
          (current?.currentRequestId && current.currentRequestId !== cue.requestId) ||
          !current.active
        )
          return;
        lastRendered = cue.requestId;
        void chrome.runtime
          .sendMessage({
            target: 'offscreen',
            type: 'answer.visible',
            sessionId: current.sessionId,
            requestId: cue.requestId,
            at: performance.timeOrigin + performance.now(),
            surface: 'overlay',
          })
          .catch(() => {});
      }),
    );
  };
  document.addEventListener('visibilitychange', acknowledge);
  const update = (state: PanelState) => {
    current = state;
    if (closed) return;
    // Mirrors visibleCue() from @noclue/shared, which this injected function cannot import:
    // the newest answer stays until a newer answer or its draft replaces it.
    const preview =
      state.active &&
      state.preview &&
      state.preview.requestId === state.currentRequestId &&
      state.preview.questionId === state.question?.id &&
      state.preview.revision === state.question?.revision
        ? state.preview
        : undefined;
    const cue = state.active && !preview && !state.cueDismissed ? state.suggestions[0] : undefined;
    const history = state.active
      ? (cue ? state.suggestions.slice(1) : state.suggestions).slice(0, 2)
      : [];
    const historyKey = history.map((s) => s.requestId).join('\n');
    if (historyKey !== lastHistoryKey) {
      lastHistoryKey = historyKey;
      const list = el<HTMLUListElement>('.history');
      // textContent only: answers are model output.
      list.replaceChildren(
        ...history.map((s) => {
          const item = document.createElement('li');
          item.dataset.requestId = s.requestId;
          const question = document.createElement('p');
          question.className = 'h-question';
          question.textContent = s.question ?? '';
          question.title = s.question ?? '';
          const answer = document.createElement('p');
          answer.className = 'h-answer';
          answer.textContent = s.suggestedResponse;
          const copy = document.createElement('button');
          copy.className = 'h-copy';
          copy.setAttribute('aria-label', 'Copy earlier response');
          copy.textContent = 'Copy';
          copy.onclick = () => {
            void (cueState.pip?.navigator ?? navigator).clipboard
              .writeText(s.suggestedResponse)
              .catch(() => {
                el('.status').textContent = 'Select and copy the response.';
              });
          };
          item.append(question, answer, copy);
          return item;
        }),
      );
      list.hidden = history.length === 0;
    }
    el('.status').textContent = preview
      ? 'Checking facts… (unverified draft)'
      : state.generating
        ? 'Preparing your cue…'
        : state.question?.state === 'FAILED'
          ? 'Could not finish. Try Answer Now.'
          : state.status;
    el('.question').textContent = cue?.question ?? state.question?.text ?? '';
    el<HTMLButtonElement>('#copy').disabled = !cue;
    el<HTMLButtonElement>('#dismiss').disabled = !cue;
    acknowledge();
    const shown = cue ?? preview;
    el('.draft').hidden = shown?.responseType !== 'draft';
    el('.answer').classList.toggle('unverified', !cue && !!preview);
    el('.answer').textContent =
      shown?.suggestedResponse ??
      (state.active ? 'Listening for your next cue…' : 'Your next cue will appear here.');
    el('.advice').textContent = cue
      ? (cue.answerBasis === 'general' ? 'General knowledge · ' : '') + cue.recommendation
      : preview
        ? 'Unverified draft. Wait for the check before quoting names, numbers or commitments.'
        : (state.question?.reason ?? state.message ?? '');
    el<HTMLButtonElement>('#answer').disabled =
      !state.active ||
      (state.generating && state.generatingMode !== 'automatic') ||
      state.status === 'Connecting' ||
      state.status === 'Reconnecting';
    el<HTMLButtonElement>('#stop').disabled = !state.active;
  };
  const listener = (message: { target?: string; state?: PanelState }) => {
    if (message.target === 'cue' && message.state) update(message.state);
  };
  chrome.runtime.onMessage.addListener(listener);
  const command = (type: 'answer' | 'stop') =>
    void chrome.runtime.sendMessage({ target: 'offscreen', type }).catch(() => {
      el('.status').textContent = 'Open noclue to reconnect.';
    });
  el('#answer').onclick = () => command('answer');
  el('#stop').onclick = () => command('stop');
  el('#copy').onclick = () => {
    const cue = current?.suggestions[0];
    if (cue)
      void (cueState.pip?.navigator ?? navigator).clipboard
        .writeText(cue.suggestedResponse)
        .catch(() => {
          el('.status').textContent = 'Select and copy the response.';
        });
  };
  el('#dismiss').onclick = () => {
    const cue = current?.suggestions[0];
    if (cue)
      void chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'dismiss',
        requestId: cue.requestId,
      });
  };
  root.querySelectorAll<HTMLButtonElement>('[data-feedback]').forEach((button) => {
    button.onclick = () => {
      const cue = current?.suggestions[0];
      if (cue)
        void chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'feedback',
          requestId: cue.requestId,
          feedback: button.dataset.feedback,
        });
    };
  });
  const observer = new ResizeObserver(() => {
    clamp();
    save();
  });
  observer.observe(host);
  const resize = () => {
    clamp();
    save();
  };
  window.addEventListener('resize', resize);
  const close = () => {
    closed = true;
    clearTimeout(saveTimer);
    document.removeEventListener('noclue:share', onShare);
    if (world.__noclueCue === cueState) world.__noclueCue = undefined;
    cueState.pip?.close();
    observer.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', acknowledge);
    chrome.runtime.onMessage.removeListener(listener);
    host.remove();
  };
  el('#close').onclick = close;
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  void chrome.runtime
    .sendMessage({ target: 'offscreen', type: 'snapshot' })
    .then((s) => {
      if (s) update(s);
    })
    .catch(() => {});
}
