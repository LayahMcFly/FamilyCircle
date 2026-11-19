'use strict';
const test = require('node:test'), assert = require('node:assert');
const { Query, TablesDB } = require('node-appwrite');
const manifest = require('./schema.manifest.json');
const { createAdapter, schemaCallCounts } = require('./adapter');
const { runProbe, cleanup, budget } = require('./probe');
const { createFakeTablesDb } = require('./fake-sdk');
const { createRedactor } = require('./redact');
const mk = (db, o = {}) => createAdapter({ tablesDb: db, Query, manifest, maxCalls: o.maxCalls || 1e6, sleep: async () => {}, ...o });
const fast = { tables: manifest.roles, rounds: 3, width: 6, trials: 8, p5Rounds: 2, p5Writers: 6, readyPollMs: 1, readyTimeoutMs: 5 };

test('contract: the pinned SDK has every call the adapter makes, with object-parameter forms', () => {
  const need = ['createRow', 'getRow', 'listRows', 'deleteRow', 'listTables', 'listColumns', 'listIndexes', 'create', 'createTable', 'createStringColumn', 'createIntegerColumn', 'createTextColumn', 'createIndex'];
  for (const n of need) assert.equal(typeof TablesDB.prototype[n], 'function', n);
  assert.deepEqual(JSON.parse(Query.equal('a', ['b'])), { method: 'equal', attribute: 'a', values: ['b'] });
  assert.equal(JSON.parse(Query.orderDesc('seq')).method, 'orderDesc');
  assert.deepEqual(JSON.parse(Query.limit(5)).values, [5]);
  assert.deepEqual(JSON.parse(Query.cursorAfter('x')).values, ['x']);
});

test('the full probe passes through the adapter on a correct store, inside the budget, and cleanup removes only recorded rows', async () => {
  const db = createFakeTablesDb(manifest), a = mk(db), r = await runProbe(a, fast);
  assert.deepEqual(r.results.filter((x) => !x.pass), []); assert.equal(r.stopped, null);
  const used = a.stats().calls; assert.ok(used <= budget(fast).runTotal, used + ' within ' + budget(fast).runTotal);
  const total = [...Object.values(db.tables)].reduce((n, t) => n + t.size, 0); assert.equal(total, r.created.length);
  const a2 = mk(db), c = await cleanup(a2, r.created); assert.equal(c.failed.length, 0); assert.ok(a2.stats().calls <= budget(fast).cleanupTotal);
  assert.equal([...Object.values(db.tables)].reduce((n, t) => n + t.size, 0), 0);
});

test('worst-case budget holds with the real defaults on a store whose responses are all conflicts or slow', async () => {
  const b = budget(); assert.equal(b.runTotal, Object.values(b.parts).reduce((x, y) => x + y, 0));
  assert.ok(b.runTotal <= 6008 && b.rowsMax === 491);
  /* a store that never enforces unique keys still stays within the budget (P2-P4 all succeed, so every create is a row) */
  const db = createFakeTablesDb(manifest, { enforce: false }), a = mk(db, { maxCalls: b.runTotal }), r = await runProbe(a, { tables: manifest.roles, readyPollMs: 1, readyTimeoutMs: 5 });
  assert.ok(a.stats().calls <= b.runTotal); assert.ok(r.created.length <= b.rowsMax, r.created.length + ' rows');
  assert.ok(r.results.some((x) => !x.pass));
});

test('the call cap is a hard stop: the next request is never sent', async () => {
  const db = createFakeTablesDb(manifest), a = mk(db, { maxCalls: 40 }), r = await runProbe(a, fast);
  assert.equal(a.stats().calls, 40); assert.equal(r.stopped, 'budget'); assert.equal(r.pass, false);
  assert.equal(db.log.length, 40, 'the fake saw exactly 40 requests');
});

test('401 and 403 stop everything at once; no scope widening, no retry', async () => {
  for (const code of [401, 403]) {
    const db = createFakeTablesDb(manifest, { fail: Object.assign((n) => n === 'listRows', { code }) }), a = mk(db), r = await runProbe(a, fast);
    assert.equal(r.stopped, 'auth'); assert.equal(db.log.length, 1, 'one request, then silence');
  }
});

test('repeated 429 or 5xx stops the run; a single one does not', async () => {
  for (const code of [429, 503]) {
    const db = createFakeTablesDb(manifest, { fail: Object.assign((n, i) => n === 'createRow' && i > 4, { code }) }), a = mk(db), r = await runProbe(a, fast);
    assert.equal(r.stopped, 'throttled_or_unavailable'); assert.equal(r.pass, false);
    const sent = db.log.filter((x) => x === 'createRow').length; assert.ok(sent <= 3 + fast.width, 'only the already-started concurrent batch, then silence: ' + sent);
  }
  const once = createFakeTablesDb(manifest, { fail: Object.assign((n, i) => n === 'listRows' && i === 2, { code: 503 }) }), a = mk(once);
  await a.list('probeEvents', { limit: 1 }); await assert.rejects(a.list('probeEvents', { limit: 1 }), /./);
  await a.list('probeEvents', { limit: 1 }); assert.equal(a.stopReason(), null);
});

test('the wall-clock deadline stops the run', async () => {
  let t = 0; const db = createFakeTablesDb(manifest), a = mk(db, { deadlineMs: 1000, now: () => t });
  await a.list('probeEvents', { limit: 1 }); t = 5000;
  await assert.rejects(a.list('probeEvents', { limit: 1 }), /stopped: time/); assert.equal(a.stopReason(), 'time'); assert.equal(db.log.length, 1);
});

test('a project that already holds rows is refused', async () => {
  const db = createFakeTablesDb(manifest); await db.createRow({ databaseId: 'exchange_probe', tableId: 'probeHints', rowId: 'old', data: { familyId: 'x', listingId: 'x', requesterId: 'x', requesterMembership: 'x', requestKey: 'x' }, permissions: [] });
  const a = mk(db), r = await runProbe(a, fast); assert.equal(r.stopped, 'not_clean'); assert.equal(r.pass, false); assert.equal(db.log.filter((x) => x === 'createRow').length, 1);
});

test('a store that does not enforce unique keys is caught through the real adapter', async () => {
  const r = await runProbe(mk(createFakeTablesDb(manifest, { enforce: false })), fast);
  const failed = r.results.filter((x) => !x.pass).map((x) => x.id); for (const id of ['P1', 'P2', 'P3', 'P4']) assert.ok(failed.includes(id), id);
});

test('readiness: waits for building columns, reports missing ones, flags a non-unique index', async () => {
  const db = createFakeTablesDb(manifest); db.schema.tables.probeEvents.indexes[0].type = 'key';
  const items = await mk(db).readiness(); assert.ok(items.find((x) => x.key === 'uq_claimKey' && x.unique && x.type === 'key'));
  const r = await runProbe(mk(db), fast); assert.equal(r.results.length, 1); assert.equal(r.results[0].id, 'P0'); assert.equal(r.pass, false);
  const db2 = createFakeTablesDb(manifest); db2.schema.tables.probeHints.columns.pop();
  assert.ok((await mk(db2).readiness()).some((x) => x.status === 'missing'));
});

test('verifySchema reports each kind of drift and changes nothing', async () => {
  assert.deepEqual(await mk(createFakeTablesDb(manifest)).verifySchema(), { ok: true, problems: [] });
  const drift = [
    ['wrong size', (s) => { s.tables.probeEvents.columns.find((c) => c.key === 'claimKey').size = 64; }, /size 64 not 80/],
    ['wrong type', (s) => { s.tables.probeEvents.columns.find((c) => c.key === 'seq').type = 'string'; }, /type string not integer/],
    ['extra column', (s) => { s.tables.probeEvents.columns.push({ key: 'extra', type: 'string', size: 5, required: false, status: 'available' }); }, /unexpected column extra/],
    ['missing index', (s) => { s.tables.probeEvents.indexes.pop(); }, /missing index ix_family_actor/],
    ['index not unique', (s) => { s.tables.probeEvents.indexes[1].type = 'key'; }, /uq_opKey: type key not unique/],
    ['index still building', (s) => { s.tables.probeHints.indexes[0].status = 'processing'; }, /status processing/],
    ['table permissions', (s) => { s.tables.probeText.permissions = ['read("any")']; }, /permissions are not empty/],
    ['row security', (s) => { s.tables.probeText.rowSecurity = true; }, /rowSecurity differs/],
    ['extra table', (s) => { s.tables.other = { columns: [], indexes: [], permissions: [], rowSecurity: false }; }, /unexpected table other/],
    ['array column', (s) => { s.tables.probeText.columns[0].array = true; }, /is an array/]
  ];
  for (const [name, mutate, re] of drift) { const db = createFakeTablesDb(manifest); mutate(db.schema); const v = await mk(db).verifySchema(); assert.equal(v.ok, false, name); assert.ok(v.problems.some((p) => re.test(p)), name + ': ' + v.problems.join('; ')); assert.ok(db.log.every((x) => x.startsWith('list')), name + ' made only read calls'); }
  const none = createFakeTablesDb(manifest, { prebuilt: false }); assert.equal((await mk(none).verifySchema()).ok, false);
});

test('createSchema builds exactly the manifest, within its call count, waits for columns, and never touches what exists', async () => {
  const db = createFakeTablesDb(manifest, { prebuilt: false }), a = mk(db); const r = await a.createSchema();
  const n = schemaCallCounts(manifest); assert.ok(a.stats().calls <= n.createSchema);
  assert.equal(r.created, 1 + 3 + 14 + 7); assert.deepEqual(await mk(db).verifySchema(), { ok: true, problems: [] });
  const again = mk(db); await assert.rejects(again.createSchema(), (e) => e.code === 409); assert.equal(again.stopReason(), 'exists'); assert.equal(db.log.filter((x) => x === 'create').length, 2, 'one create per attempt, nothing updated or deleted');
  assert.ok(!db.log.some((x) => /delete|update/i.test(x) && !/Row/.test(x)));
  const slow = createFakeTablesDb(manifest, { prebuilt: false, slowColumns: true }), s = mk(slow);
  await assert.rejects(s.createSchema(), /stopped: columns_not_ready/); assert.equal(s.stopReason(), 'columns_not_ready'); assert.ok(!slow.log.includes('createIndex'));
});

test('row ids and data are validated before any request', async () => {
  const db = createFakeTablesDb(manifest), a = mk(db);
  await assert.rejects(async () => a.create('probeEvents', '_bad', {}), (e) => e.code === 400); await assert.rejects(async () => a.create('probeEvents', 'x'.repeat(37), {}), (e) => e.code === 400);
  await assert.rejects(async () => a.create('probeEvents', 'ok1', { $id: 'x' }), /\$/); assert.equal(db.log.length, 0);
});

test('createWithTimeout reports an unknown outcome, and the late commit is visible to a lookup', async () => {
  const db = createFakeTablesDb(manifest); let release; const gate = new Promise((r) => { release = r; }); const orig = db.createRow;
  db.createRow = async (p) => { await gate; return orig(p); };
  const a = mk(db), row = { familyId: 'probe', listingId: 'l', seq: 1, claimKey: 'l_1', opKey: 'l_o', actorId: 'probe', kind: 'probe', state: '{}' };
  const e = await a.createWithTimeout('probeEvents', 'late1', row, 5).then(() => null, (x) => x); assert.equal(e.code, 0); assert.equal(e.timeout, true);
  release(); await new Promise((r) => setTimeout(r, 20)); assert.equal((await a.list('probeEvents', { eq: ['opKey', 'l_o'], limit: 5 })).length, 1);
});

test('SDK errors are redacted even if the SDK put the key in the message', async () => {
  const KEY = 'standard_' + 'ab12'.repeat(20), red = createRedactor([KEY]);
  const db = createFakeTablesDb(manifest); db.listRows = async () => { throw Object.assign(new Error('request failed with key ' + KEY), { code: 500 }); };
  const a = mk(db, { redact: red }); const e = await a.list('probeEvents', { limit: 1 }).catch((x) => x);
  assert.ok(!e.message.includes(KEY)); assert.ok(!JSON.stringify(a.stats()).includes(KEY));
});
