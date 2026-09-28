import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageState, orderMessages, pushOutcomeText, unreadCount } from './model.ts';

test('a message is unread, then read, then acknowledged; the count is of unread ones', () => {
  assert.equal(messageState({ read_at: null, acknowledged_at: null }), 'unread');
  assert.equal(messageState({ read_at: '2026-09-28T01:00:00Z', acknowledged_at: null }), 'read');
  assert.equal(messageState({ read_at: '2026-09-28T01:00:00Z', acknowledged_at: '2026-09-28T01:01:00Z' }), 'acknowledged');
  assert.equal(unreadCount([{ read_at: null, acknowledged_at: null }, { read_at: 'x', acknowledged_at: null }, { read_at: null, acknowledged_at: null }]), 2);
});

test('the push outcome is said plainly, and messages read newest first', () => {
  assert.equal(pushOutcomeText('sent', 1), 'Notification sent to 1 phone');
  assert.equal(pushOutcomeText('sent', 2), 'Notification sent to 2 phones');
  assert.match(pushOutcomeText('no_device', 0), /No phone registered/);
  assert.match(pushOutcomeText('failed', 1), /could not be delivered/);
  assert.match(pushOutcomeText(null, null), /not attempted/);
  assert.deepEqual(orderMessages([{ sent_at: '2026-09-27T00:00:00Z' }, { sent_at: '2026-09-28T00:00:00Z' }]).map((m) => m.sent_at), ['2026-09-28T00:00:00Z', '2026-09-27T00:00:00Z']);
});
