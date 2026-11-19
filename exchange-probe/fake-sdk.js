'use strict';
/* Test helper: an in-memory stand-in shaped like node-appwrite's TablesDB (object parameters, the same return shapes), built from the manifest.
 * It parses queries produced by the REAL Query class, so query serialization is exercised. Options let tests break it on purpose. */
const err = (code, message) => Object.assign(new Error(message || 'e' + code), { code });

function createFakeTablesDb(manifest, o = {}) {
  const log = [], tables = {}, schema = { database: false, tables: {} };
  const uniq = (t) => manifest.tables[t].indexes.filter((i) => i.type === 'unique').map((i) => i.columns[0]);
  for (const t of Object.keys(manifest.tables)) tables[t] = new Map();
  if (o.prebuilt !== false) { schema.database = true; for (const t of Object.keys(manifest.tables)) schema.tables[t] = { columns: manifest.tables[t].columns.map((c) => ({ ...c, status: 'available', array: false })), indexes: manifest.tables[t].indexes.map((i) => ({ ...i, status: 'available' })), permissions: [], rowSecurity: false }; }
  const tick = () => new Promise((r) => setImmediate(r));
  const fail = (name) => { if (o.fail && o.fail(name, log.filter((x) => x === name).length)) throw err(o.fail.code || 500); };
  const m = (name, fn) => async (p) => { log.push(name); await tick(); fail(name); return fn(p); };
  const parse = (qs) => (qs || []).map((q) => JSON.parse(q));
  const T = (p) => { if (p.databaseId !== manifest.database.id) throw err(404, 'database'); if (!tables[p.tableId]) throw err(404, 'table'); return tables[p.tableId]; };
  const api = {
    log, tables, schema,
    createRow: m('createRow', (p) => {
      const tb = T(p); if (tb.has(p.rowId)) throw err(409);
      if (!/^[A-Za-z0-9][A-Za-z0-9_]{0,35}$/.test(p.rowId)) throw err(400, 'bad id');
      if (p.permissions === undefined) throw err(400);
      if (o.enforce !== false) for (const k of uniq(p.tableId)) if (k !== o.brokenUnique) for (const r of tb.values()) if (r[k] === p.data[k]) throw err(409);
      if (p.data.state !== undefined && Buffer.byteLength(p.data.state) > (o.textCap || 65535)) throw err(400);
      const row = { ...p.data, $id: p.rowId, $createdAt: new Date(2026, 0, 1, 0, 0, tb.size).toISOString() }; tb.set(p.rowId, row); return row;
    }),
    deleteRow: m('deleteRow', (p) => { const tb = T(p); if (!tb.delete(p.rowId)) throw err(404); return {}; }),
    getRow: m('getRow', (p) => { const r = T(p).get(p.rowId); if (!r) throw err(404); return r; }),
    listRows: m('listRows', (p) => {
      let rows = [...T(p).values()], limit = 25, after = null, desc = null;
      for (const q of parse(p.queries)) {
        if (q.method === 'equal') rows = rows.filter((r) => q.values.includes(r[q.attribute]));
        else if (q.method === 'orderDesc') desc = q.attribute;
        else if (q.method === 'limit') limit = q.values[0];
        else if (q.method === 'cursorAfter') after = q.values[0];
        else throw err(400, 'unsupported query ' + q.method);
      }
      if (desc) rows.sort((a, b) => (b[desc] > a[desc] ? 1 : b[desc] < a[desc] ? -1 : 0)); else rows.sort((a, b) => (a.$id > b.$id ? 1 : -1));
      if (after) rows = rows.slice(rows.findIndex((r) => r.$id === after) + 1);
      return { total: rows.length, rows: rows.slice(0, limit) };
    }),
    listTables: m('listTables', (p) => { if (!schema.database || p.databaseId !== manifest.database.id) throw err(404); return { total: 0, tables: Object.entries(schema.tables).map(([id, t]) => ({ $id: id, $permissions: t.permissions, rowSecurity: t.rowSecurity })) }; }),
    listColumns: m('listColumns', (p) => ({ total: 0, columns: (schema.tables[p.tableId] || { columns: [] }).columns })),
    listIndexes: m('listIndexes', (p) => ({ total: 0, indexes: (schema.tables[p.tableId] || { indexes: [] }).indexes })),
    create: m('create', (p) => { if (schema.database) throw err(409); schema.database = true; return {}; }),
    createTable: m('createTable', (p) => { if (schema.tables[p.tableId]) throw err(409); schema.tables[p.tableId] = { columns: [], indexes: [], permissions: p.permissions, rowSecurity: p.rowSecurity }; return {}; }),
    createStringColumn: m('createStringColumn', (p) => { schema.tables[p.tableId].columns.push({ key: p.key, type: 'string', size: p.size, required: p.required, array: false, status: o.slowColumns ? 'processing' : 'available' }); return {}; }),
    createIntegerColumn: m('createIntegerColumn', (p) => { schema.tables[p.tableId].columns.push({ key: p.key, type: 'integer', required: p.required, array: false, status: 'available' }); return {}; }),
    createTextColumn: m('createTextColumn', (p) => { schema.tables[p.tableId].columns.push({ key: p.key, type: 'text', required: p.required, array: false, status: 'available' }); return {}; }),
    createIndex: m('createIndex', (p) => { const t = schema.tables[p.tableId]; if (!p.columns.every((c) => t.columns.some((x) => x.key === c && x.status === 'available'))) throw err(400, 'column not available'); t.indexes.push({ key: p.key, type: p.type, columns: p.columns, status: 'available' }); return {}; })
  };
  return api;
}
module.exports = { createFakeTablesDb, err };
