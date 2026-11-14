/*
 * Family calendar, chores and shopping list ("board"). All trusted logic lives here and runs inside family-api.
 * Ported from the Family Board in the ZenfulOutput project (also by Leia), rebuilt on Family Circle's own accounts.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 *
 * Trust model (same as logic.js and chat.js)
 *  - `user` is the account Appwrite verified from the caller's own JWT. Names on "checked off by" and on the
 *    activity history are looked up here from that account's profile; no body field can set them.
 *  - The five board tables have NO client permission at all: every read and write goes through an action below,
 *    which first checks the caller is a confirmed member of the family.
 *  - Managers are family owners and tree admins. Members add and finish tasks and shop items; deleting someone
 *    else's task, and groups, need a manager, so a member asks and a manager accepts, rejects or ignores.
 */
import { Query, ID } from 'node-appwrite';

export const BOARD_TABLES = {
  tasks: 'boardTasks',        // familyId, due, status, data (JSON text)
  groups: 'boardGroups',      // familyId, data
  products: 'boardProducts',  // familyId, data
  requests: 'boardRequests',  // familyId, status, data
  notes: 'boardNotes'         // familyId, userId (the reader), read (bool), data
};

export const BOARD_LIMITS = { tasks: 1500, groups: 60, products: 300, steps: 30, history: 40, assignees: 20, span: 366, notesShown: 40 };
export const REPEATS = ['', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'w1', 'w2', 'm1', 'm2', 'm3', 'm6', 'y1', 'y2', 'y3', 'y4', 'y5', 'y10'];
export const PER_DAY = [0, 15, 30, 45, 60, 90, 120, 180, 240];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = 864e5;

const validYmd = (s) => { if (typeof s !== 'string' || !YMD_RE.test(s)) return false; const d = new Date(s + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };
const ymdAdd = (s, days) => new Date(new Date(s + 'T12:00:00Z').getTime() + days * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / DAY);

/** The date of a repeating task's next copy: shift by the repeat step until it is not in the past. */
export function shiftDate(s, code) {
  const n = Number(code.slice(1)), u = code[0];
  if (u === 'd' || u === 'w') return ymdAdd(s, n * (u === 'w' ? 7 : 1));
  const [y, m, d] = s.split('-').map(Number);
  const months = n * (u === 'y' ? 12 : 1);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
export function nextCopy(t, today) {
  if (!t.repeat || !REPEATS.includes(t.repeat) || !t.due) return null;
  let n = shiftDate(t.due, t.repeat), i = 0;
  while (n < today && i++ < 4000) n = shiftDate(n, t.repeat);
  const span = t.start && t.start < t.due ? daysBetween(t.start, t.due) : 0;
  return { due: n, start: span ? ymdAdd(n, -span) : '' };
}

export function createBoard({ teams, listRows, createRow, updateRow, deleteRow, getRowOrNull, firstRow, requireMember, idOf, textOf, bad, forbidden, missing, ApiError, sdkCode, now, profilesTable }) {
  const T = BOARD_TABLES;
  const iso = () => new Date(now()).toISOString();
  const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

  async function all(tableId, familyId, max) {
    const out = [];
    let cursor = null;
    while (out.length < max) {
      const q = [Query.equal('familyId', [familyId]), Query.limit(100)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await listRows(tableId, q);
      out.push(...page.rows);
      if (page.rows.length < 100) break;
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return out;
  }

  /* ---------- who is who ---------- */
  async function membersOf(familyId) {
    const res = await teams.listMemberships({ teamId: familyId, queries: [Query.limit(100)] });
    const joined = res.memberships.filter((m) => m.confirm === true);
    const profs = await all(profilesTable, familyId, 400);
    const by = new Map(profs.map((p) => [p.userId, p]));
    return joined.map((m) => {
      const p = by.get(m.userId);
      return { userId: m.userId, name: (p && p.displayName) || m.userName || 'Family member', avatarFileId: (p && p.avatarFileId) || '', owner: Array.isArray(m.roles) && m.roles.includes('owner'), treeAdmin: !!(p && p.treeAdmin) };
    });
  }
  async function context(user, familyIdRaw) {
    const ctx = await requireMember(user, familyIdRaw);
    const members = await membersOf(ctx.familyId);
    const mine = members.find((m) => m.userId === user.$id) || { userId: user.$id, name: 'Someone', owner: ctx.isOwner, treeAdmin: false };
    return { ...ctx, members, me: mine, manager: ctx.isOwner || mine.treeAdmin, names: new Map(members.map((m) => [m.userId, m.name])) };
  }
  const nameOf = (c, id) => c.names.get(id) || 'Someone';
  const namesOf = (c, ids) => (ids.length ? ids.map((i) => nameOf(c, i)).join(', ') : 'Unassigned');
  const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  /* ---------- shapes ---------- */
  const taskOut = (r) => { const d = parse(r.data); return { id: r.$id, ...d, due: r.due || '', status: r.status || 'open' }; };
  const groupOut = (r) => ({ id: r.$id, ...parse(r.data) });
  const productOut = (r) => ({ id: r.$id, ...parse(r.data) });
  const ev = (c, type, extra) => ({ id: ID.unique(), type, at: iso(), actorId: c.me.userId, actorName: c.me.name, ...extra });
  const pushHist = (d, e) => { d.history = [...(d.history || []), e].slice(-BOARD_LIMITS.history); };

  function cleanSteps(a, old) {
    const prev = new Map((old || []).map((s) => [s.id, s]));
    return (Array.isArray(a) ? a : []).filter((s) => s && typeof s.text === 'string' && s.text.trim()).slice(0, BOARD_LIMITS.steps).map((s) => {
      const id = typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.id) ? s.id : ID.unique();
      return { id, text: s.text.trim().slice(0, 120), done: prev.has(id) ? !!prev.get(id).done : !!s.done };
    });
  }

  /** Validates a task form. Returns the editable fields (never anything about who finished it). */
  function cleanTask(c, b, groupIds) {
    const title = textOf(typeof b.title === 'string' ? b.title : '', 'Title', { min: 1, max: 120 });
    const due = b.due ? (validYmd(b.due) ? b.due : (() => { throw bad('That due date is not valid.'); })()) : '';
    const time = b.time ? (TIME_RE.test(b.time) ? b.time : (() => { throw bad('That time is not valid.'); })()) : '';
    if (time && !due) throw bad('Add a due date to use a due time.');
    let start = b.start || '';
    if (start && !validYmd(start)) throw bad('That start date is not valid.');
    if (start && !due) throw bad('Add a due date too. A long task runs from the start date to the due date.');
    if (start && start > due) throw bad('The start date has to be on or before the due date.');
    if (start && daysBetween(start, due) >= BOARD_LIMITS.span) throw bad('A long task can run for up to ' + BOARD_LIMITS.span + ' days.');
    if (start === due) start = '';
    const repeat = b.repeat || '';
    if (repeat && !REPEATS.includes(repeat)) throw bad('Pick one of the repeat choices.');
    if (repeat && !due) throw bad('Add a due date to repeat a task. The next one is based on it.');
    const perDay = Number(b.perDay) || 0;
    if (!PER_DAY.includes(perDay)) throw bad('That time per day is not one of the choices.');
    if (perDay && !start) throw bad('Time per day is for long tasks. Add a start date, or set it back to Not set.');
    const ids = [...new Set(Array.isArray(b.assigneeIds) ? b.assigneeIds.filter((x) => typeof x === 'string') : [])];
    if (ids.length > BOARD_LIMITS.assignees) throw bad('A task can have up to ' + BOARD_LIMITS.assignees + ' people.');
    for (const id of ids) if (!c.names.has(id)) throw bad('You can only assign a task to someone in this family.');
    const groupId = typeof b.groupId === 'string' ? b.groupId : '';
    if (groupId && !groupIds.has(groupId)) throw bad('That group does not exist.');
    return {
      title, due, time, start, perDay, repeat, assigneeIds: ids, groupId,
      special: !!b.special && !!due,
      description: textOf(typeof b.description === 'string' ? b.description : '', 'Description', { max: 2000 })
    };
  }

  /* ---------- notes (the bell) ---------- */
  async function note(c, userId, kind, data) {
    if (userId === c.me.userId) return;   // nobody is told about their own action
    await createRow(T.notes, ID.unique(), { familyId: c.familyId, userId, read: false, data: JSON.stringify({ kind, actorId: c.me.userId, actorName: c.me.name, ...data }) }, []);
  }
  const noteAll = async (c, kind, data, only) => { for (const m of c.members) if (!only || only(m)) await note(c, m.userId, kind, data); };

  async function groupIdSet(familyId) { return new Set((await all(T.groups, familyId, BOARD_LIMITS.groups)).map((r) => r.$id)); }
  async function taskRow(c, id) {
    const r = await getRowOrNull(T.tasks, idOf(id, 'taskId'));
    if (!r || r.familyId !== c.familyId) throw missing('That task does not exist.');
    return r;
  }
  const saveTask = (r, d, extra) => updateRow(T.tasks, r.$id, { data: JSON.stringify(d), ...extra });

  const actions = {
    /** One call that returns everything the calendar page needs. */
    async boardLoad({ user, body }) {
      const c = await context(user, body.familyId);
      const [tasks, groups, products, reqs, notes] = await Promise.all([
        all(T.tasks, c.familyId, BOARD_LIMITS.tasks), all(T.groups, c.familyId, BOARD_LIMITS.groups), all(T.products, c.familyId, BOARD_LIMITS.products),
        all(T.requests, c.familyId, 200),
        listRows(T.notes, [Query.equal('familyId', [c.familyId]), Query.equal('userId', [user.$id]), Query.orderDesc('$createdAt'), Query.limit(BOARD_LIMITS.notesShown)])
      ]);
      const weekAgo = now() - 7 * DAY;
      const reqOut = reqs.map((r) => ({ id: r.$id, status: r.status, at: r.$createdAt, ...parse(r.data) }))
        .filter((r) => (c.manager || r.byId === user.$id)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
      return {
        me: { userId: user.$id, name: c.me.name, manager: c.manager },
        members: c.members.map((m) => ({ userId: m.userId, name: m.name, avatarFileId: m.avatarFileId, owner: m.owner })),
        tasks: tasks.map(taskOut), groups: groups.map(groupOut), products: products.map(productOut), requests: reqOut,
        notes: notes.rows.filter((n) => new Date(n.$createdAt).getTime() >= weekAgo).map((n) => ({ id: n.$id, read: !!n.read, at: n.$createdAt, ...parse(n.data) }))
      };
    },

    async boardTaskSave({ user, body }) {
      const c = await context(user, body.familyId);
      const t = body.task && typeof body.task === 'object' ? body.task : {};
      const groupIds = await groupIdSet(c.familyId);
      const f = cleanTask(c, t, groupIds);
      if (!t.id) {
        if ((await all(T.tasks, c.familyId, BOARD_LIMITS.tasks)).length >= BOARD_LIMITS.tasks) throw new ApiError(409, 'quota', 'This calendar is full. Delete old tasks first.');
        const d = { ...f, steps: cleanSteps(t.steps), completedBy: '', completedByName: '', completedForId: '', completedForName: '', completedAt: '', createdBy: user.$id, createdAt: iso(), history: [] };
        pushHist(d, ev(c, 'created', { assigneeName: f.assigneeIds.length ? namesOf(c, f.assigneeIds) : '' }));
        const row = await createRow(T.tasks, ID.unique(), { familyId: c.familyId, due: f.due, status: 'open', data: JSON.stringify(d) }, []);
        for (const id of f.assigneeIds) await note(c, id, 'assigned', { taskId: row.$id, title: f.title, due: f.due });
        return { task: taskOut({ ...row, data: JSON.stringify(d) }) };
      }
      const r = await taskRow(c, t.id), d = parse(r.data), changed = [];
      if (d.title !== f.title) changed.push('title');
      if ((d.description || '') !== f.description) changed.push('description');
      if ((r.due || '') !== f.due) changed.push('due date');
      if ((d.time || '') !== f.time) changed.push('due time');
      if (!!d.special !== f.special) changed.push('special occasion');
      if ((d.start || '') !== f.start) changed.push('start date');
      if ((d.perDay || 0) !== f.perDay) changed.push('time per day');
      if ((d.repeat || '') !== f.repeat) changed.push('repeat');
      const steps = cleanSteps(t.steps, d.steps);
      if (JSON.stringify((d.steps || []).map((s) => s.text)) !== JSON.stringify(steps.map((s) => s.text))) changed.push('steps');
      const was = Array.isArray(d.assigneeIds) ? d.assigneeIds : [];
      if (changed.length) pushHist(d, ev(c, 'edited', { fields: changed.join(', ') }));
      if (!sameIds(was, f.assigneeIds)) {
        pushHist(d, ev(c, 'assigned', { fromName: namesOf(c, was), toName: namesOf(c, f.assigneeIds) }));
        for (const id of f.assigneeIds.filter((x) => !was.includes(x))) await note(c, id, 'assigned', { taskId: r.$id, title: f.title, due: f.due });
      }
      if ((d.groupId || '') !== f.groupId) {
        const names = new Map((await all(T.groups, c.familyId, BOARD_LIMITS.groups)).map((g) => [g.$id, parse(g.data).name]));
        pushHist(d, ev(c, 'group', { fromName: names.get(d.groupId) || 'No group', toName: names.get(f.groupId) || 'No group' }));
      }
      Object.assign(d, f, { steps });
      await saveTask(r, d, { due: f.due });
      return { task: taskOut({ ...r, due: f.due, data: JSON.stringify(d) }) };
    },

    /** Tick or untick a task. The server writes who did it, from the caller's own sign-in. */
    async boardTaskComplete({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await taskRow(c, body.taskId), d = parse(r.data);
      const going = body.done !== false;
      const today = validYmd(body.today) ? body.today : iso().slice(0, 10);
      let created = null;
      if (going) {
        if (r.status === 'complete') return { task: taskOut(r) };
        const as = (d.assigneeIds || []).filter((i) => c.names.has(i));
        const forIds = as.length <= 1 ? as : as.filter((i) => i !== user.$id);
        Object.assign(d, { completedBy: user.$id, completedByName: c.me.name, completedAt: iso(), completedForId: forIds[0] || '', completedForName: forIds.map((i) => nameOf(c, i)).join(', ') });
        pushHist(d, ev(c, 'completed', { forName: d.completedForName }));
        const nx = nextCopy({ ...d, due: r.due }, today);
        if (nx) {
          const open = (await all(T.tasks, c.familyId, BOARD_LIMITS.tasks)).find((x) => x.$id !== r.$id && x.status !== 'complete' && x.due === nx.due && (() => { const o = parse(x.data); return o.title === d.title && o.repeat === d.repeat && sameIds(o.assigneeIds || [], d.assigneeIds || []); })());
          if (!open) {
            const nd = { ...d, start: nx.start, steps: (d.steps || []).map((s) => ({ id: ID.unique(), text: s.text, done: false })), completedBy: '', completedByName: '', completedForId: '', completedForName: '', completedAt: '', createdAt: iso(), history: [] };
            pushHist(nd, ev(c, 'created', { assigneeName: (d.assigneeIds || []).length ? namesOf(c, d.assigneeIds) : '' }));
            created = await createRow(T.tasks, ID.unique(), { familyId: c.familyId, due: nx.due, status: 'open', data: JSON.stringify(nd) }, []);
          }
        }
        await saveTask(r, d, { status: 'complete' });
        const who = new Set([...(d.assigneeIds || []), d.createdBy].filter(Boolean));
        for (const id of who) await note(c, id, 'completed', { taskId: r.$id, title: d.title, forName: d.completedForName });
        return { task: taskOut({ ...r, status: 'complete', data: JSON.stringify(d) }), next: created ? taskOut(created) : null };
      }
      if (r.status !== 'complete') return { task: taskOut(r) };
      pushHist(d, ev(c, 'reopened', { fromName: d.completedByName }));
      Object.assign(d, { completedBy: '', completedByName: '', completedForId: '', completedForName: '', completedAt: '' });
      await saveTask(r, d, { status: 'open' });
      return { task: taskOut({ ...r, status: 'open', data: JSON.stringify(d) }) };
    },

    async boardStep({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await taskRow(c, body.taskId), d = parse(r.data);
      const step = (d.steps || []).find((s) => s.id === body.stepId);
      if (!step) throw missing('That step does not exist.');
      step.done = !!body.done;
      await saveTask(r, d);
      return { task: taskOut({ ...r, data: JSON.stringify(d) }) };
    },

    async boardTaskMove({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await taskRow(c, body.taskId), d = parse(r.data);
      const to = body.groupId ? String(body.groupId) : '';
      const gids = await groupIdSet(c.familyId);
      if (to && !gids.has(to)) throw bad('That group does not exist.');
      if ((d.groupId || '') !== to) {
        const names = new Map((await all(T.groups, c.familyId, BOARD_LIMITS.groups)).map((g) => [g.$id, parse(g.data).name]));
        pushHist(d, ev(c, 'group', { fromName: names.get(d.groupId) || 'No group', toName: names.get(to) || 'No group' }));
        d.groupId = to;
        await saveTask(r, d);
      }
      return { task: taskOut({ ...r, data: JSON.stringify(d) }) };
    },

    async boardTaskDelete({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await taskRow(c, body.taskId), d = parse(r.data);
      if (!c.manager && d.createdBy !== user.$id) throw forbidden('Only the person who made this task, or an owner or admin, can delete it. You can ask them with a request.');
      await deleteRow(T.tasks, r.$id);
      return { deleted: true };
    },

    /* ---------- groups: managers only; members send a request ---------- */
    async boardGroupSave({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.manager) throw forbidden('Only an owner or admin can change groups. You can ask for one with a request.');
      return { group: await saveGroup(c, body.group || {}) };
    },
    async boardGroupDelete({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.manager) throw forbidden('Only an owner or admin can delete groups.');
      return deleteGroup(c, idOf(body.groupId, 'groupId'), body.mode === 'delete' ? 'delete' : 'keep');
    },

    /* ---------- shopping list ---------- */
    async boardProductSave({ user, body }) {
      const c = await context(user, body.familyId);
      const p = body.product || {};
      const name = textOf(typeof p.name === 'string' ? p.name : '', 'Product name', { min: 1, max: 80 });
      const url = httpUrl(p.url);
      if (p.url && String(p.url).trim() && !url) throw bad('The link must start with http:// or https://');
      const cat = String(p.cat || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (p.id) {
        const r = await getRowOrNull(T.products, idOf(p.id, 'id'));
        if (!r || r.familyId !== c.familyId) throw missing('That product does not exist.');
        const d = { ...parse(r.data), name, url, cat };
        await updateRow(T.products, r.$id, { data: JSON.stringify(d) });
        return { product: productOut({ ...r, data: JSON.stringify(d) }) };
      }
      if ((await all(T.products, c.familyId, BOARD_LIMITS.products)).length >= BOARD_LIMITS.products) throw new ApiError(409, 'quota', 'The shopping list is full.');
      const d = { name, url, cat, low: false, qty: 0, opened: false, goneBy: '', by: '', at: '' };
      const row = await createRow(T.products, ID.unique(), { familyId: c.familyId, data: JSON.stringify(d) }, []);
      return { product: productOut({ ...row, data: JSON.stringify(d) }) };
    },
    async boardProductLow({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await getRowOrNull(T.products, idOf(body.productId, 'productId'));
      if (!r || r.familyId !== c.familyId) throw missing('That product does not exist.');
      const qty = Number(body.qty);
      if (!Number.isInteger(qty) || qty < 0 || qty > 999) throw bad('Enter how many are left, from 0 to 999.');
      const goneBy = body.goneBy ? (validYmd(body.goneBy) ? body.goneBy : (() => { throw bad('That date is not valid.'); })()) : '';
      const d = { ...parse(r.data), low: true, qty, opened: !!body.opened, goneBy, by: c.me.name, at: iso() };
      await updateRow(T.products, r.$id, { data: JSON.stringify(d) });
      await noteAll(c, 'low', { title: d.name, outcome: `${qty} left${d.opened ? ', one opened' : ''}${goneBy ? ', gone by ' + goneBy : ''}` });
      return { product: productOut({ ...r, data: JSON.stringify(d) }) };
    },
    async boardProductBought({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await getRowOrNull(T.products, idOf(body.productId, 'productId'));
      if (!r || r.familyId !== c.familyId) throw missing('That product does not exist.');
      const d = { ...parse(r.data), low: false, qty: 0, opened: false, goneBy: '', by: '', at: '' };
      await updateRow(T.products, r.$id, { data: JSON.stringify(d) });
      return { product: productOut({ ...r, data: JSON.stringify(d) }) };
    },
    async boardProductDelete({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await getRowOrNull(T.products, idOf(body.productId, 'productId'));
      if (!r || r.familyId !== c.familyId) throw missing('That product does not exist.');
      await deleteRow(T.products, r.$id);
      return { deleted: true };
    },

    /* ---------- change requests ---------- */
    async boardRequest({ user, body }) {
      const c = await context(user, body.familyId);
      if (c.manager) throw bad('You can do that yourself, no request needed.');
      const kind = body.kind;
      let data;
      if (kind === 'newGroup') data = { kind, name: textOf(String(body.name || ''), 'Group name', { min: 1, max: 80 }), description: textOf(String(body.description || ''), 'Description', { max: 400 }), color: COLOR_RE.test(body.color || '') ? body.color : '' };
      else if (kind === 'deleteTask') { const r = await taskRow(c, body.taskId); data = { kind, taskId: r.$id, title: parse(r.data).title }; }
      else throw bad('That kind of request is not available.');
      const pending = (await all(T.requests, c.familyId, 200)).filter((r) => r.status === 'pending' && parse(r.data).byId === user.$id).length;
      if (pending >= 10) throw new ApiError(409, 'quota', 'You already have 10 requests waiting.');
      const row = await createRow(T.requests, ID.unique(), { familyId: c.familyId, status: 'pending', data: JSON.stringify({ ...data, byId: user.$id, byName: c.me.name }) }, []);
      await noteAll(c, 'request', { requestId: row.$id, title: requestText(data) }, (m) => m.owner || m.treeAdmin);
      return { request: { id: row.$id, status: 'pending', ...data, byId: user.$id, byName: c.me.name } };
    },
    async boardDecide({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.manager) throw forbidden('Only an owner or admin can decide requests.');
      const r = await getRowOrNull(T.requests, idOf(body.requestId, 'requestId'));
      if (!r || r.familyId !== c.familyId) throw missing('That request does not exist.');
      if (r.status !== 'pending') throw new ApiError(409, 'decided', 'That request was already decided.');
      const decision = body.decision;
      if (!['approve', 'reject', 'ignore'].includes(decision)) throw bad('Choose accept, reject or ignore.');
      const d = parse(r.data);
      let status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'ignored';
      if (status === 'approved') {
        if (d.kind === 'newGroup') await saveGroup(c, { name: d.name, description: d.description, color: d.color });
        else if (d.kind === 'deleteTask') { const t = await getRowOrNull(T.tasks, d.taskId); if (t && t.familyId === c.familyId) await deleteRow(T.tasks, t.$id); }
      }
      await updateRow(T.requests, r.$id, { status, data: JSON.stringify({ ...d, decidedById: user.$id, decidedByName: c.me.name }) });
      if (status !== 'ignored') await note(c, d.byId, 'request_result', { requestId: r.$id, title: requestText(d), outcome: status });
      return { status };
    },

    /** The bell: marks everything as read. */
    async boardNotesRead({ user, body }) {
      const c = await context(user, body.familyId);
      const page = await listRows(T.notes, [Query.equal('familyId', [c.familyId]), Query.equal('userId', [user.$id]), Query.equal('read', [false]), Query.limit(100)]);
      for (const n of page.rows) await updateRow(T.notes, n.$id, { read: true });
      return { marked: page.rows.length };
    }
  };

  const requestText = (d) => (d.kind === 'newGroup' ? `add the group “${d.name}”` : `delete the task “${d.title}”`);
  function httpUrl(s) { s = String(s || '').trim(); if (!/^https?:\/\//i.test(s)) return ''; try { return new URL(s).href.slice(0, 500); } catch (e) { return ''; } }

  async function saveGroup(c, g) {
    const name = textOf(typeof g.name === 'string' ? g.name : '', 'Group name', { min: 1, max: 80 });
    const description = textOf(typeof g.description === 'string' ? g.description : '', 'Description', { max: 400 });
    if (g.id) {
      const r = await getRowOrNull(T.groups, idOf(g.id, 'id'));
      if (!r || r.familyId !== c.familyId) throw missing('That group does not exist.');
      const d = { ...parse(r.data), name, description, color: COLOR_RE.test(g.color || '') ? g.color : parse(r.data).color };
      await updateRow(T.groups, r.$id, { data: JSON.stringify(d) });
      return groupOut({ ...r, data: JSON.stringify(d) });
    }
    if ((await all(T.groups, c.familyId, BOARD_LIMITS.groups)).length >= BOARD_LIMITS.groups) throw new ApiError(409, 'quota', 'A family can have up to ' + BOARD_LIMITS.groups + ' groups.');
    const d = { name, description, color: COLOR_RE.test(g.color || '') ? g.color : '#b4556a' };
    const row = await createRow(T.groups, ID.unique(), { familyId: c.familyId, data: JSON.stringify(d) }, []);
    return groupOut({ ...row, data: JSON.stringify(d) });
  }
  async function deleteGroup(c, groupId, mode) {
    const g = await getRowOrNull(T.groups, groupId);
    if (!g || g.familyId !== c.familyId) throw missing('That group does not exist.');
    const inGroup = (await all(T.tasks, c.familyId, BOARD_LIMITS.tasks)).filter((t) => parse(t.data).groupId === groupId);
    for (const t of inGroup) {
      if (mode === 'delete') await deleteRow(T.tasks, t.$id);
      else { const d = parse(t.data); pushHist(d, ev(c, 'group', { fromName: parse(g.data).name, toName: 'No group' })); d.groupId = ''; await saveTask(t, d); }
    }
    await deleteRow(T.groups, groupId);
    return { deleted: true, tasks: inGroup.length, mode };
  }

  return { actions };
}
