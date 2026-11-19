'use strict';
/* Offline rehearsal: the probe logic against an in-memory fake that enforces unique keys, plus two broken fakes the probe must catch. No network. */
const test = require('node:test'), assert = require('node:assert');
const { runProbe, cleanup } = require('./probe');
const T = { events: 'ev', hints: 'hi', text: 'tx' };
const UNIQ = { ev: ['claimKey', 'opKey'], hi: ['requestKey'], tx: [] };
const err = (code) => Object.assign(new Error('e' + code), { code });
function fake({ enforce = true, cap = 65535, brokenUnique = null } = {}) {
  const db = { ev: new Map(), hi: new Map(), tx: new Map() };
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    db,
    async readiness() { return [{ kind: 'index', table: 'ev', key: 'claimKey', status: 'available', unique: true, type: brokenUnique === 'type' ? 'key' : 'unique' }]; },
    async create(t, id, data) { await tick(); if (db[t].has(id)) throw err(409);
      if (enforce) for (const k of UNIQ[t]) if (k !== brokenUnique) for (const r of db[t].values()) if (r[k] === data[k]) throw err(409);
      if (t === 'tx' && Buffer.byteLength(data.state) > cap) throw err(400);
      db[t].set(id, { ...data, $id: id, $createdAt: db[t].size }); return { $id: id }; },
    async del(t, id) { if (!db[t].delete(id)) throw err(404); },
    async get(t, id) { const r = db[t].get(id); if (!r) throw err(404); return r; },
    async list(t, q) { let rows = [...db[t].values()]; if (q.eq) rows = rows.filter((r) => r[q.eq[0]] === q.eq[1]);
      if (q.orderDesc) rows.sort((a, b) => (b[q.orderDesc] > a[q.orderDesc] ? 1 : -1)); else rows.sort((a, b) => (a.$id > b.$id ? 1 : -1));
      if (q.after) rows = rows.slice(rows.findIndex((r) => r.$id === q.after) + 1); return rows.slice(0, q.limit || 25); },
    async createWithTimeout(t, id, data, ms) { const commit = ms % 2 === 0; if (commit) await this.create(t, id, data); throw err(0); }
  };
}
const opts = { tables: T, rounds: 4, width: 8, trials: 12 };
test('a correct store passes every check and cleans up', async () => {
  const a = fake(), r = await runProbe(a, opts); assert.deepEqual(r.results.filter((x) => !x.pass), []);
  const c = await cleanup(a, r.created); assert.equal(c.failed.length, 0);
  assert.equal(a.db.ev.size + a.db.hi.size + a.db.tx.size, 0, 'nothing left behind');
});
test('a store that does not enforce unique keys fails P1 to P4', async () => {
  const r = await runProbe(fake({ enforce: false }), opts); const failed = r.results.filter((x) => !x.pass).map((x) => x.id);
  for (const id of ['P1', 'P2', 'P3', 'P4']) assert.ok(failed.includes(id), id);
});
test('a store that enforces only claimKey fails the opKey checks', async () => {
  const r = await runProbe(fake({ brokenUnique: 'opKey' }), opts); const failed = r.results.filter((x) => !x.pass).map((x) => x.id);
  assert.ok(failed.includes('P1') && failed.includes('P3'));
});
test('an index that is not of type unique stops the run at readiness', async () => {
  const r = await runProbe(fake({ brokenUnique: 'type' }), opts); assert.equal(r.results.length, 1); assert.equal(r.pass, false);
});
test('a text column smaller than 60000 bytes fails P9', async () => {
  const r = await runProbe(fake({ cap: 30000 }), opts); assert.ok(r.results.find((x) => x.id === 'P9' && !x.pass));
});
