/* Giving Center Phase D1 (group gifts, a tracker only): rule tests against the FAKE server. Run: node --test tests/giving/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../giving-core.js');
const F = require('../../giving-preview/giving-fake-server.js');

function world() {
  const s = F.create({ seed: false }), a = s.admin;
  a.addFamily('A', 'Family A'); a.addFamily('B', 'Family B');
  [['own', 'Olive', 'owner'], ['ann', 'Ann', 'member'], ['bob', 'Bob', 'member'], ['cy', 'Cy', 'member']].forEach(p => a.addMember('A', p[0], p[1], p[2], true));
  a.addMember('A', 'kit', 'Kit', 'member', false); a.addMember('B', 'zed', 'Zed', 'member', true);
  return { s, a, call: (u, act, b) => s.call(u, act, Object.assign({ familyId: 'A' }, b || {})) };
}
const G = { title: 'Gran present', goal: '120', each: '20', currency: 'USD', forId: 'cy' };

test('validateGift and validateContribution: plain amounts only, required fields, limits', () => {
  assert.ok(C.validateGift({ title: 'a', goal: '120', currency: 'USD' }).ok);
  assert.ok(!C.validateGift({ title: '', goal: '120', currency: 'USD' }).ok); assert.ok(!C.validateGift({ title: 'a', goal: '', currency: 'USD' }).ok);
  assert.ok(!C.validateGift({ title: 'a', goal: 'abc', currency: 'USD' }).ok); assert.ok(!C.validateGift({ title: 'a', goal: '1,5', currency: 'USD' }).ok);
  assert.ok(!C.validateGift({ title: 'a', goal: '10', currency: 'XXX' }).ok); assert.ok(!C.validateGift({ title: 'a', goal: '10', each: 'x', currency: 'USD' }).ok);
  assert.ok(!C.validateGift({ title: 'a', goal: '10', currency: 'USD', forId: 'zz' }, ['a']).ok);
  assert.equal(C.validateGift({ title: 'a', goal: '99.5', each: '', currency: 'USD' }).value.goalCents, 9950);
  assert.ok(!C.validateContribution({ amount: '' }).ok); assert.ok(!C.validateContribution({ amount: '-5' }).ok); assert.equal(C.validateContribution({ amount: '20' }).value.cents, 2000);
});
test('only adults reach group gifts; the person it is for, kids and other families get "not available"', () => {
  const { call, s } = world(); const g = call('own', 'giftSave', G).gift;
  for (const u of ['kit', 'cy']) { assert.equal(call(u, 'giftGet', { giftId: g.id }).error, 'not_available', u); assert.equal(call(u, 'giftContribute', { giftId: g.id, amount: '5' }).error, 'not_available'); }
  assert.equal(call('kit', 'giftsHome').error, 'not_available'); assert.equal(call('cy', 'giftsHome').gifts.length, 0);
  assert.equal(s.call('zed', 'giftGet', { familyId: 'A', giftId: g.id }).error, 'not_available');
  assert.equal(call('ann', 'giftsHome').gifts.length, 1);
  assert.ok(!JSON.stringify(call('cy', 'home')).includes('Gran present'), 'the honoree is not even told');
  assert.ok(call('ann', 'home').notices.some(n => /started a group gift: Gran present/.test(n.text)));
  assert.ok(!call('cy', 'home').notices.some(n => /Gran/.test(n.text)));
});
test('marked, confirmed, declined and withdrawn contributions; totals count only confirmed money', () => {
  const { call } = world(); const g = call('own', 'giftSave', G).gift;
  call('ann', 'giftContribute', { giftId: g.id, amount: '20', note: 'Venmo' }); call('bob', 'giftContribute', { giftId: g.id, amount: '25.50' });
  let v = call('own', 'giftGet', { giftId: g.id }).gift; assert.equal(v.confirmedCents, 0); assert.equal(v.pendingCents, 4550); assert.equal(v.contributions.length, 2);
  assert.ok(call('own', 'home').notices.some(n => /Ann marked a contribution/.test(n.text)));
  call('own', 'giftConfirm', { giftId: g.id, userId: 'ann' }); call('own', 'giftDecline', { giftId: g.id, userId: 'bob' });
  v = call('own', 'giftGet', { giftId: g.id }).gift; assert.equal(v.confirmedCents, 2000); assert.equal(v.pendingCents, 0); assert.equal(v.contributions.length, 1);
  assert.ok(call('ann', 'home').notices.some(n => /was confirmed/.test(n.text))); assert.ok(call('bob', 'home').notices.some(n => /could not confirm/.test(n.text)));
  assert.equal(call('ann', 'giftContribute', { giftId: g.id, amount: '30' }).error, 'confirmed');
  assert.equal(call('ann', 'giftWithdraw', { giftId: g.id }).error, 'confirmed');
  call('bob', 'giftContribute', { giftId: g.id, amount: '10' }); assert.equal(call('bob', 'giftContribute', { giftId: g.id, amount: '15' }).gift.myCents, 1500);   // a marked one can be changed
  assert.equal(call('bob', 'giftWithdraw', { giftId: g.id }).gift.myCents, undefined);
  assert.equal(call('bob', 'giftContribute', { giftId: g.id, amount: 'abc' }).error, 'invalid');
});
test('privacy: only the organiser sees who gave what; others see the total and their own part', () => {
  const { call } = world(); const g = call('own', 'giftSave', G).gift;
  call('ann', 'giftContribute', { giftId: g.id, amount: '20' }); call('own', 'giftConfirm', { giftId: g.id, userId: 'ann' }); call('bob', 'giftContribute', { giftId: g.id, amount: '33' });
  const b = call('bob', 'giftGet', { giftId: g.id }).gift, text = JSON.stringify([b, call('bob', 'giftsHome')]);
  assert.equal(b.contributions, undefined); assert.equal(b.pendingCents, undefined); assert.equal(b.confirmedCents, 2000); assert.equal(b.myCents, 3300);
  assert.ok(!/Ann/.test(text.replace(/Ann Sample/g, '')) || !/"cents":2000/.test(text), 'bob never sees ann\'s amount by name');
  assert.ok(!/"userId":"ann"/.test(JSON.stringify(call('bob', 'giftGet', { giftId: g.id }))));
  for (const a of ['giftConfirm', 'giftDecline']) assert.equal(call('bob', a, { giftId: g.id, userId: 'ann' }).error, 'not_available');
  for (const a of ['giftSetStatus', 'giftDelete', 'giftSave']) assert.equal(call('bob', a, Object.assign({ giftId: g.id }, G)).error, 'not_available');
});
test('the organiser can record cash; the honoree and kids cannot be recorded; closing stops new contributions; the organiser\'s own part is confirmed', () => {
  const { call } = world(); const g = call('own', 'giftSave', G).gift;
  assert.equal(call('own', 'giftGet', { giftId: g.id }).gift.canRecord.some(p => p.userId === 'cy' || p.userId === 'kit'), false);
  assert.equal(call('own', 'giftRecord', { giftId: g.id, userId: 'cy', amount: '10' }).error, 'not_available');
  assert.equal(call('own', 'giftRecord', { giftId: g.id, userId: 'kit', amount: '10' }).error, 'not_available');
  assert.equal(call('own', 'giftRecord', { giftId: g.id, userId: 'ann', amount: '40' }).gift.confirmedCents, 4000);
  assert.ok(call('ann', 'home').notices.some(n => /recorded your contribution/.test(n.text)));
  assert.equal(call('own', 'giftContribute', { giftId: g.id, amount: '30' }).gift.confirmedCents, 7000);
  call('own', 'giftSetStatus', { giftId: g.id, closed: true });
  assert.equal(call('bob', 'giftContribute', { giftId: g.id, amount: '5' }).error, 'closed');
  assert.equal(call('own', 'giftSave', Object.assign({ giftId: g.id }, G)).error, 'not_available');   // closed gifts are not edited
  call('own', 'giftSetStatus', { giftId: g.id, closed: false }); assert.equal(call('bob', 'giftContribute', { giftId: g.id, amount: '5' }).ok, true);
});
test('goal reached is shown; changing who it is for removes that person\'s contribution; limits; delete tells contributors', () => {
  const { call, a } = world(); const g = call('own', 'giftSave', Object.assign({}, G, { goal: '40', forId: '' })).gift;
  call('ann', 'giftContribute', { giftId: g.id, amount: '40' }); call('own', 'giftConfirm', { giftId: g.id, userId: 'ann' });
  assert.equal(call('bob', 'giftGet', { giftId: g.id }).gift.reached, true);
  call('cy', 'giftContribute', { giftId: g.id, amount: '5' });
  call('own', 'giftSave', Object.assign({ giftId: g.id }, G, { goal: '40', forId: 'cy' }));   // now it is for cy: cy's part is dropped and cy loses access
  assert.equal(call('cy', 'giftGet', { giftId: g.id }).error, 'not_available'); assert.equal(call('own', 'giftGet', { giftId: g.id }).gift.contributions.some(c => c.userId === 'cy'), false);
  assert.equal(call('own', 'giftSave', { title: 'x', goal: '', currency: 'USD' }).error, 'invalid');
  for (let i = 0; i < 4; i++) call('own', 'giftSave', Object.assign({}, G, { title: 'G' + i }));
  assert.equal(call('own', 'giftSave', G).error, 'limit');
  a.clearNotices('ann'); call('own', 'giftDelete', { giftId: g.id });
  assert.ok(call('ann', 'home').notices.some(n => /was deleted/.test(n.text))); assert.equal(call('ann', 'giftGet', { giftId: g.id }).error, 'not_available');
});
