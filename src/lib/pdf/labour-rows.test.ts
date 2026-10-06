import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labourRowsText, labourRowsTotal, readLabourRows } from './labour-rows.ts';

test('rows are read leniently, printed plainly, and summed only when complete (README R129)', () => {
  const rows = readLabourRows([{ person_name: ' Matthew Rodgers ', hours: 6.5 }, { person_name: 'Evan Burke', hours: '6.5' }, { person_name: '  ', hours: 2 }, { person_name: 'AJ', hours: null }]);
  assert.deepEqual(rows, [{ person_name: 'Matthew Rodgers', hours: 6.5 }, { person_name: 'Evan Burke', hours: 6.5 }, { person_name: 'AJ', hours: null }]);
  assert.equal(labourRowsText(rows), 'Matthew Rodgers 6.5 h, Evan Burke 6.5 h, AJ (hours not recorded)');
  assert.equal(labourRowsTotal(rows), null);
  assert.equal(labourRowsTotal(rows.slice(0, 2)), 13);
  assert.equal(labourRowsText([]), null);
  assert.deepEqual(readLabourRows(null), []);
  assert.deepEqual(readLabourRows('junk'), []);
});
