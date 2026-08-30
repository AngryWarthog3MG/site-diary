'use client';

import { useEffect, useState } from 'react';

/**
 * The knock-off reminder switch. One line on the Today screen: on weekdays
 * with no entry by 4pm, this phone gets a nudge.
 *
 * On iOS the Notification API only exists once the app is installed to the
 * home screen — a Safari tab shows the hint instead of a broken button.
 */

type State = 'unknown' | 'unsupported' | 'off' | 'on' | 'busy' | 'denied';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function ReminderToggle() {
  const [state, setState] = useState<State>('unknown');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  async function enable() {
    setState('busy');
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error('Push is not configured.');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
      });
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error('The reminder did not save.');
      setState('on');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn the reminder on.');
      setState('off');
    }
  }

  async function disable() {
    setState('busy');
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState('off');
    } catch {
      setError('Could not turn the reminder off.');
      setState('on');
    }
  }

  if (state === 'unknown') return null;

  if (state === 'unsupported') {
    return (
      <p className="reminder-line reminder-line--muted">
        Knock-off reminders need the app on your home screen — Share, then “Add to Home
        Screen”.
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className="reminder-line reminder-line--muted">
        Notifications are blocked for this app in your phone’s settings.
      </p>
    );
  }

  return (
    <div className="reminder-line">
      <button
        type="button"
        className="quotebtn"
        disabled={state === 'busy'}
        onClick={() => (state === 'on' ? void disable() : void enable())}
      >
        {state === 'busy'
          ? 'One moment…'
          : state === 'on'
            ? 'Knock-off reminder is ON — turn it off'
            : 'Remind me at knock-off if I haven’t recorded'}
      </button>
      {error && <p className="alert">{error}</p>}
    </div>
  );
}
