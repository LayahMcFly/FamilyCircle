import assert from 'node:assert/strict';
import { createApi, TABLES } from '../../../function/src/logic.js';
import { CHAT_TABLES } from '../../../function/src/chat.js';
import { GIVING_TABLES } from '../../../function/src/giving.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const PIC = fs.readFileSync(fileURLToPath(new URL('./pic.gif', import.meta.url)));
// Stand-in for the shop page lookup: no internet in tests. "nopic" links have no picture, everything else gives the fixture picture.
const JPG = fs.readFileSync(fileURLToPath(new URL('./pic.jpg', import.meta.url)));
// Etsy's API stand-in: any listing has one picture.
const EXTRA_CFG = { etsyApiKey: 'test:key', etsyDeps: { lookup: async () => [{ address: '93.184.216.34', family: 4 }], getApi: async () => ({ status: 200, body: JSON.stringify({ results: [{ rank: 1, url_170x135: 'https://i.etsystatic.com/t.jpg', url_570xN: 'https://i.etsystatic.com/f.jpg' }] }) }), get: async () => ({ status: 200, headers: {}, body: JPG }) }, linkPicture: async (url) => { if (/amazonblock/.test(url)) throw Object.assign(new Error('shop refused 503'), { linkPicture: true, kind: 'blocked', trace: ['step 1: www.amazon.com answered 503 in 120 ms, 2000 bytes', 'result: shop refused 503'] }); if (/nopic/.test(url)) throw Object.assign(new Error('none'), { linkPicture: true }); return { mime: 'image/gif', bytes: PIC }; } };

/* ---------- in-memory fake of the server services (queries, unique keys, permissions) ---------- */
function makeWorld() {
  let seq = 0;
  const world = { tables: {}, teams: {}, clock: 1_800_000_000_000 };
  world.bump = (ms) => { world.clock += ms; };
  world.files = {};
  world.storage = {
    async getFile({ fileId }) { const f = world.files[fileId]; if (!f) { const e = new Error('nf'); e.code = 404; throw e; } return f; },
    async updateFile({ fileId, permissions }) { world.files[fileId].$permissions = permissions; return world.files[fileId]; },
    async deleteFile({ fileId }) { delete world.files[fileId]; },
    async listFiles() { return { files: [] }; },
    async createFile({ fileId, file, bucketId }) { world.files[fileId] = { $id: fileId, bucketId, buf: Buffer.from(await file.arrayBuffer()), $permissions: [] }; return world.files[fileId]; },
    async getFileDownload({ fileId }) { const f = world.files[fileId]; if (!f) { const e = new Error('nf'); e.code = 404; throw e; } return f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.length); },
  };
  for (const t of [...Object.values(TABLES), ...Object.values(CHAT_TABLES), ...Object.values(GIVING_TABLES)]) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });
  const UNIQUE = ['sendKey', 'channelKey', 'dmKey', 'reactionKey', 'blockKey', 'readKey', 'profileKey', 'itemId', 'pledgeKey'];
  const match = (r, q) => {
    switch (q.method) {
      case 'equal': return q.values.includes(q.attribute === '$id' ? r.$id : r[q.attribute]);
      case 'notEqual': return !q.values.includes(r[q.attribute]);
      case 'greaterThan': return String(r[q.attribute]) > String(q.values[0]);
      case 'lessThan': return r[q.attribute] !== undefined && String(r[q.attribute]) < String(q.values[0]);
      case 'or': return q.values.some((v) => match(r, v));
      default: return true;
    }
  };
  const db = {
    async createRow({ tableId, rowId, data, permissions }) {
      const t = world.tables[tableId];
      if (!t) throw err(404, 'no table');
      const id = rowId === 'unique()' || rowId.startsWith('uniq') ? `r${++seq}` : rowId;
      for (const k of UNIQUE) if (data[k] !== undefined && [...t.values()].some((r) => r[k] === data[k])) throw err(409, 'unique');
      const row = { ...data, $id: id, $permissions: (permissions || []).slice(), $createdAt: new Date(world.clock + ++seq * 1000).toISOString() };
      t.set(id, row);
      return row;
    },
    async getRow({ tableId, rowId }) { const r = world.tables[tableId].get(rowId); if (!r) throw err(404, 'nope'); return r; },
    async updateRow({ tableId, rowId, data, permissions }) { const r = await db.getRow({ tableId, rowId }); Object.assign(r, data || {}); if (permissions) r.$permissions = permissions.slice(); return r; },
    async deleteRow({ tableId, rowId }) { await db.getRow({ tableId, rowId }); world.tables[tableId].delete(rowId); return {}; },
    async listRows({ tableId, queries = [] }) {
      const t = world.tables[tableId];
      if (!t) throw err(404, 'no table');
      let rows = [...t.values()];
      let limit = 25, order = null, cursor = null;
      for (const raw of queries) {
        const q = JSON.parse(raw);
        if (q.method === 'limit') limit = q.values[0];
        else if (q.method === 'orderDesc' || q.method === 'orderAsc') order = q;
        else if (q.method === 'cursorAfter') cursor = q.values[0];
        else rows = rows.filter((r) => match(r, q));
      }
      if (order) rows.sort((a, b) => String(a[order.attribute]).localeCompare(String(b[order.attribute])) * (order.method === 'orderDesc' ? -1 : 1));
      if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
      return { total: rows.length, rows: rows.slice(0, limit) };
    }
  };
  const users = {
    async listMemberships({ userId }) {
      const out = [];
      for (const [teamId, t] of Object.entries(world.teams)) for (const m of t.members) if (m.userId === userId) out.push({ teamId, teamName: t.name, userId, roles: m.roles, confirm: m.confirm });
      return { memberships: out };
    },
    async updateLabels() { return {}; }
  };
  const teams = {
    async getPrefs({ teamId }) { return { ...(world.teams[teamId].prefs || {}) }; },
    async updatePrefs({ teamId, prefs }) { world.teams[teamId].prefs = { ...prefs }; return prefs; },
    async listMemberships({ teamId }) { return { memberships: world.teams[teamId].members.map((m) => ({ ...m, teamId })) }; },
    async delete() { return {}; }
  };
  const api = createApi({ users, teams, db, storage: world.storage, cfg: { databaseId: 'family', bucketId: 'b', maxOwnedFamilies: 3, maxVideoMB: 15, familyStorageMB: 500, ...EXTRA_CFG }, now: () => world.clock + seq * 1000 + 500 });
  const U = (id) => ({ $id: id, emailVerification: true, status: true, labels: [] });
  const call = async (uid, action, body = {}) => { const r = await api.handle({ user: U(uid), body: { action, ...body }, deadline: Number.MAX_SAFE_INTEGER }); return r; };
  const ok = async (uid, action, body) => { const r = await call(uid, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`); return r.json; };
  const fail = async (uid, action, body, status, code) => { const r = await call(uid, action, body); assert.equal(r.status, status, `${action} should fail ${status}: ${JSON.stringify(r.json)}`); if (code) assert.equal(r.json.error, code); return r.json; };
  const addFamily = async (fid, ownerId, memberIds) => {
    world.teams[fid] = { name: 'Fam ' + fid, members: [{ userId: ownerId, roles: ['owner'], confirm: true }, ...memberIds.map((u) => ({ userId: u, roles: ['member'], confirm: true }))] };
    await db.createRow({ tableId: 'families', rowId: fid, data: { ownerId, name: 'Fam ' + fid }, permissions: [] });
    for (const u of [ownerId, ...memberIds]) await db.createRow({ tableId: 'profiles', rowId: 'unique()', data: { familyId: fid, userId: u, profileKey: `${fid}_${u}`, displayName: u }, permissions: [] });
  };
  const removeMember = (fid, uid) => { world.teams[fid].members = world.teams[fid].members.filter((m) => m.userId !== uid); };
  return { world, api, call, ok, fail, addFamily, removeMember };
}

export { makeWorld };
