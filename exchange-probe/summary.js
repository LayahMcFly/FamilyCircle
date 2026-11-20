'use strict';
/* Everything that can reach public output (the job log and job summary of a public repository) is built here, from fixed templates and per-field validators.
 * Nothing is passed through: not an SDK response, header, exception text, environment value, row, state payload or free-form detail string.
 * A field that fails its validator is dropped; a line that fails the character check is refused. Redaction elsewhere is only a backup. */
const { SafeError, REASONS } = require('./errors');

const COMMANDS = ['budget', 'connectivity', 'verify-schema', 'create-schema', 'run', 'cleanup'];
const CHECK_IDS = ['PRE', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
const STOPS = ['auth', 'budget', 'time', 'throttled_or_unavailable', 'exists', 'columns_not_ready', 'not_clean'];
const METHODS = ['createRow', 'deleteRow', 'getRow', 'listRows', 'listTables', 'listColumns', 'listIndexes', 'createDatabase', 'createTable', 'createStringColumn', 'createIntegerColumn', 'createTextColumn', 'createIndex'];
const FINDING_KINDS = ['database_unreadable', 'unexpected_table', 'unexpected_column', 'unexpected_index', 'missing_table', 'missing_column', 'missing_index', 'column_type', 'column_size', 'column_required', 'column_array', 'column_status', 'index_type', 'index_columns', 'index_status', 'permissions', 'row_security'];
const CONNECT_ERRORS = ['timeout', 'network'];

const int = (v) => Number.isSafeInteger(v) && v >= -1 && v <= 10000000;
const bool = (v) => typeof v === 'boolean';
const oneOf = (list) => (v) => typeof v === 'string' && list.includes(v);
const re = (rx) => (v) => typeof v === 'string' && rx.test(v);
const PROJECT = re(/^[A-Za-z0-9_-]{1,36}$/), HOST = re(/^[a-z0-9-]+\.cloud\.appwrite\.io$/), SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const OUTCOME = oneOf(['identical', 'different', 'refused']), PUT = oneOf(['accepted', 'refused']);
const COUNTS = { rounds: int, width: int, failedRound: int, ok: int, conflict: int, other: int };
const CHECK_DATA = {
  PRE: { table: oneOf(['events', 'hints', 'text']) },
  P0: { items: int, notAvailable: int, notUnique: int },
  P1: { claimRefused409: bool, opRefused409: bool },
  P2: COUNTS, P3: COUNTS, P4: COUNTS,
  P5: { rounds: int, writers: int, failedRound: int, rows: int, rejected: int },
  P6: { trials: int, stale: int },
  P7: { attempts: int, unknown: int, committedAmongUnknown: int, failedTrial: int },
  P8: { recreated: bool, duplicateRefused409: bool },
  P9: { asciiOutcome: OUTCOME, asciiStatus: int, cjkOutcome: OUTCOME, cjkStatus: int, b65535Outcome: PUT, b65535Status: int, b70000Outcome: PUT, b70000Status: int },
  P10: { pagedSeen: int, orderSeq: bool, orderCreated: bool }
};
const TITLES = {
  PRE: 'probe tables are empty before the run', P0: 'every column and index is available and the unique ones are unique',
  P1: 'a second row with the same claimKey or opKey is refused', P2: 'concurrent inserts with the same claimKey: exactly one wins',
  P3: 'concurrent inserts with the same opKey: exactly one wins', P4: 'concurrent identical inserts: exactly one wins',
  P5: 'the claim loop lands every writer once with a gap-free sequence', P6: 'newest-first read right after a write (informational)',
  P7: 'after a timeout, retrying with the same keys ends with exactly one row', P8: 'a deleted unique key can be recreated and a duplicate is still refused',
  P9: '60000-byte state round trip and the real text ceiling', P10: 'paging and ordering the app depends on'
};
const NOTE = 'Evidence about this project, configuration and the schedules observed only. Not production verification.';

/* a value the validator rejects is dropped, never repaired or passed through */
function pick(schema, data) {
  const out = {};
  for (const [k, ok] of Object.entries(schema)) if (data && Object.prototype.hasOwnProperty.call(data, k) && ok(data[k])) out[k] = data[k];
  return out;
}
function sanitizeCheck(r) {
  if (!r || !CHECK_IDS.includes(r.id) || typeof r.pass !== 'boolean') return null;
  return { id: r.id, title: TITLES[r.id], pass: r.pass, data: pick(CHECK_DATA[r.id], r.data) };
}
function sanitizeFinding(f, manifest) {
  if (!f || !FINDING_KINDS.includes(f.kind)) return null;
  const spec = f.table && manifest.tables[f.table] ? manifest.tables[f.table] : null;
  const table = spec ? f.table : null;
  const key = spec && typeof f.key === 'string' && (spec.columns.some((c) => c.key === f.key) || spec.indexes.some((i) => i.key === f.key)) ? f.key : null;
  return { kind: f.kind, table, key };
}
function buildSummary(raw, manifest) {
  const s = { command: oneOf(COMMANDS)(raw.command) ? raw.command : null };
  if (PROJECT(raw.project)) s.project = raw.project;
  if (HOST(raw.host)) s.host = raw.host;
  if (bool(raw.pass)) s.pass = raw.pass;
  s.stopped = oneOf(STOPS)(raw.stopped) ? raw.stopped : null;
  for (const k of ['calls', 'cap', 'rows', 'recorded', 'deleted', 'failed', 'created', 'findingCount', 'status']) if (int(raw[k])) s[k] = raw[k];
  if (typeof raw.version === 'string') s.version = SEMVER.test(raw.version) ? raw.version : 'unrecognised';
  if (oneOf(CONNECT_ERRORS)(raw.connectError)) s.connectError = raw.connectError;
  if (raw.byMethod && typeof raw.byMethod === 'object') { s.byMethod = {}; for (const m of METHODS) if (int(raw.byMethod[m])) s.byMethod[m] = raw.byMethod[m]; }
  if (Array.isArray(raw.checks)) s.checks = raw.checks.map(sanitizeCheck).filter(Boolean);
  if (Array.isArray(raw.findings)) s.findings = raw.findings.map((f) => sanitizeFinding(f, manifest)).filter(Boolean);
  s.note = NOTE;
  return s;
}

/* lines: fixed words, then name=value pairs whose values are validated above and limited to [A-Za-z0-9_.-] */
const LINE_RE = /^[a-z][a-z_]*( [A-Za-z][A-Za-z0-9]*=[A-Za-z0-9_.\-]+)*$/;
function assertSafeLine(line) { if (typeof line !== 'string' || line.length > 400 || !LINE_RE.test(line)) throw new SafeError('unsafe_line'); return line; }
const kv = (o) => Object.entries(o).map(([k, v]) => ' ' + k + '=' + String(v)).join('');
const lines = {
  start: (o) => assertSafeLine('start' + kv({ command: oneOf(COMMANDS)(o.command) ? o.command : 'unknown', project: PROJECT(o.project) ? o.project : 'none', host: HOST(o.host) ? o.host : 'none', cap: int(o.cap) ? o.cap : -1 })),
  check: (c) => assertSafeLine('check' + kv({ id: c.id, pass: c.pass, ...c.data })),
  finding: (f) => assertSafeLine('finding' + kv({ kind: f.kind, table: f.table || 'none', key: f.key || 'none' })),
  schema: (ok, count) => assertSafeLine('schema' + kv({ ok: Boolean(ok), findings: int(count) ? count : 0 })),
  created: (n) => assertSafeLine('created' + kv({ resources: int(n) ? n : 0 })),
  cleanup: (o) => assertSafeLine('cleanup' + kv({ recorded: int(o.recorded) ? o.recorded : 0, deleted: int(o.deleted) ? o.deleted : 0, failed: int(o.failed) ? o.failed : 0 })),
  connectivity: (o) => assertSafeLine('connectivity' + (oneOf(CONNECT_ERRORS)(o.connectError) ? kv({ error: o.connectError }) : kv({ status: int(o.status) ? o.status : -1, version: typeof o.version === 'string' && SEMVER.test(o.version) ? o.version : 'unrecognised' }))),
  end: (s) => assertSafeLine('end' + kv({ command: s.command || 'unknown', pass: s.pass === true, stopped: s.stopped || 'none', calls: s.calls ?? 0, cap: s.cap ?? 0, rows: s.rows ?? 0 })),
  error: (e) => (e instanceof SafeError && REASONS.includes(e.reason)) ? assertSafeLine('error' + kv({ reason: e.reason })) : assertSafeLine('error' + kv({ reason: 'unexpected', status: e && int(e.code) && e.code >= 100 && e.code <= 599 ? e.code : 0 })),
  budget: (name, n) => assertSafeLine('budget' + kv({ name: re(/^[A-Za-z0-9_-]{1,24}$/)(name) ? name : 'x', calls: int(n) ? n : 0 })),
  limit: (command, ms) => assertSafeLine('limit' + kv({ command: oneOf(COMMANDS)(command) ? command : 'unknown', ms: int(ms) ? ms : 0 }))
};
module.exports = { COMMANDS, CHECK_IDS, STOPS, METHODS, FINDING_KINDS, TITLES, NOTE, SEMVER, buildSummary, sanitizeCheck, sanitizeFinding, assertSafeLine, lines, CHECK_DATA };
