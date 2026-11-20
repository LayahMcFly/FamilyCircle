'use strict';
/* Runner for the Family Exchange unique-index probe. Offline-tested; NOT approved to run against anything.
 *
 *   node run.js budget                              prints the call budget (offline, no key, no network)
 *   node run.js connectivity                        keyless: one GET of <endpoint>/health/version, prints only a status number and a version
 *   node run.js verify-schema --expect-project ID   read-only comparison of the live schema with schema.manifest.json
 *   node run.js create-schema --expect-project ID   creates the manifest schema (needs the separate schema key)
 *   node run.js run           --expect-project ID   runs the probe checks (needs the run key)
 *   node run.js cleanup       --expect-project ID   deletes only the rows recorded in out/created.json
 *
 * Settings come from the environment (none are secret except the key):
 *   PROBE_ENDPOINT     https://<region>.cloud.appwrite.io/v1
 *   PROBE_PROJECT_ID   the disposable project's id
 *   PROBE_KEY_FILE     path to a file holding the key (preferred)   OR   PROBE_APPWRITE_KEY  the key itself
 * The key is never taken from arguments, never printed, never written to out/, and never committed.
 * Public output (the job log and job summary of a public repository) is built only by summary.js from fixed templates and validated fields: no SDK response,
 * header, exception text, environment value, row or state payload can reach it. The redactor is a backup, not the control.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const manifest = require('./schema.manifest.json');
const { runProbe, cleanup, assertTarget, budget, DEFAULTS } = require('./probe');
const { createAdapter, schemaCallCounts } = require('./adapter');
const { createRedactor } = require('./redact');
const { SafeError } = require('./errors');
const S = require('./summary');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');
const WALL_CLOCK_MS = { run: 15 * 60 * 1000, 'create-schema': 6 * 60 * 1000, 'verify-schema': 60 * 1000, cleanup: 10 * 60 * 1000, connectivity: 20 * 1000 };
const CONNECT_TIMEOUT_MS = 20 * 1000, CONNECT_BODY_LIMIT = 64 * 1024;
const KEY_SHAPE = /(?:standard|ephemeral|dynamic)_[A-Za-z0-9]{8,}|[a-f0-9]{40,}/i;

function parseArgs(argv) {
  const out = { cmd: argv[0], expectProject: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--expect-project') out.expectProject = argv[++i] || null;
    else throw new SafeError('bad_arguments', 'unknown argument');
  }
  for (const a of argv) if (KEY_SHAPE.test(a)) throw new SafeError('key_in_argument', 'an argument looks like a key; keys are never passed as arguments');
  return out;
}

function checkEndpoint(ep) {
  let u; try { u = new URL(ep); } catch (e) { throw new SafeError('bad_endpoint', 'PROBE_ENDPOINT is not a URL'); }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.cloud\.appwrite\.io$/.test(u.hostname) || u.pathname.replace(/\/$/, '') !== '/v1' || u.username || u.password || u.port) throw new SafeError('bad_endpoint', 'PROBE_ENDPOINT must be https://<region>.cloud.appwrite.io/v1');
  return u.origin + '/v1';
}

/* Reads the key from exactly one source. A key file must be outside the repository, a regular file, and readable by its owner only. */
function loadSecret(env, { repoRoot = REPO_ROOT, fsx = fs } = {}) {
  const file = env.PROBE_KEY_FILE, inline = env.PROBE_APPWRITE_KEY;
  if (file && inline) throw new SafeError('key_source_conflict', 'set only one of PROBE_KEY_FILE and PROBE_APPWRITE_KEY');
  if (!file && !inline) throw new SafeError('key_missing', 'no key: set PROBE_KEY_FILE (preferred) or PROBE_APPWRITE_KEY');
  let key;
  if (file) {
    const real = fsx.realpathSync(file), root = fsx.realpathSync(repoRoot);
    if (real === root || real.startsWith(root + path.sep)) throw new SafeError('key_file_in_repo', 'the key file must be outside the repository');
    const st = fsx.statSync(real);
    if (!st.isFile()) throw new SafeError('key_file_not_regular', 'the key file is not a regular file');
    if ((st.mode & 0o077) !== 0) throw new SafeError('key_file_mode', 'the key file must be readable by its owner only (mode 600)');
    key = fsx.readFileSync(real, 'utf8').trim();
  } else key = inline.trim();
  if (key.length < 20 || /\s/.test(key)) throw new SafeError('key_invalid', 'the key does not look like an API key');
  delete env.PROBE_APPWRITE_KEY;   // not inherited by anything started later
  return key;
}

function realSdk({ endpoint, projectId, key }) {
  const { Client, TablesDB, Query } = require('node-appwrite');
  return { tablesDb: new TablesDB(new Client().setEndpoint(endpoint).setProject(projectId).setKey(key)), Query };
}

function writeJson(outDir, file, data) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}
const nonNeg = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

/* Keyless reachability check. Reads only the status code and a strict x.y.z version from the body; headers are never read and nothing else is kept. */
async function connectivity(endpoint, fetchFn) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetchFn(endpoint + '/health/version', { method: 'GET', redirect: 'error', signal: ctl.signal, headers: { accept: 'application/json' } });
    const status = Number.isSafeInteger(res.status) ? res.status : -1;
    let version = null;
    try {
      let text = '';
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader(); let size = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > CONNECT_BODY_LIMIT) { try { await reader.cancel(); } catch (e) { /* ignore */ } break; } text += Buffer.from(value).toString('utf8'); }
      } else text = String(await res.text()).slice(0, CONNECT_BODY_LIMIT);
      const v = JSON.parse(text).version; if (typeof v === 'string' && S.SEMVER.test(v)) version = v;
    } catch (e) { /* version stays unknown */ }
    return { status, version: version || 'unrecognised' };
  } catch (e) { return { connectError: e && e.name === 'AbortError' ? 'timeout' : 'network' }; } finally { clearTimeout(timer); }
}

async function main(argv, env, deps = {}) {
  const outDir = deps.outDir || OUT_DIR;
  const lines = [], emitRaw = deps.emit || ((l) => process.stdout.write(l + '\n'));
  let redact = createRedactor();
  /* The only way anything is printed: a fixed line template from summary.js, then the (backup) redactor. */
  const say = (line) => { const r = redact(S.assertSafeLine(line)); lines.push(r); emitRaw(r); };
  const summary = { command: null };
  const finish = (code) => { try { writeJson(outDir, 'summary-' + (S.COMMANDS.includes(summary.command) ? summary.command : 'unknown') + '.json', S.buildSummary(summary, manifest)); } catch (e) { /* the summary is best effort */ } say(S.lines.end(S.buildSummary(summary, manifest))); return { code, lines }; };
  try {
    const args = parseArgs(argv);
    summary.command = S.COMMANDS.includes(args.cmd) ? args.cmd : null;
    if (args.cmd === 'budget') {
      const b = budget(), s = schemaCallCounts(manifest);
      say(S.lines.start({ command: 'budget' }));
      say(S.lines.budget('verify-schema', s.verifySchema)); say(S.lines.budget('create-schema', s.createSchema));
      say(S.lines.budget('run', b.runTotal + s.verifySchema)); say(S.lines.budget('run-probe-only', b.runTotal)); say(S.lines.budget('cleanup-max', b.cleanupTotal));
      for (const [k, v] of Object.entries(b.parts)) say(S.lines.budget(k, v));
      for (const [k, v] of Object.entries(WALL_CLOCK_MS)) say(S.lines.limit(k, v));
      summary.pass = true; return finish(0);
    }
    if (args.cmd === 'connectivity') {
      const endpoint = checkEndpoint(env.PROBE_ENDPOINT), host = new URL(endpoint).hostname;
      say(S.lines.start({ command: 'connectivity', host, cap: 1 }));
      const r = await connectivity(endpoint, deps.fetch || fetch);
      say(S.lines.connectivity(r)); summary.host = host; summary.calls = 1; summary.cap = 1;
      if (r.connectError) { summary.connectError = r.connectError; summary.pass = false; return finish(2); }
      summary.status = r.status; summary.version = r.version; summary.pass = r.status === 200 && r.version !== 'unrecognised'; return finish(summary.pass ? 0 : 1);
    }
    if (!['verify-schema', 'create-schema', 'run', 'cleanup'].includes(args.cmd)) throw new SafeError('unknown_command', 'unknown command');
    const projectId = env.PROBE_PROJECT_ID;
    assertTarget({ projectId, recordedProbeProjectId: args.expectProject });
    const endpoint = checkEndpoint(env.PROBE_ENDPOINT);
    const key = loadSecret(env, deps.secretOpts);
    redact = createRedactor([key]);
    const { tablesDb, Query } = (deps.makeSdk || realSdk)({ endpoint, projectId, key });
    const b = budget(), s = schemaCallCounts(manifest);
    const cap = { 'verify-schema': s.verifySchema, 'create-schema': s.createSchema, run: b.runTotal + s.verifySchema, cleanup: b.cleanupTotal }[args.cmd];
    const a = createAdapter({ tablesDb, Query, manifest, maxCalls: cap, deadlineMs: WALL_CLOCK_MS[args.cmd], redact, sleep: deps.sleep, timers: deps.timers });
    Object.assign(summary, { project: projectId, host: new URL(endpoint).hostname, cap });
    say(S.lines.start({ command: args.cmd, project: projectId, host: summary.host, cap }));
    const stats = () => { const st = a.stats(); summary.calls = nonNeg(st.calls); summary.byMethod = st.byMethod; return st; };

    if (args.cmd === 'verify-schema') {
      const v = await a.verifySchema(); stats();
      summary.findings = v.findings; summary.findingCount = v.findings.length; summary.pass = v.ok;
      const clean = S.buildSummary(summary, manifest);
      say(S.lines.schema(v.ok, clean.findings.length)); clean.findings.forEach((f) => say(S.lines.finding(f)));
      return finish(v.ok ? 0 : 1);
    }
    if (args.cmd === 'create-schema') {
      try { const r = await a.createSchema(); summary.created = nonNeg(r.created); say(S.lines.created(summary.created)); summary.pass = true; }
      catch (e) { summary.stopped = a.stopReason() || 'exists'; summary.pass = false; stats(); return finish(2); }
      stats(); return finish(0);
    }
    if (args.cmd === 'run') {
      const createdFile = path.join(outDir, 'created.json');
      if (fs.existsSync(createdFile) && JSON.parse(fs.readFileSync(createdFile, 'utf8')).length) throw new SafeError('rows_recorded', 'out/created.json already holds rows: run cleanup first, or use a fresh project');
      const v = await a.verifySchema();
      if (!v.ok) { stats(); summary.findings = v.findings; summary.findingCount = v.findings.length; summary.pass = false; const clean = S.buildSummary(summary, manifest); say(S.lines.schema(false, clean.findings.length)); clean.findings.forEach((f) => say(S.lines.finding(f))); return finish(1); }
      const runId = (deps.runId || crypto.randomBytes(5).toString('hex'));
      const r = await runProbe(a, { ...(deps.probeOpts || {}), tables: manifest.roles, runId, log: (c) => { const sc = S.sanitizeCheck(c); if (sc) say(S.lines.check(sc)); } });
      writeJson(outDir, 'created.json', r.created);   /* local only, never printed or uploaded: it lists the ids to clean up */
      const st = stats();
      summary.checks = r.results.map((x) => ({ id: x.id, pass: x.pass, data: x.data })); summary.pass = !r.stopped && r.pass; summary.stopped = r.stopped || null; summary.rows = r.created.length;
      return finish(r.stopped ? 2 : r.pass ? 0 : 1);
    }
    /* cleanup: only rows recorded in out/created.json; nothing else is listed or deleted */
    const createdFile = path.join(outDir, 'created.json');
    if (!fs.existsSync(createdFile)) throw new SafeError('no_record', 'out/created.json not found: nothing recorded, nothing to delete');
    const recorded = JSON.parse(fs.readFileSync(createdFile, 'utf8'));
    const r = await cleanup(a, recorded); stats();
    summary.recorded = recorded.length; summary.deleted = nonNeg(r.removed); summary.failed = r.failed.length;
    say(S.lines.cleanup({ recorded: summary.recorded, deleted: summary.deleted, failed: summary.failed }));
    if (!r.failed.length && !a.stopReason()) fs.renameSync(createdFile, path.join(outDir, 'created.cleaned-' + Date.now() + '.json'));
    summary.stopped = a.stopReason() || null; summary.pass = !r.failed.length && !a.stopReason();
    return finish(summary.pass ? 0 : 2);
  } catch (e) {
    try { say(S.lines.error(e)); } catch (x) { /* nothing more can be said safely */ }
    summary.pass = false; return finish(1);
  }
}

if (require.main === module) main(process.argv.slice(2), process.env).then((r) => { process.exitCode = r.code; });
module.exports = { main, parseArgs, checkEndpoint, loadSecret, connectivity, OUT_DIR, WALL_CLOCK_MS };
