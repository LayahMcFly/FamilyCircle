/* Family Exchange backend tests. These run against an IN-MEMORY FAKE database that enforces the declared schema (columns and UNIQUE indexes) and
 * refuses to update or delete the append-only event chain. They prove the SIMULATED implementation only. Real Appwrite behaviour (unique indexes under
 * concurrent inserts, permissions) is the Step 7 live probe that must pass before the persistence gate is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createExchange, EXCHANGE_SCHEMA, EXCHANGE_TABLES as T, EXCHANGE_LIMITS } from '../src/exchange.js';
import * as R from '../src/exchange-rules.js';
import { ApiError } from '../src/logic.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
const bad = (m) => new ApiError(400, 'bad_request', m);
const forbidden = (m = 'You do not have access to do that.') => new ApiError(403, 'forbidden', m);
const err = (code, m) => Object.assign(new Error(m), { code });
const tick = () => new Promise((r) => setImmediate(r));

function makeWorld({ eligible = () => true, mods = () => [], enabled = true, extra = 0, verified = true } = {}) {
  const w = { tables: {}, clock: 1_800_000_000_000, seq: 0, fail: [], before: null, calls: [], conflicts: [], stale: 0, hooks: { eligible, mods }, n: 0, mc: 0, listCalls: 0, eligCalls: [] };
  for (const t of [...Object.values(T), 'profiles']) w.tables[t] = new Map();
  const names = { ava: 'Ava Rowan', ben: 'Ben Rowan', dana: 'Dana Rowan', cleo: 'Cleo Rowan', eli: 'Eli Rowan', zed: 'Zed Other' };
  w.mem = { fam1: new Map(), fam2: new Map() };
  w.join = (fam, u) => { const mid = 'm' + ++w.mc + u; w.mem[fam].set(u, { mid, roles: u === (fam === 'fam1' ? 'ava' : 'zed') ? ['owner'] : ['member'] }); return mid; };
  w.leave = (fam, u) => w.mem[fam].delete(u);
  for (const u of ['ava', 'ben', 'dana', 'cleo', 'eli']) w.join('fam1', u);
  for (let i = 0; i < extra; i++) { names['u' + i] = 'User ' + i; w.join('fam1', 'u' + i); }
  w.join('fam2', 'zed');
  const schema = (t) => EXCHANGE_SCHEMA[t];
  const guard = async (op, tableId, id, data) => {
    await tick();
    w.calls.push(op + ':' + tableId);
    if (w.before) await w.before({ op, tableId, id, data });
    const f = w.fail.find((x) => x.op === op && x.table === tableId && (x.times === undefined || x.times > 0));
    if (f) { if (f.times !== undefined) f.times -= 1; throw err(500, 'injected failure'); }
  };
  const listRowsRaw = (tableId, queries = []) => {
    let rows = [...w.tables[tableId].values()], limit = 25, order = null, after = null;
    for (const raw of queries) {
      const q = JSON.parse(raw);
      if (q.method === 'equal') rows = rows.filter((r) => q.values.includes(r[q.attribute]));
      else if (q.method === 'limit') limit = q.values[0];
      else if (q.method === 'orderDesc') order = [q.attribute, -1];
      else if (q.method === 'orderAsc') order = [q.attribute, 1];
      else if (q.method === 'cursorAfter') after = q.values[0];
    }
    if (order) rows.sort((a, b) => (a[order[0]] > b[order[0]] ? 1 : a[order[0]] < b[order[0]] ? -1 : 0) * order[1]);
    if (after) rows = rows.slice(rows.findIndex((r) => r.$id === after) + 1);
    return { total: rows.length, rows: rows.slice(0, limit) };
  };
  const deps = {
    teams: {
      async listMemberships({ teamId, queries = [] }) {
        w.listCalls++;
        let limit = 25, after = null;
        for (const raw of queries) { const q = JSON.parse(raw); if (q.method === 'limit') limit = q.values[0]; if (q.method === 'cursorAfter') after = q.values[0]; }
        let all = [...w.mem[teamId]].map(([u, m]) => ({ $id: m.mid, userId: u, confirm: true, userName: names[u] || u, roles: m.roles }));
        if (after) all = all.slice(all.findIndex((m) => m.$id === after) + 1);
        return { memberships: all.slice(0, limit) };
      }
    },
    async listRows(tableId, queries) { await guard('list', tableId); return listRowsRaw(tableId, queries); },
    async createRow(tableId, rowId, data) {
      await guard('create', tableId, rowId, data);
      const s = schema(tableId);
      if (s) for (const k of Object.keys(data)) if (!(k in s.columns)) throw err(400, 'Unknown column ' + k);
      const table = w.tables[tableId];
      const clash = () => { w.conflicts.push(tableId + ':' + (data.claimKey || rowId)); return err(409, 'conflict'); };
      if (table.has(rowId)) throw clash();
      if (s) for (const u of s.unique) if ([...table.values()].some((r) => u.every((k) => r[k] === data[k]))) throw clash();
      const row = { ...data, $id: rowId, $createdAt: new Date(w.clock + ++w.seq).toISOString() };
      table.set(rowId, row); return { ...row };
    },
    async updateRow(tableId, rowId, data) {
      await guard('update', tableId, rowId, data);
      if (tableId === T.events && !(Object.keys(data).every((k) => k === 'state' || k === 'actorId') && (data.state === undefined || data.state === '{}') && (data.actorId === undefined || data.actorId === 'erased'))) throw err(500, 'the event chain is append-only; only the retention job may blank state or actorId');
      const s = schema(tableId), row = w.tables[tableId].get(rowId);
      if (!row) throw err(404, 'nope');
      if (s) for (const k of Object.keys(data)) if (!(k in s.columns)) throw err(400, 'Unknown column ' + k);
      Object.assign(row, data); return { ...row };
    },
    async deleteRow(tableId, rowId) { await guard('delete', tableId, rowId); if (tableId === T.events) throw err(500, 'event rows are never deleted'); if (!w.tables[tableId].delete(rowId)) throw err(404, 'nope'); return {}; },
    async getRowOrNull(tableId, rowId) { await guard('get', tableId, rowId); const r = w.tables[tableId].get(rowId); return r ? { ...r } : null; },
    async firstRow(tableId, queries) {
      await guard('list', tableId);
      let rows = listRowsRaw(tableId, [...queries, JSON.stringify({ method: 'limit', values: [100000] })]).rows;
      if (tableId === T.events && w.stale > 0 && queries.some((q) => JSON.parse(q).method === 'orderDesc')) { w.stale--; rows = rows.slice(1); }   // a stale read: the newest row is not visible yet
      return rows[0] || null;
    },
    async requireMember(user, familyIdRaw) {
      if (typeof familyIdRaw !== 'string' || !ID_RE.test(familyIdRaw)) throw bad('familyId is not valid.');
      const m = (w.mem[familyIdRaw] || new Map()).get(user.$id);
      if (!m) throw forbidden('You are not a member of this family.');
      return { familyId: familyIdRaw, isOwner: m.roles.includes('owner') };
    },
    idOf(value, label) { if (typeof value !== 'string' || !ID_RE.test(value)) throw bad(`${label} is not valid.`); return value; },
    bad, forbidden, ApiError, sdkCode: (e) => (e && typeof e.code === 'number' ? e.code : 0),
    now: () => w.clock, profilesTable: 'profiles',
    newId: () => 'n' + ++w.n,
    persistenceVerified: verified,
    eligibility: async (a) => { w.eligCalls.push(a); return w.hooks.eligible(a); },
    moderators: async (a) => w.hooks.mods(a)
  };
  if (enabled) { w.tables[T.state].set('fam1', { $id: 'fam1', familyId: 'fam1', enabled: true }); w.tables[T.state].set('fam2', { $id: 'fam2', familyId: 'fam2', enabled: true }); }
  const ex = createExchange(deps);
  let op = 0;
  const oid = () => 'op' + String(++op).padStart(8, '0');
  w.call = (name, who, body = {}) => ex.actions[name]({ user: { $id: who }, body: { familyId: 'fam1', ...body } });
  w.oid = oid; w.ex = ex;
  w.row = (t, id) => w.tables[t].get(id);
  w.events = (id) => [...w.tables[T.events].values()].filter((e) => e.listingId === id).sort((a, b) => a.seq - b.seq);
  w.head = (id) => { const e = w.events(id).pop(); return e ? JSON.parse(e.state) : null; };
  return w;
}
const free = (o = {}) => ({ kind: 'free', title: 'Oak bookshelf', category: 'Furniture', condition: 'Good', description: 'Sturdy shelf.', area: 'near the library', ...o });
async function seed(w, extra = {}, owner = 'ava') {
  const made = await w.call('exchangeListingSave', owner, { ...free(extra), publish: true, opId: w.oid() });
  const id = made.listing.id;
  await w.call('exchangeRequestCreate', 'ben', { listingId: id, note: 'Please', opId: w.oid() });
  await w.call('exchangeRequestCreate', 'dana', { listingId: id, note: 'Me too', opId: w.oid() });
  const view = await w.call('exchangeListingGet', owner, { listingId: id });
  const rq = (n) => view.listing.requests.find((r) => r.from === n).id;
  return { id, benReq: rq('Ben Rowan'), danaReq: rq('Dana Rowan') };
}
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.status; } };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };
const withLimit = async (k, v, fn) => { const old = EXCHANGE_LIMITS[k]; EXCHANGE_LIMITS[k] = v; try { await fn(); } finally { EXCHANGE_LIMITS[k] = old; } };

/* what must always be true of a listing's chain and state */
const invariant = (w, id) => {
  const h = w.head(id), events = w.events(id);
  const reserved = h.reqs.filter((r) => r.st === 'reserved');
  assert.ok(reserved.length <= 1, 'at most one reserved request');
  if (h.status === 'reserved' || (h.status === 'hidden' && h.hiddenFrom === 'reserved')) { assert.ok(h.resv); assert.equal(reserved.length, 1); assert.equal(h.resv.rid, reserved[0].id); assert.equal(h.resv.uid, reserved[0].uid); assert.equal(h.resv.m, reserved[0].m); }
  else { assert.equal(h.resv, null); assert.equal(reserved.length, 0); }
  if (['gone', 'withdrawn', 'closed', 'fulfilled'].includes(h.status)) assert.ok(h.reqs.every((r) => r.st !== 'waiting' && r.st !== 'reserved'), 'no open request on an ended listing');
  events.forEach((e, i) => assert.equal(e.seq, i + 1, 'claims are gap-free'));
  const revs = events.filter((e) => e.state !== '{}').map((e) => JSON.parse(e.state).rev); revs.forEach((r, i) => i && assert.ok(r >= revs[i - 1], 'content revision never goes backwards'));
};

/* ---------- fail closed ---------- */
test('Exchange is off by default, the persistence gate must be open, and an owner switch alone does not make anyone eligible', async () => {
  const w = makeWorld({ enabled: false });
  assert.equal(await status(w.call('exchangeHome', 'ava')), 404);
  assert.equal((await w.call('exchangeStatus', 'ava')).enabled, false);
  assert.equal(await status(w.call('exchangeSetState', 'ben', { enabled: true })), 403, 'only the owner can switch it');
  await w.call('exchangeSetState', 'ava', { enabled: true });
  assert.equal((await w.call('exchangeHome', 'ava')).listings.length, 0);
  const w2 = makeWorld({ enabled: false }); w2.hooks.eligible = () => false;
  await w2.call('exchangeSetState', 'ava', { enabled: true });
  assert.equal(await status(w2.call('exchangeHome', 'ava')), 404, 'switched on, but not eligible');
  const w3 = makeWorld({ verified: false });
  assert.equal(await status(w3.call('exchangeHome', 'ava')), 404, 'persistence gate closed: the whole feature is unavailable');
  assert.equal((await w3.call('exchangeStatus', 'ava')).ready, false);
});
test('missing, odd or throwing eligibility denies everyone, with the same not-available answer', async () => {
  const w = makeWorld();
  for (const hook of [() => false, () => undefined, () => 'yes', () => 1, () => { throw new Error('boom'); }]) { w.hooks.eligible = hook; assert.equal(await status(w.call('exchangeHome', 'ava')), 404); }
  const ex = createExchange({ teams: { listMemberships: async () => ({ memberships: [{ $id: 'm1', userId: 'u', confirm: true, roles: [] }] }) }, listRows: async () => ({ rows: [] }), getRowOrNull: async () => ({ enabled: true }), requireMember: async () => ({ familyId: 'f', isOwner: true }), idOf: (v) => v, bad, forbidden, ApiError, sdkCode: () => 0, now: () => 1, persistenceVerified: true });
  assert.equal(await status(ex.actions.exchangeHome({ user: { $id: 'u' }, body: { familyId: 'f' } })), 404, 'no hook at all means nobody');
  const ex2 = createExchange({ teams: {}, listRows: async () => ({ rows: [] }), getRowOrNull: async () => ({ enabled: true }), requireMember: async () => ({ familyId: 'f', isOwner: true }), idOf: (v) => v, bad, forbidden, ApiError, sdkCode: () => 0, now: () => 1, eligibility: async () => true });
  assert.equal(await status(ex2.actions.exchangeHome({ user: { $id: 'u' }, body: { familyId: 'f' } })), 404, 'no persistence flag means closed even when eligible');
});
test('eligibility is checked on every call, so removing access works at once', async () => {
  const w = makeWorld(); const s = await seed(w);
  assert.equal(await status(w.call('exchangeListingGet', 'ben', { listingId: s.id })), 200);
  w.hooks.eligible = ({ user }) => user.$id !== 'ben';
  assert.equal(await status(w.call('exchangeListingGet', 'ben', { listingId: s.id })), 404);
  assert.equal(await status(w.call('exchangeRequestCancel', 'ben', { listingId: s.id, opId: w.oid() })), 404);
});
test('other family, missing, draft, hidden and withdrawn all answer identically', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  const draft = (await w.call('exchangeListingSave', 'ava', { ...free(), opId: w.oid() })).listing.id;
  const grab = async (who, listingId, fam = 'fam1') => { try { await w.call('exchangeListingGet', who, { listingId, familyId: fam }); return 'ok'; } catch (e) { return JSON.stringify([e.status, e.code, e.message]); } };
  const missing = await grab('cleo', 'doesnotexist');
  assert.equal(await grab('cleo', draft), missing);
  await w.call('exchangeReport', 'ben', { listingId: s.id, reason: 'Other', detail: '' });
  const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
  await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() });
  assert.equal(await grab('cleo', s.id), missing, 'hidden looks like missing to a member');
  assert.equal(await grab('ben', s.id), missing, 'and to an applicant');
  assert.notEqual(await grab('dana', s.id), missing, 'the moderator can open it');
  assert.notEqual(await grab('ava', s.id), missing, 'the owner can open it');
  const other = (await w.call('exchangeListingSave', 'zed', { ...free(), publish: true, opId: w.oid(), familyId: 'fam2' })).listing.id;
  assert.equal(await grab('ava', other), missing, 'a listing from another family is not reachable');
});

/* ---------- moderators fail closed ---------- */
test('no moderator: reports cannot be filed, listed or resolved, and nothing is stored', async () => {
  const w = makeWorld(); const s = await seed(w);
  assert.equal(await code(w.call('exchangeReport', 'ben', { listingId: s.id, reason: 'Other' })), 'escalation_unavailable');
  assert.equal(w.tables[T.reports].size, 0);
  for (const who of ['ava', 'ben', 'dana']) assert.equal(await status(w.call('exchangeReportList', who)), 404);
});
test('a lone moderator who owns the listing is never the handler for it', async () => {
  const w = makeWorld({ mods: () => ['ava'] }); const s = await seed(w);
  assert.equal(await code(w.call('exchangeReport', 'ben', { listingId: s.id, reason: 'Other' })), 'escalation_unavailable');
  assert.equal(w.tables[T.reports].size, 0, 'never routed back to the accused');
  const other = (await w.call('exchangeListingSave', 'ben', { ...free({ title: 'Ben item' }), publish: true, opId: w.oid() })).listing.id;
  await w.call('exchangeReport', 'dana', { listingId: other, reason: 'Other' });
  assert.equal((await w.call('exchangeReportList', 'ava')).reports.length, 1);
});
test('the accused moderator never sees, counts or resolves a report about their own listing', async () => {
  const w = makeWorld({ mods: () => ['dana', 'ava'] }); await seed(w);
  const mineByDana = (await w.call('exchangeListingSave', 'dana', { ...free({ title: 'Dana chair' }), publish: true, opId: w.oid() })).listing.id;
  await w.call('exchangeReport', 'ben', { listingId: mineByDana, reason: 'Item looks unsafe or recalled', detail: 'loose' });
  const listed = await w.call('exchangeReportList', 'dana');
  assert.equal(listed.reports.length, 0);
  assert.equal(JSON.stringify(listed).includes('Ben'), false);
  const asAva = (await w.call('exchangeReportList', 'ava')).reports;
  assert.equal(asAva.length, 1);
  assert.equal(await status(w.call('exchangeReportResolve', 'dana', { reportId: asAva[0].id, decision: 'hide', opId: w.oid() })), 404);
  await w.call('exchangeReportResolve', 'ava', { reportId: asAva[0].id, decision: 'hide', opId: w.oid() });
  const owner = await w.call('exchangeListingGet', 'dana', { listingId: mineByDana });
  assert.equal(owner.listing.hiddenByModerator, true);
  assert.equal(JSON.stringify(owner).includes('Ben'), false, 'the owner is not told who reported');
  assert.equal(JSON.stringify(owner).includes('loose'), false);
});

/* ---------- 1. persistence: one atomic write, nothing to overwrite ---------- */
test('the only writes are creates on the event chain and create-only hints, plus the false-to-true ended flag and the switch row', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() });
  await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Other' });
  await w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'withdrawn', opId: w.oid() });
  const writes = [...new Set(w.calls.filter((c) => /^(create|update|delete):/.test(c)))].sort();
  assert.deepEqual(writes, ['create:exchangeEvents', 'create:exchangeListings', 'create:exchangeReports', 'create:exchangeRequests', 'update:exchangeListings']);
  assert.equal(w.row(T.listings, s.id).ended, true);
  for (const e of w.events(s.id)) assert.ok(e.claimKey === s.id + '_' + e.seq);
});
test('STALE WRITER: paused after validating and before its write, it cannot overwrite what two newer operations did', async () => {
  const w = makeWorld(); const s = await seed(w);
  let release; const gate = new Promise((r) => { release = r; }); let held = false, heldSeq = 0;
  w.before = async ({ op, tableId, data }) => { if (!held && op === 'create' && tableId === T.events && data.kind === 'reserve') { held = true; heldSeq = data.seq; await gate; } };
  const stale = w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }).then(() => 'ok', (e) => e.code);
  for (let i = 0; i < 200 && !held; i++) await tick();
  assert.ok(held, 'the old executor is paused after its checks and just before its only write');
  w.before = null;
  const rev0 = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing.rev;
  await w.call('exchangeListingSave', 'ava', { ...free({ title: 'Edited while paused' }), listingId: s.id, rev: rev0, publish: true, opId: w.oid() });   // newer operation 1
  await w.call('exchangeRequestCancel', 'dana', { listingId: s.id, opId: w.oid() });                                                                          // newer operation 2
  assert.equal(w.events(s.id).length, heldSeq + 1, 'two newer snapshots now exist beyond the one the old executor read');
  const before = w.events(s.id).map((e) => e.state);
  release();
  assert.equal(await stale, 'ok', 'the old intent is re-validated on the new state and still valid, so it applies ON TOP');
  const h = w.head(s.id), after = w.events(s.id).map((e) => e.state);
  assert.deepEqual(after.slice(0, before.length), before, 'no earlier snapshot was touched');
  assert.equal(h.data.title, 'Edited while paused', 'newer edit survived');
  assert.equal(h.reqs.find((r) => r.id === s.danaReq).st, 'cancelled', 'newer cancellation survived');
  assert.equal(h.reqs.find((r) => r.id === s.benReq).st, 'reserved'); assert.equal(h.status, 'reserved');
  assert.ok(w.conflicts.some((x) => x === 'exchangeEvents:' + s.id + '_' + heldSeq), 'its first write was refused by the unique key');
  invariant(w, s.id);
});
test('STALE WRITER: when the newer operations make the old intent invalid, nothing is written at all', async () => {
  const w = makeWorld(); const s = await seed(w);
  let release; const gate = new Promise((r) => { release = r; }); let held = false;
  w.before = async ({ op, tableId, data }) => { if (!held && op === 'create' && tableId === T.events && data.kind === 'reserve') { held = true; await gate; } };
  const stale = w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }).then(() => 'ok', (e) => e.code);
  for (let i = 0; i < 200 && !held; i++) await tick();
  w.before = null;
  await w.call('exchangeRequestDecline', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  await w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'withdrawn', opId: w.oid() });
  const n = w.events(s.id).length; release();
  assert.equal(await stale, 'changed');
  assert.equal(w.events(s.id).length, n, 'the stale reserve added no snapshot');
  assert.equal(w.head(s.id).status, 'withdrawn'); assert.equal(w.head(s.id).resv, null); invariant(w, s.id);
});
test('a stale READ of the chain head cannot cause an overwrite either: the claim is refused and the action retries on fresh state', async () => {
  const w = makeWorld(); const s = await seed(w);
  const n = w.events(s.id).length; w.stale = 2;   // the ownership check and the claim step both read a stale head
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  assert.equal(w.stale, 0, 'the stale read happened');
  assert.equal(w.events(s.id).length, n + 1, 'exactly one new snapshot');
  assert.ok(w.conflicts.length >= 1, 'the stale claim was refused'); invariant(w, s.id);
});
test('a failed write changes nothing, and the same retry then completes it once', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid(); const n = w.events(s.id).length;
  w.fail.push({ op: 'create', table: T.events, times: 1 });
  assert.ok(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id })));
  assert.equal(w.events(s.id).length, n); assert.equal(w.head(s.id).status, 'available', 'nothing half done is possible');
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  assert.equal(w.events(s.id).length, n + 1); invariant(w, s.id);
});
test('if the ended flag cannot be written the listing is still ended, still frees the slot, and nothing else is affected', async () => {
  await withLimit('listingsPerMember', 2, async () => {
    const w = makeWorld({});
    const a = (await w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: w.oid() })).listing.id;
    await w.call('exchangeListingSave', 'ava', { ...free({ title: 'Two' }), publish: true, opId: w.oid() });
    w.fail.push({ op: 'update', table: T.listings });
    await w.call('exchangeListingEnd', 'ava', { listingId: a, to: 'withdrawn', opId: w.oid() });
    assert.equal(w.row(T.listings, a).ended, false, 'the hint is stale');
    assert.equal(w.head(a).status, 'withdrawn', 'the chain is the truth');
    await w.call('exchangeListingSave', 'ava', { ...free({ title: 'Three' }), publish: true, opId: w.oid() });
  });
});
test('two reservation confirmations: exactly one wins, the other is told it changed', async () => {
  const w = makeWorld(); const s = await seed(w);
  const results = await Promise.allSettled([
    w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }),
    w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() })
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'changed');
  invariant(w, s.id); assert.equal(w.head(s.id).status, 'reserved');
});
test('many simultaneous reservations still produce one winner', async () => {
  const w = makeWorld(); const s = await seed(w);
  const out = await Promise.allSettled([...Array(6)].map((_, i) => w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: i % 2 ? s.benReq : s.danaReq, opId: w.oid() })));
  assert.equal(out.filter((r) => r.status === 'fulfilled').length, 1); invariant(w, s.id);
});
test('reservation versus withdrawal never leaves a reservation on an ended listing', async () => {
  for (let i = 0; i < 5; i++) {
    const w = makeWorld(); const s = await seed(w);
    await Promise.allSettled([
      w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }),
      w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'withdrawn', opId: w.oid() })
    ]);
    invariant(w, s.id);
  }
});
test('a new request racing a withdrawal cannot be left waiting on an ended listing', async () => {
  const w = makeWorld(); const s = await seed(w);
  await Promise.allSettled([
    w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'gone', opId: w.oid() }),
    w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: '', opId: w.oid() })
  ]);
  invariant(w, s.id);
});
test('release versus a new reservation versus the recipient backing out never double-books', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  await Promise.allSettled([
    w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() }),
    w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() }),
    w.call('exchangeCancelReservation', 'ben', { listingId: s.id, opId: w.oid() })
  ]);
  invariant(w, s.id);
});
test('publishing an edit versus a reservation: whichever claims first decides, and a reserved item never changes in public', async () => {
  for (let i = 0; i < 6; i++) {
    const w = makeWorld(); const s = await seed(w);
    const before = await w.call('exchangeListingGet', 'ava', { listingId: s.id });
    const results = await Promise.allSettled([
      w.call('exchangeListingSave', 'ava', { ...free({ title: 'Oak bookshelf, taller' }), listingId: s.id, rev: before.listing.rev, publish: true, opId: w.oid() }),
      w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() })
    ]);
    invariant(w, s.id);
    const h = w.head(s.id), edit = results[0];
    if (edit.status === 'fulfilled' && edit.value.saved === 'private') { assert.equal(h.data.title, 'Oak bookshelf'); assert.ok(h.pending); }
    if (edit.status === 'rejected') assert.equal(edit.reason.code, 'changed');
  }
});
test('stale revisions change nothing', async () => {
  const w = makeWorld(); const s = await seed(w);
  const v = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  await w.call('exchangeListingSave', 'ava', { ...free({ title: 'First' }), listingId: s.id, rev: v.rev, opId: w.oid() });
  const before = w.tables[T.events].size;
  assert.equal(await code(w.call('exchangeListingSave', 'ava', { ...free({ title: 'Second' }), listingId: s.id, rev: v.rev, opId: w.oid() })), 'changed');
  assert.equal(w.tables[T.events].size, before, 'no snapshot was written');
  assert.equal(w.head(s.id).data.title, 'First');
  assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: 'nosuchrequest', opId: w.oid() })), 'changed');
});

/* ---------- duplicate retries ---------- */
test('the same opId twice, one after the other, takes effect once', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  const n = w.tables[T.events].size;
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  assert.equal(w.tables[T.events].size, n); invariant(w, s.id);
});
test('a late duplicate cannot undo a later release', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() });
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  assert.equal(w.head(s.id).status, 'available', 'the old retry did not re-reserve'); invariant(w, s.id);
});
test('identical retries at the same moment make one snapshot', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  const out = await Promise.allSettled([1, 2, 3].map(() => w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id })));
  assert.ok(out.every((r) => r.status === 'fulfilled'));
  assert.equal(w.events(s.id).filter((e) => e.opKey === s.id + '_' + id).length, 1); invariant(w, s.id);
});
test('a repeated create tap makes one listing', async () => {
  const w = makeWorld(); const id = w.oid();
  await Promise.all([1, 2].map(() => w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: id })));
  assert.equal(w.tables[T.listings].size, 1); assert.equal(w.tables[T.events].size, 1);
});
test("someone else cannot replay another person's opId", async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  assert.equal(await status(w.call('exchangeCancelReservation', 'ben', { listingId: s.id, opId: id })), 400);
});

/* ---------- 2. membership instance binding ---------- */
test('an owner who is removed and invited again does not get their old listings back, and they do not count against the new membership', async () => {
  await withLimit('listingsPerMember', 2, async () => {
    const w = makeWorld();
    const s = { id: (await w.call('exchangeListingSave', 'dana', { ...free(), publish: true, opId: w.oid() })).listing.id };
    await w.call('exchangeRequestCreate', 'ben', { listingId: s.id, note: '', opId: w.oid() });
    s.benReq = (await w.call('exchangeListingGet', 'dana', { listingId: s.id })).listing.requests[0].id;
    await w.call('exchangeListingSave', 'dana', { ...free({ title: 'Second' }), publish: true, opId: w.oid() });
    w.leave('fam1', 'dana'); const newMid = w.join('fam1', 'dana');
    assert.equal(await status(w.call('exchangeListingGet', 'dana', { listingId: s.id })), 404, 'cannot open it');
    const v = (await w.call('exchangeListingGet', 'ben', { listingId: s.id }).catch((e) => e.status));
    assert.equal(v, 404, 'and nobody else can see an orphaned listing');
    assert.equal(await status(w.call('exchangeListingEnd', 'dana', { listingId: s.id, to: 'withdrawn', opId: w.oid() })), 404);
    assert.equal(await status(w.call('exchangeListingSave', 'dana', { ...free(), listingId: s.id, rev: 1, opId: w.oid() })), 404);
    assert.equal(await status(w.call('exchangeReserve', 'dana', { listingId: s.id, requestId: s.benReq, opId: w.oid() })), 404);
    assert.equal((await w.call('exchangeMine', 'dana')).listings.length, 0);
    assert.equal((await w.call('exchangeHome', 'cleo')).listings.length, 0);
    for (const t of ['One', 'Two']) await w.call('exchangeListingSave', 'dana', { ...free({ title: t }), publish: true, opId: w.oid() });   // fresh limit for the new membership
    assert.equal(await code(w.call('exchangeListingSave', 'dana', { ...free({ title: 'Three' }), publish: true, opId: w.oid() })), 'limit');
    assert.equal(w.head(s.id).ownerM !== newMid, true);
  });
});
test('a requester who is removed and invited again loses the old request, the owner cannot confirm it, and asking again makes a new one', async () => {
  const w = makeWorld(); const s = await seed(w);
  w.leave('fam1', 'dana'); w.join('fam1', 'dana');
  const mine = (await w.call('exchangeListingGet', 'dana', { listingId: s.id })).listing;
  assert.equal(mine.myRequest, null, 'the old request is not hers any more');
  assert.equal(await status(w.call('exchangeRequestCancel', 'dana', { listingId: s.id, opId: w.oid() })), 409);
  const own = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  assert.equal(own.requests.some((r) => r.from === 'Dana Rowan'), false, 'the owner is not shown a request from a membership that no longer exists');
  assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() })), 'recipient_unavailable');
  assert.equal((await w.call('exchangeActivity', 'dana')).requests.length, 0);
  await w.call('exchangeRequestCreate', 'dana', { listingId: s.id, note: 'again', opId: w.oid() });
  const fresh2 = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing.requests.find((r) => r.from === 'Dana Rowan');
  assert.notEqual(fresh2.id, s.danaReq, 'a new request under the new membership');
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: fresh2.id, opId: w.oid() });
  assert.equal((await w.call('exchangeListingGet', 'dana', { listingId: s.id })).listing.myRequest.reservedForMe, true); invariant(w, s.id);
});
test('a reserved recipient who is removed and invited again has no claim on the reservation, and the owner can release it', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  w.leave('fam1', 'ben'); w.join('fam1', 'ben');
  const ben = (await w.call('exchangeListingGet', 'ben', { listingId: s.id })).listing;
  assert.equal(ben.myRequest, null); assert.equal(JSON.stringify(ben).includes('reservedForMe":true'), false);
  assert.equal(await status(w.call('exchangeCancelReservation', 'ben', { listingId: s.id, opId: w.oid() })), 409);
  assert.equal((await w.call('exchangeActivity', 'ben')).requests.length, 0);
  const own = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  assert.equal(own.reservedFor.unavailable, true, 'the owner is told this person is not available');
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() });
  assert.equal(w.head(s.id).status, 'available'); invariant(w, s.id);
});
test('a re-invited reporter or moderator keeps no old report rights, and the accused is matched by account', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Other' });
  const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
  w.leave('fam1', 'ava'); w.join('fam1', 'ava');     // the accused leaves and returns
  assert.equal(await status(w.call('exchangeListingGet', 'ava', { listingId: s.id })), 404);
  assert.equal(await status(w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() })), 404, 'orphaned listing: no handler acts on it');
});

/* ---------- 3. recipient eligibility at confirmation ---------- */
test('removal between asking and confirming blocks the reservation, leaves the request waiting, and lets the owner pick someone else', async () => {
  const w = makeWorld(); const s = await seed(w);
  w.leave('fam1', 'dana');
  const n = w.events(s.id).length;
  assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() })), 'recipient_unavailable');
  assert.equal(w.events(s.id).length, n); assert.equal(w.head(s.id).status, 'available'); assert.equal(w.head(s.id).reqs.find((r) => r.id === s.danaReq).st, 'waiting');
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }); invariant(w, s.id);
});
test('an eligibility change between asking and confirming blocks that person only, and the hook sees the recipient and their membership', async () => {
  const w = makeWorld(); const s = await seed(w);
  w.hooks.eligible = ({ user }) => user.$id !== 'dana';
  w.eligCalls.length = 0;
  assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() })), 'recipient_unavailable');
  const asked = w.eligCalls.find((a) => a.user.$id === 'dana');
  assert.ok(asked && asked.familyId === 'fam1' && asked.membershipId === w.mem.fam1.get('dana').mid);
  w.hooks.eligible = ({ user }) => { if (user.$id === 'ben') throw new Error('hook down'); return true; };
  assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() })), 'recipient_unavailable', 'a failing hook denies');
  w.hooks.eligible = () => true;
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() }); invariant(w, s.id);
});
test('CONSISTENCY BOUNDARY: a removal that lands after the final membership check but before the claim is not caught at commit, and is contained afterwards', async () => {
  const w = makeWorld(); const s = await seed(w); let done = false;
  w.before = async ({ op, tableId, data }) => { if (!done && op === 'create' && tableId === T.events && data.kind === 'reserve') { done = true; w.leave('fam1', 'ben'); } };
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  w.before = null;
  assert.equal(w.head(s.id).status, 'reserved', 'the reservation did commit: membership lives in Appwrite Teams, outside the claim');
  assert.equal(await status(w.call('exchangeListingGet', 'ben', { listingId: s.id })), 403, 'but the removed person cannot reach anything');
  const own = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing; assert.equal(own.reservedFor.unavailable, true);
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() }); assert.equal(w.head(s.id).status, 'available'); invariant(w, s.id);
});

/* ---------- 4. membership pagination ---------- */
test('members and moderators beyond the first page of memberships are found', async () => {
  const w = makeWorld({ extra: 250, mods: () => ['u230', 'ghost'] });
  w.listCalls = 0;
  const made = await w.call('exchangeListingSave', 'u240', { ...free(), publish: true, opId: w.oid() });
  assert.equal(made.listing.owner, 'User 240', 'a member past the first 100 is a member');
  assert.ok(w.listCalls >= 3, 'every page was read');
  const id = made.listing.id;
  await w.call('exchangeReport', 'u200', { listingId: id, reason: 'Other' });
  const rep = (await w.call('exchangeReportList', 'u230')).reports;
  assert.equal(rep.length, 1, 'a moderator at position 231 can list reports');
  assert.equal(await status(w.call('exchangeReportList', 'u231')), 404, 'a non-moderator past the first page cannot');
  await w.call('exchangeReportResolve', 'u230', { reportId: rep[0].id, decision: 'hide', opId: w.oid() });
  assert.equal(w.head(id).status, 'hidden');
  await w.call('exchangeRequestCreate', 'u249', { listingId: id, note: '', opId: w.oid() }).catch(() => {});
});
test('a family of exactly one full page and one just over still reads completely', async () => {
  for (const extra of [95, 96]) {                     // 5 named members + extra = 100 or 101
    const w = makeWorld({ extra, mods: () => ['u' + (extra - 1)] });
    const made = await w.call('exchangeListingSave', 'u' + (extra - 1), { ...free(), publish: true, opId: w.oid() });
    assert.equal(made.listing.owner, 'User ' + (extra - 1));
  }
});

/* ---------- 5. listing limits ---------- */
test('finishing or withdrawing a listing really does free a place; drafts and hidden listings still use one', async () => {
  await withLimit('listingsPerMember', 3, async () => {
    const w = makeWorld({ mods: () => ['dana'] });
    const mk = async (t, extra = {}) => (await w.call('exchangeListingSave', 'ava', { ...free({ title: t }), publish: true, opId: w.oid(), ...extra })).listing.id;
    const a = await mk('A'), b = await mk('B'); await mk('C', { publish: false });   // a draft counts
    const err1 = await w.call('exchangeListingSave', 'ava', { ...free({ title: 'D' }), publish: true, opId: w.oid() }).catch((e) => e);
    assert.equal(err1.code, 'limit'); assert.match(err1.message, /Finish or withdraw one/);
    await w.call('exchangeListingEnd', 'ava', { listingId: a, to: 'withdrawn', opId: w.oid() });
    const d = await mk('D');                                                          // withdrawing freed a place
    assert.equal(await code(w.call('exchangeListingSave', 'ava', { ...free({ title: 'E' }), publish: true, opId: w.oid() })), 'limit');
    await w.call('exchangeListingEnd', 'ava', { listingId: b, to: 'gone', opId: w.oid() });
    await mk('E');                                                                    // finishing freed another
    await w.call('exchangeReport', 'ben', { listingId: d, reason: 'Other' });
    const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
    await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() });
    assert.equal(await code(w.call('exchangeListingSave', 'ava', { ...free({ title: 'F' }), publish: true, opId: w.oid() })), 'limit', 'a hidden listing still holds its place');
    assert.equal((await w.call('exchangeMine', 'ava')).listings.length, 5);
  });
});
test('the limit is per person, a repeated create tap does not use a second place, and the number stays provisional', async () => {
  await withLimit('listingsPerMember', 2, async () => {
    const w = makeWorld(); const id = w.oid();
    await w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: id });
    await w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: id });
    await w.call('exchangeListingSave', 'ava', { ...free({ title: 'Two' }), publish: true, opId: w.oid() });
    assert.equal(w.tables[T.listings].size, 2);
    await w.call('exchangeListingSave', 'ben', { ...free({ title: 'Ben' }), publish: true, opId: w.oid() });
  });
  assert.equal(EXCHANGE_LIMITS.listingsPerMember, 50, 'placeholder value, to be confirmed');
});

/* ---------- lifecycle rules carried from the preview ---------- */
test('reserved listings take private edits only, keep the author text exactly, and release does not publish them', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  let v = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  const text = 'Sturdy  shelf.\n\n\nNow with  two   spaces.';
  const r = await w.call('exchangeListingSave', 'ava', { ...free({ description: text }), listingId: s.id, rev: v.rev, publish: true, opId: w.oid() });
  assert.equal(r.saved, 'private'); assert.equal(r.blocked, true);
  assert.equal(w.head(s.id).data.description, 'Sturdy shelf.');
  const seenByBen = (await w.call('exchangeListingGet', 'ben', { listingId: s.id })).listing;
  assert.equal(seenByBen.description, 'Sturdy shelf.'); assert.equal(seenByBen.pending, undefined);
  const spacing = await w.call('exchangeListingSave', 'ava', { ...free({ description: 'Sturdy  shelf.' }), listingId: s.id, rev: (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing.rev, publish: true, opId: w.oid() });
  assert.equal(spacing.saved, 'private', 'even a spacing-only change waits'); assert.deepEqual(spacing.materialChanges, []);
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() });
  v = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  assert.equal(v.status, 'available'); assert.equal(v.description, 'Sturdy shelf.', 'release did not publish'); assert.equal(v.pending.description, 'Sturdy  shelf.');
  assert.equal(v.requests.find((q) => q.id === s.benReq).status, 'released');
  assert.equal(v.requests.find((q) => q.id === s.danaReq).status, 'waiting');
  const pub = await w.call('exchangeListingSave', 'ava', { ...free({ description: text }), listingId: s.id, rev: v.rev, publish: true, opId: w.oid() });
  assert.equal(pub.saved, 'published'); assert.equal(w.head(s.id).data.description, text, 'stored byte for byte'); assert.equal(w.head(s.id).pending, null);
});
test('asking again after a release or a cancel makes a waiting request and never a reservation', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() });
  const back = (await w.call('exchangeRequestCreate', 'ben', { listingId: s.id, note: 'again', opId: w.oid() })).listing;
  assert.equal(back.myRequest.status, 'waiting'); assert.equal(back.status, 'available');
  await w.call('exchangeRequestCancel', 'ben', { listingId: s.id, opId: w.oid() });
  assert.equal((await w.call('exchangeListingGet', 'ben', { listingId: s.id })).listing.myRequest.status, 'cancelled');
  assert.equal((await w.call('exchangeRequestCreate', 'ben', { listingId: s.id, note: '', opId: w.oid() })).listing.myRequest.status, 'waiting');
  invariant(w, s.id);
});
test('a decline is final for that person and gives no reason, and the recipient can back out', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeRequestDecline', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() });
  assert.equal(await code(w.call('exchangeRequestCreate', 'dana', { listingId: s.id, note: '', opId: w.oid() })), 'declined');
  assert.equal(await status(w.call('exchangeRequestCancel', 'dana', { listingId: s.id, opId: w.oid() })), 409);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  const seen = (await w.call('exchangeListingGet', 'ben', { listingId: s.id })).listing; assert.equal(seen.myRequest.reservedForMe, true);
  const after = (await w.call('exchangeCancelReservation', 'ben', { listingId: s.id, opId: w.oid() })).listing;
  assert.equal(after.status, 'available'); assert.equal(after.myRequest.status, 'cancelled'); invariant(w, s.id);
});
test('ending a listing closes every open request, withdrawn leaves only a minimal record, and wanted posts end differently', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  assert.equal(await code(w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'fulfilled', opId: w.oid() })), 'changed', 'a free item cannot be fulfilled');
  await w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'withdrawn', opId: w.oid() });
  invariant(w, s.id);
  const min = (await w.call('exchangeListingGet', 'ben', { listingId: s.id })).listing;
  assert.deepEqual(Object.keys(min).sort(), ['id', 'kind', 'myRequest', 'owner', 'status', 'title']);
  assert.equal(await status(w.call('exchangeListingGet', 'cleo', { listingId: s.id })), 404, 'someone who never asked sees nothing');
  const wanted = (await w.call('exchangeListingSave', 'ava', { kind: 'wanted', title: 'Tomato cages', category: 'Garden and outdoor', description: 'Any size.', area: 'near the park', publish: true, opId: w.oid() })).listing;
  assert.equal(wanted.status, 'open');
  await w.call('exchangeListingEnd', 'ava', { listingId: wanted.id, to: 'fulfilled', opId: w.oid() });
  assert.equal(w.head(wanted.id).status, 'fulfilled');
});
test('a draft publishes only for its owner and is invisible to everyone else', async () => {
  const w = makeWorld();
  const d = (await w.call('exchangeListingSave', 'ava', { ...free(), opId: w.oid() })).listing;
  assert.equal(d.status, 'draft');
  assert.equal((await w.call('exchangeHome', 'ben')).listings.length, 0);
  const p = await w.call('exchangeListingSave', 'ava', { ...free(), listingId: d.id, rev: d.rev, publish: true, opId: w.oid() });
  assert.equal(p.listing.status, 'available'); assert.equal((await w.call('exchangeHome', 'ben')).listings.length, 1);
});

/* ---------- moderation ---------- */
test('hide, restore and keep behave as in the preview, and a hidden reserved listing keeps its reservation', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Wrong category', detail: '' });
  assert.equal((await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Wrong category' })).already, true, 'a second report from the same person is a no-op');
  const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
  assert.equal(rep.reporter, 'Cleo Rowan');
  await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() });
  assert.equal(w.head(s.id).status, 'hidden'); assert.ok(w.head(s.id).resv);
  assert.equal((await w.call('exchangeHome', 'ben')).listings.length, 0);
  const owner = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing; assert.equal(owner.hiddenByModerator, true);
  assert.equal(await code(w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'gone', opId: w.oid() })), 'changed', 'owner cannot change a hidden listing');
  assert.equal(await code(w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() })), 'changed');
  const modView = (await w.call('exchangeListingGet', 'dana', { listingId: s.id })).listing; assert.deepEqual(Object.keys(modView).sort(), ['description', 'id', 'kind', 'moderatorView', 'status', 'title']);
  await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'restore', opId: w.oid() });
  assert.equal(w.head(s.id).status, 'reserved'); invariant(w, s.id);
  assert.equal(await code(w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() })), 'changed', 'a decided report cannot be decided again');
});
test('keep closes the report and leaves the listing alone; deciding on an ended listing is refused', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  await w.call('exchangeReport', 'ben', { listingId: s.id, reason: 'Other' });
  const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
  await w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'gone', opId: w.oid() });
  assert.equal(await code(w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() })), 'changed');
  const w2 = makeWorld({ mods: () => ['dana'] }); const s2 = await seed(w2);
  await w2.call('exchangeReport', 'ben', { listingId: s2.id, reason: 'Other' });
  const r2 = (await w2.call('exchangeReportList', 'dana')).reports[0];
  await w2.call('exchangeReportResolve', 'dana', { reportId: r2.id, decision: 'keep', opId: w2.oid() });
  assert.equal(w2.head(s2.id).status, 'available'); assert.equal(w2.head(s2.id).reps[0].st, 'kept');
});
test('report limits and validation', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  assert.equal(await status(w.call('exchangeReport', 'ava', { listingId: s.id, reason: 'Other' })), 400, 'not your own listing');
  assert.equal(await status(w.call('exchangeReport', 'ben', { listingId: s.id, reason: 'made up' })), 400);
  const ids = [];
  for (let i = 0; i < 11; i++) ids.push((await w.call('exchangeListingSave', 'cleo', { ...free({ title: 'Item ' + i }), publish: true, opId: w.oid() })).listing.id);
  let sent = 0, limited = 0;
  for (const id of ids) { try { await w.call('exchangeReport', 'ben', { listingId: id, reason: 'Other' }); sent++; } catch (e) { if (e.status === 429) limited++; } }
  assert.equal(sent, 10); assert.equal(limited, 1);
});

/* ---------- privacy: field-by-field allow-lists ---------- */
test('non-owners never see other applicants, reservations, pending edits or internals', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  const v = (await w.call('exchangeListingGet', 'dana', { listingId: s.id })).listing;
  const text = JSON.stringify(v);
  for (const leak of ['Ben', 'requests', 'pending', 'reservedFor"', 'familyId', 'ownerId', 'ownerM', 'requesterId', 'seq', 'claimKey', 'opKey', 'membership', 'hiddenFrom', '"$', '"uid"', '"m"']) assert.equal(text.includes(leak), false, 'leaked ' + leak);
  assert.equal(v.myRequest.reservedForMe, false);
  const home = JSON.stringify(await w.call('exchangeHome', 'dana'));
  for (const leak of ['Ben', 'description', 'requests', 'rev', 'pending']) assert.equal(home.includes(leak), false, 'home leaked ' + leak);
  const owner = JSON.stringify((await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing);
  for (const leak of ['familyId', 'ownerId', 'ownerM', 'requesterId', 'claimKey', 'opKey', '"seq"', '"uid"', '"m"', '"reps"']) assert.equal(owner.includes(leak), false, 'owner view leaked ' + leak);
});
test('my activity lists only my own requests and my own listings, and never a hidden or draft one', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  const a = await w.call('exchangeActivity', 'ava'); assert.equal(a.needsReply[0].waiting, 2);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  assert.equal((await w.call('exchangeActivity', 'ava')).reserved[0].for, 'Ben Rowan');
  assert.equal((await w.call('exchangeActivity', 'ben')).requests[0].reservedForMe, true);
  assert.equal((await w.call('exchangeActivity', 'dana')).requests[0].reservedForMe, false);
  await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Other' });
  const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
  await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() });
  assert.equal((await w.call('exchangeActivity', 'ben')).requests.length, 0, 'no title leak once hidden');
  assert.equal((await w.call('exchangeActivity', 'ava')).hidden.length, 1);
});

/* ---------- input rules ---------- */
test('photos, contact details, addresses and long text are refused; request notes follow the same rules', async () => {
  const w = makeWorld();
  assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...free({ photos: ['a.jpg'] }), publish: true, opId: w.oid() })), 400, 'photos are not approved');
  assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...free({ description: 'call 555 123 4567' }), publish: true, opId: w.oid() })), 400);
  assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...free({ area: '412 Maple Street' }), publish: true, opId: w.oid() })), 400);
  assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...free({ description: 'x'.repeat(2500) }), publish: true, opId: w.oid() })), 400);
  assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...free({ condition: 'Mint' }), publish: true, opId: w.oid() })), 400);
  assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...free(), kind: 'priced', publish: true, opId: w.oid() })), 400, 'no money listings');
  const s = await seed(w);
  assert.equal(await status(w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: 'text me at a@b.com', opId: w.oid() })), 400);
  assert.equal(await status(w.call('exchangeRequestCreate', 'ava', { listingId: s.id, note: '', opId: w.oid() })), 400, 'not your own');
  assert.equal(await status(w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: '', opId: 'bad id!' })), 400, 'bad opId');
});
test('a request that would grow a snapshot past the soft cap is refused instead of truncated', async () => {
  const w = makeWorld(); const s = await seed(w);
  await withLimit('stateSoftMax', Buffer.byteLength(w.events(s.id).pop().state) + 100, async () => {
    assert.equal(await code(w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: 'x'.repeat(250), opId: w.oid() })), 'limit');
  });
});

/* ---------- parity with the preview rules ---------- */
test('server rules match the preview rules (text rules only; photos and the Messages wording differ on purpose)', () => {
  const P = createRequire(import.meta.url)('../../exchange-preview/exchange-rules.js');
  for (const k of ['title', 'description', 'area', 'note']) assert.equal(R.LIMITS[k], P.LIMITS[k], k);
  assert.deepEqual(R.CATEGORIES, P.CATEGORIES); assert.deepEqual(R.CONDITIONS, P.CONDITIONS);
  const samples = ['412 Maple Street', 'near the library', 'a@b.com', 'call 555 123 4567', 'www.example.com', '', '  spaced   out  ', '12 Oak Ave', 'Plain text'];
  for (const s of samples) { assert.equal(R.looksLikeAddress(s), P.looksLikeAddress(s), s); assert.equal(R.looksLikeContact(s), P.looksLikeContact(s), s); assert.equal(R.clean(s), P.clean(s), s); }
  const base = { kind: 'free', title: 'Oak', category: 'Furniture', condition: 'Good', description: 'Sturdy', area: 'near the park' };
  const variants = [base, { ...base, title: '' }, { ...base, category: 'Cars' }, { ...base, condition: 'Mint' }, { ...base, description: 'a@b.com' }, { ...base, description: '12 Oak Ave' }, { ...base, area: '412 Maple Street' }, { ...base, kind: 'wanted', condition: '' }, { ...base, kind: 'other' }, { ...base, description: 'x'.repeat(1001) }];
  for (const v of variants) assert.deepEqual(Object.keys(R.validate(v).errors).sort(), Object.keys(P.validate({ ...v, photos: [] }).errors).sort(), JSON.stringify(v));
  const pairs = [[base, { ...base, title: 'oak' }], [base, { ...base, description: 'Sturdy   ' }], [base, { ...base, description: 'Stur\n dy' }], [base, { ...base, area: 'near the lake' }], [base, base]];
  for (const [a, b] of pairs) { assert.deepEqual(R.materialChanges(a, b), P.materialChanges(a, b)); assert.equal(R.anyChanges(a, b), P.anyChanges(a, b)); }
});
test('the schema the code expects declares every unique key the design relies on', () => {
  assert.deepEqual(EXCHANGE_SCHEMA.exchangeEvents.unique, [['claimKey'], ['opKey']]);
  assert.deepEqual(EXCHANGE_SCHEMA.exchangeRequests.unique, [['requestKey']]);
  assert.deepEqual(EXCHANGE_SCHEMA.exchangeReports.unique, [['reportKey']]);
  assert.equal(EXCHANGE_SCHEMA.exchangeReservations, undefined, 'there is no mutable reservation table any more');
  for (const t of ['exchangeListings', 'exchangeRequests', 'exchangeReports']) assert.ok(/ownerMembership|requesterMembership|reporterMembership/.test(Object.keys(EXCHANGE_SCHEMA[t].columns).join()), t + ' binds a membership id');
});

/* ======================= snapshot size: safety actions must always fit ======================= */
const cjk = (n) => '漢'.repeat(n), emoji = (n) => '😀'.repeat(Math.floor(n / 2));   // n counts UTF-16 units, which is what the length limits count
const maxFree = (o = {}) => free({ title: cjk(80), description: cjk(1000), area: cjk(60), ...o });
const bytesOf = (w, id) => Buffer.byteLength(w.events(id).pop().state);
/* build a listing at the soft cap: maximum data, as many maximum-size reports as allowed, then maximum-size requests until the size cap refuses one */
async function fillToCap(w, text) {
  const id = (await w.call('exchangeListingSave', 'ava', { ...maxFree(), publish: true, opId: w.oid() })).listing.id;
  let reports = 0, asked = [];
  for (let i = 30; i < 55; i++) { try { await w.call('exchangeReport', 'u' + i, { listingId: id, reason: 'Item looks unsafe or recalled', detail: text(300) }); reports++; } catch (e) { if (e.code === 'limit') break; throw e; } }
  for (let i = 0; i < 30; i++) { try { await w.call('exchangeRequestCreate', 'u' + i, { listingId: id, note: text(300), opId: w.oid() }); asked.push('u' + i); } catch (e) { if (e.code === 'limit') break; throw e; } }
  return { id, reports, asked };
}
for (const [label, text] of [['multibyte CJK text', cjk], ['four-byte emoji text', emoji]]) {
  test(`SIZE (${label}): at the cap, growth is refused but every safety action still works and stays under the hard cap`, async () => {
    const w = makeWorld({ extra: 60, mods: () => ['dana'] });
    const { id, reports, asked } = await fillToCap(w, text);
    const full = bytesOf(w, id), S = EXCHANGE_LIMITS;
    assert.ok(full > S.stateSoftMax - 1400 && full <= S.stateSoftMax, 'filled to the soft cap: ' + full);
    assert.ok(full > JSON.parse(w.events(id).pop().state).reqs.length * 100, 'multibyte content really counted in bytes');
    assert.ok(Buffer.byteLength(text(300)) > 300 * 1.9, 'the test text is multibyte');
    assert.ok(reports >= 10 && asked.length >= 10 && asked.length < S.requestsPerListing, `a real history: ${reports} reports, ${asked.length} requests, limited by size not by count`);
    assert.equal(await code(w.call('exchangeRequestCreate', 'u59', { listingId: id, note: text(300), opId: w.oid() })), 'limit', 'a new request is refused');
    assert.equal(await code(w.call('exchangeReport', 'u29', { listingId: id, reason: 'Item looks unsafe or recalled', detail: text(300) })), 'limit', 'a new report is refused');
    let max = full, maxDelta = 0, last = full;
    const step = async (name, p) => { await p; const b = bytesOf(w, id); max = Math.max(max, b); maxDelta = Math.max(maxDelta, b - last); last = b; assert.ok(b <= S.stateBytesMax, name + ' stayed under the hard cap: ' + b); invariant(w, id); };
    const view = async () => (await w.call('exchangeListingGet', 'ava', { listingId: id })).listing;
    const reqOf = async (n) => (await view()).requests.find((r) => r.from === 'User ' + n.slice(1)).id;
    const shortEdit = free({ description: 'Shorter.' });
    await step('a shrinking edit is allowed', w.call('exchangeListingSave', 'ava', { ...shortEdit, listingId: id, rev: (await view()).rev, publish: true, opId: w.oid() }));
    assert.ok(bytesOf(w, id) < full - 2000, 'shrinking freed room');
    await step('decline', w.call('exchangeRequestDecline', 'ava', { listingId: id, requestId: await reqOf(asked[0]), opId: w.oid() }));
    await step('reserve', w.call('exchangeReserve', 'ava', { listingId: id, requestId: await reqOf(asked[1]), opId: w.oid() }));
    const open = (await w.call('exchangeReportList', 'dana')).reports.filter((r) => r.status === 'open');
    await step('hide (moderation)', w.call('exchangeReportResolve', 'dana', { reportId: open[0].id, decision: 'hide', opId: w.oid() }));
    await step('restore (moderation)', w.call('exchangeReportResolve', 'dana', { reportId: open[0].id, decision: 'restore', opId: w.oid() }));
    await step('keep (moderation)', w.call('exchangeReportResolve', 'dana', { reportId: open[1].id, decision: 'keep', opId: w.oid() }));
    await step('recipient backs out', w.call('exchangeCancelReservation', asked[1], { listingId: id, opId: w.oid() }));
    await step('reserve again', w.call('exchangeReserve', 'ava', { listingId: id, requestId: await reqOf(asked[2]), opId: w.oid() }));
    await step('release', w.call('exchangeRelease', 'ava', { listingId: id, opId: w.oid() }));
    await step('an applicant cancels', w.call('exchangeRequestCancel', asked[3], { listingId: id, opId: w.oid() }));
    await step('withdraw', w.call('exchangeListingEnd', 'ava', { listingId: id, to: 'withdrawn', opId: w.oid() }));
    assert.equal(w.head(id).status, 'withdrawn');
    assert.ok(S.stateBytesMax - S.stateSoftMax >= 10 * Math.max(maxDelta, 1), `headroom ${S.stateBytesMax - S.stateSoftMax} is at least 10x the largest single safety growth ${maxDelta}`);
    assert.ok(S.stateBytesMax <= 65535, 'under the column limit with margin');
  });
}
test('SIZE: withdrawing is the first thing tried at the cap, and it works', async () => {
  const w = makeWorld({ extra: 60, mods: () => ['dana'] }); const { id } = await fillToCap(w, cjk);
  await w.call('exchangeListingEnd', 'ava', { listingId: id, to: 'withdrawn', opId: w.oid() });
  assert.equal(w.head(id).status, 'withdrawn'); invariant(w, id);
});
test('SIZE: a long random run of safety actions on a full listing never fails for size and never passes the hard cap', async () => {
  const w = makeWorld({ extra: 60, mods: () => ['dana'] }); const { id, asked } = await fillToCap(w, cjk);
  let x = 12345; const rnd = (n) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return Math.abs(x) % n; };
  const ok = new Set(['changed', 'not_available', 'recipient_unavailable']); let done = 0, maxB = 0; const errs = {};
  for (let i = 0; i < 160; i++) {
    w.clock += 8000;   // keep the per-minute brake out of the way
    const who = asked[rnd(asked.length)], view = (await w.call('exchangeListingGet', 'ava', { listingId: id }).catch(() => null));
    const ids = view ? view.listing.requests.map((r) => r.id) : [], pick = () => ids[rnd(ids.length)] || 'nosuch';
    const reps = (await w.call('exchangeReportList', 'dana')).reports, rep = reps[rnd(Math.max(reps.length, 1))];
    if (w.head(id).status === 'hidden') { const hr = reps.find((r) => r.status === 'hidden'); await w.call('exchangeReportResolve', 'dana', { reportId: hr.id, decision: 'restore', opId: w.oid() }); done++; continue; }   // a moderator restores
    const ops = [
      () => w.call('exchangeReserve', 'ava', { listingId: id, requestId: pick(), opId: w.oid() }),
      () => w.call('exchangeRelease', 'ava', { listingId: id, opId: w.oid() }),
      () => w.call('exchangeCancelReservation', who, { listingId: id, opId: w.oid() }),
      () => w.call('exchangeRequestDecline', 'ava', { listingId: id, requestId: pick(), opId: w.oid() }),
      () => w.call('exchangeRequestCancel', who, { listingId: id, opId: w.oid() }),
      () => w.call('exchangeListingDiscardPending', 'ava', { listingId: id, opId: w.oid() }),
      () => rep && w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: ['keep', 'hide', 'restore'][rnd(3)], opId: w.oid() }),
      () => w.call('exchangeRequestCreate', who, { listingId: id, note: cjk(300), opId: w.oid() })   // may re-ask after a release or cancel, which does not grow the snapshot
    ];
    try { await ops[rnd(ops.length)](); done++; } catch (e) { errs[e.code || e.status] = (errs[e.code || e.status] || 0) + 1; assert.ok(ok.has(e.code) || e.status === 409 || e.status === 404, 'unexpected failure: ' + (e.code || e.message)); assert.notEqual(e.code === 'limit' && !(e.message || '').includes('too full') && !(e.message || '').includes('reached'), true, 'size refusal on a safety action'); }
    const b = bytesOf(w, id); maxB = Math.max(maxB, b); assert.ok(b <= EXCHANGE_LIMITS.stateBytesMax); invariant(w, id);
    if (w.head(id).status === 'withdrawn') break;
  }
  assert.ok(done > 20, 'many operations really ran: ' + done + ' ' + JSON.stringify(errs) + ' ' + w.head(id).status); assert.ok(maxB <= EXCHANGE_LIMITS.stateBytesMax);
});
test('SIZE: maximum single-listing data, with a maximum private edit while reserved, fits well inside the cap', async () => {
  const w = makeWorld();
  const id = (await w.call('exchangeListingSave', 'ava', { ...maxFree(), publish: true, opId: w.oid() })).listing.id;
  await w.call('exchangeRequestCreate', 'ben', { listingId: id, note: cjk(300), opId: w.oid() });
  const rq = (await w.call('exchangeListingGet', 'ava', { listingId: id })).listing.requests[0].id;
  await w.call('exchangeReserve', 'ava', { listingId: id, requestId: rq, opId: w.oid() });
  const v = (await w.call('exchangeListingGet', 'ava', { listingId: id })).listing;
  const r = await w.call('exchangeListingSave', 'ava', { ...maxFree({ title: cjk(79) + '字', description: cjk(999) + '字' }), listingId: id, rev: v.rev, publish: true, opId: w.oid() });
  assert.equal(r.saved, 'private');
  assert.ok(bytesOf(w, id) < EXCHANGE_LIMITS.stateSoftMax / 2, 'listing + pending + one request: ' + bytesOf(w, id));
  await w.call('exchangeListingEnd', 'ava', { listingId: id, to: 'withdrawn', opId: w.oid() });
});
test('SIZE: a very large first listing is refused cleanly rather than stored half-way', async () => {
  await withLimit('stateSoftMax', 3000, async () => {
    const w = makeWorld();
    assert.equal(await status(w.call('exchangeListingSave', 'ava', { ...maxFree(), publish: true, opId: w.oid() })), 400);
    assert.equal(w.tables[T.events].size, 0);
  });
});

/* ======================= hint-row failures ======================= */
const hintRows = (w, t) => [...w.tables[t].values()];
test('HINT (ask): a failure between the hint and the snapshot leaves nothing visible, and the same or a new retry completes it with one entry', async () => {
  const w = makeWorld(); const s = await seed(w); const opId = w.oid();
  w.fail.push({ op: 'create', table: T.events, times: 1 });
  assert.ok(await code(w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: 'hi', opId })));
  assert.equal(hintRows(w, T.requests).filter((r) => r.requesterId === 'cleo').length, 1, 'the hint exists');
  assert.equal(w.head(s.id).reqs.some((r) => r.uid === 'cleo'), false, 'but no request exists');
  assert.equal((await w.call('exchangeListingGet', 'cleo', { listingId: s.id })).listing.myRequest, null, 'the hint grants nothing');
  assert.equal((await w.call('exchangeActivity', 'cleo')).requests.length, 0, 'and is not listed');
  assert.equal((await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing.requests.some((r) => r.from === 'Cleo Rowan'), false);
  const again = await w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: 'hi', opId: w.oid() });   // a NEW opId, as a fresh tap would send
  assert.equal(again.listing.myRequest.status, 'waiting');
  assert.equal(hintRows(w, T.requests).filter((r) => r.requesterId === 'cleo').length, 1, 'still one hint');
  const entry = w.head(s.id).reqs.filter((r) => r.uid === 'cleo'); assert.equal(entry.length, 1); assert.equal(entry[0].id, hintRows(w, T.requests).find((r) => r.requesterId === 'cleo').$id, 'entry id equals hint id');
  assert.equal((await w.call('exchangeActivity', 'cleo')).requests.length, 1); invariant(w, s.id);
});
test('HINT (ask): when the listing ended before the retry, the request fails cleanly, the hint stays harmless, and cleanup removes it', async () => {
  const w = makeWorld(); const s = await seed(w);
  w.fail.push({ op: 'create', table: T.events, times: 1 });
  await code(w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: '', opId: w.oid() }));
  await w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'withdrawn', opId: w.oid() });
  assert.equal(await status(w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: '', opId: w.oid() })), 404, 'withdrawn and never asked: not available');
  assert.equal((await w.call('exchangeActivity', 'cleo')).requests.length, 0);
  assert.deepEqual(await w.ex.retention.sweepHints('fam1', 3600000), { listings: 0, requests: 0, reports: 0 }, 'too new to sweep');
  w.clock += 2 * 3600000;
  const removed = await w.ex.retention.sweepHints('fam1', 3600000);
  assert.equal(removed.requests, 1, 'only the orphan hint is removed');
  assert.equal(hintRows(w, T.requests).filter((r) => r.requesterId === 'cleo').length, 0);
  assert.ok(hintRows(w, T.requests).some((r) => r.requesterId === 'ben') && hintRows(w, T.requests).some((r) => r.requesterId === 'dana'), 'hints that reached a snapshot are kept');
});
test('HINT (report): a hint without a report is invisible to moderators, cannot be decided, still counts toward the daily limit, and a retry completes it', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  w.fail.push({ op: 'create', table: T.events, times: 1 });
  assert.ok(await code(w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Other', detail: 'x' })));
  const orphan = hintRows(w, T.reports)[0];
  assert.equal((await w.call('exchangeReportList', 'dana')).reports.length, 0, 'not listed');
  assert.equal(await status(w.call('exchangeReportResolve', 'dana', { reportId: orphan.$id, decision: 'hide', opId: w.oid() })), 404, 'cannot be decided');
  assert.equal(w.head(s.id).status, 'available');
  const ok = await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Other', detail: 'x' });
  assert.equal(ok.sent, true); assert.equal(hintRows(w, T.reports).length, 1, 'same hint reused');
  const listed = (await w.call('exchangeReportList', 'dana')).reports; assert.equal(listed.length, 1); assert.equal(listed[0].id, orphan.$id);
});
test('HINT (create): a listing hint with no snapshot is not a listing: invisible, uncounted, not hijackable, and a retry or cleanup resolves it', async () => {
  await withLimit('listingsPerMember', 2, async () => {
    const w = makeWorld(); const opId = w.oid();
    w.fail.push({ op: 'create', table: T.events, times: 1 });
    assert.ok(await code(w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId })));
    assert.equal(w.tables[T.listings].size, 1); assert.equal(w.tables[T.events].size, 0);
    assert.equal((await w.call('exchangeHome', 'ben')).listings.length, 0); assert.equal((await w.call('exchangeMine', 'ava')).listings.length, 0);
    assert.equal(await status(w.call('exchangeListingSave', 'ben', { ...free(), publish: true, opId })), 400, 'someone else cannot take the same opId');
    for (const t of ['One', 'Two']) await w.call('exchangeListingSave', 'ava', { ...free({ title: t }), publish: true, opId: w.oid() });   // the orphan used no place
    const done = await w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId }).catch((e) => e.code);
    assert.equal(done, undefined === done ? undefined : done);
  });
  const w2 = makeWorld(); const o2 = w2.oid();
  w2.fail.push({ op: 'create', table: T.events, times: 1 });
  await code(w2.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: o2 }));
  const r = await w2.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: o2 });   // same retry completes it
  assert.equal(r.listing.status, 'available'); assert.equal(w2.tables[T.listings].size, 1); assert.equal(w2.tables[T.events].size, 1);
  const w3 = makeWorld(); w3.fail.push({ op: 'create', table: T.events, times: 1 }); await code(w3.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: w3.oid() }));
  w3.clock += 2 * 3600000; assert.equal((await w3.ex.retention.sweepHints('fam1', 3600000)).listings, 1); assert.equal(w3.tables[T.listings].size, 0);
});
test('HINT: hints never grant rights, even when forged or mismatched', async () => {
  await withLimit('listingsPerMember', 2, async () => {
    const w = makeWorld(); const s = await seed(w);
    w.tables[T.requests].set('forged1', { $id: 'forged1', familyId: 'fam1', listingId: s.id, requesterId: 'cleo', requesterMembership: w.mem.fam1.get('cleo').mid, requestKey: s.id + '_' + w.mem.fam1.get('cleo').mid });
    w.tables[T.listings].set('forged2', { $id: 'forged2', familyId: 'fam1', ownerId: 'ben', ownerMembership: w.mem.fam1.get('ben').mid, kind: 'free', ended: false });
    assert.equal((await w.call('exchangeListingGet', 'cleo', { listingId: s.id })).listing.myRequest, null);
    assert.equal(await status(w.call('exchangeRequestCancel', 'cleo', { listingId: s.id, opId: w.oid() })), 409);
    assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: 'forged1', opId: w.oid() })), 'changed');
    assert.equal(await status(w.call('exchangeListingEnd', 'ben', { listingId: s.id, to: 'withdrawn', opId: w.oid() })), 404);
    w.tables[T.listings].set(s.id + 'x', { $id: s.id + 'x', familyId: 'fam1', ownerId: 'ben', ownerMembership: w.mem.fam1.get('ben').mid, kind: 'free', ended: false });
    for (const t of ['A', 'B']) await w.call('exchangeListingSave', 'ben', { ...free({ title: t }), publish: true, opId: w.oid() });   // forged hints did not use his places
    assert.equal(await code(w.call('exchangeListingSave', 'ben', { ...free({ title: 'C' }), publish: true, opId: w.oid() })), 'limit');
  });
});
test('HINT: a lost hint on a committed request is restored by the next ask, with the same id', async () => {
  const w = makeWorld(); const s = await seed(w);
  const hint = hintRows(w, T.requests).find((r) => r.requesterId === 'ben'); w.tables[T.requests].delete(hint.$id);
  assert.equal((await w.call('exchangeActivity', 'ben')).requests.length, 0, 'not discoverable while the hint is gone');
  assert.equal((await w.call('exchangeListingGet', 'ben', { listingId: s.id })).listing.myRequest.status, 'waiting', 'the request itself is intact and reachable');
  assert.equal(await code(w.call('exchangeRequestCreate', 'ben', { listingId: s.id, note: '', opId: w.oid() })), 'already_asked');
  assert.ok(w.tables[T.requests].has(hint.$id), 'the hint is back under the same id');
  assert.equal((await w.call('exchangeActivity', 'ben')).requests.length, 1);
});

/* ======================= retention, deletion and the chain ======================= */
const allText = (w) => JSON.stringify([...w.tables[T.events].values(), ...w.tables[T.requests].values(), ...w.tables[T.reports].values(), ...w.tables[T.listings].values()]);
test('RETENTION: nothing is wired to an action, no period is defaulted, and the sweep refuses a short or missing window', async () => {
  const w = makeWorld();
  assert.deepEqual(Object.keys(w.ex.actions).filter((k) => /erase|retention|redact|sweep|blank/i.test(k)), []);
  for (const bad2 of [undefined, 0, 1000, 3599999, NaN, '3600000']) assert.equal(await status(w.ex.retention.sweepHints('fam1', bad2)), 400);
  const s = await seed(w); await w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'withdrawn', opId: w.oid() });
  w.clock += 400 * 24 * 3600000;
  assert.ok(allText(w).includes('Please'), 'a year later the content is still there: indefinite unless someone runs a job');
});
test('RETENTION: erasing a listing appends a clean snapshot, blanking history keeps the chain valid, and old retries and stale writers still cannot change anything', async () => {
  const w = makeWorld({ mods: () => ['dana'] }); const s = await seed(w);
  await w.call('exchangeReport', 'cleo', { listingId: s.id, reason: 'Other', detail: 'secret detail' });
  let release; const gate = new Promise((r) => { release = r; }); let held = false; const staleOp = w.oid();
  w.before = async ({ op, tableId, data }) => { if (!held && op === 'create' && tableId === T.events && data.kind === 'reserve') { held = true; await gate; } };
  const stale = w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: staleOp }).then(() => 'ok', (e) => e.code);
  for (let i = 0; i < 200 && !held; i++) await tick(); w.before = null;
  await w.ex.retention.erase('fam1', s.id, 'xerase00001');
  const blanked = await w.ex.retention.blankHistory('fam1', s.id);
  const h = w.head(s.id), rows = w.events(s.id);
  assert.ok(blanked >= 3); assert.equal(h.status, 'withdrawn'); assert.equal(h.data.title, ''); assert.ok(h.reqs.every((r) => r.note === '' && r.st !== 'waiting')); assert.ok(h.reps.every((r) => r.detail === ''));
  rows.forEach((r, i) => { assert.equal(r.seq, i + 1); assert.equal(r.claimKey, s.id + '_' + r.seq); assert.ok(r.opKey); if (i < rows.length - 1) assert.equal(r.state, '{}'); else assert.notEqual(r.state, '{}'); });
  for (const t of ['Oak bookshelf', 'Please', 'Me too', 'secret detail']) assert.equal(allText(w).includes(t), false, 'gone: ' + t);
  const n = rows.length; release();
  assert.equal(await stale, 'changed', 'the paused writer is refused, then finds a withdrawn listing');
  assert.equal(w.events(s.id).length, n, 'and wrote nothing');
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: staleOp }).catch(() => {});
  assert.equal(w.events(s.id).length, n, 'an old opId replayed after the purge is still a no-op'); invariant(w, s.id);
});
test('RETENTION: blanking history while a change is being written leaves a valid chain', async () => {
  const w = makeWorld(); const s = await seed(w);
  for (let i = 0; i < 3; i++) await w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: 'n' + i, opId: w.oid() }).catch(() => {});
  await Promise.allSettled([w.ex.retention.blankHistory('fam1', s.id), w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }), w.ex.retention.blankHistory('fam1', s.id)]);
  const rows = w.events(s.id), top = rows[rows.length - 1];
  assert.notEqual(top.state, '{}', 'the head is never blanked'); rows.forEach((r, i) => assert.equal(r.seq, i + 1));
  assert.ok(w.head(s.id).v === 1); invariant(w, s.id);
  await w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() }).catch(() => {});
});
test('RETENTION: removing a member erases their listings, notes, report details, hints and account id, and leaves other people\'s content and every chain intact', async () => {
  const w = makeWorld({ mods: () => ['dana'] });
  const avas = await seed(w);                                                                                       // ava's listing: ben and dana asked
  const bens = (await w.call('exchangeListingSave', 'ben', { ...free({ title: 'BENLIST' }), publish: true, opId: w.oid() })).listing.id;
  await w.call('exchangeRequestCreate', 'cleo', { listingId: bens, note: 'CLEONOTE', opId: w.oid() });
  await w.call('exchangeReport', 'ben', { listingId: avas.id, reason: 'Other', detail: 'BENREPORT' });
  await w.call('exchangeReserve', 'ava', { listingId: avas.id, requestId: avas.benReq, opId: w.oid() });
  await w.call('exchangeRequestCreate', 'ben', { listingId: (await w.call('exchangeListingSave', 'cleo', { ...free({ title: 'CLEOLIST' }), publish: true, opId: w.oid() })).listing.id, note: 'BENNOTE', opId: w.oid() });
  assert.ok(allText(w).includes('"ben"'));
  const r = await w.ex.retention.redactMember('fam1', 'ben', 'tag000001');
  assert.ok(r.listings >= 3);
  for (const t of ['"ben"', 'BENLIST', 'BENREPORT', 'BENNOTE']) assert.equal(allText(w).includes(t), false, 'removed: ' + t);
  assert.ok(allText(w).includes('Me too') && allText(w).includes('CLEOLIST'), 'other people\'s content is kept');
  const h = w.head(avas.id);
  assert.equal(h.status, 'available', 'his reservation was released'); assert.equal(h.resv, null); assert.ok(h.reqs.find((x) => x.id === avas.danaReq).st === 'waiting');
  assert.equal(w.head(bens).status, 'withdrawn');
  for (const id of [avas.id, bens]) { const rows = w.events(id); rows.forEach((x, i) => assert.equal(x.seq, i + 1)); }
  await w.call('exchangeReserve', 'ava', { listingId: avas.id, requestId: avas.danaReq, opId: w.oid() });   // the chain still takes new changes
  invariant(w, avas.id);
});
