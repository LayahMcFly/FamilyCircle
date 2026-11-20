'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Query } = require('node-appwrite');
const manifest = require('./schema.manifest.json');
const { main, parseArgs, checkEndpoint, loadSecret } = require('./run');
const { PRODUCTION_PROJECT_ID } = require('./probe');
const { createFakeTablesDb } = require('./fake-sdk');

const KEY = 'standard_' + 'c0ffee12'.repeat(10);
const EP = 'https://nyc.cloud.appwrite.io/v1', PID = 'probeproject01';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const quick = { rounds: 2, width: 4, trials: 6, p5Rounds: 1, p5Writers: 4, readyPollMs: 1, readyTimeoutMs: 5 };
function setup(o = {}) {
  const dir = tmp(), keyFile = path.join(dir, 'key'); fs.writeFileSync(keyFile, KEY + '\n', { mode: 0o600 });
  const db = o.db || createFakeTablesDb(manifest), out = [], made = [];
  const env = { PROBE_ENDPOINT: EP, PROBE_PROJECT_ID: PID, PROBE_KEY_FILE: keyFile, ...(o.env || {}) };
  const deps = { emit: (l) => out.push(l), outDir: path.join(dir, 'out'), makeSdk: (x) => { made.push(x); return { tablesDb: db, Query }; }, sleep: async () => {}, probeOpts: quick, ...(o.deps || {}) };
  const go = (cmd, expect = PID) => main([cmd, ...(expect ? ['--expect-project', expect] : [])], env, deps);
  return { dir, db, out, made, env, deps, go };
}
const everything = (dir, out) => out.join('\n') + '\n' + (fs.existsSync(path.join(dir, 'out')) ? fs.readdirSync(path.join(dir, 'out')).map((f) => fs.readFileSync(path.join(dir, 'out', f), 'utf8')).join('\n') : '');

test('arguments: only --expect-project, and nothing key-shaped', () => {
  assert.deepEqual(parseArgs(['run', '--expect-project', 'abc']), { cmd: 'run', expectProject: 'abc' });
  assert.throws(() => parseArgs(['run', '--key', 'x']), /unknown argument/);
  assert.throws(() => parseArgs(['run', '--expect-project', KEY]), /looks like a key/);
  assert.throws(() => parseArgs(['run', 'standard_' + 'a'.repeat(30)]), /looks like a key|unknown/);
});

test('endpoint: only https on <region>.cloud.appwrite.io/v1', () => {
  assert.equal(checkEndpoint(EP), EP); assert.equal(checkEndpoint('https://fra.cloud.appwrite.io/v1/'), 'https://fra.cloud.appwrite.io/v1');
  for (const bad of ['http://nyc.cloud.appwrite.io/v1', 'https://evil.example/v1', 'https://nyc.cloud.appwrite.io.evil.example/v1', 'https://nyc.cloud.appwrite.io:8443/v1', 'https://u:p@nyc.cloud.appwrite.io/v1', 'https://nyc.cloud.appwrite.io/v2', 'nyc.cloud.appwrite.io', '']) assert.throws(() => checkEndpoint(bad), /PROBE_ENDPOINT/, bad);
});

test('secret intake: one source, file outside the repo, owner-only, not inherited', () => {
  const d = tmp(), f = path.join(d, 'k'); fs.writeFileSync(f, KEY, { mode: 0o600 });
  assert.equal(loadSecret({ PROBE_KEY_FILE: f }), KEY);
  const env = { PROBE_APPWRITE_KEY: KEY }; assert.equal(loadSecret(env), KEY); assert.equal('PROBE_APPWRITE_KEY' in env, false, 'removed from the environment after reading');
  assert.throws(() => loadSecret({ PROBE_KEY_FILE: f, PROBE_APPWRITE_KEY: KEY }), /only one/);
  assert.throws(() => loadSecret({}), /no key/);
  fs.chmodSync(f, 0o644); assert.throws(() => loadSecret({ PROBE_KEY_FILE: f }), /owner only/);
  const inRepo = path.join(__dirname, 'zz-test-key'); fs.writeFileSync(inRepo, KEY, { mode: 0o600 });
  try { assert.throws(() => loadSecret({ PROBE_KEY_FILE: inRepo }), /outside the repository/); } finally { fs.unlinkSync(inRepo); }
  assert.throws(() => loadSecret({ PROBE_APPWRITE_KEY: 'short' }), /does not look like/);
  assert.throws(() => loadSecret({ PROBE_KEY_FILE: d }), /not a regular file/);
});

test('budget command needs no key, no network and builds no client', async () => {
  const s = setup({ env: { PROBE_KEY_FILE: undefined } }); const r = await main(['budget'], {}, s.deps);
  assert.equal(r.code, 0); assert.equal(s.made.length, 0); assert.match(s.out.join('\n'), /budget name=run calls=6015/);
});

test('the target guard refuses before a key is read or a client is built', async () => {
  for (const [pid, expect] of [[PRODUCTION_PROJECT_ID, PRODUCTION_PROJECT_ID], [PID, 'otherproject'], [PID, null]]) {
    const s = setup({ env: { PROBE_PROJECT_ID: pid } }); const r = await s.go('run', expect);
    assert.equal(r.code, 1); assert.equal(s.made.length, 0); assert.equal(s.db.log.length, 0);
  }
  const s = setup({ env: { PROBE_ENDPOINT: 'https://evil.example/v1' } }); assert.equal((await s.go('run')).code, 1); assert.equal(s.made.length, 0);
});

test('end to end: verify, run, cleanup. No key anywhere in output or files, even if the SDK echoes it', async () => {
  const s = setup(); const wrap = (fn) => async (p) => { try { return await fn(p); } catch (e) { e.message += ' [sent key ' + KEY + ']'; throw e; } };
  for (const n of ['createRow', 'deleteRow', 'getRow', 'listRows']) s.db[n] = wrap(s.db[n].bind(s.db));
  let r = await s.go('verify-schema'); assert.equal(r.code, 0);
  r = await s.go('run'); assert.equal(r.code, 0, s.out.join('\n'));
  const created = JSON.parse(fs.readFileSync(path.join(s.dir, 'out', 'created.json'), 'utf8')); assert.ok(created.length > 20);
  const rows = () => Object.values(s.db.tables).reduce((n, t) => n + t.size, 0); assert.equal(rows(), created.length);
  const rep = JSON.parse(fs.readFileSync(path.join(s.dir, 'out', 'summary-run.json'), 'utf8'));
  assert.match(rep.note, /not production verification/i); assert.equal(rep.pass, true);
  await s.db.createRow({ databaseId: 'exchange_probe', tableId: 'probeText', rowId: 'unrecorded1', data: { state: 'x' }, permissions: [] });
  r = await s.go('cleanup'); assert.equal(r.code, 0);
  assert.deepEqual([...s.db.tables.probeText.keys()], ['unrecorded1'], 'a row nobody recorded is left alone'); assert.equal(rows(), 1);
  assert.ok(fs.readdirSync(path.join(s.dir, 'out')).some((f) => f.startsWith('created.cleaned-')));
  assert.ok(!everything(s.dir, s.out).includes(KEY), 'key never appears'); assert.ok(!/standard_[A-Za-z0-9]{16,}/.test(everything(s.dir, s.out)));
});

test('a second run is refused until cleanup, and an unclean project is refused', async () => {
  const s = setup(); assert.equal((await s.go('run')).code, 0);
  const again = await s.go('run'); assert.equal(again.code, 1); assert.match(s.out.join('\n'), /error reason=rows_recorded/);
  const dirty = setup(); await dirty.db.createRow({ databaseId: 'exchange_probe', tableId: 'probeEvents', rowId: 'old1', data: { familyId: 'f', listingId: 'l', seq: 1, claimKey: 'l_1', opKey: 'l_o', actorId: 'a', kind: 'k', state: '{}' }, permissions: [] });
  const r = await dirty.go('run'); assert.equal(r.code, 2); assert.ok(dirty.db.tables.probeEvents.has('old1'));
});

test('run refuses when the live schema differs from the manifest, before any row is written', async () => {
  const db = createFakeTablesDb(manifest); db.schema.tables.probeEvents.indexes.pop();
  const s = setup({ db }); const r = await s.go('run'); assert.equal(r.code, 1); assert.equal(db.log.includes('createRow'), false);
});

test('an auth failure stops the run, exits 2, and still records the rows created so far', async () => {
  const db = createFakeTablesDb(manifest, { fail: Object.assign((n, i) => n === 'createRow' && i > 3, { code: 403 }) });
  const s = setup({ db }); const r = await s.go('run'); assert.equal(r.code, 2); assert.match(s.out.join('\n'), /end command=run pass=false stopped=auth/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, 'out', 'created.json'), 'utf8')).length, Object.values(db.tables).reduce((n, t) => n + t.size, 0));
});

test('create-schema on an existing schema stops without touching anything', async () => {
  const s = setup(); const before = JSON.stringify(s.db.schema); const r = await s.go('create-schema'); assert.equal(r.code, 2); assert.equal(JSON.stringify(s.db.schema), before);
  const fresh = setup({ db: createFakeTablesDb(manifest, { prebuilt: false }) }); assert.equal((await fresh.go('create-schema')).code, 0); assert.equal((await fresh.go('verify-schema')).code, 0);
});

test('full-size default run on a correct store stays inside its cap and passes', async () => {
  const s = setup({ deps: { probeOpts: {} } }); const r = await s.go('run'); assert.equal(r.code, 0, s.out.slice(-6).join('\n'));
  const used = Number(/end command=run .*calls=(\d+) cap=(\d+)/.exec(s.out.join('\n'))[1]); assert.ok(used <= 6015, 'calls ' + used);
});

test('no key-shaped string and no argv key reading exist in the probe sources', () => {
  const dir = __dirname, files = fs.readdirSync(dir).filter((f) => /\.(js|json|md)$/.test(f) && f !== 'package-lock.json');
  for (const f of files) { const text = fs.readFileSync(path.join(dir, f), 'utf8'); assert.ok(!/(?:standard|ephemeral|dynamic)_[A-Za-z0-9]{16,}/.test(text), f + ' holds a key-shaped string'); }
  const run = fs.readFileSync(path.join(dir, 'run.js'), 'utf8'); assert.ok(!/process\.argv[^;]*key/i.test(run)); assert.ok(!/console\.(log|dir|error)/.test(run), 'run.js prints only through the redacting emit');
});
