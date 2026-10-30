import { CONFIG } from './config.js';
import { createDial } from './dial.js';
import { initPush } from './push.js';

/** A call Oppo placed more than this long ago shows as missed, not ringing. */
const STALE_CALL_MS = 10 * 60 * 1000;
/** How long the incoming screen rings before it becomes a missed call. */
const RING_TIMEOUT_MS = 60 * 1000;

const $ = (id) => document.getElementById(id);
const els = {
  body: document.body,
  status: $('status'),
  timer: $('timer'),
  reason: $('reason'),
  caption: $('caption'),
  callBtn: $('call-btn'),
  answerBtn: $('answer-btn'),
  declineBtn: $('decline-btn'),
  muteBtn: $('mute-btn'),
  endBtn: $('end-btn'),
  settingsBtn: $('settings-btn'),
  settings: $('settings'),
};

const dial = createDial($('dial'));

/**
 * @typedef {'idle'|'incoming'|'connecting'|'live'|'ended'} Phase
 * @typedef {{ phase: Phase, status: string, reason: string|null, muted: boolean, startedAt: number|null }} CallState
 */

/** @type {Readonly<CallState>} */
let state = Object.freeze({
  phase: 'idle',
  status: 'Ready when you are',
  reason: null,
  muted: false,
  startedAt: null,
});

let conversation = null;
let timerId = 0;
let ringTimeoutId = 0;

/** @param {Partial<CallState>} patch */
function setState(patch) {
  state = Object.freeze({ ...state, ...patch });
  render();
}

function render() {
  els.body.dataset.state = state.phase;
  els.status.textContent = state.status;
  els.reason.hidden = !state.reason;
  els.reason.textContent = state.reason ?? '';
  els.muteBtn.setAttribute('aria-pressed', String(state.muted));
  els.muteBtn.textContent = state.muted ? 'Unmute' : 'Mute';
  els.endBtn.disabled = state.phase === 'connecting' && !conversation;
}

/** @param {number} ms */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function startTimer() {
  stopTimer();
  const tick = () => { els.timer.textContent = formatDuration(Date.now() - (state.startedAt ?? Date.now())); };
  tick();
  timerId = window.setInterval(tick, 1000);
}

function stopTimer() {
  window.clearInterval(timerId);
}

/** @param {{ message: string, role?: string, source?: string }} payload */
function showCaption(payload) {
  const role = payload.role ?? (payload.source === 'ai' ? 'agent' : 'user');
  els.caption.dataset.role = role;
  els.caption.textContent = payload.message;
}

/** @param {unknown} error */
function describeStartError(error) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone is blocked. Allow it for Oppo in Settings, then try again.';
  }
  if (name === 'NotFoundError') return 'No microphone found on this device.';
  if (!navigator.onLine) return 'You are offline. Connect to Wi-Fi or data and try again.';
  return 'Could not reach Oppo. Check your connection and try again.';
}

/** @param {string|null} reason */
function buildSessionOptions(reason) {
  const options = {
    agentId: CONFIG.agentId,
    connectionType: CONFIG.connectionType,
    useWakeLock: true,
    onConnect: () => {
      setState({ phase: 'live', status: 'Connected', startedAt: Date.now() });
      startTimer();
    },
    onDisconnect: handleDisconnect,
    onError: (message) => setState({ status: `Line trouble: ${message}` }),
    onModeChange: ({ mode }) => {
      els.body.dataset.mode = mode;
      if (state.phase === 'live') setState({ status: mode === 'speaking' ? 'Oppo is speaking' : 'Listening' });
    },
    onMessage: showCaption,
  };
  if (reason && CONFIG.allowFirstMessageOverride) {
    return { ...options, overrides: { agent: { firstMessage: `Hey Abdulah, it's Oppo. I'm calling about this: ${reason}` } } };
  }
  return options;
}

/** @param {string|null} reason Why Oppo called, when this call answers an incoming one. */
async function startCall(reason = null) {
  if (conversation || state.phase === 'connecting') return;
  window.clearTimeout(ringTimeoutId);
  els.caption.textContent = '';
  setState({ phase: 'connecting', status: 'Connecting…', reason, muted: false });

  try {
    const { Conversation } = await import('./vendor/elevenlabs.js');
    conversation = await Conversation.startSession(buildSessionOptions(reason));
    dial.attach(conversation);
    render();
    if (reason && !CONFIG.allowFirstMessageOverride) {
      conversation.sendContextualUpdate(
        `You (Oppo) placed this call to Abdulah. The reason you called: ${reason}. ` +
        'Briefly tell him why you called before anything else.',
      );
    }
  } catch (error) {
    conversation = null;
    dial.detach();
    setState({ phase: 'idle', status: describeStartError(error) });
  }
}

/** @param {{ reason: string, message?: string }} details */
function handleDisconnect(details) {
  const duration = state.startedAt ? formatDuration(Date.now() - state.startedAt) : null;
  stopTimer();
  dial.detach();
  conversation = null;
  delete els.body.dataset.mode;
  const status = details?.reason === 'error'
    ? `Call dropped${details.message ? `: ${details.message}` : ''}`
    : `Call ended${duration ? ` · ${duration}` : ''}`;
  setState({ phase: 'ended', status, reason: null, startedAt: null, muted: false });
}

async function endCall() {
  if (!conversation) return;
  setState({ status: 'Hanging up…' });
  try {
    await conversation.endSession();
  } catch {
    handleDisconnect({ reason: 'user' });
  }
}

function toggleMute() {
  if (!conversation) return;
  const muted = !state.muted;
  conversation.setMicMuted(muted);
  setState({ muted });
}

/** @param {{ reason?: string|null, ts?: string|null }} call */
function showIncoming({ reason = null, ts = null }) {
  if (conversation) return;
  const placedAt = ts ? Date.parse(ts) : Date.now();
  const isStale = Number.isFinite(placedAt) && Date.now() - placedAt > STALE_CALL_MS;
  if (isStale) {
    setState({ phase: 'idle', status: 'Missed call from Oppo. Call back?', reason });
    return;
  }
  setState({ phase: 'incoming', status: 'Oppo is calling', reason });
  window.clearTimeout(ringTimeoutId);
  ringTimeoutId = window.setTimeout(() => {
    if (state.phase === 'incoming') setState({ phase: 'idle', status: 'Missed call from Oppo. Call back?' });
  }, RING_TIMEOUT_MS);
}

function declineCall() {
  window.clearTimeout(ringTimeoutId);
  setState({ phase: 'idle', status: 'Declined. Oppo will report back in OpenBot.', reason: null });
}

function readIncomingFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('incoming') !== '1') return;
  showIncoming({ reason: params.get('reason'), ts: params.get('ts') });
  window.history.replaceState(null, '', window.location.pathname);
}

/** The service worker saves each incoming call here, because iOS can drop the tap's message and URL. */
const PENDING_CACHE = 'oppo-line-pending';
const PENDING_KEY = 'pending-call';

async function readPendingCall() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(PENDING_CACHE);
    const hit = await cache.match(PENDING_KEY);
    if (!hit) return;
    const call = await hit.json();
    await cache.delete(PENDING_KEY);
    // Already ringing or on a call: this saved copy is the same call, so just drop it.
    if (conversation || state.phase === 'incoming' || state.phase === 'connecting') return;
    showIncoming({ reason: call?.reason || null, ts: call?.ts || null });
  } catch {
    // No saved call or unreadable: nothing to show.
  }
}

// Listen before registering, so a message sent while the app wakes is not lost.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'incoming') showIncoming(event.data);
  });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') readPendingCall(); });
window.addEventListener('pageshow', () => readPendingCall());

/** @returns {Promise<{ registration: ServiceWorkerRegistration|null, swError: string|null }>} */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return { registration: null, swError: 'service workers unavailable' };
  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    return { registration, swError: null };
  } catch (error) {
    const swError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { registration: null, swError };
  }
}

els.callBtn.addEventListener('click', () => startCall(state.phase === 'idle' ? state.reason : null));
els.answerBtn.addEventListener('click', () => startCall(state.reason));
els.declineBtn.addEventListener('click', declineCall);
els.endBtn.addEventListener('click', endCall);
els.muteBtn.addEventListener('click', toggleMute);
els.settingsBtn.addEventListener('click', () => els.settings.showModal());
window.addEventListener('pagehide', () => { if (conversation) conversation.endSession(); });

render();
readIncomingFromUrl();
readPendingCall();
registerServiceWorker().then(({ registration, swError }) => initPush({ registration, swError, dialog: els.settings }));
