import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sees, canSee, defaultScreens, grantableScreens, SCREENS } from './roles.ts';

test('with no ticks, sees answers exactly as the role table does', () => {
  for (const role of ['supervisor', 'leading_hand', 'labourer', 'pm', 'admin'] as const) {
    for (const screen of SCREENS) assert.equal(sees({ role, screens: null }, screen), canSee(role, screen), `${role} ${screen}`);
  }
});

test('ticks decide exactly which screens open, and Home is always open', () => {
  const m = { role: 'supervisor' as const, screens: ['signin', 'prestart'] };
  assert.equal(sees(m, 'signin'), true);
  assert.equal(sees(m, 'prestart'), true);
  assert.equal(sees(m, 'entries'), false);
  assert.equal(sees(m, 'claims'), false);
  assert.equal(sees(m, 'today'), true);
  assert.equal(sees({ role: 'supervisor', screens: [] }, 'today'), true);
});

test('a tick can open a screen the role would not have had', () => {
  assert.equal(canSee('leading_hand', 'claims'), false);
  assert.equal(sees({ role: 'leading_hand', screens: ['claims'] }, 'claims'), true);
});

test('a labourer never gets past their two doors, whatever is ticked', () => {
  assert.equal(sees({ role: 'labourer', screens: ['entries', 'claims', 'signin'] }, 'entries'), false);
  assert.equal(sees({ role: 'labourer', screens: ['entries', 'claims', 'signin'] }, 'claims'), false);
  assert.equal(sees({ role: 'labourer', screens: ['entries', 'claims', 'signin'] }, 'signin'), true);
  assert.equal(sees({ role: 'labourer', screens: [] }, 'incidents'), false);
  assert.deepEqual(grantableScreens('labourer'), ['signin', 'incidents']);
});

test('an admin keeps Settings — the screen the ticks are set from', () => {
  assert.equal(sees({ role: 'admin', screens: ['entries'] }, 'settings'), true);
  assert.equal(sees({ role: 'supervisor', screens: ['entries'] }, 'settings'), false);
});

test('the default list is the role table minus Home, and grantable is every screen minus Home for non-labourers', () => {
  assert.equal(defaultScreens('pm').includes('today'), false);
  assert.equal(defaultScreens('pm').includes('settings'), false);
  assert.equal(defaultScreens('admin').includes('settings'), true);
  assert.equal(grantableScreens('pm').length, SCREENS.length - 1);
});
