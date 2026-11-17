import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, TABLES } from '../src/logic.js';
import { CHAT_TABLES } from '../src/chat.js';
import { RECIPE_TABLES } from '../src/recipes.js';
import { createRequire } from 'node:module';
const EXTRA_CFG = {};   // tests put stand-ins for the outside world here (link preview fetcher, GIF service)

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
  for (const t of [...Object.values(TABLES), ...Object.values(CHAT_TABLES), ...Object.values(RECIPE_TABLES)]) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });
  const UNIQUE = ['pubKey', 'sendKey', 'channelKey', 'dmKey', 'reactionKey', 'blockKey', 'readKey', 'profileKey', 'itemId', 'pledgeKey', 'partKey'];
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
    async listMemberships({ teamId }) { return { memberships: world.teams[teamId].members.map((m) => ({ ...m, teamId, $id: 'mb-' + teamId + '-' + m.userId + '-' + (m.gen || 1), userName: 'Name ' + m.userId })) }; },
    async delete() { return {}; }
  };
  const api = createApi({ users, teams, db, storage: world.storage, cfg: { databaseId: 'family', bucketId: 'b', maxOwnedFamilies: 3, maxVideoMB: 15, familyStorageMB: 500, ...EXTRA_CFG }, now: () => world.clock + seq * 1000 + 500 });
  const U = (id) => ({ $id: id, emailVerification: true, status: true, labels: [] });
  const call = async (uid, action, body = {}) => { const r = await api.handle({ user: U(uid), body: { action, ...body }, deadline: Number.MAX_SAFE_INTEGER }); return r; };
  const ok = async (uid, action, body) => { const r = await call(uid, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)} ${r.cause && r.cause.stack}`); return r.json; };
  const fail = async (uid, action, body, status, code) => { const r = await call(uid, action, body); assert.equal(r.status, status, `${action} should fail ${status}: ${JSON.stringify(r.json)}`); if (code) assert.equal(r.json.error, code); return r.json; };
  const addFamily = async (fid, ownerId, memberIds) => {
    world.teams[fid] = { name: 'Fam ' + fid, members: [{ userId: ownerId, roles: ['owner'], confirm: true }, ...memberIds.map((u) => ({ userId: u, roles: ['member'], confirm: true }))] };
    await db.createRow({ tableId: 'families', rowId: fid, data: { ownerId, name: 'Fam ' + fid }, permissions: [] });
    for (const u of [ownerId, ...memberIds]) await db.createRow({ tableId: 'profiles', rowId: 'unique()', data: { familyId: fid, userId: u, profileKey: `${fid}_${u}`, displayName: u }, permissions: [] });
  };
  const removeMember = (fid, uid) => { world.teams[fid].members = world.teams[fid].members.filter((m) => m.userId !== uid); };
  const reinvite = (fid, uid) => { world.teams[fid].members.push({ userId: uid, roles: ['member'], confirm: true, gen: 2 }); };
  return { world, api, call, ok, fail, addFamily, removeMember, reinvite };
}

const SQ = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivGPaCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=', WIDE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivGPaCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==';
const rows = (w, t) => [...w.world.tables[t].values()];
const DAY = 864e5;
const F = (extra = {}) => ({ familyId: 'famA', ...extra });
const draft = (o = {}) => ({ id: 'book-1', slug: 'gran', name: 'Gran Bread', ingredients: ['500 g flour'], steps: ['Bake.'], fav: true, source: 'http://x', notes: 'Slow.', ...o });
const pub = (d, o = {}) => F({ draft: d, imageKey: '', ...o });
const sweep = (w) => w.api.handle({ user: null, body: {}, deadline: Number.MAX_SAFE_INTEGER });
async function setup({ on = true } = {}) {
  const w = makeWorld();
  await w.addFamily('famA', 'owner', ['tia', 'sam', 'ann']);
  await w.addFamily('famB', 'zed', ['yan']);
  await w.ok('owner', 'setTreeAdmin', F({ userId: 'tia', admin: true }));
  if (on) await w.ok('owner', 'recipesSetEnabled', F({ enabled: true }));
  return w;
}
const call404 = async (w, u, a, b) => { const r = await w.call(u, a, b); assert.equal(r.status, 404, `${a}: ${JSON.stringify(r.json)}`); return r.json; };
const files = (w) => Object.keys(w.world.files).length;

test('off by default: only status answers, and only the owner can turn it on', async () => {
  const w = await setup({ on: false });
  assert.deepEqual(await w.ok('ann', 'recipesStatus', F()), { ok: true, enabled: false, canTurnOn: false });
  assert.equal((await w.ok('owner', 'recipesStatus', F())).canTurnOn, true);
  for (const a of ['recipesMine', 'recipesLibrary']) await call404(w, 'ann', a, F());
  await call404(w, 'ann', 'recipesPublish', pub(draft()));
  await w.fail('ann', 'recipesSetEnabled', F({ enabled: true }), 403);
  await w.fail('tia', 'recipesSetEnabled', F({ enabled: true }), 403);   // a tree admin is not the owner
  await w.ok('owner', 'recipesSetEnabled', F({ enabled: true }));
  assert.equal((await w.ok('ann', 'recipesStatus', F())).enabled, true);
  await w.fail('zed', 'recipesStatus', F(), 403);   // famB's owner is no member of famA
});

test('publish stores only a text snapshot; family members read it, other families and non-members cannot', async () => {
  const w = await setup();
  const out = await w.ok('ann', 'recipesPublish', pub(draft()));
  const row = rows(w, 'recipePubs')[0];
  assert.deepEqual(row.$permissions, []);
  const stored = JSON.parse(row.data);
  for (const k of ['id', 'slug', 'fav', 'source', 'image']) assert.equal(k in stored, false, k);
  assert.equal(row.sourceId, 'book-1'); assert.equal(row.hash, out.hash);
  const lib = await w.ok('sam', 'recipesLibrary', F());
  assert.equal(lib.recipes.length, 1); assert.equal(lib.recipes[0].name, 'Gran Bread'); assert.equal(lib.recipes[0].mine, false);
  assert.equal((await w.ok('ann', 'recipesLibrary', F())).recipes[0].mine, true);
  const got = await w.ok('sam', 'recipesGet', F({ id: out.id }));
  assert.equal(got.recipe.name, 'Gran Bread'); assert.equal(got.recipe.authorName, 'Name ann');
  await w.fail('zed', 'recipesLibrary', F(), 403);
  await w.fail('zed', 'recipesGet', F({ id: out.id }), 403);
  await w.ok('zed', 'recipesSetEnabled', { familyId: 'famB', enabled: true });
  await call404(w, 'zed', 'recipesGet', { familyId: 'famB', id: out.id });   // another family's id answers like a missing one
  assert.deepEqual(await call404(w, 'sam', 'recipesGet', F({ id: 'nope' })), await call404(w, 'zed', 'recipesGet', { familyId: 'famB', id: out.id }));
});

test('mine lists only my own published recipes; search is by title; the library is sorted', async () => {
  const w = await setup();
  await w.ok('ann', 'recipesPublish', pub(draft()));
  await w.ok('sam', 'recipesPublish', pub(draft({ id: 'book-2', name: 'Apple Pie' })));
  assert.deepEqual((await w.ok('ann', 'recipesMine', F())).pubs.map((p) => p.sourceSlug), ['book-1']);
  assert.deepEqual((await w.ok('tia', 'recipesMine', F())).pubs, []);
  assert.deepEqual((await w.ok('tia', 'recipesLibrary', F())).recipes.map((r) => r.name), ['Apple Pie', 'Gran Bread']);
  assert.deepEqual((await w.ok('tia', 'recipesLibrary', F({ q: 'gran' }))).recipes.map((r) => r.name), ['Gran Bread']);
});

test('owner, tree admin and other members get no right to edit or unpublish what someone else published', async () => {
  const w = await setup();
  const { id } = await w.ok('ann', 'recipesPublish', pub(draft()));
  for (const u of ['owner', 'tia', 'sam']) {
    await call404(w, u, 'recipesUpdate', F({ id, draft: draft({ name: 'Hijack' }), imageKey: '' }));
    await call404(w, u, 'recipesUnpublish', F({ id }));
  }
  assert.equal(JSON.parse(rows(w, 'recipePubs')[0].data).name, 'Gran Bread');
});

test('a duplicate publish and a bad recipe are refused with plain messages', async () => {
  const w = await setup();
  await w.ok('ann', 'recipesPublish', pub(draft()));
  await w.fail('ann', 'recipesPublish', pub(draft()), 409, 'exists');
  await w.fail('ann', 'recipesPublish', pub(draft({ id: 'b2', name: '' })), 400, 'invalid');
  await w.fail('ann', 'recipesPublish', pub(draft({ id: 'b3', ingredients: [] })), 400, 'invalid');
  const big = { name: 'P', ingredients: Array.from({ length: 60 }, () => 'y'.repeat(160)), steps: Array.from({ length: 40 }, () => 'x'.repeat(700)) };
  await w.fail('ann', 'recipesPublish', pub(draft({ id: 'b4', ...big, notes: 'n'.repeat(1500), parts: [big, big, big, big, big] })), 400, 'invalid');
  await w.fail('ann', 'recipesPublish', F({ draft: { name: 'No id', ingredients: ['a'], steps: ['b'] } }), 400);
  assert.equal(rows(w, 'recipePubs').length, 1);
});

test('photos: a square JPEG is kept apart in the bucket with a thumbnail; bad pictures are refused; update swaps it; unpublish deletes it', async () => {
  const w = await setup();
  const d = draft({ image: SQ });
  await w.fail('ann', 'recipesPublish', pub(d, { pics: { photo: WIDE, thumb: SQ }, imageKey: 'abc' }), 400, 'invalid');
  await w.fail('ann', 'recipesPublish', pub(d, { pics: { photo: SQ, thumb: WIDE }, imageKey: 'abc' }), 400, 'invalid');
  await w.fail('ann', 'recipesPublish', pub(d, { pics: { photo: 'data:image/png;base64,AAAA', thumb: SQ }, imageKey: 'abc' }), 400);
  await w.fail('ann', 'recipesPublish', pub(d, { imageKey: 'abc' }), 400, 'invalid');   // a photo but no pictures sent
  assert.equal(files(w), 0);
  const { id } = await w.ok('ann', 'recipesPublish', pub(d, { pics: { photo: SQ, thumb: SQ }, imageKey: 'abc' }));
  assert.equal(files(w), 1);
  const row = rows(w, 'recipePubs')[0];
  assert.deepEqual(w.world.files[row.photoId].$permissions, []);
  assert.equal((await w.ok('sam', 'recipesLibrary', F())).recipes[0].thumb, SQ);
  assert.equal((await w.ok('sam', 'recipesGet', F({ id }))).recipe.image, SQ);
  const first = row.photoId;
  await w.ok('ann', 'recipesUpdate', pub(draft({ image: SQ, name: 'Gran Bread 2' }), { id, pics: { photo: SQ, thumb: SQ }, imageKey: 'def' }));
  assert.equal(files(w), 1); assert.notEqual(rows(w, 'recipePubs')[0].photoId, first);
  await w.ok('ann', 'recipesUpdate', pub(draft({ name: 'No photo now' }), { id }));
  assert.equal(files(w), 0); assert.equal(rows(w, 'recipePubs')[0].thumb, '');
  assert.equal((await w.ok('sam', 'recipesGet', F({ id }))).recipe.image, '');
  await w.ok('ann', 'recipesUpdate', pub(d, { id, pics: { photo: SQ, thumb: SQ }, imageKey: 'abc' }));
  await w.ok('ann', 'recipesUnpublish', F({ id }));
  assert.equal(files(w), 0); assert.equal(rows(w, 'recipePubs').length, 0);
  await call404(w, 'sam', 'recipesGet', F({ id }));
});

test('update changes what the family sees and bumps the version; the hash follows the text', async () => {
  const w = await setup();
  const a = await w.ok('ann', 'recipesPublish', pub(draft()));
  const b = await w.ok('ann', 'recipesUpdate', pub(draft({ name: 'Gran Bread v2' }), { id: a.id }));
  assert.equal(b.version, 2); assert.notEqual(a.hash, b.hash);
  assert.equal((await w.ok('sam', 'recipesLibrary', F())).recipes[0].name, 'Gran Bread v2');
  assert.equal((await w.ok('ann', 'recipesMine', F())).pubs[0].hash, b.hash);
});

test('a removed author is hidden at once, stays hidden after re-invite, and can publish again fresh', async () => {
  const w = await setup();
  const { id } = await w.ok('ann', 'recipesPublish', pub(draft({ image: SQ }), { pics: { photo: SQ, thumb: SQ }, imageKey: 'abc' }));
  w.removeMember('famA', 'ann');
  assert.equal((await w.ok('sam', 'recipesLibrary', F())).recipes.length, 0);
  await call404(w, 'sam', 'recipesGet', F({ id }));
  assert.ok(rows(w, 'recipePubs')[0].hiddenAt);
  w.reinvite('famA', 'ann');
  assert.equal((await w.ok('sam', 'recipesLibrary', F())).recipes.length, 0);
  await call404(w, 'sam', 'recipesGet', F({ id }));
  assert.deepEqual((await w.ok('ann', 'recipesMine', F())).pubs, []);   // not hers any more
  await call404(w, 'ann', 'recipesUpdate', F({ id, draft: draft(), imageKey: '' }));
  await call404(w, 'ann', 'recipesUnpublish', F({ id }));
  const again = await w.ok('ann', 'recipesPublish', pub(draft({ name: 'Fresh' })));   // clears the stale row, nothing revived
  assert.equal(rows(w, 'recipePubs').length, 1); assert.notEqual(again.id, id);
  assert.equal((await w.ok('sam', 'recipesLibrary', F())).recipes[0].name, 'Fresh');
  assert.equal(files(w), 0);
});

test('the scheduled sweep deletes rows hidden for 30 days, with their photo', async () => {
  const w = await setup();
  await w.ok('ann', 'recipesPublish', pub(draft({ image: SQ }), { pics: { photo: SQ, thumb: SQ }, imageKey: 'abc' }));
  await w.ok('sam', 'recipesPublish', pub(draft({ id: 'book-2', name: 'Keep me' })));
  w.removeMember('famA', 'ann');
  await w.ok('sam', 'recipesLibrary', F());   // stamps hiddenAt
  w.world.bump(29 * DAY); await sweep(w);
  assert.equal(rows(w, 'recipePubs').length, 2);
  w.world.bump(2 * DAY);
  const out = await sweep(w);
  assert.equal(out.json.recipesPurged, 1);
  assert.deepEqual(rows(w, 'recipePubs').map((x) => x.sourceId), ['book-2']);
  assert.equal(files(w), 0);
});

test('deleting the family removes its recipes, photos and switch', async () => {
  const w = await setup();
  await w.ok('ann', 'recipesPublish', pub(draft({ image: SQ }), { pics: { photo: SQ, thumb: SQ }, imageKey: 'abc' }));
  let r; do { r = await w.ok('owner', 'deleteFamily', F()); } while (!r.done);
  assert.equal(rows(w, 'recipePubs').length, 0); assert.equal(rows(w, 'recipeState').length, 0); assert.equal(files(w), 0);
});

test('the rules match the preview: same answers for snapshots, hashes, validation and who may read or author', async () => {
  const M = await import('../src/recipes-rules.js');
  const C = createRequire(import.meta.url)('../../recipes-pub-core.js');
  const drafts = [draft(), draft({ name: '  Spaced  ', tags: ['a', 'b'], parts: [{ name: 'Sub', ingredients: ['x'], steps: ['y'] }] }), draft({ ingredients: [] }), draft({ name: '' }), draft({ image: SQ })];
  for (const d of drafts) {
    assert.deepEqual(M.snapshotOf(d), C.snapshotOf(d));
    assert.equal(M.imageKeyOf(d), C.imageKeyOf(d));
    for (const pics of [null, { photo: SQ, thumb: SQ }, { photo: WIDE, thumb: SQ }]) assert.deepEqual(M.validate(d, pics, 'abc'), C.validate(d, pics, 'abc'));
    const pb = { hash: C.hashOf(C.snapshotOf(d), C.imageKeyOf(d)) };
    assert.equal(M.stateOf(d, pb), C.stateOf(d, pb)); assert.equal(M.stateOf(d, { hash: 'x.y' }), C.stateOf(d, { hash: 'x.y' }));
  }
  assert.deepEqual(M.LIMITS, C.LIMITS);
  const mem = { active: true, familyId: 'f', userId: 'u', membershipId: 'm1' };
  const row = { familyId: 'f', status: 'published', hiddenAt: null, authorId: 'u', authorMembershipId: 'm1' };
  for (const [m, r, a] of [[mem, row, mem], [mem, row, { ...mem, membershipId: 'm2' }], [mem, { ...row, hiddenAt: 'x' }, mem], [mem, { ...row, familyId: 'g' }, mem], [{ ...mem, active: false }, row, mem], [mem, row, null]]) {
    assert.equal(M.canRead(m, r, a), C.canRead(m, r, a)); assert.equal(M.canAuthor(m, r), C.canAuthor(m, r));
  }
});

const book = (o = {}) => ({ id: 'bk-1', name: 'Family Favourites', settings: { title: 'Family Favourites', author: 'Ann', intro: 'Our best.', dedication: 'For Gran.' },
  sections: [{ id: 's1', title: 'Breads', items: ['gran'] }, { id: 's2', title: '', items: ['stew'] }],
  snap: { gran: { slug: 'gran', name: 'Gran Bread', ingredients: ['500 g flour'], steps: ['Bake.'], image: 'data:x', fav: true }, stew: { slug: 'stew', name: 'Stew', ingredients: ['beef'], steps: ['Simmer.'], parts: ['gravy'] } },
  extras: { gravy: { slug: 'gravy', name: 'Gravy', ingredients: ['stock'], steps: ['Whisk.'] } }, ...o });
const bpub = (b, o = {}) => F({ book: b, ...o });

test('cookbooks: off until sharing is on; then publish stores a text snapshot with sub-recipes copied in and no photo or private fields', async () => {
  const w = await setup({ on: false });
  await call404(w, 'ann', 'recipesBookPublish', bpub(book()));
  await w.ok('owner', 'recipesSetEnabled', F({ enabled: true }));
  const out = await w.ok('ann', 'recipesBookPublish', bpub(book()));
  const row = rows(w, 'recipeBooks')[0];
  assert.deepEqual(row.$permissions, []); assert.equal(row.count, 2);
  const d = JSON.parse(row.data);
  assert.equal(d.name, 'Family Favourites'); assert.equal(d.sections.length, 2); assert.equal(d.sections[1].recipes[0].parts[0].name, 'Gravy');
  assert.equal(JSON.stringify(d).includes('data:x'), false); assert.equal('fav' in d.sections[0].recipes[0], false);
  const lib = await w.ok('sam', 'recipesBookLibrary', F());
  assert.equal(lib.books.length, 1); assert.equal(lib.books[0].count, 2); assert.equal(lib.books[0].mine, false);
  const got = await w.ok('sam', 'recipesBookGet', F({ id: out.id }));
  assert.equal(got.book.sections[0].recipes[0].name, 'Gran Bread'); assert.equal(got.book.authorName, 'Name ann');
  assert.deepEqual((await w.ok('ann', 'recipesBookMine', F())).pubs.map((p) => p.sourceSlug), ['bk-1']);
  assert.deepEqual((await w.ok('sam', 'recipesBookMine', F())).pubs, []);
  await w.fail('zed', 'recipesBookLibrary', F(), 403);
});

test('cookbooks: only the author updates or unpublishes; update bumps the version; duplicates and bad books are refused', async () => {
  const w = await setup();
  const a = await w.ok('ann', 'recipesBookPublish', bpub(book()));
  for (const u of ['owner', 'tia', 'sam']) { await call404(w, u, 'recipesBookUpdate', F({ id: a.id, book: book({ name: 'Hijack', settings: { title: 'Hijack' } }) })); await call404(w, u, 'recipesBookUnpublish', F({ id: a.id })); }
  await w.fail('ann', 'recipesBookPublish', bpub(book()), 409, 'exists');
  await w.fail('ann', 'recipesBookPublish', bpub(book({ id: 'b2', settings: {}, name: '' })), 400, 'invalid');
  await w.fail('ann', 'recipesBookPublish', bpub(book({ id: 'b3', sections: [{ items: [] }] })), 400, 'invalid');
  const many = {}; const items = []; for (let i = 0; i < 26; i++) { many['r' + i] = { name: 'R' + i, ingredients: ['x'], steps: ['y'] }; items.push('r' + i); }
  await w.fail('ann', 'recipesBookPublish', bpub(book({ id: 'b4', sections: [{ items }], snap: many })), 400, 'invalid');
  const b = await w.ok('ann', 'recipesBookUpdate', F({ id: a.id, book: book({ settings: { title: 'Family Favourites 2', author: 'Ann' } }) }));
  assert.equal(b.version, 2); assert.notEqual(b.hash, a.hash);
  assert.equal((await w.ok('sam', 'recipesBookLibrary', F())).books[0].name, 'Family Favourites 2');
  await w.ok('ann', 'recipesBookUnpublish', F({ id: a.id }));
  assert.equal(rows(w, 'recipeBooks').length, 0); await call404(w, 'sam', 'recipesBookGet', F({ id: a.id }));
});

test('cookbooks: a removed author is hidden at once, stays hidden after re-invite, is swept after 30 days; deleting the family removes them', async () => {
  const w = await setup();
  const { id } = await w.ok('ann', 'recipesBookPublish', bpub(book()));
  w.removeMember('famA', 'ann');
  assert.equal((await w.ok('sam', 'recipesBookLibrary', F())).books.length, 0);
  await call404(w, 'sam', 'recipesBookGet', F({ id }));
  w.reinvite('famA', 'ann');
  await call404(w, 'sam', 'recipesBookGet', F({ id })); assert.deepEqual((await w.ok('ann', 'recipesBookMine', F())).pubs, []);
  w.world.bump(31 * DAY); const out = await sweep(w);
  assert.equal(out.json.recipesPurged, 1); assert.equal(rows(w, 'recipeBooks').length, 0);
  await w.ok('ann', 'recipesBookPublish', bpub(book()));
  let r; do { r = await w.ok('owner', 'deleteFamily', F()); } while (!r.done);
  assert.equal(rows(w, 'recipeBooks').length, 0);
});

test('the cookbook rules match the preview', async () => {
  const M = await import('../src/recipes-rules.js');
  const C = createRequire(import.meta.url)('../../recipes-pub-core.js');
  for (const b of [book(), book({ settings: {} , name: '' }), book({ sections: [] }), book({ sections: [{ title: 'x'.repeat(200), items: ['gran', 'missing'] }] })]) {
    assert.deepEqual(M.bookSnapshotOf(b), C.bookSnapshotOf(b)); assert.deepEqual(M.validateBook(b), C.validateBook(b));
    assert.equal(M.bookStateOf(b, { hash: 'x' }), C.bookStateOf(b, { hash: 'x' })); assert.equal(M.bookStateOf(b, null), 'private');
  }
});
