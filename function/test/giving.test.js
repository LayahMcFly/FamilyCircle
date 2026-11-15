import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, TABLES } from '../src/logic.js';
import { CHAT_TABLES } from '../src/chat.js';
import { GIVING_TABLES } from '../src/giving.js';
import { createRequire } from 'node:module';
const EXTRA_CFG = {};   // tests put stand-ins for the outside world here (link preview fetcher, GIF service)

/* ---------- in-memory fake of the server services (queries, unique keys, permissions) ---------- */
function makeWorld() {
  let seq = 0;
  const world = { tables: {}, teams: {}, clock: 1_800_000_000_000 };
  world.bump = (ms) => { world.clock += ms; };
  world.files = {};
  world.storage = {
    async getFile({ fileId }) { const f = world.files[fileId]; if (!f) { const e = new Error('nf'); e.code = 404; throw e; } return f; },
    async updateFile({ fileId, permissions }) { world.files[fileId].$permissions = permissions; return world.files[fileId]; },
    async deleteFile({ fileId }) { delete world.files[fileId]; },
    async listFiles() { return { files: [] }; },
    async createFile({ fileId, file, bucketId }) { world.files[fileId] = { $id: fileId, bucketId, buf: Buffer.from(await file.arrayBuffer()), $permissions: [] }; return world.files[fileId]; },
    async getFileDownload({ fileId }) { const f = world.files[fileId]; if (!f) { const e = new Error('nf'); e.code = 404; throw e; } return f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.length); },
  };
  for (const t of [...Object.values(TABLES), ...Object.values(CHAT_TABLES), ...Object.values(GIVING_TABLES)]) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });
  const UNIQUE = ['sendKey', 'channelKey', 'dmKey', 'reactionKey', 'blockKey', 'readKey', 'profileKey', 'itemId'];
  const match = (r, q) => {
    switch (q.method) {
      case 'equal': return q.values.includes(q.attribute === '$id' ? r.$id : r[q.attribute]);
      case 'notEqual': return !q.values.includes(r[q.attribute]);
      case 'greaterThan': return String(r[q.attribute]) > String(q.values[0]);
      case 'lessThan': return r[q.attribute] !== undefined && String(r[q.attribute]) < String(q.values[0]);
      case 'or': return q.values.some((v) => match(r, v));
      default: return true;
    }
  };
  const db = {
    async createRow({ tableId, rowId, data, permissions }) {
      const t = world.tables[tableId];
      if (!t) throw err(404, 'no table');
      const id = rowId === 'unique()' || rowId.startsWith('uniq') ? `r${++seq}` : rowId;
      for (const k of UNIQUE) if (data[k] !== undefined && [...t.values()].some((r) => r[k] === data[k])) throw err(409, 'unique');
      const row = { ...data, $id: id, $permissions: (permissions || []).slice(), $createdAt: new Date(world.clock + ++seq * 1000).toISOString() };
      t.set(id, row);
      return row;
    },
    async getRow({ tableId, rowId }) { const r = world.tables[tableId].get(rowId); if (!r) throw err(404, 'nope'); return r; },
    async updateRow({ tableId, rowId, data, permissions }) { const r = await db.getRow({ tableId, rowId }); Object.assign(r, data || {}); if (permissions) r.$permissions = permissions.slice(); return r; },
    async deleteRow({ tableId, rowId }) { await db.getRow({ tableId, rowId }); world.tables[tableId].delete(rowId); return {}; },
    async listRows({ tableId, queries = [] }) {
      const t = world.tables[tableId];
      if (!t) throw err(404, 'no table');
      let rows = [...t.values()];
      let limit = 25, order = null, cursor = null;
      for (const raw of queries) {
        const q = JSON.parse(raw);
        if (q.method === 'limit') limit = q.values[0];
        else if (q.method === 'orderDesc' || q.method === 'orderAsc') order = q;
        else if (q.method === 'cursorAfter') cursor = q.values[0];
        else rows = rows.filter((r) => match(r, q));
      }
      if (order) rows.sort((a, b) => String(a[order.attribute]).localeCompare(String(b[order.attribute])) * (order.method === 'orderDesc' ? -1 : 1));
      if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
      return { total: rows.length, rows: rows.slice(0, limit) };
    }
  };
  const users = {
    async listMemberships({ userId }) {
      const out = [];
      for (const [teamId, t] of Object.entries(world.teams)) for (const m of t.members) if (m.userId === userId) out.push({ teamId, teamName: t.name, userId, roles: m.roles, confirm: m.confirm });
      return { memberships: out };
    },
    async updateLabels() { return {}; }
  };
  const teams = {
    async getPrefs({ teamId }) { return { ...(world.teams[teamId].prefs || {}) }; },
    async updatePrefs({ teamId, prefs }) { world.teams[teamId].prefs = { ...prefs }; return prefs; },
    async listMemberships({ teamId }) { return { memberships: world.teams[teamId].members.map((m) => ({ ...m, teamId })) }; },
    async delete() { return {}; }
  };
  const api = createApi({ users, teams, db, storage: world.storage, cfg: { databaseId: 'family', bucketId: 'b', maxOwnedFamilies: 3, maxVideoMB: 15, familyStorageMB: 500, ...EXTRA_CFG }, now: () => world.clock + seq * 1000 + 500 });
  const U = (id) => ({ $id: id, emailVerification: true, status: true, labels: [] });
  const call = async (uid, action, body = {}) => { const r = await api.handle({ user: U(uid), body: { action, ...body }, deadline: Number.MAX_SAFE_INTEGER }); return r; };
  const ok = async (uid, action, body) => { const r = await call(uid, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`); return r.json; };
  const fail = async (uid, action, body, status, code) => { const r = await call(uid, action, body); assert.equal(r.status, status, `${action} should fail ${status}: ${JSON.stringify(r.json)}`); if (code) assert.equal(r.json.error, code); return r.json; };
  const addFamily = async (fid, ownerId, memberIds) => {
    world.teams[fid] = { name: 'Fam ' + fid, members: [{ userId: ownerId, roles: ['owner'], confirm: true }, ...memberIds.map((u) => ({ userId: u, roles: ['member'], confirm: true }))] };
    await db.createRow({ tableId: 'families', rowId: fid, data: { ownerId, name: 'Fam ' + fid }, permissions: [] });
    for (const u of [ownerId, ...memberIds]) await db.createRow({ tableId: 'profiles', rowId: 'unique()', data: { familyId: fid, userId: u, profileKey: `${fid}_${u}`, displayName: u }, permissions: [] });
  };
  const removeMember = (fid, uid) => { world.teams[fid].members = world.teams[fid].members.filter((m) => m.userId !== uid); };
  return { world, api, call, ok, fail, addFamily, removeMember };
}
const rows = (w, t) => [...w.world.tables[t].values()];
const DAY = 864e5;
const F = (extra = {}) => ({ familyId: 'famA', ...extra });
/* famA: owner (adult), tia (tree admin, a kid until marked), ann, bob (adults), kid (kid). Giving Center is on unless asked otherwise. */
async function setup({ on = true } = {}) {
  const w = makeWorld();
  await w.addFamily('famA', 'owner', ['tia', 'ann', 'bob', 'kid']);
  await w.addFamily('famB', 'zed', ['yan']);
  await w.ok('owner', 'setTreeAdmin', F({ userId: 'tia', admin: true }));
  if (on) {
    await w.ok('owner', 'givingSetEnabled', F({ enabled: true }));
    for (const u of ['ann', 'bob']) await w.ok('owner', 'givingMemberSetAdult', F({ userId: u, adult: true }));
  }
  return w;
}
const mkList = async (w, uid, name = 'Wishes', audience) => (await w.ok(uid, 'givingListSave', F({ name, audience }))).list;
const mkItem = async (w, uid, listId, extra = {}) => (await w.ok(uid, 'givingItemSave', F({ listId, title: 'Blue mug', ...extra }))).item;
const RESERVATION_WORDS = /reserv|buyer|taken/i;
/** Every key anywhere in an object, so a leaked field cannot hide inside a nested value. */
const keysOf = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keysOf(v, out); } return out; };
const call404 = async (w, u, a, b) => { const r = await w.call(u, a, b); assert.equal(r.status, 404); return r.json; };

test('the rules match the preview you tested: same answers for prices, links, items, reports', async () => {
  const P = createRequire(import.meta.url)('../../giving-core.js');
  const M = await import('../src/giving-rules.js');
  for (const x of ['25', '24.99', '1,250.00', '1,5', '0', '', 'abc', '100000', '100001', ' 12.5 ']) assert.equal(M.parseAmount(x), P.parseAmount(x), 'price ' + x);
  for (const x of ['https://a.example.com/x', 'javascript:alert(1)', 'http://u:p@a.com', 'data:text/html,hi', 'a b.com', '', 'https://nodot']) assert.equal(M.cleanUrl(x), P.cleanUrl(x), 'url ' + x);
  const items = [{ title: 'A', price: '10', currency: 'USD' }, { title: '', notes: 'x' }, { title: 'T', priority: 'huge' }, { title: 'T', price: '5' }, { title: 'T', url: 'ftp://x.com' }];
  for (const b of items) assert.deepEqual(M.validateItem(b), P.validateItem(b));
  assert.deepEqual(Object.keys(M.CURRENCIES), Object.keys(P.CURRENCIES));
  assert.deepEqual(M.LIMITS, P.LIMITS);
  for (const b of [{ reason: 'other', note: 'x' }, { reason: 'nope' }, { reason: 'other', note: 'x'.repeat(501) }]) assert.deepEqual(M.validateReport(b), P.validateReport(b));
});

test('off by default: nothing works until the owner turns it on, and only the owner can', async () => {
  const w = await setup({ on: false });
  const st = await w.ok('ann', 'givingStatus', F());
  assert.equal(st.enabled, false); assert.equal(st.canTurnOn, false);
  for (const a of ['givingHome', 'givingListSave', 'givingMembers']) await w.fail('ann', a, F({ name: 'x' }), 404, 'not_available');
  await w.fail('tia', 'givingSetEnabled', F({ enabled: true }), 403);
  await w.fail('ann', 'givingSetEnabled', F({ enabled: true }), 403);
  await w.fail('zed', 'givingSetEnabled', F({ enabled: true }), 403);   // another family's owner
  assert.equal((await w.ok('owner', 'givingSetEnabled', F({ enabled: true }))).enabled, true);
  await w.ok('ann', 'givingHome', F());
  assert.equal((await w.ok('ann', 'givingStatus', F())).enabled, true);
  await w.ok('owner', 'givingSetEnabled', F({ enabled: false }));
  await w.fail('ann', 'givingHome', F(), 404, 'not_available');
  await w.fail('yan', 'givingHome', F(), 403);   // not in the family at all
});

test('giving tables hold no client permissions', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  await w.ok('kid', 'givingReport', F({ kind: 'list', targetId: l.id, reason: 'other' }));
  for (const t of Object.values(GIVING_TABLES)) for (const r of rows(w, t)) assert.deepEqual(r.$permissions, [], t);
  assert.ok(rows(w, 'givingReservations').length === 1 && rows(w, 'givingState').length === 1);
});

test('adult flag: everyone starts as a kid, owners are adults, only managers set it, never for themselves', async () => {
  const w = await setup();
  const home = (u) => w.ok(u, 'givingHome', F());
  assert.equal((await home('owner')).me.adult, true);
  assert.equal((await home('ann')).me.adult, true);
  assert.equal((await home('kid')).me.adult, false);
  const tia = await home('tia');
  assert.equal(tia.me.adult, false);          // a tree admin is a manager but still a kid until marked
  assert.equal(tia.canManageAges, true);
  assert.equal(tia.canModerate, false);       // moderating needs a manager who is also an adult
  assert.equal((await home('ann')).canManageAges, false);
  await w.fail('ann', 'givingMemberSetAdult', F({ userId: 'kid', adult: true }), 404, 'not_available');   // adults who are not managers cannot
  await w.fail('kid', 'givingMembers', F(), 404);
  await w.fail('tia', 'givingMemberSetAdult', F({ userId: 'tia', adult: true }), 400, 'self');
  await w.fail('owner', 'givingMemberSetAdult', F({ userId: 'owner', adult: true }), 400, 'self');
  await w.fail('tia', 'givingMemberSetAdult', F({ userId: 'owner', adult: false }), 400, 'owner');
  await w.fail('tia', 'givingMemberSetAdult', F({ userId: 'yan', adult: true }), 404);   // not in this family
  await w.ok('owner', 'givingMemberSetAdult', F({ userId: 'tia', adult: true }));
  assert.equal((await home('tia')).canModerate, true);
  const list = (await w.ok('tia', 'givingMembers', F())).members;
  assert.equal(list.find((m) => m.userId === 'tia').self, true);
  assert.equal(list.find((m) => m.userId === 'kid').adult, false);
  assert.equal(list.find((m) => m.userId === 'owner').adult, true);
  await w.fail('zed', 'givingMemberSetAdult', { familyId: 'famA', userId: 'kid', adult: true }, 403);
});

test('adult flag is per family: an adult in one family is a kid in another', async () => {
  const w = await setup();
  await w.addFamily('famC', 'ann', ['bob']);
  await w.ok('ann', 'givingSetEnabled', { familyId: 'famC', enabled: true });
  assert.equal((await w.ok('bob', 'givingHome', { familyId: 'famC' })).me.adult, false);   // bob is an adult in famA only
  assert.equal((await w.ok('bob', 'givingHome', F())).me.adult, true);
});

test('a missing givingAdult value reads as a kid', async () => {
  const w = await setup();
  const prof = [...w.world.tables.profiles.values()].find((p) => p.userId === 'kid' && p.familyId === 'famA');
  assert.equal(prof.givingAdult, undefined);
  assert.equal((await w.ok('kid', 'givingHome', F())).me.adult, false);
});

test('lists: limits, validation, audience rules, owner-only edits, uniform not-available', async () => {
  const w = await setup();
  await w.fail('ann', 'givingListSave', F({ name: '  ' }), 400, 'invalid');
  await w.fail('ann', 'givingListSave', F({ name: 'x'.repeat(61) }), 400, 'invalid');
  const a = await mkList(w, 'ann', '  Birthday  ');
  assert.equal(a.name, 'Birthday');
  await w.fail('kid', 'givingListSave', F({ name: 'Gift ideas', audience: 'adults' }), 403, 'adults_only');
  const k = await mkList(w, 'kid', 'Bubble stuff');
  await w.fail('kid', 'givingListSave', F({ listId: k.id, name: 'Bubble stuff', audience: 'adults' }), 403, 'adults_only');
  const secret = await mkList(w, 'ann', 'For the kid', 'adults');
  assert.equal(secret.audience, 'adults');
  const seen = (u) => w.ok(u, 'givingHome', F()).then((h) => h.lists.map((l) => l.name));
  assert.deepEqual((await seen('kid')).sort(), ['Birthday', 'Bubble stuff']);       // adults-only list is not even listed
  assert.ok((await seen('bob')).includes('For the kid'));
  const gone = await call404(w, 'kid', 'givingListGet', F({ listId: secret.id }));
  const never = await call404(w, 'kid', 'givingListGet', F({ listId: 'doesnotexist' }));
  assert.deepEqual(gone, never);                                                     // a kid cannot tell "hidden" from "nothing there"
  await w.fail('bob', 'givingListSave', F({ listId: a.id, name: 'Mine now' }), 404);
  await w.fail('bob', 'givingListDelete', F({ listId: a.id }), 404);
  await w.fail('zed', 'givingListGet', { familyId: 'famB', listId: a.id }, 404);      // another family's id
  for (let i = 0; i < 8; i++) await mkList(w, 'ann', 'L' + i);                       // ann now has 10
  await w.fail('ann', 'givingListSave', F({ name: 'eleventh' }), 409, 'limit');
  assert.equal((await w.ok('ann', 'givingHome', F())).canCreateList, false);
});

test('items: validation, 100 limit, owner-only, safe links, currencies never mixed', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann');
  await w.fail('ann', 'givingItemSave', F({ listId: l.id, title: '' }), 400, 'invalid');
  await w.fail('ann', 'givingItemSave', F({ listId: l.id, title: 'x', url: 'javascript:alert(1)' }), 400, 'invalid');
  await w.fail('ann', 'givingItemSave', F({ listId: l.id, title: 'x', price: '1,5', currency: 'USD' }), 400, 'invalid');
  await w.fail('ann', 'givingItemSave', F({ listId: l.id, title: 'x', price: '5' }), 400, 'invalid');   // price without a currency
  await w.fail('ann', 'givingItemSave', F({ listId: l.id, title: 'x', notes: 'n'.repeat(1001) }), 400, 'invalid');
  await w.fail('bob', 'givingItemSave', F({ listId: l.id, title: 'sneaky' }), 404);
  const a = await mkItem(w, 'ann', l.id, { price: '10', currency: 'USD' });
  await mkItem(w, 'ann', l.id, { title: 'Pen', price: '4', currency: 'EUR' });
  const got = await w.ok('ann', 'givingListGet', F({ listId: l.id }));
  assert.deepEqual(got.totals.map((t) => t.currency), ['EUR', 'USD']);
  assert.equal(a.mine, true);
  for (let i = 0; i < 98; i++) { w.world.bump(61000); await w.ok('ann', 'givingItemSave', F({ listId: l.id, title: 'i' + i })); }
  await w.fail('ann', 'givingItemSave', F({ listId: l.id, title: 'one too many' }), 409, 'limit');
});

test('SURPRISE: the owner and kids never get a reservation field; adults see only "reserved", never who', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  for (const u of ['ann', 'kid']) {
    const got = await w.ok(u, 'givingListGet', F({ listId: l.id })), home = await w.ok(u, 'givingHome', F());
    const bad = keysOf(got).filter((k) => RESERVATION_WORDS.test(k));
    assert.deepEqual(bad, [], u + ' leaked ' + bad);
    assert.deepEqual(home.reservations, []);                                  // home only ever lists the caller's OWN reservations
    assert.deepEqual(keysOf(home.lists).filter((k) => RESERVATION_WORDS.test(k)), []);
    for (const r of [got, home]) assert.ok(!JSON.stringify(r).includes('bob'), u + ' saw the buyer');
  }
  const owner = await w.ok('ann', 'givingHome', F());
  assert.equal(owner.notices.length, 0);                                    // the owner is never notified of a reservation
  assert.equal(rows(w, 'givingNotices').filter((n) => n.userId === 'ann').length, 0);
  const other = (await w.ok('owner', 'givingListGet', F({ listId: l.id }))).items[0];
  assert.equal(other.reserved, true);
  assert.equal(other.reservedByMe, undefined);
  assert.ok(!JSON.stringify(other).includes('bob'));
  const buyer = (await w.ok('bob', 'givingListGet', F({ listId: l.id }))).items[0];
  assert.equal(buyer.reservedByMe, true);
  assert.equal((await w.ok('bob', 'givingHome', F())).reservations.length, 1);
  const saved = (await w.ok('ann', 'givingItemSave', F({ listId: l.id, itemId: it.id, title: 'Blue mug' }))).item;
  assert.deepEqual(keysOf(saved).filter((k) => RESERVATION_WORDS.test(k)), []);   // even the owner's own save answer carries nothing
});

test('reserving: one winner, kids cannot, not your own, release only your own, received frees it', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  await w.fail('ann', 'givingReserve', F({ itemId: it.id }), 400, 'own_item');
  await w.fail('kid', 'givingReserve', F({ itemId: it.id }), 403, 'adults_only');
  await w.fail('tia', 'givingReserve', F({ itemId: it.id }), 403, 'adults_only');      // a tree admin who is not marked an adult
  const [x, y] = await Promise.all([w.call('bob', 'givingReserve', F({ itemId: it.id })), w.call('owner', 'givingReserve', F({ itemId: it.id }))]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);                           // exactly one winner
  assert.equal(rows(w, 'givingReservations').length, 1);
  const winner = x.status === 200 ? 'bob' : 'owner', loser = winner === 'bob' ? 'owner' : 'bob';
  await w.fail(loser, 'givingReserve', F({ itemId: it.id }), 409, 'taken');
  assert.equal((await w.ok(winner, 'givingReserve', F({ itemId: it.id }))).already, true);   // asking twice is safe
  await w.fail(loser, 'givingRelease', F({ itemId: it.id }), 404);                      // someone else's looks like none
  await w.ok(winner, 'givingRelease', F({ itemId: it.id }));
  await w.ok(loser, 'givingReserve', F({ itemId: it.id }));
  await w.ok('ann', 'givingItemReceived', F({ itemId: it.id }));
  assert.equal(rows(w, 'givingReservations').length, 0);
  assert.ok((await w.ok(loser, 'givingHome', F())).notices.some((n) => /marked received/.test(n.text)));
  await w.fail('bob', 'givingReserve', F({ itemId: it.id }), 409, 'unavailable');
  const sec = await mkList(w, 'ann', 'secret', 'adults'); const si = await mkItem(w, 'ann', sec.id);
  await w.fail('kid', 'givingReserve', F({ itemId: si.id }), 404, 'not_available');      // a kid cannot reach an adults-only item
});

test('a changed item tells the buyer; a notes-only edit does not', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id, { price: '10', currency: 'USD' });
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  await w.ok('ann', 'givingItemSave', F({ listId: l.id, itemId: it.id, title: 'Blue mug', price: '10', currency: 'USD', notes: 'any blue', priority: 'high' }));
  assert.equal((await w.ok('bob', 'givingHome', F())).reservations[0].changedSinceReserved, false);
  await w.ok('ann', 'givingItemSave', F({ listId: l.id, itemId: it.id, title: 'Blue mug', price: '12', currency: 'USD' }));
  assert.equal((await w.ok('bob', 'givingHome', F())).reservations[0].changedSinceReserved, true);
});

test('deleting items and lists releases reservations and tells the buyer', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const a = await mkItem(w, 'ann', l.id), b = await mkItem(w, 'ann', l.id, { title: 'Pen' });
  await w.ok('bob', 'givingReserve', F({ itemId: a.id })); await w.ok('bob', 'givingReserve', F({ itemId: b.id }));
  await w.fail('bob', 'givingItemDelete', F({ itemId: a.id }), 404);
  await w.ok('ann', 'givingItemDelete', F({ itemId: a.id }));
  assert.equal(rows(w, 'givingReservations').length, 1);
  await w.ok('ann', 'givingListDelete', F({ listId: l.id }));
  assert.equal(rows(w, 'givingReservations').length + rows(w, 'givingItems').length + rows(w, 'givingLists').length, 0);
  assert.equal((await w.ok('bob', 'givingHome', F())).notices.length, 2);
});

test('turning someone back into a kid releases their reservations', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  await w.ok('owner', 'givingMemberSetAdult', F({ userId: 'bob', adult: false }));
  assert.equal(rows(w, 'givingReservations').length, 0);
  const h = await w.ok('bob', 'givingHome', F());
  assert.equal(h.me.adult, false);
  assert.deepEqual(h.notices.map((n) => n.text), ['Your gift reservations were released.']);
  await w.fail('bob', 'givingReserve', F({ itemId: it.id }), 403, 'adults_only');
});

test('removed members: lists hide at once, reservations free, lists are deleted after 30 days', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann', 'Ann list'); const it = await mkItem(w, 'ann', l.id);
  const bl = await mkList(w, 'bob', 'Bob list'); const bi = await mkItem(w, 'bob', bl.id);
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  await w.ok('ann', 'givingReserve', F({ itemId: bi.id }));
  w.removeMember('famA', 'ann');
  await w.fail('ann', 'givingHome', F(), 403);
  const h = await w.ok('owner', 'givingHome', F());
  assert.deepEqual(h.lists.map((x) => x.name), ['Bob list']);
  await w.fail('owner', 'givingListGet', F({ listId: l.id }), 404);
  assert.equal(rows(w, 'givingReservations').filter((r) => r.buyerId === 'ann').length, 0);
  assert.equal((await w.ok('bob', 'givingHome', F())).notices.filter((n) => /no longer available/.test(n.text)).length, 1);
  assert.ok(rows(w, 'givingLists').find((r) => r.$id === l.id).hiddenAt);          // hidden, not deleted yet
  w.world.bump(29 * DAY); await w.ok('owner', 'givingHome', F());
  assert.ok(rows(w, 'givingLists').some((r) => r.$id === l.id));                    // day 29: still kept
  w.world.bump(2 * DAY); await w.ok('owner', 'givingHome', F());
  assert.ok(!rows(w, 'givingLists').some((r) => r.$id === l.id));                   // day 31: gone
  assert.ok(!rows(w, 'givingItems').some((r) => r.$id === it.id));
});

test('scheduled cleanup deletes lists hidden for 30 days even if nobody opens Giving Center', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); await mkItem(w, 'ann', l.id);
  w.removeMember('famA', 'ann');
  await w.ok('owner', 'givingHome', F());
  w.world.bump(31 * DAY);
  const out = await w.api.handle({ user: null, body: {}, deadline: Number.MAX_SAFE_INTEGER });
  assert.equal(out.status, 200);
  assert.equal(out.json.givingPurged, 1);
  assert.equal(rows(w, 'givingLists').length + rows(w, 'givingItems').length, 0);
});

test('a re-invited person does not get hidden lists back and comes back as a kid', async () => {
  const w = await setup();
  await mkList(w, 'ann');
  w.removeMember('famA', 'ann');
  await w.ok('owner', 'givingHome', F());                                           // hides the list
  w.world.teams.famA.members.push({ userId: 'ann', roles: ['member'], confirm: true });
  const prof = [...w.world.tables.profiles.values()].find((p) => p.userId === 'ann' && p.familyId === 'famA');
  prof.givingAdult = false;                                                        // a fresh membership starts as a kid
  const h = await w.ok('ann', 'givingHome', F());
  assert.equal(h.lists.length, 0);
  assert.equal(h.me.adult, false);
});

test('reports: anyone can report, owners are not told who, only adult managers review, resolve works', async () => {
  const w = await setup();
  await w.ok('owner', 'givingMemberSetAdult', F({ userId: 'tia', adult: true }));
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id, { url: 'https://shop.example.com/x' });
  await w.fail('ann', 'givingReport', F({ kind: 'item', targetId: it.id, reason: 'other' }), 400, 'own_content');
  await w.fail('kid', 'givingReport', F({ kind: 'item', targetId: it.id, reason: 'bogus' }), 400, 'invalid');
  const first = await w.ok('kid', 'givingReport', F({ kind: 'item', targetId: it.id, reason: 'unsafe', note: 'looks odd' }));
  const again = await w.ok('kid', 'givingReport', F({ kind: 'item', targetId: it.id, reason: 'unsafe', note: 'looks odd' }));
  assert.equal(first.message, again.message);
  assert.equal(rows(w, 'givingReports').length, 1);                                // a repeat is not a second row
  await w.ok('bob', 'givingReport', F({ kind: 'list', targetId: l.id, reason: 'other' }));
  for (const u of ['ann', 'bob', 'kid']) await w.fail(u, 'givingReports', F(), 404);
  assert.equal((await w.ok('ann', 'givingHome', F())).openReports, undefined);
  const view = await w.ok('tia', 'givingReports', F());
  assert.equal(view.reports.length, 2);
  assert.ok(!keysOf(view).some((k) => RESERVATION_WORDS.test(k)));
  assert.equal((await w.ok('owner', 'givingHome', F())).openReports, 2);
  const dismiss = view.reports.find((r) => r.kind === 'list');
  await w.ok('owner', 'givingReportResolve', F({ reportId: dismiss.id, resolution: 'dismiss' }));
  assert.equal(rows(w, 'givingReports').length, 1);
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  const rep = view.reports.find((r) => r.kind === 'item');
  await w.fail('kid', 'givingReportResolve', F({ reportId: rep.id, resolution: 'remove' }), 404);
  await w.ok('tia', 'givingReportResolve', F({ reportId: rep.id, resolution: 'remove' }));
  assert.equal(rows(w, 'givingItems').length, 0);
  assert.equal(rows(w, 'givingReservations').length, 0);
  const told = (await w.ok('ann', 'givingHome', F())).notices.map((n) => n.text);
  assert.deepEqual(told, ['An item on your wishlist was removed by a family admin.']);
  assert.ok(!JSON.stringify(told).match(/kid|bob|tia|report/i));                    // the owner never learns who reported
  await w.fail('zed', 'givingReportResolve', { familyId: 'famB', reportId: rep.id, resolution: 'dismiss' }, 404);
});

test('reports: kids cannot report what they cannot see; a person is capped at 20', async () => {
  const w = await setup();
  const secret = await mkList(w, 'ann', 'secret', 'adults');
  await w.fail('kid', 'givingReport', F({ kind: 'list', targetId: secret.id, reason: 'other' }), 404, 'not_available');
  const l = await mkList(w, 'ann');
  for (let i = 0; i < 20; i++) { w.world.bump(61000); const it = await mkItem(w, 'ann', l.id, { title: 't' + i }); await w.ok('bob', 'givingReport', F({ kind: 'item', targetId: it.id, reason: 'other' })); }
  const extra = await mkItem(w, 'ann', l.id, { title: 'extra' });
  await w.fail('bob', 'givingReport', F({ kind: 'item', targetId: extra.id, reason: 'other' }), 429, 'limit');
});

test('notices can be dismissed only by their owner', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  await w.ok('ann', 'givingItemDelete', F({ itemId: it.id }));
  const n = (await w.ok('bob', 'givingHome', F())).notices[0];
  await w.ok('owner', 'givingNoticeDismiss', F({ noticeId: n.id }));
  assert.equal((await w.ok('bob', 'givingHome', F())).notices.length, 1);
  await w.ok('bob', 'givingNoticeDismiss', F({ noticeId: n.id }));
  assert.equal((await w.ok('bob', 'givingHome', F())).notices.length, 0);
});

test('slow down: more than 60 giving actions a minute from one person are refused', async () => {
  const w = await setup();
  let refused = 0;
  for (let i = 0; i < 70; i++) if ((await w.call('ann', 'givingStatus', F())).status === 429) refused++;
  assert.ok(refused >= 5);
});

/* ---------- photos ---------- */
const jpegUrl = (bytes, fill = 7) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes, fill)]).toString('base64');
const photoOf = (w) => rows(w, 'givingItems')[0];

test('photos: the owner adds one; the small picture rides with the list, the full one is fetched on request', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  const thumb = jpegUrl(500), photo = jpegUrl(5000);
  const saved = (await w.ok('ann', 'givingPhotoSave', F({ itemId: it.id, thumb, photo }))).item;
  assert.equal(saved.thumb, thumb);
  assert.equal(Object.keys(w.world.files).length, 1);
  assert.deepEqual(rows(w, 'givingItems')[0].$permissions, []);
  assert.equal(w.world.files[Object.keys(w.world.files)[0]].$permissions.length, 0);           // the file has no client permission at all
  for (const u of ['ann', 'bob', 'kid']) assert.equal((await w.ok(u, 'givingListGet', F({ listId: l.id }))).items[0].thumb, thumb);
  assert.equal((await w.ok('bob', 'givingPhotoGet', F({ itemId: it.id }))).photo, photo);
  assert.equal((await w.ok('kid', 'givingPhotoGet', F({ itemId: it.id }))).photo, photo);       // kids may see the pictures on lists they can see
  await w.fail('zed', 'givingPhotoGet', { familyId: 'famB', itemId: it.id }, 404);              // another family
  await w.fail('bob', 'givingPhotoSave', F({ itemId: it.id, thumb, photo }), 404);              // only the list owner
  await w.fail('bob', 'givingPhotoRemove', F({ itemId: it.id }), 404);
});

test('photos: an adults-only item picture is not reachable by a kid, and the reservation rules still hold', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann', 'secret', 'adults'); const it = await mkItem(w, 'ann', l.id);
  await w.ok('ann', 'givingPhotoSave', F({ itemId: it.id, thumb: jpegUrl(100), photo: jpegUrl(1000) }));
  await w.fail('kid', 'givingPhotoGet', F({ itemId: it.id }), 404, 'not_available');
  await w.ok('bob', 'givingReserve', F({ itemId: it.id }));
  const forAnn = await w.ok('ann', 'givingListGet', F({ listId: l.id }));
  assert.deepEqual(keysOf(forAnn).filter((k) => RESERVATION_WORDS.test(k)), []);
});

test('photos: only real JPEG data inside the size limits is accepted', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  const send = (thumb, photo) => w.fail('ann', 'givingPhotoSave', F({ itemId: it.id, thumb, photo }), 400);
  await send('not a picture', jpegUrl(100));
  await send(jpegUrl(100), 'data:image/png;base64,AAAA');
  await send('data:image/jpeg;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64'), jpegUrl(100));   // says JPEG, is not
  await send(jpegUrl(10001), jpegUrl(100));
  await send(jpegUrl(100), jpegUrl(250001));
  await send(jpegUrl(100), undefined);
  assert.equal(Object.keys(w.world.files).length, 0);
  assert.equal(photoOf(w).thumb, undefined);
});

test('photos: replacing and removing delete the old file; editing the item keeps the photo', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const it = await mkItem(w, 'ann', l.id);
  await w.ok('ann', 'givingPhotoSave', F({ itemId: it.id, thumb: jpegUrl(100, 1), photo: jpegUrl(1000, 1) }));
  const first = Object.keys(w.world.files)[0];
  await w.ok('ann', 'givingPhotoSave', F({ itemId: it.id, thumb: jpegUrl(100, 2), photo: jpegUrl(1000, 2) }));
  assert.equal(Object.keys(w.world.files).length, 1);
  assert.ok(!w.world.files[first]);
  const edited = (await w.ok('ann', 'givingItemSave', F({ listId: l.id, itemId: it.id, title: 'Renamed' }))).item;
  assert.ok(edited.thumb);
  assert.equal((await w.ok('bob', 'givingPhotoGet', F({ itemId: it.id }))).photo, jpegUrl(1000, 2));
  const gone = (await w.ok('ann', 'givingPhotoRemove', F({ itemId: it.id }))).item;
  assert.equal(gone.thumb, undefined);
  assert.equal(Object.keys(w.world.files).length, 0);
  await w.fail('bob', 'givingPhotoGet', F({ itemId: it.id }), 404);
});

test('photos: deleting an item or a list, or the 30-day cleanup, deletes the files too', async () => {
  const w = await setup();
  const l = await mkList(w, 'ann'); const a = await mkItem(w, 'ann', l.id), b = await mkItem(w, 'ann', l.id, { title: 'Pen' });
  for (const x of [a, b]) await w.ok('ann', 'givingPhotoSave', F({ itemId: x.id, thumb: jpegUrl(100), photo: jpegUrl(1000) }));
  assert.equal(Object.keys(w.world.files).length, 2);
  await w.ok('ann', 'givingItemDelete', F({ itemId: a.id }));
  assert.equal(Object.keys(w.world.files).length, 1);
  w.removeMember('famA', 'ann');
  await w.ok('owner', 'givingHome', F());
  assert.equal(Object.keys(w.world.files).length, 1);                // hidden for 30 days, not deleted yet
  w.world.bump(31 * DAY);
  await w.api.handle({ user: null, body: {}, deadline: Number.MAX_SAFE_INTEGER });
  assert.equal(Object.keys(w.world.files).length, 0);
});

/* ---------- link pictures ---------- */
test('link pictures: a member gets the picture the link gives; bad links, strangers, an off family and too many tries are refused', async () => {
  const calls = [];
  EXTRA_CFG.linkPicture = async (url) => { calls.push(url); if (/nopic/.test(url)) throw Object.assign(new Error('x'), { linkPicture: true }); return { mime: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }; };
  try {
    const w2 = await setup();
    const r = await w2.ok('bob', 'givingLinkPicture', F({ url: 'https://shop.example/thing' }));
    assert.match(r.image, /^data:image\/png;base64,/); assert.equal(r.host, 'shop.example'); assert.equal(calls[0], 'https://shop.example/thing');
    await w2.fail('bob', 'givingLinkPicture', F({ url: 'javascript:alert(1)' }), 400);
    await w2.fail('bob', 'givingLinkPicture', F({ url: '' }), 400);
    await w2.fail('bob', 'givingLinkPicture', F({ url: 'https://nopic.example/x' }), 422);
    await w2.fail('zed', 'givingLinkPicture', { familyId: 'famB', url: 'https://shop.example/thing' }, 404);   // not a member of this family
    for (let i = 0; i < 4; i++) await w2.ok('ann', 'givingLinkPicture', F({ url: 'https://shop.example/' + i }));
    let limited = 0; for (let i = 0; i < 8; i++) { try { await w2.ok('ann', 'givingLinkPicture', F({ url: 'https://shop.example/m' + i })); } catch (e) { limited++; } }
    assert.ok(limited >= 1, 'the per-person cap stops a flood');
    assert.equal(Object.keys(w2.world.files).length, 0);   // nothing is stored by the lookup itself
  } finally { delete EXTRA_CFG.linkPicture; }
});

/* ---------- Etsy pictures (never stored) ---------- */
test('etsy pictures: shown for Etsy-link items to anyone who may see the item, kept only in memory, and not for other links, strangers or when not set up', async () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 3)]);
  let apiCalls = 0;
  EXTRA_CFG.etsyApiKey = 'k:s';
  EXTRA_CFG.etsyDeps = { lookup: async () => [{ address: '93.184.216.34', family: 4 }], getApi: async () => { apiCalls++; return { status: 200, body: JSON.stringify({ results: [{ rank: 1, url_170x135: 'https://i.etsystatic.com/t.jpg', url_570xN: 'https://i.etsystatic.com/f.jpg' }] }) }; }, get: async () => ({ status: 200, headers: {}, body: jpg }) };
  try {
    const w = await setup();
    const l = await mkList(w, 'ann');
    const etsyItem = (await w.ok('ann', 'givingItemSave', F({ listId: l.id, title: 'Necklace', priority: 'high', url: 'https://www.etsy.com/listing/1426958759/personalized-name-necklace' }))).item;
    const other = (await w.ok('ann', 'givingItemSave', F({ listId: l.id, title: 'Other', priority: 'high', url: 'https://shop.example/thing' }))).item;
    const r = await w.ok('kid', 'givingEtsyPicture', F({ itemId: etsyItem.id }));
    assert.match(r.image, /^data:image\/jpeg;base64,/); assert.match(r.notice, /not endorsed or certified by Etsy/);
    await w.ok('bob', 'givingEtsyPicture', F({ itemId: etsyItem.id })); assert.equal(apiCalls, 1, 'the second ask comes from memory');
    await w.ok('bob', 'givingEtsyPicture', F({ itemId: etsyItem.id, size: 'full' })); assert.equal(apiCalls, 2);
    await w.fail('bob', 'givingEtsyPicture', F({ itemId: other.id }), 404);
    await w.fail('zed', 'givingEtsyPicture', { familyId: 'famB', itemId: etsyItem.id }, 404);
    assert.equal(Object.keys(w.world.files).length, 0, 'nothing from Etsy is saved');
    assert.ok(!/etsystatic|data:image/.test(JSON.stringify(rows(w, 'givingItems'))), 'nothing from Etsy is in the item rows');
  } finally { delete EXTRA_CFG.etsyApiKey; delete EXTRA_CFG.etsyDeps; }
  const w2 = await setup(); const l2 = await mkList(w2, 'ann');
  const it2 = (await w2.ok('ann', 'givingItemSave', F({ listId: l2.id, title: 'N', priority: 'high', url: 'https://www.etsy.com/listing/1426958759/x' }))).item;
  await w2.fail('bob', 'givingEtsyPicture', F({ itemId: it2.id }), 503);   // no key set up
});

test('the function cleans a long pasted shop link the same way as the page', async () => {
  const w = await setup(); const l = await mkList(w, 'ann');
  const long = 'https://www.walmart.com/ip/Thing/939951644?selectedSellerId=16451&wmlspartner=wlpa&gclid=' + 'x'.repeat(500) + '&sid=abc';
  const it = (await w.ok('ann', 'givingItemSave', F({ listId: l.id, title: 'Thing', priority: 'high', url: long }))).item;
  assert.equal(it.url, 'https://www.walmart.com/ip/Thing/939951644?selectedSellerId=16451');
});
