/* Proves that importing the probe modules, or running the probe's own tests, can never reach the network, so the real connectivity command cannot be started by accident.
 * Run: node --test tests/exchange-probe-offline.test.js   (offline, no key) */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const GUARD = path.join(__dirname, 'helpers', 'no-network.cjs'), PROBE = path.resolve(__dirname, '..', 'exchange-probe');
const child = (args, opts = {}) => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nonet-')), 'attempts.log');
  const r = spawnSync(process.execPath, args, { cwd: opts.cwd || PROBE, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: '--require ' + GUARD, NO_NET_LOG: log, PROBE_ENDPOINT: '', PROBE_APPWRITE_KEY: '', PROBE_KEY_FILE: '' }, timeout: 600000 });
  return { r, attempts: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
};

test('the guard itself works: a fetch or socket attempt is recorded and refused', () => {
  const { r, attempts } = child(['-e', "try { fetch('https://example.invalid/x'); } catch (e) {} try { require('net').connect(80, '127.0.0.1'); } catch (e) {} console.log('done')"]);
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(attempts, ['fetch', 'net.connect']);
});

test('importing every probe module makes no network attempt and starts no command', () => {
  const { r, attempts } = child(['-e', "for (const m of ['./run', './probe', './adapter', './summary', './errors', './redact']) require(m); console.log('imported')"]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /imported/); assert.deepEqual(attempts, []);
});

test('run.js only does something when it is the entry point (requiring it runs no command)', () => {
  const src = fs.readFileSync(path.join(PROBE, 'run.js'), 'utf8');
  assert.match(src, /if \(require\.main === module\) main\(/);
  const { r, attempts } = child(['-e', "const t = require('./run'); console.log(typeof t.main, typeof t.connectivity)"]);
  assert.equal(r.stdout.trim(), 'function function'); assert.deepEqual(attempts, []);
});

test('no probe test calls the connectivity command or function without an injected fetch', () => {
  for (const f of fs.readdirSync(PROBE).filter((n) => /\.test\.js$/.test(n))) {
    const src = fs.readFileSync(path.join(PROBE, f), 'utf8');
    for (const m of src.matchAll(/main\(\[[^\]]*'connectivity'[^\]]*\][^;\n]*/g)) assert.match(m[0], /fetch\s*:/, f + ': main([connectivity]) must pass a fake fetch: ' + m[0].slice(0, 90));
    for (const m of src.matchAll(/\bconnectivity\(([^;\n]*)/g)) assert.match(m[1], /^\s*EP\s*,/, f + ': connectivity() must be called with an endpoint and a fake fetch');
    for (const m of src.matchAll(/\bconnectivity\((?:EP|[A-Za-z_]+)\s*,\s*([^;\n]*)/g)) assert.doesNotMatch(m[1], /^\s*(fetch|globalThis\.fetch)\s*\)/, f + ': never the real fetch');
  }
});

test('the whole probe test suite, run under the network guard, makes zero network attempts and passes', () => {
  const { r, attempts } = child(['--test', 'manifest.test.js', 'adapter.test.js', 'runner.test.js', 'probe.test.js', 'public-output.test.js']);
  assert.equal(r.status, 0, (r.stdout || '').split('\n').filter((l) => /^not ok|# (pass|fail)/.test(l)).join('\n') + r.stderr.slice(0, 400));
  assert.deepEqual(attempts, [], 'a probe test tried to reach the network: ' + attempts.join(','));
  const m = /# pass (\d+)/.exec(r.stdout || ''); assert.ok(m && Number(m[1]) >= 47, 'the suite must really run (expected at least 47 passing tests)');
});
