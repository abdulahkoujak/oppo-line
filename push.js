import { CONFIG } from './config.js';

const LINE_PREFIX = 'oppo-line:';

const $ = (id) => document.getElementById(id);

/** @param {string} base64url */
function toUint8Array(base64url) {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** @param {string} text */
function toBase64Url(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {PushSubscription} subscription */
function lineCodeFor(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  return LINE_PREFIX + toBase64Url(JSON.stringify({ endpoint, keys }));
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** iOS version from the user agent, e.g. 17.4. Null when not on iOS. */
function iosVersion() {
  const match = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && match ? Number(`${match[1]}.${match[2]}`) : null;
}

/** One line of facts about this device, so a failure can be diagnosed from a screenshot. */
function deviceDetails(registration, swError) {
  const ios = iosVersion();
  return [
    ios ? `iOS ${ios}` : 'not iOS',
    isStandalone() ? 'home-screen app' : 'in browser',
    `worker: ${registration ? 'running' : swError ? 'failed' : 'missing'}`,
    `push: ${'PushManager' in window ? 'yes' : 'no'}`,
    `alerts: ${'Notification' in window ? Notification.permission : 'no'}`,
  ].join(' · ');
}

/**
 * Explains, in plain words, what stops push on this device. Null when nothing does.
 * @param {ServiceWorkerRegistration|null} registration
 * @param {string|null} swError
 */
function findPushBlocker(registration, swError) {
  const ios = iosVersion();
  if (ios && ios < 16.4) return `This iPhone is on iOS ${ios}. Calls from Oppo need iOS 16.4 or newer (Settings › General › Software Update).`;
  if (!isStandalone()) return 'Open Oppo from your Home Screen icon to turn on calls.';
  if (!registration) return `The app's background part didn't start (${swError ?? 'unknown reason'}). Close Oppo fully and reopen it.`;
  if (!('PushManager' in window) || !('Notification' in window)) {
    return 'iPhone is not offering notifications to this app. Delete the Oppo icon, add it again from Safari (not Chrome), and open it from the new icon.';
  }
  return null;
}

/**
 * Wires up the "Let Oppo call you" sheet: install hint, permission, and the line code.
 * @param {{ registration: ServiceWorkerRegistration|null, swError: string|null, dialog: HTMLDialogElement }} deps
 */
export async function initPush({ registration, swError, dialog }) {
  const ui = {
    install: $('step-install'),
    allow: $('step-allow'),
    code: $('step-code'),
    button: $('push-btn'),
    output: $('push-code'),
    copy: $('copy-btn'),
    note: $('push-note'),
    details: $('push-details'),
  };

  const setNote = (text) => { ui.note.textContent = text; };
  ui.details.textContent = deviceDetails(registration, swError);
  const markDone = (step, done) => { step.dataset.done = String(done); };

  function showCode(subscription) {
    ui.output.value = lineCodeFor(subscription);
    markDone(ui.allow, true);
    ui.button.textContent = 'Calls from Oppo are on';
    ui.button.disabled = true;
  }

  markDone(ui.install, isStandalone());
  ui.code.hidden = true;

  const blocker = findPushBlocker(registration, swError);
  if (blocker) {
    ui.button.disabled = true;
    setNote(blocker);
    return;
  }

  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      showCode(existing);
      ui.code.hidden = false;
    }
  } catch {
    setNote('Could not check notification status.');
  }

  ui.button.addEventListener('click', async () => {
    if (!isStandalone()) {
      setNote('First add Oppo to your Home Screen and open it from there. iPhone only allows notifications that way.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNote('Notifications are off. Turn them on in Settings › Notifications › Oppo.');
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toUint8Array(CONFIG.vapidPublicKey),
      });
      showCode(subscription);
      ui.code.hidden = false;
      setNote('Done. Now copy the line code and send it to Oppo.');
    } catch (error) {
      setNote(`Could not turn on calls: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  });

  ui.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.output.value);
      setNote('Line code copied.');
    } catch {
      ui.output.select();
      setNote('Select the code above and copy it.');
    }
  });

  dialog.addEventListener('close', () => setNote(''));
}
