/* Unit tests for the Family Exchange PREVIEW fake API (sample data only). Run: node --test tests/exchange-fake-api.test.js
 * They check what each sample account RECEIVES from the fake server, not what the screen draws. */
const test = require('node:test'), assert = require('node:assert');
const A = require('../exchange-preview/exchange-fake-api.js');
const viewers = [{ id: 'ava', name: 'Ava Rowan' }, { id: 'ben', name: 'Ben Rowan' }, { id: 'dana', name: 'Dana Rowan', moderator: true }, { id: 'eli', name: 'Eli Rowan', moderator: true }];
const mk = () => ({
  listings: [{ id: 'l1', owner: 'dana', title: 'Desk chair' }, { id: 'l2', owner: 'ben', title: 'Books' }, { id: 'l3', owner: 'eli', title: 'Bike' }],
  reports: [{ id: 'p1', listing: 'l1', by: 'ben', reason: 'Item looks unsafe', detail: 'The lever is loose.', ago: '1h', status: 'open' }, { id: 'p2', listing: 'l2', by: 'ava', reason: 'Other', detail: '', ago: '2h', status: 'open' }, { id: 'p3', listing: 'l3', by: 'ava', reason: 'Other', detail: 'secret3', ago: '3h', status: 'open' }, { id: 'p4', listing: 'gone', by: 'ben', reason: 'Other', detail: '', ago: '4h', status: 'open' }]
});
const ask = (db, id) => JSON.parse(A.listReports(db, viewers, id));
test('an accused moderator receives no byte of the report about their own listing', () => {
  const raw = A.listReports(mk(), viewers, 'dana');
  for (const t of ['p1', 'loose', 'Item looks unsafe', 'Desk chair']) assert.ok(!raw.includes(t), t);
  const r = JSON.parse(raw); assert.equal(r.ok, true); assert.deepEqual(r.reports.map(x => x.id), ['p2', 'p3', 'p4']);
});
test('no count, placeholder or hint stands in for the withheld report', () => {
  const r = ask(mk(), 'dana'); assert.deepEqual(Object.keys(r).sort(), ['ok', 'reports']);
  for (const x of r.reports) assert.deepEqual(Object.keys(x).sort(), ['ago', 'detail', 'id', 'listingId', 'reason', 'reporter', 'status', 'title']);
});
test('each moderator is excluded only from reports about their own listings', () => {
  assert.deepEqual(ask(mk(), 'eli').reports.map(x => x.id), ['p1', 'p2', 'p4']);
  assert.ok(!A.listReports(mk(), viewers, 'eli').includes('secret3'));
});
test('account switching: the answer depends only on the caller, in any order, and never carries over', () => {
  const db = mk(), seq = ['dana', 'eli', 'ava', 'dana', 'ben', 'eli', 'dana'], seen = seq.map(id => A.listReports(db, viewers, id));
  assert.equal(seen[0], seen[3]); assert.equal(seen[0], seen[6]); assert.equal(seen[1], seen[5]);
  assert.ok(!seen[0].includes('loose')); assert.ok(seen[1].includes('loose'));
  for (const i of [2, 4]) assert.equal(seen[i], '{"ok":false,"status":404,"error":"not_available"}');
});
test('non-moderators and unknown accounts get one identical answer', () => {
  const same = '{"ok":false,"status":404,"error":"not_available"}';
  for (const id of ['ava', 'ben', 'nobody', '', undefined]) assert.equal(A.listReports(mk(), viewers, id), same);
});
test('the answer is rebuilt from the current data every time: once the owner changes, so does what each account receives', () => {
  const db = mk(); assert.ok(!A.listReports(db, viewers, 'dana').includes('loose'));
  db.listings[0].owner = 'ben'; assert.ok(A.listReports(db, viewers, 'dana').includes('loose'));
  db.listings[1].owner = 'dana'; assert.ok(!A.listReports(db, viewers, 'dana').includes('"p2"'));
});
test('deciding a report is refused for the accused, for non-moderators and for unknown reports, with no difference to tell them apart', () => {
  const db = mk();
  assert.equal(A.canResolve(db, viewers, 'dana', 'p1'), false); assert.equal(A.canResolve(db, viewers, 'dana', 'nope'), false);
  assert.equal(A.canResolve(db, viewers, 'ava', 'p2'), false); assert.equal(A.canResolve(db, viewers, 'dana', 'p2'), true);
  assert.equal(A.canResolve(db, viewers, 'dana', 'p4'), false, 'a report whose listing is gone cannot be decided');
});
