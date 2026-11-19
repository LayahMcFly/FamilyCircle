'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const manifest = require('./schema.manifest.json'), pkg = require('./package.json'), lock = require('./package-lock.json');

test('the manifest is complete and exact', () => {
  assert.equal(manifest.database.id, 'exchange_probe');
  assert.deepEqual(manifest.tableDefaults, { permissions: [], rowSecurity: false, enabled: true });
  for (const [t, spec] of Object.entries(manifest.tables)) {
    assert.match(t, /^[A-Za-z][A-Za-z0-9_]{0,35}$/);
    const keys = spec.columns.map((c) => c.key); assert.equal(new Set(keys).size, keys.length, t + ' duplicate column');
    for (const c of spec.columns) { assert.ok(['string', 'integer', 'text'].includes(c.type)); assert.equal(c.required, true); assert.equal(c.type === 'string', Number.isInteger(c.size), t + '.' + c.key + ' size'); if (c.size) assert.ok(c.size > 0 && c.size <= 255); }
    for (const i of spec.indexes) { assert.ok(['key', 'unique'].includes(i.type)); assert.ok(i.columns.every((x) => keys.includes(x)), t + '.' + i.key + ' columns exist'); }
    const ik = spec.indexes.map((i) => i.key); assert.equal(new Set(ik).size, ik.length);
  }
  assert.deepEqual(manifest.roles, { events: 'probeEvents', hints: 'probeHints', text: 'probeText' });
  for (const r of Object.values(manifest.roles)) assert.ok(manifest.tables[r]);
});

test('the probe only writes columns the manifest defines, with values that fit', async () => {
  const { runProbe } = require('./probe'), { createFakeTablesDb } = require('./fake-sdk'), { createAdapter } = require('./adapter');
  const db = createFakeTablesDb(manifest), seen = [], orig = db.createRow;
  db.createRow = async (p) => { seen.push(p); return orig(p); };
  const a = createAdapter({ tablesDb: db, Query: require('node-appwrite').Query, manifest, maxCalls: 1e6 });
  await runProbe(a, { tables: manifest.roles, runId: 'abcdef0123', rounds: 2, width: 4, trials: 6, p5Rounds: 1, p5Writers: 4, readyPollMs: 1, readyTimeoutMs: 10 });
  assert.ok(seen.length > 50);
  for (const p of seen) {
    const spec = manifest.tables[p.tableId];
    assert.deepEqual(Object.keys(p.data).sort(), spec.columns.map((c) => c.key).sort(), p.tableId + ' columns');
    for (const c of spec.columns) { const v = p.data[c.key]; if (c.type === 'string') assert.ok(typeof v === 'string' && Buffer.byteLength(v) <= c.size, p.tableId + '.' + c.key + ' fits'); if (c.type === 'integer') assert.ok(Number.isInteger(v)); }
    assert.deepEqual(p.permissions, []);
  }
});

test('the events and hint definitions match the production schema as of this commit (drift alarm, not a runtime dependency)', async () => {
  /* read the object literal from the source text: importing the module would need the function's own node_modules */
  const src = fs.readFileSync(path.join(__dirname, '../function/src/exchange.js'), 'utf8');
  const m = /export const EXCHANGE_SCHEMA = (\{[\s\S]*?\n\});/.exec(src); assert.ok(m, 'EXCHANGE_SCHEMA literal found');
  const S = require('vm').runInNewContext('(' + m[1] + ')');
  const size = (s) => (/^string\((\d+)\)$/.exec(s) || [])[1];
  const pairs = [['probeEvents', 'exchangeEvents'], ['probeHints', 'exchangeRequests']];
  for (const [mine, prod] of pairs) {
    const spec = manifest.tables[mine], real = S[prod];
    const realCols = Object.entries(real.columns).map(([k, v]) => ({ key: k, type: size(v) ? 'string' : v.startsWith('text') ? 'text' : v, size: size(v) ? Number(size(v)) : undefined }));
    assert.deepEqual(spec.columns.map((c) => [c.key, c.type, c.size]).sort(), realCols.map((c) => [c.key, c.type, c.size]).sort(), mine + ' columns');
    assert.deepEqual(spec.indexes.filter((i) => i.type === 'unique').map((i) => i.columns).sort(), real.unique.slice().sort(), mine + ' unique');
    assert.deepEqual(spec.indexes.filter((i) => i.type === 'key').map((i) => i.columns).sort(), real.indexes.slice().sort(), mine + ' indexes');
  }
});

test('the SDK is pinned exactly, matches the production function, and the lockfile agrees', () => {
  assert.equal(pkg.dependencies['node-appwrite'], '31.1.0');
  assert.deepEqual(Object.keys(pkg.dependencies), ['node-appwrite']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '../function/package.json'), 'utf8')).dependencies['node-appwrite'], '31.1.0');
  const e = lock.packages['node_modules/node-appwrite']; assert.equal(e.version, '31.1.0'); assert.match(e.integrity, /^sha512-/);
  assert.equal(lock.packages[''].dependencies['node-appwrite'], '31.1.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules/node-appwrite/package.json'), 'utf8')).version, '31.1.0');
  for (const [name, p] of Object.entries(lock.packages)) if (name) assert.ok(p.integrity && p.resolved.startsWith('https://registry.npmjs.org/'), name + ' pinned with integrity');
});
