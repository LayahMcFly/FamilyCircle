'use strict';
/* Runner for the Family Exchange unique-index probe. Offline-tested; NOT approved to run against anything.
 *
 *   node run.js budget                              prints the call budget (offline, no key, no network)
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
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const manifest = require('./schema.manifest.json');
const { runProbe, cleanup, assertTarget, budget, DEFAULTS } = require('./probe');
const { createAdapter, schemaCallCounts } = require('./adapter');
const { createRedactor } = require('./redact');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');
const WALL_CLOCK_MS = { run: 15 * 60 * 1000, 'create-schema': 6 * 60 * 1000, 'verify-schema': 60 * 1000, cleanup: 10 * 60 * 1000 };
const KEY_SHAPE = /(?:standard|ephemeral|dynamic)_[A-Za-z0-9]{8,}|[a-f0-9]{40,}/i;

function parseArgs(argv) {
  const out = { cmd: argv[0], expectProject: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--expect-project') out.expectProject = argv[++i] || null;
    else throw new Error('unknown argument');
  }
  for (const a of argv) if (KEY_SHAPE.test(a)) throw new Error('an argument looks like a key; keys are never passed as arguments');
  return out;
}

function checkEndpoint(ep) {
  let u; try { u = new URL(ep); } catch (e) { throw new Error('PROBE_ENDPOINT is not a URL'); }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.cloud\.appwrite\.io$/.test(u.hostname) || u.pathname.replace(/\/$/, '') !== '/v1' || u.username || u.password || u.port) throw new Error('PROBE_ENDPOINT must be https://<region>.cloud.appwrite.io/v1');
  return u.origin + '/v1';
}

/* Reads the key from exactly one source. A key file must be outside the repository, a regular file, and readable by its owner only. */
function loadSecret(env, { repoRoot = REPO_ROOT, fsx = fs } = {}) {
  const file = env.PROBE_KEY_FILE, inline = env.PROBE_APPWRITE_KEY;
  if (file && inline) throw new Error('set only one of PROBE_KEY_FILE and PROBE_APPWRITE_KEY');
  if (!file && !inline) throw new Error('no key: set PROBE_KEY_FILE (preferred) or PROBE_APPWRITE_KEY');
  let key;
  if (file) {
    const real = fsx.realpathSync(file), root = fsx.realpathSync(repoRoot);
    if (real === root || real.startsWith(root + path.sep)) throw new Error('the key file must be outside the repository');
    const st = fsx.statSync(real);
    if (!st.isFile()) throw new Error('the key file is not a regular file');
    if ((st.mode & 0o077) !== 0) throw new Error('the key file must be readable by its owner only (mode 600)');
    key = fsx.readFileSync(real, 'utf8').trim();
  } else key = inline.trim();
  if (key.length < 20 || /\s/.test(key)) throw new Error('the key does not look like an API key');
  delete env.PROBE_APPWRITE_KEY;   // not inherited by anything started later
  return key;
}

function realSdk({ endpoint, projectId, key }) {
  const { Client, TablesDB, Query } = require('node-appwrite');
  return { tablesDb: new TablesDB(new Client().setEndpoint(endpoint).setProject(projectId).setKey(key)), Query };
}

function writeJson(outDir, file, data, redact) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(outDir, file), redact(JSON.stringify(data, null, 2)) + '\n', { mode: 0o600 });
}

async function main(argv, env, deps = {}) {
  const outDir = deps.outDir || OUT_DIR;
  const lines = [], emitRaw = deps.emit || ((l) => process.stdout.write(l + '\n'));
  let redact = createRedactor();
  const emit = (l) => { const r = redact(l); lines.push(r); emitRaw(r); };
  try {
    const args = parseArgs(argv);
    if (args.cmd === 'budget') {
      const b = budget(), s = schemaCallCounts(manifest);
      emit('Call budget (worst case, enforced as a hard cap by the adapter):');
      emit('  verify-schema ' + s.verifySchema + ', create-schema ' + s.createSchema + ', run ' + (b.runTotal + s.verifySchema) + ' (probe ' + b.runTotal + ' plus a ' + s.verifySchema + '-call schema check), cleanup ' + b.cleanupTotal + ' (rows recorded, at most)');
      for (const [k, v] of Object.entries(b.parts)) emit('    ' + k + ': ' + v);
      emit('  wall clock limits (ms): ' + JSON.stringify(WALL_CLOCK_MS));
      return { code: 0, lines };
    }
    if (!['verify-schema', 'create-schema', 'run', 'cleanup'].includes(args.cmd)) throw new Error('unknown command');
    const projectId = env.PROBE_PROJECT_ID;
    assertTarget({ projectId, recordedProbeProjectId: args.expectProject });
    const endpoint = checkEndpoint(env.PROBE_ENDPOINT);
    const key = loadSecret(env, deps.secretOpts);
    redact = createRedactor([key]);
    const { tablesDb, Query } = (deps.makeSdk || realSdk)({ endpoint, projectId, key });
    const b = budget(), s = schemaCallCounts(manifest);
    const cap = { 'verify-schema': s.verifySchema, 'create-schema': s.createSchema, run: b.runTotal + s.verifySchema, cleanup: b.cleanupTotal }[args.cmd];
    const a = createAdapter({ tablesDb, Query, manifest, maxCalls: cap, deadlineMs: WALL_CLOCK_MS[args.cmd], redact, sleep: deps.sleep, timers: deps.timers });
    emit('command ' + args.cmd + ', project ' + projectId + ', endpoint ' + endpoint + ', call cap ' + cap);

    if (args.cmd === 'verify-schema') {
      const v = await a.verifySchema();
      emit(v.ok ? 'schema matches the manifest' : 'schema differs from the manifest:');
      v.problems.forEach((p) => emit('  ' + p));
      emit('calls used ' + a.stats().calls);
      return { code: v.ok ? 0 : 1, lines };
    }
    if (args.cmd === 'create-schema') {
      try { const r = await a.createSchema(); emit('created ' + r.created + ' resources'); }
      catch (e) { emit('create-schema stopped: ' + (a.stopReason() || e.message) + '; nothing pre-existing was touched'); emit('calls used ' + a.stats().calls); return { code: 2, lines }; }
      emit('calls used ' + a.stats().calls);
      return { code: 0, lines };
    }
    if (args.cmd === 'run') {
      const createdFile = path.join(outDir, 'created.json');
      if (fs.existsSync(createdFile) && JSON.parse(fs.readFileSync(createdFile, 'utf8')).length) throw new Error('out/created.json already holds rows: run cleanup first, or use a fresh project');
      const v = await a.verifySchema();
      if (!v.ok) { emit('refusing to run: schema differs from the manifest'); v.problems.forEach((p) => emit('  ' + p)); return { code: 1, lines }; }
      const runId = (deps.runId || crypto.randomBytes(5).toString('hex'));
      const r = await runProbe(a, { ...(deps.probeOpts || {}), tables: manifest.roles, runId, log: emit });
      writeJson(outDir, 'created.json', r.created, redact);
      const st = a.stats();
      writeJson(outDir, 'run-' + runId + '.json', { runId, stopped: r.stopped, pass: r.pass, results: r.results, calls: st.calls, byMethod: st.byMethod, rowsCreated: r.created.length, note: 'Evidence about this project, configuration and the schedules observed only. Not production verification.' }, redact);
      emit((r.stopped ? 'STOPPED (' + r.stopped + ')' : r.pass ? 'all checks passed' : 'some checks failed') + '; calls used ' + st.calls + ' of ' + cap + '; rows created ' + r.created.length);
      return { code: r.stopped ? 2 : r.pass ? 0 : 1, lines };
    }
    /* cleanup: only rows recorded in out/created.json; nothing else is listed or deleted */
    const createdFile = path.join(outDir, 'created.json');
    if (!fs.existsSync(createdFile)) throw new Error('out/created.json not found: nothing recorded, nothing to delete');
    const recorded = JSON.parse(fs.readFileSync(createdFile, 'utf8'));
    const r = await cleanup(a, recorded);
    emit('recorded ' + recorded.length + ', deleted ' + r.removed + ', failed ' + r.failed.length + '; calls used ' + a.stats().calls);
    if (!r.failed.length && !a.stopReason()) fs.renameSync(createdFile, path.join(outDir, 'created.cleaned-' + Date.now() + '.json'));
    r.failed.forEach((f) => emit('  could not delete ' + f));
    return { code: r.failed.length || a.stopReason() ? 2 : 0, lines };
  } catch (e) {
    emit('error: ' + e.message);
    return { code: 1, lines };
  }
}

if (require.main === module) main(process.argv.slice(2), process.env).then((r) => { process.exitCode = r.code; });
module.exports = { main, parseArgs, checkEndpoint, loadSecret, OUT_DIR, WALL_CLOCK_MS };
