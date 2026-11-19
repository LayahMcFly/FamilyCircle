'use strict';
/* Appwrite adapter for the probe. Wraps the pinned node-appwrite TablesDB (object-parameter calls, as the production function uses) behind the small interface probe.js expects.
 * Offline-tested against an SDK-shaped fake. Never constructed with credentials here: the runner builds the client. Not run against Appwrite.
 * Guards: a hard cap on total API calls, a wall-clock deadline, and an immediate stop on 401/403, repeated 429/5xx, or repeated unexpected network failures. After a stop, no further request is sent. */

const FIVE = 5, COLUMN_POLLS = 30;

function createAdapter({ tablesDb, Query, manifest, maxCalls, deadlineMs = null, redact = (x) => String(x), now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const databaseId = manifest.database.id;
  const tableIds = Object.keys(manifest.tables);
  let calls = 0, stop = null, bad = 0;
  const byMethod = {};
  const startedAt = now();

  const stopWith = (why) => { if (!stop) stop = why; };
  const mapError = (e) => Object.assign(new Error(redact(e)), { code: Number.isInteger(e && e.code) ? e.code : 0, type: e && e.type ? String(e.type) : undefined });
  const stoppedError = (why) => Object.assign(new Error('stopped: ' + why), { code: -1, stopped: why });

  /* every SDK request goes through here */
  async function call(name, fn, { expectNetworkLoss = false } = {}) {
    if (stop) throw stoppedError(stop);
    if (deadlineMs !== null && now() - startedAt > deadlineMs) { stopWith('time'); throw stoppedError(stop); }
    if (calls >= maxCalls) { stopWith('budget'); throw stoppedError(stop); }
    calls++; byMethod[name] = (byMethod[name] || 0) + 1;
    try { const r = await fn(); bad = 0; return r; }
    catch (e) {
      const err = mapError(e);
      if (err.code === 401 || err.code === 403) stopWith('auth');
      else if (err.code === 429 || err.code >= 500 || (err.code === 0 && !expectNetworkLoss)) { if (++bad >= FIVE) stopWith('throttled_or_unavailable'); }
      else bad = 0;
      throw err;
    }
  }

  const rowIdOk = (id) => /^[A-Za-z0-9][A-Za-z0-9_]{0,35}$/.test(id);
  const cleanData = (d) => { for (const k of Object.keys(d)) if (k.startsWith('$')) throw new Error('data key starts with $'); return d; };

  const api = {
    stopReason: () => stop,
    stats: () => ({ calls, byMethod: { ...byMethod }, stopped: stop }),

    create(table, id, data) {
      if (!rowIdOk(id)) throw Object.assign(new Error('bad row id ' + id), { code: 400 });
      return call('createRow', () => tablesDb.createRow({ databaseId, tableId: table, rowId: id, data: cleanData(data), permissions: [] }));
    },
    del(table, id) { return call('deleteRow', () => tablesDb.deleteRow({ databaseId, tableId: table, rowId: id })); },
    get(table, id) { return call('getRow', () => tablesDb.getRow({ databaseId, tableId: table, rowId: id })); },
    async list(table, q = {}) {
      const queries = [];
      if (q.eq) queries.push(Query.equal(q.eq[0], [q.eq[1]]));
      if (q.orderDesc) queries.push(Query.orderDesc(q.orderDesc));
      if (q.after) queries.push(Query.cursorAfter(q.after));
      queries.push(Query.limit(Math.min(q.limit || 25, 100)));
      const r = await call('listRows', () => tablesDb.listRows({ databaseId, tableId: table, queries }));
      return r.rows;
    },
    /* The client gives up after ms, but the request may still commit: the outcome is unknown, so the caller must look it up. */
    createWithTimeout(table, id, data, ms) {
      const p = call('createRow', () => tablesDb.createRow({ databaseId, tableId: table, rowId: id, data: cleanData(data), permissions: [] }), { expectNetworkLoss: true });
      p.catch(() => {});
      return new Promise((resolve, reject) => {
        const t = timers.set(() => reject(Object.assign(new Error('client timeout'), { code: 0, timeout: true })), ms);
        p.then((r) => { timers.clear(t); resolve(r); }, (e) => { timers.clear(t); reject(e); });
      });
    },

    /* P0 input: every expected column and index with its live status; anything expected but absent is reported as missing */
    async readiness() {
      const items = [];
      for (const t of tableIds) {
        const spec = manifest.tables[t];
        const cols = (await call('listColumns', () => tablesDb.listColumns({ databaseId, tableId: t, queries: [Query.limit(100)] }))).columns;
        const idx = (await call('listIndexes', () => tablesDb.listIndexes({ databaseId, tableId: t, queries: [Query.limit(100)] }))).indexes;
        for (const c of spec.columns) { const f = cols.find((x) => x.key === c.key); items.push({ kind: 'column', table: t, key: c.key, status: f ? f.status : 'missing' }); }
        for (const i of spec.indexes) { const f = idx.find((x) => x.key === i.key); items.push({ kind: 'index', table: t, key: i.key, status: f ? f.status : 'missing', unique: i.type === 'unique', type: f ? f.type : null }); }
      }
      return items;
    },

    /* Read-only comparison of the live schema with the manifest. Reports every difference; changes nothing. */
    async verifySchema() {
      const problems = [];
      let listed;
      try { listed = (await call('listTables', () => tablesDb.listTables({ databaseId }))).tables; }
      catch (e) { return { ok: false, problems: ['database ' + databaseId + ' could not be read (' + e.code + ')'] }; }
      for (const t of listed) if (!tableIds.includes(t.$id)) problems.push('unexpected table ' + t.$id);
      for (const t of tableIds) {
        const spec = manifest.tables[t], live = listed.find((x) => x.$id === t);
        if (!live) { problems.push('missing table ' + t); continue; }
        const perms = live.$permissions || [], defaults = manifest.tableDefaults;
        if (perms.length !== defaults.permissions.length) problems.push(t + ': table permissions are not empty');
        if (Boolean(live.rowSecurity) !== defaults.rowSecurity) problems.push(t + ': rowSecurity differs');
        const cols = (await call('listColumns', () => tablesDb.listColumns({ databaseId, tableId: t, queries: [Query.limit(100)] }))).columns;
        const idx = (await call('listIndexes', () => tablesDb.listIndexes({ databaseId, tableId: t, queries: [Query.limit(100)] }))).indexes;
        for (const c of cols) if (!spec.columns.some((x) => x.key === c.key)) problems.push(t + ': unexpected column ' + c.key);
        for (const i of idx) if (!spec.indexes.some((x) => x.key === i.key)) problems.push(t + ': unexpected index ' + i.key);
        for (const c of spec.columns) {
          const f = cols.find((x) => x.key === c.key);
          if (!f) { problems.push(t + ': missing column ' + c.key); continue; }
          if (f.type !== c.type) problems.push(t + '.' + c.key + ': type ' + f.type + ' not ' + c.type);
          if (c.size !== undefined && f.size !== c.size) problems.push(t + '.' + c.key + ': size ' + f.size + ' not ' + c.size);
          if (Boolean(f.required) !== c.required) problems.push(t + '.' + c.key + ': required differs');
          if (f.array) problems.push(t + '.' + c.key + ': is an array');
          if (f.status !== 'available') problems.push(t + '.' + c.key + ': status ' + f.status);
        }
        for (const i of spec.indexes) {
          const f = idx.find((x) => x.key === i.key);
          if (!f) { problems.push(t + ': missing index ' + i.key); continue; }
          if (f.type !== i.type) problems.push(t + '.' + i.key + ': type ' + f.type + ' not ' + i.type);
          if (JSON.stringify(f.columns) !== JSON.stringify(i.columns)) problems.push(t + '.' + i.key + ': columns ' + JSON.stringify(f.columns));
          if (f.status !== 'available') problems.push(t + '.' + i.key + ': status ' + f.status);
        }
      }
      return { ok: problems.length === 0, problems };
    },

    /* Setup path, only with a separate schema-privilege key. Creates; never updates or deletes. Any 409 stops it, so a pre-existing resource is never touched. */
    async createSchema() {
      const made = [];
      const step = async (what, fn) => { try { await call(what, fn); made.push(what); } catch (e) { if (e.code === 409) stopWith('exists'); throw e; } };
      await step('createDatabase', () => tablesDb.create({ databaseId, name: manifest.database.name }));
      for (const t of tableIds) {
        const spec = manifest.tables[t], d = manifest.tableDefaults;
        await step('createTable', () => tablesDb.createTable({ databaseId, tableId: t, name: t, permissions: d.permissions, rowSecurity: d.rowSecurity, enabled: d.enabled }));
        for (const c of spec.columns) {
          if (c.type === 'string') await step('createStringColumn', () => tablesDb.createStringColumn({ databaseId, tableId: t, key: c.key, size: c.size, required: c.required }));
          else if (c.type === 'integer') await step('createIntegerColumn', () => tablesDb.createIntegerColumn({ databaseId, tableId: t, key: c.key, required: c.required }));
          else if (c.type === 'text') await step('createTextColumn', () => tablesDb.createTextColumn({ databaseId, tableId: t, key: c.key, required: c.required }));
          else throw new Error('manifest column type not supported: ' + c.type);
        }
      }
      /* Appwrite builds columns in the background, and an index on a column that is still building is refused. Wait for every column of a table, then create its indexes. */
      for (const t of tableIds) {
        const spec = manifest.tables[t];
        if (!spec.indexes.length) continue;
        let ready = false;
        for (let n = 0; n < COLUMN_POLLS && !ready; n++) {
          const cols = (await call('listColumns', () => tablesDb.listColumns({ databaseId, tableId: t, queries: [Query.limit(100)] }))).columns;
          ready = spec.columns.every((c) => cols.some((x) => x.key === c.key && x.status === 'available'));
          if (!ready) await sleep(2000);
        }
        if (!ready) { stopWith('columns_not_ready'); throw stoppedError(stop); }
        for (const i of spec.indexes) await step('createIndex', () => tablesDb.createIndex({ databaseId, tableId: t, key: i.key, type: i.type, columns: i.columns }));
      }
      return { created: made.length };
    }
  };
  return api;
}

/* the most calls each command may make; enforced by the adapter's cap */
function schemaCallCounts(manifest) {
  const ids = Object.keys(manifest.tables);
  const cols = ids.reduce((n, t) => n + manifest.tables[t].columns.length, 0), idx = ids.reduce((n, t) => n + manifest.tables[t].indexes.length, 0);
  return { createSchema: 1 + ids.length + cols + idx + ids.length * COLUMN_POLLS, verifySchema: 1 + ids.length * 2 };
}
module.exports = { createAdapter, schemaCallCounts };
