import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, TABLES } from '../src/logic.js';
import { CHAT_TABLES } from '../src/chat.js';
import { BOARD_TABLES, nextCopy, shiftDate } from '../src/board.js';
const EXTRA_CFG = {};   // tests put stand-ins for the outside world here (link preview fetcher, GIF service)

/* ---------- in-memory fake of the server services (queries, unique keys, permissions) ---------- */
function makeWorld() {
  let seq = 0;
  const world = { tables: {}, teams: {}, clock: 1_800_000_000_000 };
  world.files = {};
  world.storage = {
    async getFile({ fileId }) { const f = world.files[fileId]; if (!f) { const e = new Error('nf'); e.code = 404; throw e; } return f; },
    async updateFile({ fileId, permissions }) { world.files[fileId].$permissions = permissions; return world.files[fileId]; },
    async deleteFile({ fileId }) { delete world.files[fileId]; },
  };
  for (const t of [...Object.values(TABLES), ...Object.values(CHAT_TABLES), ...Object.values(BOARD_TABLES)]) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });
  const UNIQUE = ['sendKey', 'channelKey', 'dmKey', 'reactionKey', 'blockKey', 'readKey', 'profileKey'];
  const match = (r, q) => {
    switch (q.method) {
      case 'equal': return q.values.includes(q.attribute === '$id' ? r.$id : r[q.attribute]);
      case 'notEqual': return !q.values.includes(r[q.attribute]);
      case 'greaterThan': return String(r[q.attribute]) > String(q.values[0]);
      case 'lessThan': return String(r[q.attribute]) < String(q.values[0]);
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
const rows = (w, t) => [...w.world.tables[t].values()];
async function setup() {
  const w = makeWorld();
  await w.addFamily('famA', 'owner', ['ann', 'bob']);
  await w.addFamily('famB', 'zed', ['yan']);
  return w;
}
const task = (o) => ({ title: 'Dishes', due: '2026-12-01', ...o });

test('repeat dates: month ends clamp, past dates roll forward, long tasks keep their length', () => {
  assert.equal(shiftDate('2026-01-31', 'm1'), '2026-02-28');
  assert.equal(shiftDate('2026-12-31', 'm2'), '2027-02-28');
  assert.equal(shiftDate('2026-03-01', 'w2'), '2026-03-15');
  assert.equal(nextCopy({ due: '2026-01-01', repeat: 'd1' }, '2026-01-10').due, '2026-01-10');
  const n = nextCopy({ start: '2026-01-01', due: '2026-01-03', repeat: 'w1' }, '2026-01-05');
  assert.deepEqual(n, { due: '2026-01-10', start: '2026-01-08' });
  assert.equal(nextCopy({ due: '2026-01-01', repeat: '' }, '2026-01-02'), null);
});

test('board tables hold no client permissions and other families cannot be reached', async () => {
  const w = await setup();
  const t = (await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({}) })).task;
  for (const r of rows(w, BOARD_TABLES.tasks)) assert.deepEqual(r.$permissions, []);
  await w.fail('yan', 'boardLoad', { familyId: 'famA' }, 403);
  await w.fail('zed', 'boardTaskComplete', { familyId: 'famA', taskId: t.id }, 403);
  await w.fail('zed', 'boardTaskComplete', { familyId: 'famB', taskId: t.id }, 404);
  const load = await w.ok('bob', 'boardLoad', { familyId: 'famA' });
  assert.equal(load.tasks.length, 1);
  assert.equal(load.me.manager, false);
  assert.equal((await w.ok('owner', 'boardLoad', { familyId: 'famA' })).me.manager, true);
});

test('task validation: dates, assignees from this family only, steps, repeat', async () => {
  const w = await setup();
  const f = (t) => w.fail('ann', 'boardTaskSave', { familyId: 'famA', task: t }, 400);
  await f(task({ title: '' }));
  await f(task({ due: '2026-02-30' }));
  await f(task({ time: '9am' }));
  await f(task({ due: '', time: '09:00' }));
  await f(task({ start: '2026-12-05' }));
  await f(task({ repeat: 'x9' }));
  await f(task({ perDay: 7, start: '2026-11-28' }));
  await f(task({ assigneeIds: ['yan'] }));
  await f(task({ groupId: 'nope' }));
  const ok = (await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({ assigneeIds: ['bob'], steps: [{ text: ' wash ' }, { text: '' }], time: '09:30', start: '2026-11-28', perDay: 60 }) })).task;
  assert.equal(ok.steps.length, 1);
  assert.equal(ok.steps[0].text, 'wash');
  assert.equal(ok.createdBy, 'ann');
  assert.equal(ok.history[0].actorName, 'ann');
});

test('completing: server writes who did it, makes the next repeat once, notifies others, undo works', async () => {
  const w = await setup();
  const t = (await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({ assigneeIds: ['bob'], repeat: 'w1' }) })).task;
  const done = await w.ok('bob', 'boardTaskComplete', { familyId: 'famA', taskId: t.id, today: '2026-12-01', completedBy: 'ann', completedByName: 'Fake' });
  assert.equal(done.task.status, 'complete');
  assert.equal(done.task.completedBy, 'bob');
  assert.equal(done.task.completedByName, 'bob');
  assert.equal(done.next.due, '2026-12-08');
  await w.ok('bob', 'boardTaskComplete', { familyId: 'famA', taskId: t.id, today: '2026-12-01' });
  assert.equal(rows(w, BOARD_TABLES.tasks).length, 2, 'second tick makes no extra copy');
  const notes = (await w.ok('ann', 'boardLoad', { familyId: 'famA' })).notes;
  assert.ok(notes.some((n) => n.kind === 'completed' && n.actorName === 'bob'));
  assert.ok(!(await w.ok('bob', 'boardLoad', { familyId: 'famA' })).notes.some((n) => n.kind === 'completed'), 'nobody is told about their own action');
  const back = await w.ok('bob', 'boardTaskComplete', { familyId: 'famA', taskId: t.id, done: false });
  assert.equal(back.task.status, 'open');
  assert.equal(back.task.completedBy, '');
});

test('steps, moving between groups, and deleting: creator or manager only', async () => {
  const w = await setup();
  const g = (await w.ok('owner', 'boardGroupSave', { familyId: 'famA', group: { name: 'Chores', color: '#112233' } })).group;
  const t = (await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({ steps: [{ id: 's1', text: 'one' }] }) })).task;
  assert.equal((await w.ok('bob', 'boardStep', { familyId: 'famA', taskId: t.id, stepId: 's1', done: true })).task.steps[0].done, true);
  await w.fail('bob', 'boardStep', { familyId: 'famA', taskId: t.id, stepId: 'zz', done: true }, 404);
  assert.equal((await w.ok('bob', 'boardTaskMove', { familyId: 'famA', taskId: t.id, groupId: g.id })).task.groupId, g.id);
  await w.fail('bob', 'boardTaskMove', { familyId: 'famA', taskId: t.id, groupId: 'nope' }, 400);
  await w.fail('bob', 'boardTaskDelete', { familyId: 'famA', taskId: t.id }, 403);
  await w.ok('ann', 'boardTaskDelete', { familyId: 'famA', taskId: t.id });
  const t2 = (await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({}) })).task;
  await w.ok('owner', 'boardTaskDelete', { familyId: 'famA', taskId: t2.id });
  assert.equal(rows(w, BOARD_TABLES.tasks).length, 0);
});

test('groups are manager only; deleting a group can keep or delete its tasks', async () => {
  const w = await setup();
  await w.fail('ann', 'boardGroupSave', { familyId: 'famA', group: { name: 'X' } }, 403);
  const g = (await w.ok('owner', 'boardGroupSave', { familyId: 'famA', group: { name: 'School' } })).group;
  const t = (await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({ groupId: g.id }) })).task;
  const r = await w.ok('owner', 'boardGroupDelete', { familyId: 'famA', groupId: g.id, mode: 'keep' });
  assert.equal(r.tasks, 1);
  assert.equal((await w.ok('ann', 'boardLoad', { familyId: 'famA' })).tasks.find((x) => x.id === t.id).groupId, '');
  const g2 = (await w.ok('owner', 'boardGroupSave', { familyId: 'famA', group: { name: 'Two' } })).group;
  await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({ groupId: g2.id }) });
  await w.ok('owner', 'boardGroupDelete', { familyId: 'famA', groupId: g2.id, mode: 'delete' });
  assert.equal(rows(w, BOARD_TABLES.tasks).length, 1);
});

test('shopping list: low, bought, link must be http(s), any member may use it', async () => {
  const w = await setup();
  await w.fail('ann', 'boardProductSave', { familyId: 'famA', product: { name: 'Milk', url: 'javascript:alert(1)' } }, 400);
  const p = (await w.ok('ann', 'boardProductSave', { familyId: 'famA', product: { name: 'Milk', url: 'https://shop.example/milk', cat: 'Dairy' } })).product;
  await w.fail('ann', 'boardProductLow', { familyId: 'famA', productId: p.id, qty: -1 }, 400);
  const low = (await w.ok('ann', 'boardProductLow', { familyId: 'famA', productId: p.id, qty: 1, opened: true, goneBy: '2026-12-05' })).product;
  assert.equal(low.low, true);
  assert.equal(low.by, 'ann');
  assert.ok((await w.ok('bob', 'boardLoad', { familyId: 'famA' })).notes.some((n) => n.kind === 'low'));
  assert.equal((await w.ok('bob', 'boardProductBought', { familyId: 'famA', productId: p.id })).product.low, false);
  await w.ok('bob', 'boardProductDelete', { familyId: 'famA', productId: p.id });
  assert.equal(rows(w, BOARD_TABLES.products).length, 0);
});

test('requests: members ask, managers decide, the asker hears back', async () => {
  const w = await setup();
  await w.fail('owner', 'boardRequest', { familyId: 'famA', kind: 'newGroup', name: 'X' }, 400);
  await w.fail('ann', 'boardRequest', { familyId: 'famA', kind: 'wipe' }, 400);
  const rq = (await w.ok('ann', 'boardRequest', { familyId: 'famA', kind: 'newGroup', name: 'Pets', color: '#445566' })).request;
  await w.fail('bob', 'boardDecide', { familyId: 'famA', requestId: rq.id, decision: 'approve' }, 403);
  assert.equal((await w.ok('bob', 'boardLoad', { familyId: 'famA' })).requests.length, 0, 'other members do not see it');
  assert.ok((await w.ok('owner', 'boardLoad', { familyId: 'famA' })).notes.some((n) => n.kind === 'request'));
  await w.ok('owner', 'boardDecide', { familyId: 'famA', requestId: rq.id, decision: 'approve' });
  assert.equal(rows(w, BOARD_TABLES.groups).length, 1);
  await w.fail('owner', 'boardDecide', { familyId: 'famA', requestId: rq.id, decision: 'reject' }, 409);
  assert.ok((await w.ok('ann', 'boardLoad', { familyId: 'famA' })).notes.some((n) => n.kind === 'request_result' && n.outcome === 'approved'));
  const t = (await w.ok('bob', 'boardTaskSave', { familyId: 'famA', task: task({}) })).task;
  const del = (await w.ok('ann', 'boardRequest', { familyId: 'famA', kind: 'deleteTask', taskId: t.id })).request;
  await w.ok('owner', 'boardDecide', { familyId: 'famA', requestId: del.id, decision: 'reject' });
  assert.equal(rows(w, BOARD_TABLES.tasks).length, 1, 'rejected: task stays');
});

test('the bell marks notes read', async () => {
  const w = await setup();
  await w.ok('ann', 'boardTaskSave', { familyId: 'famA', task: task({ assigneeIds: ['bob'] }) });
  assert.equal((await w.ok('bob', 'boardLoad', { familyId: 'famA' })).notes.filter((n) => !n.read).length, 1);
  assert.equal((await w.ok('bob', 'boardNotesRead', { familyId: 'famA' })).marked, 1);
  assert.equal((await w.ok('bob', 'boardLoad', { familyId: 'famA' })).notes.filter((n) => !n.read).length, 0);
});
