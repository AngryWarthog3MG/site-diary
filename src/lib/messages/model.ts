/**
 * Messages from the office to a person (README R112): the words for what happened to one. Pure, node-tested.
 * A message is the record that someone was told: sent by whom and when, whether their phone was told, when they
 * opened it, and when they tapped "Got it".
 */
export interface MessageRow {
  id: string;
  body: string;
  sent_at: string;
  push_result: 'sent' | 'no_device' | 'failed' | null;
  push_devices: number | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

export type MessageState = 'unread' | 'read' | 'acknowledged';

export function messageState(m: Pick<MessageRow, 'read_at' | 'acknowledged_at'>): MessageState {
  if (m.acknowledged_at) return 'acknowledged';
  if (m.read_at) return 'read';
  return 'unread';
}

/** How the phone was told, in the sender's words. */
export function pushOutcomeText(result: MessageRow['push_result'], devices: number | null): string {
  if (result === 'sent') return `Notification sent to ${devices ?? 1} phone${devices === 1 ? '' : 's'}`;
  if (result === 'no_device') return 'No phone registered for notifications — they see it when they open the app';
  if (result === 'failed') return 'The notification could not be delivered — they see it when they open the app';
  return 'Notification not attempted yet';
}

export function unreadCount(rows: ReadonlyArray<Pick<MessageRow, 'read_at' | 'acknowledged_at'>>): number {
  return rows.filter((m) => messageState(m) === 'unread').length;
}

/** Newest first. */
export function orderMessages<T extends Pick<MessageRow, 'sent_at'>>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => b.sent_at.localeCompare(a.sent_at));
}
