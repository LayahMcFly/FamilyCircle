/* Giving Center preview: rule tests against the FAKE server (a simulation, not the real function and not a live backend).
 * Run:  node --test tests/giving/        No dependencies. Nothing here touches a network or any Appwrite project. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../giving-preview/giving-core.js');
const F = require('../../giving-preview/giving-fake-server.js');

function world() {
  const s = F.create({ seed: false }), a = s.admin;
  a.addFamily('A', 'Family A'); a.addFamily('B', 'Family B');
  [['own', 'Olive'], ['buy', 'Bea'], ['buy2', 'Bo'], ['kid', 'Kit'], ['gone', 'Gus']].forEach(p => a.addMember('A', 'u-' + p[0], p[1]));
  a.addMember('B', 'u-out', 'Xan');
  ['own', 'buy', 'buy2', 'gone', 'out'].forEach(u => a.setEligible('u-' + u, true));
  const list = a.addList('A', 'u-own', 'Mine'), item = a.addItem(list.id, { title: 'Mug', priceCents: 1000, currency: 'USD' });
  return { s, a, list, item, call: s.call };
}
const SECRET = /reserved|reservedByMe|changedSinceReserved|availableCount|buyer|u-buy|Bea|Bo\b/i;
/* what an owner may be shown about their OWN lists and items: walk and report any reservation-ish key */
function ownerLeaks(res) { const bad = []; (function walk(o, own) { if (Array.isArray(o)) return o.forEach(x => walk(x, own)); if (o && typeof o === 'object') { const mine = o.mine === true || own; Object.keys(o).forEach(k => { if (mine && /reserv|buyer|available/i.test(k) && k !== 'reservations') bad.push(k); walk(o[k], mine && k !== 'lists'); }); } })(res, false); return bad; }

test('the owner never receives any reservation field, before or after a reservation', () => {
  const w = world();
  const before = JSON.stringify(w.call('u-own', 'listGet', { familyId: 'A', listId: w.list.id }));
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
  const after = JSON.stringify(w.call('u-own', 'listGet', { familyId: 'A', listId: w.list.id }));
  assert.equal(before, after, 'owner response is byte-for-byte the same');
  assert.doesNotMatch(after, SECRET);
  assert.doesNotMatch(JSON.stringify(w.call('u-own', 'home', { familyId: 'A' })), SECRET);
  assert.deepEqual(ownerLeaks(JSON.parse(after)), []);
});
test('owner cannot reserve, release or learn state through those actions', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  const r1 = w.call('u-own', 'reserve', { familyId: 'A', itemId: w.item.id });
  const w2 = world(); const r2 = w2.call('u-own', 'reserve', { familyId: 'A', itemId: w2.item.id });
  assert.deepEqual([r1.error, r1.message], [r2.error, r2.message], 'same answer whether reserved or not');
  assert.equal(w.call('u-own', 'release', { familyId: 'A', itemId: w.item.id }).error, 'not_available');
});
test('buyer sees their own reservation; other givers see Reserved with no identity', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  const mine = w.call('u-buy', 'listGet', { familyId: 'A', listId: w.list.id }).items[0];
  assert.equal(mine.reservedByMe, true);
  const other = w.call('u-buy2', 'listGet', { familyId: 'A', listId: w.list.id });
  assert.equal(other.items[0].reserved, true); assert.equal(other.items[0].reservedByMe, undefined);
  assert.doesNotMatch(JSON.stringify(other), /u-buy\b|Bea/);
});
test('one active reservation per item: second buyer refused, same buyer is idempotent', () => {
  const w = world();
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
  const again = w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }); assert.equal(again.ok, true); assert.equal(again.already, true);
  const second = w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }); assert.equal(second.ok, false); assert.equal(second.error, 'taken');
  assert.equal(Object.keys(JSON.parse(w.a.dump()).reservations).length, 1);
});
test('simultaneous reserve attempts produce exactly one winner', async () => {
  const w = world();
  const rs = await Promise.all(['u-buy', 'u-buy2', 'u-buy', 'u-buy2'].map(u => Promise.resolve().then(() => w.call(u, 'reserve', { familyId: 'A', itemId: w.item.id }))));
  const winners = new Set(rs.filter(r => r.ok).map(() => 1)); assert.ok(winners.size === 1);
  assert.equal(Object.keys(JSON.parse(w.a.dump()).reservations).length, 1);
});
test('release: only the buyer can; someone else\'s reservation looks like none', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  assert.equal(w.call('u-buy2', 'release', { familyId: 'A', itemId: w.item.id }).error, 'not_available');
  assert.equal(w.call('u-buy', 'release', { familyId: 'A', itemId: w.item.id }).ok, true);
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
});
test('eligibility is a plain per-account yes or no, with no owner bypass', () => {
  const w = world();
  assert.equal(w.call('u-kid', 'home', { familyId: 'A' }).error, 'no_access');
  w.a.setEligible('u-own', false);
  assert.equal(w.call('u-own', 'listGet', { familyId: 'A', listId: w.list.id }).error, 'no_access');
  assert.equal(w.call('u-own', 'itemSave', { familyId: 'A', listId: w.list.id, title: 'x' }).error, 'no_access');
});
test('other family and nonexistent things get one identical answer; body cannot name another user', () => {
  const w = world();
  const cross = w.call('u-out', 'listGet', { familyId: 'A', listId: w.list.id }), none = w.call('u-buy', 'listGet', { familyId: 'A', listId: 'nope' });
  assert.deepEqual(cross, { ok: false, error: 'not_available', message: 'That is not available.' }); assert.deepEqual(none, cross);
  assert.equal(w.call('u-out', 'reserve', { familyId: 'B', itemId: w.item.id }).error, 'not_available', 'item from family A via family B');
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id, userId: 'u-buy2', buyerId: 'u-buy2' }).ok, true);
  assert.equal(JSON.parse(w.a.dump()).reservations[w.item.id].buyerId, 'u-buy', 'identity comes from the signed-in account only');
});
test('only the owner can edit, delete or mark received', () => {
  const w = world();
  for (const [act, extra] of [['itemSave', { listId: w.list.id, itemId: w.item.id, title: 'Hack' }], ['itemDelete', { itemId: w.item.id }], ['itemReceived', { itemId: w.item.id }], ['listSave', { listId: w.list.id, name: 'x' }], ['listDelete', { listId: w.list.id }]])
    assert.equal(w.call('u-buy', act, Object.assign({ familyId: 'A' }, extra)).error, 'not_available', act);
});
test('edit flag: title, link and price changes mark the item for the buyer; notes and priority do not', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  const base = { familyId: 'A', listId: w.list.id, itemId: w.item.id, title: 'Mug', price: '10', currency: 'USD', url: '' };
  w.call('u-own', 'itemSave', Object.assign({}, base, { notes: 'new note', priority: 'high' }));
  assert.equal(w.call('u-buy', 'listGet', { familyId: 'A', listId: w.list.id }).items[0].changedSinceReserved, false);
  w.call('u-own', 'itemSave', Object.assign({}, base, { price: '12' }));
  assert.equal(w.call('u-buy', 'listGet', { familyId: 'A', listId: w.list.id }).items[0].changedSinceReserved, true);
  assert.equal(w.call('u-buy', 'home', { familyId: 'A' }).reservations[0].changedSinceReserved, true);
});
test('received closes the reservation and tells the buyer; delete does the same', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.call('u-own', 'itemReceived', { familyId: 'A', itemId: w.item.id });
  const home = w.call('u-buy', 'home', { familyId: 'A' }); assert.equal(home.reservations.length, 0); assert.match(home.notices[0].text, /marked received/);
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).error, 'unavailable');
  const it2 = w.a.addItem(w.list.id, { title: 'Book' }); w.call('u-buy', 'reserve', { familyId: 'A', itemId: it2.id });
  w.call('u-own', 'itemDelete', { familyId: 'A', itemId: it2.id });
  assert.equal(w.call('u-buy', 'home', { familyId: 'A' }).notices.length, 2);
  assert.deepEqual(ownerLeaks(w.call('u-own', 'home', { familyId: 'A' })), []);
});
test('removed buyer: reservations released, items reserve-able again; removed owner: lists unreachable; re-invite starts clean', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.a.removeMember('A', 'u-buy');
  assert.equal(w.call('u-buy', 'home', { familyId: 'A' }).error, 'not_available');
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
  w.a.removeMember('A', 'u-own');
  assert.equal(w.call('u-buy2', 'listGet', { familyId: 'A', listId: w.list.id }).error, 'not_available');
  assert.equal(w.call('u-buy2', 'home', { familyId: 'A' }).reservations.length, 0);
  w.a.reinvite('A', 'u-own');
  assert.equal(w.call('u-own', 'listGet', { familyId: 'A', listId: w.list.id }).error, 'not_available', 'old list is not revived');
  assert.equal(w.call('u-own', 'home', { familyId: 'A' }).lists.length, 0);
});
test('limits and validation: titles, notes, urls, prices, currencies', () => {
  const w = world(), b = { familyId: 'A', listId: w.list.id };
  const bad = (f) => w.call('u-own', 'itemSave', Object.assign({}, b, { title: 'T' }, f));
  assert.equal(bad({ title: '  ' }).fields.title.length > 0, true);
  assert.ok(bad({ title: 'x'.repeat(121) }).fields.title);
  assert.ok(bad({ notes: 'x'.repeat(1001) }).fields.notes);
  for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.b/c', 'https://user:pw@a.com', 'https://a b.com', 'http://localhost', '//a.com']) assert.ok(bad({ url: u }).fields.url, u);
  for (const p of ['abc', '-5', '1.234', '1e3', '0', '100001', '1,5']) assert.ok(bad({ price: p, currency: 'USD' }).fields.price, p);
  assert.ok(bad({ price: '5' }).fields.currency, 'price needs a currency');
  assert.ok(bad({ price: '5', currency: 'JPY' }).fields.currency);
  assert.equal(bad({ url: 'https://shop.example.com/a?b=1', price: '24.99', currency: 'USD' }).ok, true);
  assert.equal(bad({ price: '', currency: 'USD' }).ok, true, 'a currency with no price is dropped, not an error');
  for (let i = 0; i < 100; i++) w.a.addItem(w.list.id, { title: 'f' + i });
  assert.equal(bad({}).error, 'limit');
  for (let i = 0; i < 9; i++) w.call('u-own', 'listSave', { familyId: 'A', name: 'L' + i });
  assert.equal(w.call('u-own', 'listSave', { familyId: 'A', name: 'one too many' }).error, 'limit');
});
test('typed text keeps its case and is not altered', () => {
  const w = world(); const r = w.call('u-own', 'itemSave', { familyId: 'A', listId: w.list.id, title: 'iPhone CASE for NASA <b>x</b>', notes: 'lower UPPER MiXeD' });
  assert.equal(r.item.title, 'iPhone CASE for NASA <b>x</b>'); assert.equal(r.item.notes, 'lower UPPER MiXeD');
});
test('totals are per currency and never mixed; received items are left out', () => {
  const t = C.totalsByCurrency([{ priceCents: 1000, currency: 'USD' }, { priceCents: 500, currency: 'USD' }, { priceCents: 700, currency: 'EUR' }, { priceCents: 900, currency: 'USD', received: true }]);
  assert.deepEqual(t.map(x => [x.currency, x.cents]), [['EUR', 700], ['USD', 1500]]);
});
test('seeded sample world: owner Rae sees no reservation fields; Sam and Tia see theirs', () => {
  const s = F.create(), fam = 'famA';
  const home = s.call('u-rae', 'home', { familyId: fam });
  const l = home.lists.find(x => x.name === 'Birthday ideas');
  const detail = s.call('u-rae', 'listGet', { familyId: fam, listId: l.id });
  assert.deepEqual(ownerLeaks(detail), []); assert.doesNotMatch(JSON.stringify(detail), /\bSam\b|\bTia\b|reserved/i);
  assert.equal(home.reservations.length, 0, 'Rae has reserved nothing herself');
  const sam = home.lists.find(x => x.name === 'Home projects'); assert.equal(sam.availableCount, 1, 'as a giver Rae sees only a count of what is free on Sam\'s list');
  assert.equal(s.call('u-sam', 'home', { familyId: fam }).reservations.length, 1);
  assert.equal(s.call('u-riley', 'home', { familyId: fam }).error, 'no_access');
  assert.equal(s.call('u-quinn', 'home', { familyId: fam }).error, 'not_available');
  assert.equal(s.call('u-olive', 'home', { familyId: fam }).error, 'not_available');
});
