'use strict';
/* Public output = what the runner prints (job log) and the summary-<command>.json files (job summary). These tests feed hostile material into every channel the
 * runner can see and prove none of it can come out. created.json is local only and is never part of the public set. */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Query } = require('node-appwrite');
const manifest = require('./schema.manifest.json');
const { main, connectivity } = require('./run');
const S = require('./summary');
const { SafeError, REASONS } = require('./errors');
const { createFakeTablesDb } = require('./fake-sdk');

const KEY = 'standard_' + 'c0ffee12'.repeat(10);
const CANARIES = ['CANARY_RESPONSE_8f3a', 'CANARY_HEADER_71bc', 'CANARY_ENV_55de', 'CANARY_STATE_02aa', 'CANARY_STACK_99ff'];
const INJECT = '\n::add-mask::CANARY_RESPONSE_8f3a\n::error::CANARY_HEADER_71bc\r\n##[group]x';
const EP = 'https://nyc.cloud.appwrite.io/v1', PID = 'probeproject01';
const quick = { rounds: 2, width: 4, trials: 6, p5Rounds: 1, p5Writers: 4, readyPollMs: 1, readyTimeoutMs: 5 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
const hostileErr = (code) => Object.assign(new Error('boom ' + CANARIES[0] + INJECT + ' key=' + KEY), { code, response: { secret: CANARIES[0], headers: { 'x-appwrite-key': CANARIES[1] } }, headers: { authorization: CANARIES[1] }, stack: CANARIES[4], type: CANARIES[0], url: 'https://evil.example/?k=' + CANARIES[2] });

function setup(db, extraEnv = {}) {
  const dir = tmp(), keyFile = path.join(dir, 'key'); fs.writeFileSync(keyFile, KEY + '\n', { mode: 0o600 });
  const out = [], env = { PROBE_ENDPOINT: EP, PROBE_PROJECT_ID: PID, PROBE_KEY_FILE: keyFile, PROBE_CANARY_ENV: CANARIES[2], ...extraEnv };
  const deps = { emit: (l) => out.push(l), outDir: path.join(dir, 'out'), makeSdk: () => ({ tablesDb: db, Query }), sleep: async () => {}, probeOpts: quick };
  return { dir, out, env, deps, go: (cmd) => main([cmd, '--expect-project', PID], env, deps) };
}
function publicText(s) {
  const files = fs.existsSync(path.join(s.dir, 'out')) ? fs.readdirSync(path.join(s.dir, 'out')).filter((f) => /^summary-.*\.json$/.test(f)) : [];
  return { text: s.out.join('\n') + '\n' + files.map((f) => fs.readFileSync(path.join(s.dir, 'out', f), 'utf8')).join('\n'), files };
}
function assertClean(s, label) {
  const { text, files } = publicText(s);
  for (const c of [...CANARIES, KEY, 'evil.example', 'add-mask', '##[']) assert.ok(!text.includes(c), label + ': output leaked ' + c);
  for (const l of s.out) { assert.match(l, /^[a-z][a-z_]*( [A-Za-z][A-Za-z0-9]*=[A-Za-z0-9_.\-]+)*$/, label + ': unsafe line ' + JSON.stringify(l)); assert.ok(!l.includes('::'), label); }
  for (const f of files) validateSummaryFile(JSON.parse(fs.readFileSync(path.join(s.dir, 'out', f), 'utf8')));
}
const TOP = new Set(['command', 'project', 'host', 'pass', 'stopped', 'calls', 'cap', 'rows', 'recorded', 'deleted', 'failed', 'created', 'findingCount', 'status', 'version', 'connectError', 'byMethod', 'checks', 'findings', 'note']);
function validateSummaryFile(j) {
  for (const k of Object.keys(j)) assert.ok(TOP.has(k), 'unexpected summary field ' + k);
  assert.ok(S.COMMANDS.includes(j.command)); assert.equal(j.note, S.NOTE);
  for (const m of Object.keys(j.byMethod || {})) assert.ok(S.METHODS.includes(m));
  for (const c of j.checks || []) { assert.deepEqual(Object.keys(c).sort(), ['data', 'id', 'pass', 'title']); assert.equal(c.title, S.TITLES[c.id]); for (const [k, v] of Object.entries(c.data)) { assert.ok(k in S.CHECK_DATA[c.id]); assert.ok(typeof v === 'number' || typeof v === 'boolean' || /^[a-z]+$/.test(v)); } }
  for (const f of j.findings || []) { assert.ok(S.FINDING_KINDS.includes(f.kind)); assert.ok(f.table === null || manifest.tables[f.table]); }
}

test('SDK errors with hostile text, response, headers, stack and injection never reach public output (every command)', async () => {
  for (const code of [401, 403, 429, 500, undefined]) {
    for (const cmd of ['verify-schema', 'create-schema', 'run', 'cleanup']) {
      const db = createFakeTablesDb(manifest); const fail = hostileErr(code);
      for (const n of Object.keys(db)) if (typeof db[n] === 'function' && /^(list|get|create|delete|update)/.test(n)) db[n] = async () => { throw fail; };
      const s = setup(db);
      if (cmd === 'cleanup') { fs.mkdirSync(path.join(s.dir, 'out')); fs.writeFileSync(path.join(s.dir, 'out', 'created.json'), JSON.stringify([{ table: 'probeEvents', id: 'row1' }])); }
      const r = await s.go(cmd); assert.ok(r.code !== 0 || cmd === 'cleanup', cmd); assertClean(s, cmd + ' ' + code);
    }
  }
});

test('responses carrying canaries in rows, state payloads and unexpected schema names are summarised without them', async () => {
  const db = createFakeTablesDb(manifest);
  const g = db.getRow.bind(db), l = db.listRows.bind(db);
  db.getRow = async (p) => { const row = await g(p); return { ...row, state: CANARIES[3], $id: CANARIES[0], extra: { x: CANARIES[1] } }; };
  db.listRows = async (p) => { const r = await l(p); return { ...r, rows: r.rows.map((x) => ({ ...x, state: CANARIES[3], claimKey: CANARIES[0] })) }; };
  const s = setup(db); await s.go('run'); assertClean(s, 'run with hostile rows');
  /* a schema with canary-named extras: findings carry the kind only, never the names */
  const db2 = createFakeTablesDb(manifest); db2.schema.tables.probeEvents.columns.push({ key: CANARIES[0], type: 'string', size: 5, required: true, array: false, status: 'available' });
  db2.schema.tables[CANARIES[1]] = { columns: [], indexes: [], permissions: [], rowSecurity: false };
  const s2 = setup(db2); const r2 = await s2.go('verify-schema'); assert.equal(r2.code, 1); assertClean(s2, 'verify-schema with hostile names');
  assert.match(s2.out.join('\n'), /finding kind=unexpected_(column|table)/);
});

test('environment values never appear, even when they hold the key or workflow commands', async () => {
  const s = setup(createFakeTablesDb(manifest), { PROBE_CANARY_ENV: CANARIES[2] + INJECT, GITHUB_TOKEN: CANARIES[2], PROBE_NOTE: KEY });
  await s.go('run'); assertClean(s, 'env');
});

test('bad input produces fixed reason codes only (argument text, endpoint text and project ids are never echoed)', async () => {
  const dir = tmp(), out = [];
  const run = (argv, env) => main(argv, env, { emit: (l) => out.push(l), outDir: path.join(dir, 'out') });
  await run(['run', '--expect-project', CANARIES[0] + INJECT], { PROBE_PROJECT_ID: CANARIES[1], PROBE_ENDPOINT: 'https://' + CANARIES[2] + '.evil.example/v1' });
  await run(['run', '--expect-project', PID], { PROBE_PROJECT_ID: PID, PROBE_ENDPOINT: 'https://' + CANARIES[2] + '.evil.example/v1' });
  await run(['connectivity'], { PROBE_ENDPOINT: 'http://' + CANARIES[0] + '.example' });
  await run([CANARIES[1] + INJECT], {});
  const text = out.join('\n'); for (const c of CANARIES) assert.ok(!text.includes(c)); assert.ok(!text.includes('evil.example'));
  assert.ok(out.every((l) => /^[a-z]/.test(l) && !l.includes('::')));
  assert.ok(out.some((l) => /error reason=(target_mismatch|bad_endpoint|unknown_command|bad_arguments)/.test(l)));
});

test('a non-SafeError exception is reported only as "unexpected" with a numeric status', () => {
  assert.equal(S.lines.error(hostileErr(503)), 'error reason=unexpected status=503');
  assert.equal(S.lines.error(hostileErr('CANARY')), 'error reason=unexpected status=0');
  assert.equal(S.lines.error(new SafeError('key_missing', 'free text ' + CANARIES[0])), 'error reason=key_missing');
  assert.throws(() => new SafeError('free text reason'), /unknown reason/);
  assert.ok(REASONS.every((r) => /^[a-z_]+$/.test(r)));
});

test('summary.js: unknown fields, free text, bad values and injection are dropped, not repaired', () => {
  const raw = { command: 'run', project: 'probeproject01', host: 'nyc.cloud.appwrite.io', pass: true, stopped: CANARIES[0], calls: 5, cap: 9, rows: '12', secret: CANARIES[1], version: '1.2.3' + INJECT,
    byMethod: { createRow: 3, [CANARIES[0]]: 4 }, checks: [{ id: 'P1', pass: true, data: { claimRefused409: true, opRefused409: CANARIES[0], note: CANARIES[1] }, detail: CANARIES[2] }, { id: CANARIES[0], pass: true }],
    findings: [{ kind: 'missing_column', table: 'probeEvents', key: 'claimKey' }, { kind: 'missing_column', table: CANARIES[0], key: CANARIES[1] }, { kind: CANARIES[0] }] };
  const out = S.buildSummary(raw, manifest), text = JSON.stringify(out);
  for (const c of CANARIES) assert.ok(!text.includes(c)); assert.ok(!text.includes('::')); assert.equal(out.stopped, null); assert.equal(out.rows, undefined); assert.equal(out.version, 'unrecognised');
  assert.deepEqual(out.checks, [{ id: 'P1', title: S.TITLES.P1, pass: true, data: { claimRefused409: true } }]);
  assert.deepEqual(out.findings, [{ kind: 'missing_column', table: 'probeEvents', key: 'claimKey' }, { kind: 'missing_column', table: null, key: null }]);
  for (const bad of ['has space=1 x', 'Upper start', 'line\nbreak', '::error::x', 'a=b::c', 'x ' + 'a'.repeat(500), 'k=v=w', 'a=' + CANARIES[0] + ':']) assert.throws(() => S.assertSafeLine(bad), (e) => e instanceof SafeError, JSON.stringify(bad));
});

test('connectivity: hostile bodies and headers are never read into output; only a status and a strict version survive', async () => {
  const mk = (res) => async () => res;
  const bodyOf = (text) => ({ status: 200, get headers() { throw new Error('headers must not be read'); }, text: async () => text });
  assert.deepEqual(await connectivity(EP, mk(bodyOf('{"version":"1.9.2"}'))), { status: 200, version: '1.9.2' });
  for (const text of ['{"version":"1.9.2\\n::error::x"}', '{"version":"' + CANARIES[0] + '"}', '<html>' + CANARIES[1] + '</html>', '{"version":{"a":1}}', '{"version":"1.9.2.3"}', 'x'.repeat(200000)]) assert.deepEqual(await connectivity(EP, mk(bodyOf(text))), { status: 200, version: 'unrecognised' }, text.slice(0, 40));
  assert.deepEqual(await connectivity(EP, mk({ status: 503, text: async () => CANARIES[0] })), { status: 503, version: 'unrecognised' });
  assert.deepEqual(await connectivity(EP, async () => { throw hostileErr(); }), { connectError: 'network' });
  assert.deepEqual(await connectivity(EP, async () => { const e = new Error(CANARIES[0]); e.name = 'AbortError'; throw e; }), { connectError: 'timeout' });
  /* streamed bodies are cut off at the limit */
  let read = 0; const stream = { status: 200, body: { getReader: () => ({ read: async () => { read++; return read > 100 ? { done: true } : { done: false, value: new Uint8Array(4096) }; }, cancel: async () => {} }) } };
  assert.equal((await connectivity(EP, mk(stream))).version, 'unrecognised'); assert.ok(read < 30, 'stopped reading at the byte limit, read ' + read);
});

test('connectivity command end to end: keyless, one request, output is fixed lines, bad endpoint refused before any request', async () => {
  const dir = tmp(), out = [], calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return { status: 200, headers: { get: () => CANARIES[1] }, text: async () => '{"version":"1.9.2","other":"' + CANARIES[0] + '"}' }; };
  const r = await main(['connectivity'], { PROBE_ENDPOINT: EP, PROBE_APPWRITE_KEY: KEY, PROBE_KEY_FILE: '/nonexistent' }, { emit: (l) => out.push(l), outDir: path.join(dir, 'out'), fetch: fetchFn });
  assert.equal(r.code, 0); assert.equal(calls.length, 1); assert.equal(calls[0].url, EP + '/health/version'); assert.equal(calls[0].init.method, 'GET');
  assert.ok(!JSON.stringify(calls[0].init.headers || {}).match(/key|authorization|project/i), 'no credential header is sent');
  assert.deepEqual(out.filter((l) => /^connectivity/.test(l)), ['connectivity status=200 version=1.9.2']);
  const s = { dir, out }; assertClean(s, 'connectivity');
  const out2 = []; const r2 = await main(['connectivity'], { PROBE_ENDPOINT: 'http://evil.example' }, { emit: (l) => out2.push(l), outDir: path.join(dir, 'o2'), fetch: async () => { throw new Error('must not be called'); } });
  assert.equal(r2.code, 1); assert.ok(out2.some((l) => l === 'error reason=bad_endpoint'));
});

test('structure: run.js prints only through say(), never prints exception text, and writes only summary files plus the local created.json', () => {
  const src = fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8');
  assert.equal((src.match(/process\.stdout\.write/g) || []).length, 1); assert.ok(!/\bemit\(/.test(src.replace(/deps\.emit/g, '')), 'no raw emit() call'); assert.ok(!/console\./.test(src));
  assert.ok(!/\be\.message\b|\.stack\b|String\(e\)|\$\{e\}/.test(src), 'exception text is never printed');
  assert.ok(!/say\([^S]/.test(src.replace(/say\(S\./g, 'say(S.')), 'every say() argument is a template from summary.js');
  const writes = [...src.matchAll(/writeJson\(outDir, ([^,]+),/g)].map((m) => m[1]); assert.deepEqual(writes.filter((w) => w !== 'file').sort(), ["'created.json'", "'summary-' + (S.COMMANDS.includes(summary.command) ? summary.command : 'unknown') + '.json'"].sort());
  assert.ok(!/GITHUB_STEP_SUMMARY|appendFile/.test(src), 'the job summary is produced by the workflow from summary-*.json only');
});

test('mutation check: if the runner printed a raw string, the line guard would refuse it', async () => {
  const s = setup(createFakeTablesDb(manifest));
  const orig = S.lines.start; S.lines.start = () => 'start ' + CANARIES[0] + INJECT;   /* simulated regression: free text in a line */
  try { const r = await s.go('verify-schema'); assert.ok(s.out.every((l) => !l.includes(CANARIES[0])), 'a regressed template cannot print'); assert.ok(r.code !== undefined); } finally { S.lines.start = orig; }
});
