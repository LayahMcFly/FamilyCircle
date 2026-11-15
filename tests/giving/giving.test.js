/* Giving Center preview: rule tests against the FAKE server (a simulation, not the real function and not a live backend).
 * Run:  node --test tests/giving/        No dependencies. Nothing here touches a network or any Appwrite project. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../giving-core.js');
const F = require('../../giving-preview/giving-fake-server.js');

/* Family A: owner (adult), admin Ada (adult), tree admin Tess (adult), adults Olive/Bea/Bo, kid Kit, member Gus (adult, removed later). Family B: Xan. */
function world() {
  const s = F.create({ seed: false }), a = s.admin;
  a.addFamily('A', 'Family A'); a.addFamily('B', 'Family B');
  a.addMember('A', 'u-own', 'Olive', 'member', true); a.addMember('A', 'u-buy', 'Bea', 'member', true); a.addMember('A', 'u-buy2', 'Bo', 'member', true);
  a.addMember('A', 'u-kid', 'Kit', 'member', false); a.addMember('A', 'u-gone', 'Gus', 'member', true);
  a.addMember('A', 'u-boss', 'Owen', 'owner', true); a.addMember('A', 'u-adm', 'Ada', 'admin', true); a.addMember('A', 'u-tree', 'Tess', 'treeAdmin', true);
  a.addMember('B', 'u-out', 'Xan', 'member', true);
  const list = a.addList('A', 'u-own', 'Mine'), item = a.addItem(list.id, { title: 'Mug', priceCents: 1000, currency: 'USD' });
  return { s, a, list, item, call: s.call };
}
const SECRET = /reserved|reservedByMe|changedSinceReserved|availableCount|buyer|u-buy|Bea|Bo\b/i;
/* what an owner may be shown about their OWN lists and items: walk and report any reservation-ish key */
function ownerLeaks(res) { const bad = []; (function walk(o, own) { if (Array.isArray(o)) return o.forEach(x => walk(x, own)); if (o && typeof o === 'object') { const mine = o.mine === true || own; Object.keys(o).forEach(k => { if (mine && /reserv|buyer|available|report/i.test(k) && k !== 'reservations') bad.push(k); walk(o[k], mine && k !== 'lists'); }); } })(res, false); return bad; }
const g = (w, u, id) => w.call(u, 'listGet', { familyId: 'A', listId: id || w.list.id });

test('the owner never receives any reservation field, before or after a reservation', () => {
  const w = world();
  const before = JSON.stringify(g(w, 'u-own'));
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
  const after = JSON.stringify(g(w, 'u-own'));
  assert.equal(before, after, 'owner response is byte-for-byte the same');
  assert.doesNotMatch(after, SECRET); assert.deepEqual(ownerLeaks(JSON.parse(after)), []);
  assert.doesNotMatch(JSON.stringify(w.call('u-own', 'home', { familyId: 'A' })), SECRET);
});
test('owner cannot reserve; the answer is the same whether or not it is reserved', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  const r1 = w.call('u-own', 'reserve', { familyId: 'A', itemId: w.item.id });
  const w2 = world(); const r2 = w2.call('u-own', 'reserve', { familyId: 'A', itemId: w2.item.id });
  assert.deepEqual([r1.error, r1.message], [r2.error, r2.message]);
  assert.equal(w.call('u-own', 'release', { familyId: 'A', itemId: w.item.id }).error, 'not_available');
});
test('buyer sees their own reservation; other adults see Reserved with no identity', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  assert.equal(g(w, 'u-buy').items[0].reservedByMe, true);
  const other = g(w, 'u-buy2'); assert.equal(other.items[0].reserved, true); assert.equal(other.items[0].reservedByMe, undefined);
  assert.doesNotMatch(JSON.stringify(other), /u-buy\b|Bea/);
});
test('one active reservation per item: second buyer refused, same buyer is idempotent, and simultaneous attempts give one winner', async () => {
  const w = world();
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }).already, true);
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).error, 'taken');
  const w2 = world();
  const rs = await Promise.all(['u-buy', 'u-buy2', 'u-buy', 'u-buy2'].map(u => Promise.resolve().then(() => w2.call(u, 'reserve', { familyId: 'A', itemId: w2.item.id }))));
  assert.equal(new Set(rs.filter(r => r.ok).map(() => 1)).size, 1);
  assert.equal(Object.keys(JSON.parse(w2.a.dump()).reservations).length, 1);
});
test('release: only the buyer can; someone else\'s reservation looks like none', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  assert.equal(w.call('u-buy2', 'release', { familyId: 'A', itemId: w.item.id }).error, 'not_available');
  assert.equal(w.call('u-buy', 'release', { familyId: 'A', itemId: w.item.id }).ok, true);
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
});

test('everyone is a kid until marked: a kid has a list and sees public lists, but cannot reserve and never sees reservation data', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  const view = g(w, 'u-kid'); assert.equal(view.ok, true);
  assert.doesNotMatch(JSON.stringify(view), /reserved|reservedByMe|availableCount|u-buy|Bea/i); assert.equal(view.items[0].kid, true);
  assert.equal(w.call('u-kid', 'reserve', { familyId: 'A', itemId: w.item.id }).error, 'adults_only');
  const home = w.call('u-kid', 'home', { familyId: 'A' }); assert.equal(home.me.adult, false); assert.deepEqual(home.reservations, []);
  assert.equal(w.call('u-kid', 'listSave', { familyId: 'A', name: 'Kit wishes' }).ok, true);
  assert.equal(w.call('u-kid', 'listSave', { familyId: 'A', name: 'x', audience: 'adults' }).error, 'adults_only');
});
test('only an owner, admin or family tree admin can mark someone as an adult; nobody can change their own', () => {
  const w = world();
  for (const u of ['u-own', 'u-buy', 'u-kid']) { assert.equal(w.call(u, 'memberSetAdult', { familyId: 'A', userId: 'u-kid', adult: true }).error, 'not_available', u); assert.equal(w.call(u, 'members', { familyId: 'A' }).error, 'not_available'); }
  for (const u of ['u-boss', 'u-adm', 'u-tree']) { assert.equal(w.call(u, 'memberSetAdult', { familyId: 'A', userId: 'u-kid', adult: true }).ok, true, u); w.call(u, 'memberSetAdult', { familyId: 'A', userId: 'u-kid', adult: false }); }
  assert.equal(w.call('u-adm', 'memberSetAdult', { familyId: 'A', userId: 'u-adm', adult: false }).error, 'self');
  assert.equal(w.call('u-adm', 'memberSetAdult', { familyId: 'A', userId: 'u-out', adult: true }).error, 'not_available', 'someone in another family');
  w.call('u-adm', 'memberSetAdult', { familyId: 'A', userId: 'u-kid', adult: true });
  assert.equal(w.call('u-kid', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true, 'now an adult');
});
test('marking an adult as a kid releases their reservations and they lose adult powers', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.call('u-adm', 'memberSetAdult', { familyId: 'A', userId: 'u-buy', adult: false });
  assert.equal(Object.keys(JSON.parse(w.a.dump()).reservations).length, 0);
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id }).error, 'adults_only');
});
test('adults-only lists: an adult can make one; a kid cannot see it, reach it by id, or learn it exists', () => {
  const w = world();
  const secret = w.call('u-buy', 'listSave', { familyId: 'A', name: 'Gifts for Kit', audience: 'adults' }).list;
  assert.equal(secret.audience, 'adults');
  const it = w.call('u-buy', 'itemSave', { familyId: 'A', listId: secret.id, title: 'Bike' }).item;
  const ghost = w.call('u-kid', 'listGet', { familyId: 'A', listId: 'nope' });
  assert.deepEqual(w.call('u-kid', 'listGet', { familyId: 'A', listId: secret.id }), ghost, 'identical to a missing list');
  assert.deepEqual(w.call('u-kid', 'reserve', { familyId: 'A', itemId: it.id }), ghost);
  assert.deepEqual(w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: it.id, reason: 'other' }), ghost);
  const home = JSON.stringify(w.call('u-kid', 'home', { familyId: 'A' })); assert.doesNotMatch(home, /Gifts for Kit|Bike|Bea/);
  assert.ok(w.call('u-buy2', 'home', { familyId: 'A' }).lists.some(l => l.name === 'Gifts for Kit'), 'other adults see it');
  assert.equal(w.call('u-kid', 'itemSave', { familyId: 'A', listId: secret.id, title: 'x' }).error, 'not_available');
});
test('eligibility has no hidden bypass: an owner who is not marked as an adult is a kid', () => {
  const w = world(); w.a.setAdult('A', 'u-boss', false);
  assert.equal(w.call('u-boss', 'reserve', { familyId: 'A', itemId: w.item.id }).error, 'adults_only');
  assert.equal(w.call('u-boss', 'reports', { familyId: 'A' }).error, 'not_available', 'and cannot review reports');
  assert.equal(w.call('u-boss', 'members', { familyId: 'A' }).ok, true, 'but the role can still mark ages');
});

test('other family and nonexistent things get one identical answer; the body cannot name another user', () => {
  const w = world();
  const cross = w.call('u-out', 'listGet', { familyId: 'A', listId: w.list.id }), none = g(w, 'u-buy', 'nope');
  assert.deepEqual(cross, { ok: false, error: 'not_available', message: 'That is not available.' }); assert.deepEqual(none, cross);
  assert.equal(w.call('u-out', 'reserve', { familyId: 'B', itemId: w.item.id }).error, 'not_available');
  assert.equal(w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id, userId: 'u-buy2', buyerId: 'u-buy2' }).ok, true);
  assert.equal(JSON.parse(w.a.dump()).reservations[w.item.id].buyerId, 'u-buy');
});
test('only the owner can edit, delete or mark received', () => {
  const w = world();
  for (const [act, extra] of [['itemSave', { listId: w.list.id, itemId: w.item.id, title: 'Hack' }], ['itemDelete', { itemId: w.item.id }], ['itemReceived', { itemId: w.item.id }], ['listSave', { listId: w.list.id, name: 'x' }], ['listDelete', { listId: w.list.id }]])
    for (const u of ['u-buy', 'u-adm']) assert.equal(w.call(u, act, Object.assign({ familyId: 'A' }, extra)).error, 'not_available', u + ' ' + act);
});
test('edit flag: title, link and price changes mark the item for the buyer; notes and priority do not', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  const base = { familyId: 'A', listId: w.list.id, itemId: w.item.id, title: 'Mug', price: '10', currency: 'USD', url: '' };
  w.call('u-own', 'itemSave', Object.assign({}, base, { notes: 'new note', priority: 'high' }));
  assert.equal(g(w, 'u-buy').items[0].changedSinceReserved, false);
  w.call('u-own', 'itemSave', Object.assign({}, base, { price: '12' }));
  assert.equal(g(w, 'u-buy').items[0].changedSinceReserved, true);
  assert.equal(w.call('u-buy', 'home', { familyId: 'A' }).reservations[0].changedSinceReserved, true);
});
test('received or deleted closes the reservation and tells the buyer; the owner learns nothing', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.call('u-own', 'itemReceived', { familyId: 'A', itemId: w.item.id });
  const home = w.call('u-buy', 'home', { familyId: 'A' }); assert.equal(home.reservations.length, 0); assert.match(home.notices[0].text, /marked received/);
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).error, 'unavailable');
  const it2 = w.a.addItem(w.list.id, { title: 'Book' }); w.call('u-buy', 'reserve', { familyId: 'A', itemId: it2.id });
  w.call('u-own', 'itemDelete', { familyId: 'A', itemId: it2.id });
  assert.equal(w.call('u-buy', 'home', { familyId: 'A' }).notices.length, 2);
  assert.deepEqual(ownerLeaks(w.call('u-own', 'home', { familyId: 'A' })), []);
});
test('removed buyer: reservations released; removed owner: lists unreachable; re-invite starts clean and as a kid', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.a.removeMember('A', 'u-buy');
  assert.equal(w.call('u-buy', 'home', { familyId: 'A' }).error, 'not_available');
  assert.equal(w.call('u-buy2', 'reserve', { familyId: 'A', itemId: w.item.id }).ok, true);
  w.a.removeMember('A', 'u-own');
  assert.equal(g(w, 'u-buy2').error, 'not_available');
  w.a.reinvite('A', 'u-own');
  assert.equal(g(w, 'u-own').error, 'not_available', 'old list is not revived');
  assert.equal(w.call('u-own', 'home', { familyId: 'A' }).me.adult, false, 'a re-invited person is a kid again');
});

test('reporting: anyone who can see it, except its owner, can report; owners never learn who; repeats are quiet', () => {
  const w = world();
  assert.equal(w.call('u-own', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'other' }).error, 'own_content');
  assert.equal(w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'bad' }).fields.reason.length > 0, true, 'a reason is required');
  const r1 = w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'unsafe', note: 'Odd link' }), r2 = w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'unsafe' });
  assert.deepEqual(r1, r2, 'same answer on a repeat'); assert.equal(Object.keys(JSON.parse(w.a.dump()).reports).length, 1);
  assert.equal(w.call('u-buy', 'report', { familyId: 'A', kind: 'list', targetId: w.list.id, reason: 'other', note: 'x'.repeat(501) }).error, 'invalid');
  assert.equal(w.call('u-out', 'report', { familyId: 'B', kind: 'item', targetId: w.item.id, reason: 'other' }).error, 'not_available');
  assert.deepEqual(ownerLeaks(g(w, 'u-own')), []); assert.doesNotMatch(JSON.stringify(w.call("u-own", "home", { familyId: "A" })), /Kit|openReports/i);
});
test('reports are reviewed only by owners, admins and tree admins who are adults, and show content only', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'inappropriate', note: 'Not kind' });
  for (const u of ['u-own', 'u-buy', 'u-kid']) assert.equal(w.call(u, 'reports', { familyId: 'A' }).error, 'not_available', u);
  for (const u of ['u-boss', 'u-adm', 'u-tree']) { const r = w.call(u, 'reports', { familyId: 'A' }); assert.equal(r.reports.length, 1); assert.equal(r.reports[0].reporterName, 'Kit'); assert.doesNotMatch(JSON.stringify(r), /reserv|Bea|u-buy/i, u); assert.equal(w.call(u, 'home', { familyId: 'A' }).openReports, 1); }
  assert.equal(w.call('u-own', 'reportResolve', { familyId: 'A', reportId: 'p1', action: 'remove' }).error, 'not_available');
});
test('resolving a report: dismiss clears it; remove deletes the content, tells the owner without naming the reporter, and releases the reservation', () => {
  const w = world(); w.call('u-buy', 'reserve', { familyId: 'A', itemId: w.item.id });
  w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'other' });
  const id = w.call('u-adm', 'reports', { familyId: 'A' }).reports[0].id;
  assert.equal(w.call('u-adm', 'reportResolve', { familyId: 'A', reportId: id, action: 'dismiss' }).ok, true);
  assert.equal(w.call('u-adm', 'reports', { familyId: 'A' }).reports.length, 0); assert.equal(g(w, 'u-own').items.length, 1);
  w.call('u-kid', 'report', { familyId: 'A', kind: 'item', targetId: w.item.id, reason: 'other' });
  const id2 = w.call('u-adm', 'reports', { familyId: 'A' }).reports[0].id;
  assert.equal(w.call('u-adm', 'reportResolve', { familyId: 'A', reportId: id2, action: 'remove' }).ok, true);
  assert.equal(g(w, 'u-own').items.length, 0);
  const n = w.call('u-own', 'home', { familyId: 'A' }).notices; assert.match(n[0].text, /removed by a family admin/); assert.doesNotMatch(JSON.stringify(n), /Kit/);
  assert.match(w.call('u-buy', 'home', { familyId: 'A' }).notices[0].text, /no longer on the wishlist/);
});

test('limits and validation: titles, notes, urls, prices, currencies', () => {
  const w = world(), b = { familyId: 'A', listId: w.list.id };
  const bad = (f) => w.call('u-own', 'itemSave', Object.assign({}, b, { title: 'T' }, f));
  assert.ok(bad({ title: '  ' }).fields.title); assert.ok(bad({ title: 'x'.repeat(121) }).fields.title); assert.ok(bad({ notes: 'x'.repeat(1001) }).fields.notes);
  for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.b/c', 'https://user:pw@a.com', 'https://a b.com', 'http://localhost', '//a.com']) assert.ok(bad({ url: u }).fields.url, u);
  for (const p of ['abc', '-5', '1.234', '1e3', '0', '100001', '1,5']) assert.ok(bad({ price: p, currency: 'USD' }).fields.price, p);
  assert.ok(bad({ price: '5' }).fields.currency); assert.ok(bad({ price: '5', currency: 'JPY' }).fields.currency);
  for (const c of ['MXN', 'INR', 'NZD', 'CHF', 'PHP', 'NGN']) assert.equal(bad({ price: '5', currency: c }).ok, true, c);
  assert.equal(bad({ url: 'https://shop.example.com/a?b=1', price: '24.99', currency: 'USD' }).ok, true);
  assert.equal(bad({ price: '1,250.00', currency: 'USD' }).item.priceCents, 125000);
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
test('seeded sample world behaves as described', () => {
  const s = F.create(), fam = 'famA', call = s.call;
  const home = call('u-rae', 'home', { familyId: fam }), l = home.lists.find(x => x.name === 'Birthday ideas');
  const detail = call('u-rae', 'listGet', { familyId: fam, listId: l.id });
  assert.deepEqual(ownerLeaks(detail), []); assert.doesNotMatch(JSON.stringify(detail), /\bSam\b|\bTia\b|reserved/i);
  assert.equal(home.lists.some(x => /birthday gifts/.test(x.name)) , true, 'Rae is an adult and sees the adults-only list');
  assert.equal(call('u-riley', 'home', { familyId: fam }).lists.some(x => /birthday gifts/.test(x.name)), false, 'Riley (a kid) does not');
  assert.equal(call('u-una', 'home', { familyId: fam }).me.adult, false);
  assert.equal(call('u-ada', 'home', { familyId: fam }).canManageAges, true); assert.equal(call('u-rae', 'home', { familyId: fam }).canManageAges, false);
  assert.equal(call('u-sam', 'home', { familyId: fam }).reservations.length, 1);
  assert.equal(call('u-quinn', 'home', { familyId: fam }).error, 'not_available'); assert.equal(call('u-olive', 'home', { familyId: fam }).error, 'not_available');
});

test('the page never fetch()es a data: address (the page security rules block it); link pictures are decoded directly', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ui = fs.readFileSync(path.join(__dirname, '../../giving-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  assert.ok(!/fetch\(\s*r\.image/.test(ui) && !/fetch\(\s*['"]data:/.test(ui));
  const connect = /connect-src([^;]*)/.exec(html)[1];
  assert.ok(!/\bdata:/.test(connect), 'connect-src stays strict');
  assert.match(ui, /function dataUrlToFile/);
});

test('a long pasted shop link has its advertising parts removed (and variant choices kept) instead of being rejected', () => {
  const long = 'https://www.walmart.com/ip/Tamagotchi-nano-x-BTS-TinyTAN-Purple/939951644?wmlspartner=wlpa&selectedSellerId=16451&adid=22222222228939951644_16451_199492704626_24219758109&wl0=&wl1=g&wl2=m&wl3=823751273895&wl4=pla-2449037643288&wl5=9011339&wl6=&wl7=&wl8=&wl9=pla&wl10=120816664&wl11=online&wl12=939951644_16451&veh=sem&gad_source=1&gad_campaignid=24219758109&gbraid=0AAAAADmfBIp_l_WZFA5n5PpwqZNFhZ4CF&gclid=Cj0KCQiAzeXXBhCGARIsADO5-zHJiEEf2d9M1albChdcV4tRYnp5aOhKPqqSJbCXUcpL-3fkMYe3iY8aAh33EALw_wcB&sid=618f3ba2-e220-4d7d-bc36-2f10fa456214';
  assert.ok(long.length > 500);
  assert.equal(C.cleanUrl(long), 'https://www.walmart.com/ip/Tamagotchi-nano-x-BTS-TinyTAN-Purple/939951644?selectedSellerId=16451');
  assert.equal(C.cleanUrl('https://www.amazon.com/dp/B000?th=1&psc=1&utm_source=x&ref_=abc'), 'https://www.amazon.com/dp/B000?th=1&psc=1');
  assert.equal(C.cleanUrl('https://shop.example/a?color=blue&fbclid=zzz'), 'https://shop.example/a?color=blue');
  assert.equal(C.cleanUrl('https://shop.example/' + 'a'.repeat(600)), null, 'still too long after cleaning');
  assert.equal(C.cleanUrl('javascript:alert(1)'), null);
});
