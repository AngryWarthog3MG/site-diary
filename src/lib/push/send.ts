import webpush from 'web-push';

/**
 * The web-push sender. VAPID identifies this app to the browser push
 * services; the keys live in env and the private one never leaves the server.
 */

export class PushConfigError extends Error {}

let configured = false;
function configure(): void {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new PushConfigError('VAPID keys are not configured.');
  }
  webpush.setVapidDetails('mailto:mitchell.vanzyl@gmail.com', publicKey, privateKey);
  configured = true;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Send one notification. Returns 'gone' when the subscription is dead
 * (uninstalled, permission revoked) so the caller can delete the row —
 * a push list that only ever grows would slowly become a list of ghosts.
 */
export async function sendPush(
  target: PushTarget,
  message: PushMessage,
): Promise<'sent' | 'gone' | 'failed'> {
  configure();
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(message),
      { TTL: 4 * 60 * 60, urgency: 'normal' },
    );
    return 'sent';
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';
    return 'failed';
  }
}
