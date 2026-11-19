/* Family Exchange backend tests. These run against an IN-MEMORY FAKE database that enforces the declared schema (columns and UNIQUE indexes),
 * so they prove the SIMULATED implementation only. Real Appwrite concurrency, permissions and unique-index behaviour are Step 7 live checks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createExchange, EXCHANGE_SCHEMA, EXCHANGE_TABLES as T } from '../src/exchange.js';
import * as R from '../src/exchange-rules.js';
import { ApiError } from '../src/logic.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
const bad = (m) => new ApiError(400, 'bad_request', m);
const forbidden = (m = 'You do not have access to do that.') => new ApiError(403, 'forbidden', m);
const err = (code, m) => Object.assign(new Error(m), { code });
const tick = () => new Promise((r) => setImmediate(r));

function makeWorld({ eligible = () => true, mods = () => [], enabled = true } = {}) {
  const w = { tables: {}, clock: 1_800_000_000_000, seq: 0, fail: [], before: null, calls: [], hooks: { eligible, mods }, n: 0 };
  for (const t of [...Object.values(T), 'profiles']) w.tables[t] = new Map();
  const people = { ava: 'Ava Rowan', ben: 'Ben Rowan', dana: 'Dana Rowan', cleo: 'Cleo Rowan', eli: 'Eli Rowan' };
  w.teamsOf = { fam1: Object.keys(people), fam2: ['zed'] };
  w.owner = { fam1: 'ava', fam2: 'zed' };
  const schema = (t) => EXCHANGE_SCHEMA[t];
  const parseQ = (q) => JSON.parse(q);
  const guard = async (op, tableId, id) => {
    await tick();
    w.calls.push(op + ':' + tableId);
    if (w.before) await w.before({ op, tableId, id });
    const f = w.fail.find((x) => x.op === op && x.table === tableId && (x.times === undefined || x.times > 0) && (!x.skip || (x.skip -= 1, false) === true));
    if (f) { if (f.times !== undefined) f.times -= 1; throw err(500, 'injected failure'); }
  };
  const listRowsRaw = (tableId, queries = []) => {
    let rows = [...w.tables[tableId].values()], limit = 25, order = null, after = null;
    for (const raw of queries) {
      const q = parseQ(raw);
      if (q.method === 'equal') rows = rows.filter((r) => q.values.includes(q.attribute === '$id' ? r.$id : r[q.attribute]));
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
    teams: { async listMemberships({ teamId }) { return { memberships: (w.teamsOf[teamId] || []).map((u) => ({ userId: u, confirm: true, userName: people[u] || u })) }; } },
    async listRows(tableId, queries) { await guard('list', tableId); return listRowsRaw(tableId, queries); },
    async createRow(tableId, rowId, data) {
      await guard('create', tableId, rowId);
      const s = schema(tableId);
      if (s) for (const k of Object.keys(data)) if (!(k in s.columns)) throw err(400, 'Unknown column ' + k);
      const table = w.tables[tableId];
      if (table.has(rowId)) throw err(409, 'row exists');
      if (s) for (const u of s.unique) if ([...table.values()].some((r) => u.every((k) => r[k] === data[k]))) throw err(409, 'unique ' + u.join());
      const row = { ...data, $id: rowId, $createdAt: new Date(w.clock + ++w.seq).toISOString() };
      table.set(rowId, row); return { ...row };
    },
    async updateRow(tableId, rowId, data) {
      await guard('update', tableId, rowId);
      const s = schema(tableId), row = w.tables[tableId].get(rowId);
      if (!row) throw err(404, 'nope');
      if (s) for (const k of Object.keys(data)) if (!(k in s.columns)) throw err(400, 'Unknown column ' + k);
      Object.assign(row, data); return { ...row };
    },
    async deleteRow(tableId, rowId) { await guard('delete', tableId, rowId); if (!w.tables[tableId].delete(rowId)) throw err(404, 'nope'); return {}; },
    async getRowOrNull(tableId, rowId) { await guard('get', tableId, rowId); const r = w.tables[tableId].get(rowId); return r ? { ...r } : null; },
    async firstRow(tableId, queries) { await guard('list', tableId); return listRowsRaw(tableId, [...queries, JSON.stringify({ method: 'limit', values: [1] })]).rows[0] || null; },
    async requireMember(user, familyIdRaw) {
      if (typeof familyIdRaw !== 'string' || !ID_RE.test(familyIdRaw)) throw bad('familyId is not valid.');
      if (!(w.teamsOf[familyIdRaw] || []).includes(user.$id)) throw forbidden('You are not a member of this family.');
      return { familyId: familyIdRaw, isOwner: w.owner[familyIdRaw] === user.$id };
    },
    idOf(value, label) { if (typeof value !== 'string' || !ID_RE.test(value)) throw bad(`${label} is not valid.`); return value; },
    bad, forbidden, ApiError, sdkCode: (e) => (e && typeof e.code === 'number' ? e.code : 0),
    now: () => w.clock, profilesTable: 'profiles',
    newId: () => 'n' + ++w.n,
    eligibility: async (a) => w.hooks.eligible(a),
    moderators: async (a) => w.hooks.mods(a)
  };
  if (enabled) w.tables[T.state].set('fam1', { $id: 'fam1', familyId: 'fam1', enabled: true });
  const ex = createExchange(deps);
  const as = (id) => ({ $id: id });
  let op = 0;
  const oid = () => 'op' + String(++op).padStart(8, '0');
  const call = (name, who, body = {}) => ex.actions[name]({ user: as(who), body: { familyId: 'fam1', ...body } });
  const fam = (name, who, body) => call(name, who, body);
  w.call = fam; w.oid = oid; w.ex = ex;
  w.row = (t, id) => w.tables[t].get(id);
  return w;
}
const free = (o = {}) => ({ kind: 'free', title: 'Oak bookshelf', category: 'Furniture', condition: 'Good', description: 'Sturdy shelf.', area: 'near the library', ...o });
async function seed(w, extra = {}) {
  const made = await w.call('exchangeListingSave', 'ava', { ...free(extra), publish: true, opId: w.oid() });
  const id = made.listing.id;
  await w.call('exchangeRequestCreate', 'ben', { listingId: id, note: 'Please', opId: w.oid() });
  await w.call('exchangeRequestCreate', 'dana', { listingId: id, note: 'Me too', opId: w.oid() });
  const owner = await w.call('exchangeListingGet', 'ava', { listingId: id });
  const rq = (n) => owner.listing.requests.find((r) => r.from === n).id;
  return { id, benReq: rq('Ben Rowan'), danaReq: rq('Dana Rowan') };
}
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.status; } };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

/* ---------- fail closed ---------- */
test('Exchange is off by default, and an owner switch alone does not make anyone eligible', async () => {
  const w = makeWorld({ enabled: false });
  assert.equal(await status(w.call('exchangeHome', 'ava')), 404);
  assert.equal((await w.call('exchangeStatus', 'ava')).enabled, false);
  assert.equal(await status(w.call('exchangeSetState', 'ben', { enabled: true })), 403, 'only the owner can switch it');
  await w.call('exchangeSetState', 'ava', { enabled: true });
  assert.equal((await w.call('exchangeHome', 'ava')).listings.length, 0);
  const w2 = makeWorld({ enabled: false }); w2.hooks.eligible = () => false;
  await w2.call('exchangeSetState', 'ava', { enabled: true });
  assert.equal(await status(w2.call('exchangeHome', 'ava')), 404, 'switched on, but not eligible');
});
test('missing, odd or throwing eligibility denies everyone, with the same not-available answer', async () => {
  const w = makeWorld();
  for (const hook of [() => false, () => undefined, () => 'yes', () => 1, () => { throw new Error('boom'); }]) {
    w.hooks.eligible = hook;
    assert.equal(await status(w.call('exchangeHome', 'ava')), 404);
  }
  const ex = createExchange({ ...{ teams: {}, listRows: async () => ({ rows: [] }), getRowOrNull: async () => ({ enabled: true }), requireMember: async () => ({ familyId: 'f', isOwner: true }), idOf: (v) => v, bad, forbidden, ApiError, sdkCode: () => 0, now: () => 1 } });
  assert.equal(await status(ex.actions.exchangeHome({ user: { $id: 'u' }, body: { familyId: 'f' } })), 404, 'no hook at all means nobody');
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
  const grab = async (who, listingId) => { try { await w.call('exchangeListingGet', who, { listingId }); return 'ok'; } catch (e) { return JSON.stringify([e.status, e.code, e.message]); } };
  const missing = await grab('cleo', 'doesnotexist');
  assert.equal(await grab('cleo', draft), missing);
  await w.call('exchangeReport', 'ben', { listingId: s.id, reason: 'Other', detail: '' });
  const rep = (await w.call('exchangeReportList', 'dana')).reports[0];
  await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'hide', opId: w.oid() });
  assert.equal(await grab('cleo', s.id), missing, 'hidden looks like missing to a member');
  assert.equal(await grab('ben', s.id), missing, 'and to an applicant');
  assert.notEqual(await grab('dana', s.id), missing, 'the moderator can open it');
  assert.notEqual(await grab('ava', s.id), missing, 'the owner can open it');
  const w2 = makeWorld(); w2.teamsOf.fam2 = ['zed']; w2.tables[T.listings].set('x1', { $id: 'x1', familyId: 'fam2', ownerId: 'zed', kind: 'free', status: 'available', rev: 1, seq: 0, data: '{}', pending: '' });
  assert.equal(await grab.call(null, 'ava', 'x1') === undefined, false);
  assert.equal(await status(w2.call('exchangeListingGet', 'ava', { listingId: 'x1' })), 404, 'a listing from another family is not reachable');
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
  const w = makeWorld({ mods: () => ['dana', 'ava'] }); const s = await seed(w);
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

/* ---------- concurrency: the claim ---------- */
const invariant = (w, id) => {
  const l = w.row(T.listings, id), res = [...w.tables[T.reservations].values()].filter((r) => r.listingId === id);
  const reqs = [...w.tables[T.requests].values()].filter((r) => r.listingId === id);
  assert.ok(res.length <= 1, 'at most one reservation row');
  const reserved = reqs.filter((r) => r.status === 'reserved');
  assert.ok(reserved.length <= 1, 'at most one reserved request');
  if (l.status === 'reserved') { assert.equal(res.length, 1); assert.equal(reserved.length, 1); assert.equal(res[0].requestId, reserved[0].$id); assert.equal(res[0].reservedFor, reserved[0].requesterId); }
  else { assert.equal(res.length, 0); assert.equal(reserved.length, 0); }
  if (['gone', 'withdrawn', 'closed', 'fulfilled'].includes(l.status)) assert.ok(reqs.every((r) => r.status !== 'waiting' && r.status !== 'reserved'), 'no open request on an ended listing');
  const events = [...w.tables[T.events].values()].filter((e) => e.listingId === id).sort((a, b) => a.seq - b.seq);
  events.forEach((e, i) => assert.equal(e.seq, i + 1, 'claims are gap-free'));
  assert.equal(l.seq, events.length, 'listing row caught up with every claim');
};
test('two reservation confirmations: exactly one wins, the other is told it changed', async () => {
  const w = makeWorld(); const s = await seed(w);
  const results = await Promise.allSettled([
    w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }),
    w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() })
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'changed');
  invariant(w, s.id);
  assert.equal(w.row(T.listings, s.id).status, 'reserved');
});
test('many simultaneous reservations still produce one winner', async () => {
  const w = makeWorld(); const s = await seed(w);
  const out = await Promise.allSettled([...Array(6)].map((_, i) => w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: i % 2 ? s.benReq : s.danaReq, opId: w.oid() })));
  assert.equal(out.filter((r) => r.status === 'fulfilled').length, 1);
  invariant(w, s.id);
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
test('release versus a new reservation never double-books', async () => {
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
    const l = w.row(T.listings, s.id), edit = results[0];
    if (edit.status === 'fulfilled' && edit.value.saved === 'private') { assert.equal(JSON.parse(l.data).title, 'Oak bookshelf'); assert.ok(l.pending); }
    if (edit.status === 'rejected') assert.equal(edit.reason.code, 'changed');
  }
});
test('stale revisions change nothing', async () => {
  const w = makeWorld(); const s = await seed(w);
  const v = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  await w.call('exchangeListingSave', 'ava', { ...free({ title: 'First' }), listingId: s.id, rev: v.rev, opId: w.oid() });
  const eventsBefore = w.tables[T.events].size;
  assert.equal(await code(w.call('exchangeListingSave', 'ava', { ...free({ title: 'Second' }), listingId: s.id, rev: v.rev, opId: w.oid() })), 'changed');
  assert.equal(w.tables[T.events].size, eventsBefore, 'no claim was taken');
  assert.equal(JSON.parse(w.row(T.listings, s.id).data).title, 'First');
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
  assert.equal(w.row(T.listings, s.id).status, 'available', 'the old retry did not re-reserve'); invariant(w, s.id);
});
test('two identical retries at the same moment make one claim', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  const out = await Promise.allSettled([1, 2, 3].map(() => w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id })));
  assert.ok(out.every((r) => r.status === 'fulfilled'));
  assert.equal([...w.tables[T.events].values()].filter((e) => e.opKey === s.id + '_' + id).length, 1); invariant(w, s.id);
});
test('a repeated create tap makes one listing', async () => {
  const w = makeWorld(); const id = w.oid();
  await Promise.all([1, 2].map(() => w.call('exchangeListingSave', 'ava', { ...free(), publish: true, opId: id })));
  assert.equal(w.tables[T.listings].size, 1);
});
test('someone else cannot replay another person\'s opId', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  assert.equal(await status(w.call('exchangeCancelReservation', 'ben', { listingId: s.id, opId: id })), 400);
});

/* ---------- partial failures roll forward ---------- */
test('a failure part-way through applying is finished by the next action, never left half done', async () => {
  const w = makeWorld(); const s = await seed(w);
  w.fail.push({ op: 'update', table: T.requests, times: 1 });   // the request update inside the reserve plan fails
  assert.ok(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() })));
  assert.equal(w.row(T.listings, s.id).status, 'available', 'the listing row is written last, so it still shows the old state');
  const claimed = [...w.tables[T.events].values()].filter((e) => e.kind === 'reserve');
  assert.equal(claimed.length, 1, 'the claim exists');
  // another person's action on the same listing first rolls the claimed change forward
  const seen = await w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: '', opId: w.oid() });
  assert.equal(seen.listing.status, 'reserved');
  invariant(w, s.id);
  assert.equal(w.row(T.requests, s.benReq).status, 'reserved');
});
test('a failure on the very last write is also repaired', async () => {
  const w = makeWorld(); const s = await seed(w);
  w.fail.push({ op: 'update', table: T.listings, times: 1 });
  assert.ok(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() })));
  assert.equal(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.danaReq, opId: w.oid() })), 'changed', 'the second confirm sees the first one finished');
  invariant(w, s.id); assert.equal(w.row(T.requests, s.danaReq).status, 'waiting');
});
test('retrying the same failed action with the same opId completes it once', async () => {
  const w = makeWorld(); const s = await seed(w); const id = w.oid();
  w.fail.push({ op: 'create', table: T.reservations, times: 1 });
  assert.ok(await code(w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id })));
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: id });
  invariant(w, s.id); assert.equal(w.row(T.listings, s.id).status, 'reserved');
});
test('a slow first executor stops once someone else has finished its change (best effort fence)', async () => {
  const w = makeWorld(); const s = await seed(w);
  let release; const gate = new Promise((r) => { release = r; }); let held = false;
  w.before = async ({ op, tableId }) => { if (!held && op === 'update' && tableId === T.requests) { held = true; await gate; } };
  const slow = w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() }).catch((e) => e);
  for (let i = 0; i < 40 && !held; i++) await tick();
  assert.ok(held, 'the first executor is paused after claiming');
  w.before = null;
  await w.call('exchangeRequestCreate', 'cleo', { listingId: s.id, note: '', opId: w.oid() });   // repairs and completes the claimed change
  release(); await slow;
  invariant(w, s.id);
  assert.equal(w.row(T.listings, s.id).status, 'reserved');
});

/* ---------- lifecycle rules carried from the preview ---------- */
test('reserved listings take private edits only, keep the author text exactly, and release does not publish them', async () => {
  const w = makeWorld(); const s = await seed(w);
  await w.call('exchangeReserve', 'ava', { listingId: s.id, requestId: s.benReq, opId: w.oid() });
  let v = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing;
  const text = 'Sturdy  shelf.\n\n\nNow with  two   spaces.';
  const r = await w.call('exchangeListingSave', 'ava', { ...free({ description: text }), listingId: s.id, rev: v.rev, publish: true, opId: w.oid() });
  assert.equal(r.saved, 'private'); assert.equal(r.blocked, true);
  assert.equal(JSON.parse(w.row(T.listings, s.id).data).description, 'Sturdy shelf.');
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
  assert.equal(pub.saved, 'published'); assert.equal(JSON.parse(w.row(T.listings, s.id).data).description, text, 'stored byte for byte');
  assert.equal(w.row(T.listings, s.id).pending, '');
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
  assert.equal(w.row(T.listings, wanted.id).status, 'fulfilled');
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
  assert.equal(w.row(T.listings, s.id).status, 'hidden'); assert.equal(w.tables[T.reservations].size, 1);
  assert.equal((await w.call('exchangeHome', 'ben')).listings.length, 0);
  const owner = (await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing; assert.equal(owner.hiddenByModerator, true);
  assert.equal(await code(w.call('exchangeListingEnd', 'ava', { listingId: s.id, to: 'gone', opId: w.oid() })), 'changed', 'owner cannot change a hidden listing');
  assert.equal(await code(w.call('exchangeRelease', 'ava', { listingId: s.id, opId: w.oid() })), 'changed');
  const modView = (await w.call('exchangeListingGet', 'dana', { listingId: s.id })).listing; assert.deepEqual(Object.keys(modView).sort(), ['description', 'id', 'kind', 'moderatorView', 'status', 'title']);
  await w.call('exchangeReportResolve', 'dana', { reportId: rep.id, decision: 'restore', opId: w.oid() });
  assert.equal(w.row(T.listings, s.id).status, 'reserved'); invariant(w, s.id);
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
  assert.equal(w2.row(T.listings, s2.id).status, 'available'); assert.equal(w2.row(T.reports, r2.id).status, 'kept');
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
  for (const leak of ['Ben', 'requests', 'pending', 'reservedFor"', 'familyId', 'ownerId', 'requesterId', 'seq', 'claimKey', 'opKey', 'plan', 'hiddenFrom', '"$']) assert.equal(text.includes(leak), false, 'leaked ' + leak);
  assert.equal(v.myRequest.reservedForMe, false);
  const home = JSON.stringify(await w.call('exchangeHome', 'dana'));
  for (const leak of ['Ben', 'description', 'requests', 'rev', 'pending']) assert.equal(home.includes(leak), false, 'home leaked ' + leak);
  const owner = JSON.stringify((await w.call('exchangeListingGet', 'ava', { listingId: s.id })).listing);
  for (const leak of ['familyId', 'ownerId', 'requesterId', 'claimKey', 'opKey', '"plan"', '"seq"']) assert.equal(owner.includes(leak), false, 'owner view leaked ' + leak);
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
  assert.deepEqual(EXCHANGE_SCHEMA.exchangeReservations.unique, [['listingId']]);
  assert.deepEqual(EXCHANGE_SCHEMA.exchangeRequests.unique, [['requestKey']]);
  assert.deepEqual(EXCHANGE_SCHEMA.exchangeReports.unique, [['reportKey']]);
});
