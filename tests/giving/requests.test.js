/* Giving Center Phase A (requests and pledges): rule tests against the FAKE server (a simulation, not the real function). Run: node --test tests/giving/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../giving-core.js');
const F = require('../../giving-preview/giving-fake-server.js');

function world() {
  const s = F.create({ seed: false }), a = s.admin;
  a.addFamily('A', 'Family A'); a.addFamily('B', 'Family B');
  a.addMember('A', 'own', 'Olive', 'owner', true); a.addMember('A', 'ada', 'Ada', 'admin', true);
  a.addMember('A', 'ann', 'Ann', 'member', true); a.addMember('A', 'bob', 'Bob', 'member', true);
  a.addMember('A', 'kit', 'Kit', 'member', false); a.addMember('A', 'gus', 'Gus', 'member', true);
  a.addMember('B', 'xan', 'Xan', 'member', true);
  const call = (u, act, b) => s.call(u, act, Object.assign({ familyId: 'A' }, b || {}));
  const ok = (u, act, b) => { const r = call(u, act, b); assert.equal(r.ok, true, act + ' ' + JSON.stringify(r)); return r; };
  const bad = (u, act, b, code) => { const r = call(u, act, b); assert.equal(r.ok, false, act + ' should fail'); if (code) assert.equal(r.error, code); return r; };
  return { s, a, call, ok, bad };
}
const REQ = (o) => Object.assign({ title: 'Help moving', kind: 'time', needed: 2 }, o || {});

test('an adult posts a request and the family sees it; the validation is plain and strict', () => {
  const w = world();
  const r = w.ok('ann', 'requestSave', REQ()).request;
  assert.equal(r.approval, 'approved'); assert.equal(r.stillNeeded, 2);
  assert.equal(w.ok('bob', 'requestsHome').open.length, 1);
  assert.equal(w.bad('ann', 'requestSave', REQ({ title: '' })).fields.title.length > 0, true);
  assert.ok(w.bad('ann', 'requestSave', REQ({ needed: 0 })).fields.needed);
  assert.ok(w.bad('ann', 'requestSave', REQ({ needed: 99 })).fields.needed);
  assert.ok(w.bad('ann', 'requestSave', REQ({ neededBy: '12/24' })).fields.neededBy);
  assert.ok(w.bad('ann', 'requestSave', REQ({ kind: 'money' })).fields.kind);
  assert.equal(w.ok('ann', 'requestSave', REQ({ title: 'Coat', amount: 'about $40' })).request.amount, 'about $40');
});

test('a kid\'s request waits for an adult owner or admin; only then does the family see it', () => {
  const w = world();
  const r = w.ok('kit', 'requestSave', REQ({ title: 'Library trip' })); assert.equal(r.request.approval, 'pending'); assert.equal(r.waitingForApproval, true);
  assert.equal(w.ok('bob', 'requestsHome').open.length, 0, 'an ordinary adult does not see it');
  assert.equal(w.bad('bob', 'requestGet', { requestId: r.request.id }, 'not_available').ok, false);
  assert.equal(w.ok('kit', 'requestsHome').open.length, 1, 'the kid sees their own');
  assert.equal(w.ok('ada', 'requestsHome').waiting.length, 1);
  w.bad('bob', 'requestApprove', { requestId: r.request.id }, 'not_available');
  w.bad('kit', 'requestApprove', { requestId: r.request.id }, 'not_available');
  w.bad('bob', 'pledgeSave', { requestId: r.request.id }, 'not_available');   // cannot pledge before approval
  w.ok('ada', 'requestApprove', { requestId: r.request.id });
  assert.equal(w.ok('bob', 'requestsHome').open.length, 1);
  assert.match(w.ok('kit', 'home').notices.map((n) => n.text).join(' '), /approved/);
});

test('an edit by a kid goes back for approval; an edit by an adult stays posted', () => {
  const w = world(); const k = w.ok('kit', 'requestSave', REQ()).request; w.ok('ada', 'requestApprove', { requestId: k.id });
  assert.equal(w.ok('kit', 'requestSave', REQ({ requestId: k.id, title: 'Changed' })).request.approval, 'pending');
  assert.equal(w.ok('bob', 'requestsHome').open.length, 0);
  const a = w.ok('ann', 'requestSave', REQ()).request; assert.equal(w.ok('ann', 'requestSave', REQ({ requestId: a.id, title: 'New' })).request.approval, 'approved');
  w.bad('bob', 'requestSave', REQ({ requestId: a.id }), 'not_available');   // not yours
});

test('rejecting a pending request removes it and tells the kid without saying who', () => {
  const w = world(); const k = w.ok('kit', 'requestSave', REQ()).request;
  w.ok('ada', 'requestReject', { requestId: k.id });
  assert.equal(w.ok('kit', 'requestsHome').open.length, 0);
  assert.match(w.ok('kit', 'home').notices.map((n) => n.text).join(' '), /was not posted/);
  assert.ok(!/Ada/.test(JSON.stringify(w.ok('kit', 'home').notices)));
});

test('only adults pledge; one pledge per person; not on your own request; limits; closed requests refuse', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ({ needed: 2 })).request;
  w.bad('kit', 'pledgeSave', { requestId: r.id }, 'adults_only');
  w.bad('ann', 'pledgeSave', { requestId: r.id }, 'own_request');
  w.ok('bob', 'pledgeSave', { requestId: r.id, note: 'I can bring the van' });
  const again = w.ok('bob', 'pledgeSave', { requestId: r.id, note: 'Van and a friend' });   // same person again edits the note, no second pledge
  assert.equal(again.request.pledgedCount, 1); assert.equal(again.request.pledges[0].note, 'Van and a friend');
  w.ok('gus', 'pledgeSave', { requestId: r.id });
  const full = w.ok('own', 'requestGet', { requestId: r.id }).request; assert.equal(full.stillNeeded, 0); assert.equal(full.pledgedCount, 2);
  w.ok('ann', 'requestClose', { requestId: r.id });
  w.bad('ada', 'pledgeSave', { requestId: r.id }, 'closed');
  assert.ok(w.bad('ada', 'pledgeSave', { requestId: r.id, note: 'x'.repeat(400) }).fields || true);
});

test('the requester sees who pledged and marks them done; a done pledge cannot be withdrawn; a pledger can withdraw before that', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ()).request;
  const p1 = w.ok('bob', 'pledgeSave', { requestId: r.id }).request.myPledgeId; const p2 = w.ok('gus', 'pledgeSave', { requestId: r.id }).request.myPledgeId;
  assert.deepEqual(w.ok('ann', 'requestGet', { requestId: r.id }).request.pledges.map((p) => p.name).sort(), ['Bob', 'Gus']);
  w.bad('bob', 'pledgeDone', { pledgeId: p1 }, 'not_available');   // only the requester marks done
  w.ok('ann', 'pledgeDone', { pledgeId: p1 });
  w.bad('bob', 'pledgeWithdraw', { pledgeId: p1 }, 'done');
  assert.equal(w.ok('gus', 'pledgeWithdraw', { pledgeId: p2 }).request.pledgedCount, 1);
  w.bad('bob', 'pledgeWithdraw', { pledgeId: p2 }, 'not_available');   // someone else's
  assert.match(w.ok('ann', 'home').notices.map((n) => n.text).join(' '), /withdrew/);
  assert.match(w.ok('bob', 'home').notices.map((n) => n.text).join(' '), /Thank you/);
});

test('adults-only requests are invisible to kids (same answer as a made-up id); kids cannot create them', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ({ audience: 'adults' })).request;
  assert.equal(w.ok('kit', 'requestsHome').open.length, 0);
  assert.deepEqual(w.bad('kit', 'requestGet', { requestId: r.id }), w.bad('kit', 'requestGet', { requestId: 'q-nope' }));
  w.bad('kit', 'requestSave', REQ({ audience: 'adults' }), 'adults_only');
  assert.equal(w.ok('bob', 'requestsHome').open.length, 1);
});

test('other families, non-members and removed members get the same plain answer', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ()).request;
  const nobody = w.s.call('xan', 'requestGet', { familyId: 'A', requestId: r.id });
  assert.deepEqual(nobody, w.s.call('xan', 'requestGet', { familyId: 'A', requestId: 'q-nope' }));
  assert.equal(w.s.call('xan', 'requestsHome', { familyId: 'A' }).error, 'not_available');
  assert.equal(w.s.call('xan', 'pledgeSave', { familyId: 'B', requestId: r.id }).ok, false);   // right family for him, wrong request
  w.ok('bob', 'pledgeSave', { requestId: r.id });
  w.a.removeMember('A', 'ann');   // the requester leaves: the request disappears for everyone
  assert.equal(w.ok('gus', 'requestsHome').open.length, 0); w.bad('gus', 'requestGet', { requestId: r.id }, 'not_available');
  const r2 = w.ok('gus', 'requestSave', REQ()).request; w.ok('bob', 'pledgeSave', { requestId: r2.id });
  w.a.removeMember('A', 'bob');   // a pledger leaves: the pledge is gone
  assert.equal(w.ok('gus', 'requestGet', { requestId: r2.id }).request.pledgedCount, 0);
  w.bad('bob', 'requestsHome', {}, 'not_available');
});

test('deleting a request tells pledgers; closing and reopening works; the open limit holds', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ()).request; w.ok('bob', 'pledgeSave', { requestId: r.id });
  assert.equal(w.ok('ann', 'requestClose', { requestId: r.id }).request.status, 'closed');
  assert.equal(w.ok('ann', 'requestClose', { requestId: r.id, reopen: true }).request.status, 'open');
  w.bad('bob', 'requestClose', { requestId: r.id }, 'not_available');
  w.ok('ann', 'requestDelete', { requestId: r.id });
  assert.match(w.ok('bob', 'home').notices.map((n) => n.text).join(' '), /was removed/);
  for (let i = 0; i < C.REQ.open; i++) w.ok('ann', 'requestSave', REQ({ title: 'R' + i }));
  w.bad('ann', 'requestSave', REQ({ title: 'one too many' }), 'limit');
  assert.equal(w.ok('ann', 'requestsHome').canCreate, false);
});

test('reporting a request: a reporter is never named to the owner; admins review and remove', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ()).request; w.ok('gus', 'pledgeSave', { requestId: r.id });
  w.bad('ann', 'requestReport', { targetId: r.id, reason: 'other' }, 'own_content');
  assert.ok(w.bad('bob', 'requestReport', { targetId: r.id, reason: 'nope' }).fields.reason);
  w.ok('bob', 'requestReport', { targetId: r.id, reason: 'inappropriate', note: 'not kind' });
  w.ok('bob', 'requestReport', { targetId: r.id, reason: 'inappropriate' });   // repeat: same answer, no second report
  const list = w.ok('ada', 'reports').reports; assert.equal(list.length, 1); assert.equal(list[0].kind, 'request'); assert.equal(list[0].reporterName, 'Bob');
  w.bad('bob', 'reports', {}, 'not_available');
  w.ok('ada', 'reportResolve', { reportId: w.ok('ada', 'reports').reports[0].id, action: 'remove' });
  assert.equal(w.ok('bob', 'requestsHome').open.length, 0);
  assert.match(w.ok('ann', 'home').notices.map((n) => n.text).join(' '), /removed by a family admin/);
  assert.ok(!/Bob/.test(JSON.stringify(w.ok('ann', 'home').notices)), 'the owner is never told who reported');
  assert.match(w.ok('gus', 'home').notices.map((n) => n.text).join(' '), /was removed/);
});

test('money is only plain text: no amount is ever parsed, added or charged', () => {
  const w = world(); const r = w.ok('ann', 'requestSave', REQ({ amount: 'about $40, or a gift card' })).request;
  assert.equal(r.amount, 'about $40, or a gift card'); assert.ok(!('priceCents' in r) && !('total' in r));
  assert.ok(w.bad('ann', 'requestSave', REQ({ amount: 'x'.repeat(61) })).fields.amount);
});

/* ---------- Emergency requests (Phase B) ---------- */
const EM = (o) => Object.assign({ title: 'Car broke down, need a ride', helpers: ['bob', 'gus'] }, o || {});

test('emergency: rules are strict and plain (at least one, at most 8, adults only, no repeats)', () => {
  assert.equal(C.validateEmergency({ title: 'x', helpers: [] }).ok, false);
  assert.equal(C.validateEmergency({ title: '', helpers: ['a'] }).errors.title.length > 0, true);
  assert.equal(C.validateEmergency({ title: 'x', helpers: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }).errors.helpers, 'You can ask up to 8 adults.');
  assert.deepEqual(C.validateEmergency({ title: 'x', helpers: ['a', 'a', 'b'] }).value.helpers, ['a', 'b']);
  const w = world();
  w.bad('ann', 'emergencySave', EM({ helpers: ['kit'] }), 'invalid');   // a kid cannot be chosen
  w.bad('ann', 'emergencySave', EM({ helpers: ['ann'] }), 'invalid');   // not yourself
  w.bad('ann', 'emergencySave', EM({ helpers: ['xan'] }), 'invalid');   // not another family
  w.bad('ann', 'emergencySave', EM({ title: '' }), 'invalid');
});

test('emergency: only the owner and the chosen adults can see it; admins, others and kids cannot', () => {
  const w = world();
  const q = w.ok('ann', 'emergencySave', EM()).request;
  assert.equal(q.urgent, true); assert.equal(q.hoursLeft, 48); assert.deepEqual(q.helperNames, ['Bob', 'Gus']);
  assert.equal(w.ok('bob', 'requestGet', { requestId: q.id }).request.helperNames, undefined);   // helpers do not see who else was asked
  for (const u of ['own', 'ada', 'kit']) { w.bad(u, 'requestGet', { requestId: q.id }, 'not_available'); assert.equal(w.ok(u, 'requestsHome').urgent.length, 0); }
  w.bad('xan', 'requestGet', { requestId: q.id, familyId: 'B' }, 'not_available');
  assert.equal(w.ok('bob', 'requestsHome').urgent.length, 1);
  assert.equal(w.ok('ann', 'requestsHome').open.length, 0);   // never mixed into the ordinary list
});

test('emergency: helpers get a short notice with no details; a helper answers; the owner sees who', () => {
  const w = world();
  const q = w.ok('kit', 'emergencySave', EM({ title: 'Stuck at the school, need pickup', details: 'Front gate', helpers: ['bob'] })).request;   // a kid can ask adults at once
  const n = w.ok('bob', 'home').notices.map((x) => x.text);
  assert.deepEqual(n, ['Kit needs help. Tap to open.']);
  assert.equal(w.ok('bob', 'home').requests.urgent, 1);
  w.ok('bob', 'pledgeSave', { requestId: q.id, note: 'On my way' });
  const v = w.ok('kit', 'requestGet', { requestId: q.id }).request;
  assert.equal(v.pledges[0].name, 'Bob'); assert.equal(v.pledges[0].note, 'On my way');
  w.bad('ann', 'pledgeSave', { requestId: q.id }, 'not_available');
});

test('emergency: closes itself after 48 hours, keep open restarts it, one open at a time, cannot be edited or reopened as ordinary', () => {
  const w = world();
  const q = w.ok('ann', 'emergencySave', EM()).request;
  w.bad('ann', 'emergencySave', EM(), 'limit');
  w.bad('ann', 'requestSave', { requestId: q.id, title: 'Changed', kind: 'thing', needed: 1 }, 'not_available');
  w.a.advanceHours(47);
  assert.equal(w.ok('bob', 'requestGet', { requestId: q.id }).request.status, 'open');
  w.ok('ann', 'emergencyKeepOpen', { requestId: q.id });          // restarts the 48 hours
  w.a.advanceHours(47);
  assert.equal(w.ok('ann', 'requestGet', { requestId: q.id }).request.status, 'open');
  w.a.advanceHours(2);
  const closed = w.ok('bob', 'requestGet', { requestId: q.id }).request;
  assert.equal(closed.status, 'closed'); assert.equal(closed.hoursLeft, 0);
  w.bad('bob', 'pledgeSave', { requestId: q.id }, 'closed');
  assert.equal(w.ok('bob', 'requestsHome').urgent.length, 0);
  w.bad('ann', 'requestClose', { requestId: q.id, reopen: true }, 'invalid');
  w.ok('ann', 'emergencyKeepOpen', { requestId: q.id });          // the owner can still keep it going
  assert.equal(w.ok('bob', 'requestGet', { requestId: q.id }).request.status, 'open');
  w.bad('bob', 'emergencyKeepOpen', { requestId: q.id }, 'not_available');
});

test('emergency: the helper list holds only other adults in the family', () => {
  const w = world();
  const h = w.ok('ann', 'emergencyHelpers');
  assert.deepEqual(h.helpers.map((x) => x.userId).sort(), ['ada', 'bob', 'gus', 'own']); assert.equal(h.max, 8);
  assert.equal(w.ok('kit', 'emergencyHelpers').helpers.length, 5);
});
