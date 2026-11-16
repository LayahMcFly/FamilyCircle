/* Giving Center Phase C (gift exchanges): rule tests against the FAKE server. Run: node --test tests/giving/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../giving-core.js');
const F = require('../../giving-preview/giving-fake-server.js');

function seeded(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
function world() {
  const s = F.create({ seed: false }), a = s.admin;
  a.addFamily('A', 'Family A'); a.addFamily('B', 'Family B');
  [['own', 'Olive', 'owner'], ['ann', 'Ann', 'member'], ['bob', 'Bob', 'member'], ['cy', 'Cy', 'member'], ['dee', 'Dee', 'member']].forEach(p => a.addMember('A', p[0], p[1], p[2], true));
  a.addMember('A', 'kit', 'Kit', 'member', false); a.addMember('B', 'zed', 'Zed', 'member', true);
  const call = (u, act, b) => s.call(u, act, Object.assign({ familyId: 'A' }, b || {}));
  return { s, a, call };
}

test('drawPairs: always a permutation, never yourself, never an excluded pair (either direction)', () => {
  for (let i = 0; i < 3000; i++) {
    const rnd = seeded(i), n = 4 + (i % 8), ids = Array.from({ length: n }, (_, k) => 'p' + k);
    const ex = i % 3 === 0 ? [] : [[ids[0], ids[1]], [ids[2], ids[3 % n]]].filter(p => p[0] !== p[1]);
    const r = C.drawPairs(ids, ex, rnd); assert.ok(r.ok, 'draw ' + i);
    assert.equal(new Set(Object.values(r.pairs)).size, n);
    ids.forEach(g => { assert.ok(r.pairs[g]); assert.notEqual(r.pairs[g], g); });
    ex.forEach(p => { assert.notEqual(r.pairs[p[0]], p[1]); assert.notEqual(r.pairs[p[1]], p[0]); });
  }
});
test('drawPairs: refuses impossible rules and tiny groups instead of hanging', () => {
  assert.equal(C.drawPairs(['a', 'b'], []).ok, false);
  assert.equal(C.drawPairs(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]).ok, false);
  const t = Date.now(); assert.equal(C.drawPairs(Array.from({ length: 30 }, (_, i) => 'p' + i), Array.from({ length: 29 }, (_, i) => ['p0', 'p' + (i + 1)])).ok, false); assert.ok(Date.now() - t < 3000);
});
test('drawPairs: draws are not always the same (it is random)', () => {
  const seen = new Set(); for (let i = 0; i < 50; i++) seen.add(JSON.stringify(C.drawPairs(['a', 'b', 'c', 'd', 'e'], [], seeded(i)).pairs)); assert.ok(seen.size > 5);
});
test('validateExchange: name, date, limit, note and exclusion rules', () => {
  assert.ok(!C.validateExchange({ name: '' }).ok); assert.ok(!C.validateExchange({ name: 'x'.repeat(61) }).ok);
  assert.ok(!C.validateExchange({ name: 'a', date: '12/24' }).ok); assert.ok(C.validateExchange({ name: 'a', date: '2026-12-24' }).ok);
  assert.ok(!C.validateExchange({ name: 'a', limit: 'x'.repeat(31) }).ok); assert.ok(!C.validateExchange({ name: 'a', note: 'x'.repeat(301) }).ok);
  assert.ok(!C.validateExchange({ name: 'a', exclusions: [['a', 'a']] }, ['a']).ok);
  assert.ok(!C.validateExchange({ name: 'a', exclusions: [['a', 'z']] }, ['a', 'b']).ok);
  assert.equal(C.validateExchange({ name: 'a', exclusions: [['a', 'b'], ['b', 'a']] }, ['a', 'b']).value.exclusions.length, 1);
});

test('only adults see or join exchanges; other families and kids get "not available"', () => {
  const { call } = world(); const x = call('own', 'exchangeSave', { name: 'Holiday' }).exchange;
  ['kit'].forEach(u => assert.equal(call(u, 'exchangesHome').error, 'not_available'));
  assert.equal(call('kit', 'exchangeGet', { exchangeId: x.id }).error, 'not_available');
  assert.equal(call('kit', 'exchangeJoin', { exchangeId: x.id }).error, 'not_available');
  assert.equal(world().s.call('zed', 'exchangeGet', { familyId: 'A', exchangeId: x.id }).error, 'not_available');
  assert.equal(call('ann', 'exchangesHome').exchanges.length, 1);
});
test('join, leave, add and remove before the draw; only the organiser adds, removes, draws', () => {
  const { call } = world(); const x = call('own', 'exchangeSave', { name: 'Holiday' }).exchange;
  assert.equal(call('ann', 'exchangeJoin', { exchangeId: x.id }).exchange.members.length, 2);
  assert.equal(call('ann', 'exchangeAddMember', { exchangeId: x.id, userId: 'bob' }).error, 'not_available');
  assert.equal(call('ann', 'exchangeRemoveMember', { exchangeId: x.id, userId: 'own' }).error, 'not_available');
  assert.equal(call('ann', 'exchangeDraw', { exchangeId: x.id }).error, 'not_available');
  assert.equal(call('own', 'exchangeAddMember', { exchangeId: x.id, userId: 'kit' }).error, 'not_available');   // a kid cannot be added
  assert.equal(call('own', 'exchangeDraw', { exchangeId: x.id }).error, 'too_few');
  call('own', 'exchangeAddMember', { exchangeId: x.id, userId: 'bob' });
  assert.equal(call('ann', 'exchangeLeave', { exchangeId: x.id }).exchange.members.length, 2);
  assert.equal(call('own', 'exchangeLeave', { exchangeId: x.id }).error, 'organiser');
});
test('draw: everyone sees only their own match; the organiser sees nobody\'s; no response ever carries the pairs', () => {
  const { s, a, call } = world(); a.rand = seeded(7);
  const x = call('own', 'exchangeSave', { name: 'Holiday' }).exchange;
  ['ann', 'bob', 'cy'].forEach(u => call(u, 'exchangeJoin', { exchangeId: x.id }));
  call('own', 'exchangeSave', { exchangeId: x.id, name: 'Holiday', exclusions: [['ann', 'bob']] });
  assert.equal(call('own', 'exchangeDraw', { exchangeId: x.id }).ok, true);
  const truth = JSON.parse(s.admin.dump()).exchanges[x.id].pairs;
  assert.equal(call('own', 'exchangeDraw', { exchangeId: x.id }).error, 'already_drawn');
  ['own', 'ann', 'bob', 'cy'].forEach(u => {
    const v = call(u, 'exchangeGet', { exchangeId: x.id }).exchange, text = JSON.stringify([v, call(u, 'exchangesHome'), call(u, 'home')]);
    assert.equal(v.match.name, { own: 'Olive', ann: 'Ann', bob: 'Bob', cy: 'Cy' }[truth[u]], u + ' sees exactly their own match');
    assert.ok(!/"pairs"|"giver"|"receiver"/.test(text), 'no pairing field for ' + u);
    assert.equal((text.match(/"match":/g) || []).length, 1, 'only one match is ever shown to ' + u);
  });
  assert.notEqual(truth.ann, 'bob'); assert.notEqual(truth.bob, 'ann');
  assert.equal(call('dee', 'exchangeGet', { exchangeId: x.id }).exchange.match, undefined);   // an adult who did not join has no match to see
  assert.equal(call('ann', 'exchangeJoin', { exchangeId: x.id }).error, 'already_drawn');
});
test('the match sees only the lists they could already see (adults-only lists included for adults)', () => {
  const { a, call } = world(); a.rand = seeded(3);
  const x = call('own', 'exchangeSave', { name: 'H' }).exchange; ['ann', 'bob'].forEach(u => call(u, 'exchangeJoin', { exchangeId: x.id }));
  const l1 = a.addList('A', 'ann', 'Ann ideas'); a.addItem(l1.id, { title: 'Mug' }); a.addList('A', 'bob', 'Bob ideas');
  call('own', 'exchangeDraw', { exchangeId: x.id });
  const m = call('own', 'exchangeGet', { exchangeId: x.id }).exchange.match;
  assert.ok(['Ann', 'Bob'].includes(m.name)); if (m.name === 'Ann') assert.deepEqual(m.lists.map(l => l.name), ['Ann ideas']);
});
test('leaving after the draw: the organiser and whoever drew that person are told, and no one learns who drew whom', () => {
  const { s, a, call } = world(); a.rand = seeded(11);
  const x = call('own', 'exchangeSave', { name: 'H' }).exchange; ['ann', 'bob', 'cy'].forEach(u => call(u, 'exchangeJoin', { exchangeId: x.id }));
  call('own', 'exchangeDraw', { exchangeId: x.id }); ['own', 'ann', 'bob', 'cy'].forEach(u => a.clearNotices(u));
  const truth = JSON.parse(a.dump()).exchanges[x.id].pairs, giverOfAnn = Object.keys(truth).find(g => truth[g] === 'ann');
  call('ann', 'exchangeLeave', { exchangeId: x.id });
  const org = call('own', 'home').notices.map(n => n.text).join('|'); assert.match(org, /Ann left H/);
  assert.ok(!/drew|giving to|match/i.test(org) || giverOfAnn === 'own');   // the organiser is told only that Ann left
  const giver = call(giverOfAnn, 'exchangeGet', { exchangeId: x.id }).exchange; assert.equal(giver.matchLeft, true);
  ['bob', 'cy'].filter(u => u !== giverOfAnn).forEach(u => assert.equal(call(u, 'exchangeGet', { exchangeId: x.id }).exchange.match !== undefined, true));
  assert.equal(call('own', 'exchangeRedraw', { exchangeId: x.id }).ok, true);   // three people remain, so a redraw works
  ['bob', 'cy'].forEach(u => assert.ok(call(u, 'home').notices.some(n => /drawn again/.test(n.text))));
  assert.equal(call('own', 'exchangeGet', { exchangeId: x.id }).exchange.round, 2);
});
test('an impossible set of rules is refused with a plain message', () => {
  const { call } = world(); const x = call('own', 'exchangeSave', { name: 'H' }).exchange; ['ann', 'bob'].forEach(u => call(u, 'exchangeJoin', { exchangeId: x.id }));
  call('own', 'exchangeSave', { exchangeId: x.id, name: 'H', exclusions: [['own', 'ann'], ['own', 'bob']] });
  const r = call('own', 'exchangeDraw', { exchangeId: x.id }); assert.equal(r.error, 'cannot_draw'); assert.match(r.message, /Remove an exclusion/);
});
test('removing a member from the family drops them from exchanges; removing the organiser cancels them', () => {
  const { a, call } = world(); const x = call('own', 'exchangeSave', { name: 'H' }).exchange; ['ann', 'bob', 'cy'].forEach(u => call(u, 'exchangeJoin', { exchangeId: x.id }));
  a.removeMember('A', 'cy'); assert.equal(call('own', 'exchangeGet', { exchangeId: x.id }).exchange.members.length, 3);
  a.removeMember('A', 'own'); assert.equal(call('ann', 'exchangesHome').exchanges.length, 0);
});
test('delete tells everyone and erases the draw; edits are refused after the draw', () => {
  const { s, a, call } = world(); const x = call('own', 'exchangeSave', { name: 'H' }).exchange; ['ann', 'bob'].forEach(u => call(u, 'exchangeJoin', { exchangeId: x.id })); call('own', 'exchangeDraw', { exchangeId: x.id });
  assert.equal(call('own', 'exchangeSave', { exchangeId: x.id, name: 'New' }).error, 'not_available');
  a.clearNotices('ann'); assert.equal(call('own', 'exchangeDelete', { exchangeId: x.id }).ok, true);
  assert.deepEqual(JSON.parse(a.dump()).exchanges[x.id].pairs, {}); assert.ok(call('ann', 'home').notices.some(n => /was deleted/.test(n.text)));
  assert.equal(call('ann', 'exchangeGet', { exchangeId: x.id }).error, 'not_available');
});
