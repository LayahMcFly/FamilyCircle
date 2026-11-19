/*
 * Family Exchange backend: free items and Wanted posts between family members. Server side only.
 * Copyright (C) 2026 Leia.
 *
 * STATUS: built on branch exchange-step6 as code only. NOT deployed, NOT enabled for any family, no tables exist yet, and the app has no screen for it.
 * Design: EXCHANGE-BACKEND-DESIGN.md (section 12 decisions are unresolved; nothing here settles them).
 *
 * Trust model (same as board.js, chat.js and giving.js)
 *  - `user` is the account Appwrite verified from the caller's own JWT. No body field can name a person.
 *  - The six exchange tables have NO client permission: every read and write goes through an action below, which first checks that the caller
 *    is a confirmed family member, that Exchange is turned on for the family, and that the caller passes the ELIGIBILITY hook.
 *  - ELIGIBILITY and MODERATORS are injected hooks. They default to "nobody": no eligibility hook means nobody may use Exchange, and no
 *    moderator hook means there is no moderator. These are placeholders, not production safeguards. No adult flag, tree-admin right or
 *    new profile column is invented here.
 *  - A listing the caller may not see (another family, missing, hidden, draft, withdrawn) answers with the same "not available" body.
 *  - Applicants never see each other. Reporters are never shown to the reported member. A report about your own listing is never listed to you.
 *
 * Concurrency (see EXCHANGE-BACKEND-DESIGN.md section 3, and the "Step 6 mechanism" notes in FAMILY-EXCHANGE-PROGRESS.md)
 *  Every change to a listing, its requests, its reservation or a report about it goes through mutate():
 *   1. read the listing at sequence n, finish any earlier claimed-but-unapplied change (roll forward), validate against that fresh state;
 *   2. CLAIM sequence n+1 by inserting an immutable event row whose claimKey (listingId_n+1) has a UNIQUE index. Only one writer can win;
 *      a loser gets HTTP 409, re-reads, and validates again against the winner's result;
 *   3. apply the plan stored in the event. Every step is idempotent and the listing row is written last with seq = n+1, so a crash at any
 *      point is repaired by the next action on that listing (roll forward), never by guessing.
 *  A second unique key (opKey = listingId_opId) makes a duplicate retry of the same action a no-op that returns the current state.
 *  Known limit: the claim is atomic, the apply steps are not one transaction. See the progress file for the remaining live checks.
 */
import { Query, ID } from 'node-appwrite';
import * as R from './exchange-rules.js';

export const EXCHANGE_TABLES = {
  listings: 'exchangeListings',
  requests: 'exchangeRequests',
  reservations: 'exchangeReservations',
  reports: 'exchangeReports',
  events: 'exchangeEvents',
  state: 'exchangeState'
};
/* The exact schema this code expects. Nothing creates it: schema work is a separate approval (Step 7). The tests run against this shape. */
export const EXCHANGE_SCHEMA = {
  exchangeListings: { columns: { familyId: 'string(36)', ownerId: 'string(36)', kind: 'string(8)', status: 'string(12)', rev: 'integer', seq: 'integer', hiddenFrom: 'string(12)', data: 'string(6000)', pending: 'string(6000)' }, unique: [], indexes: [['familyId', 'status'], ['familyId', 'ownerId']] },
  exchangeRequests: { columns: { familyId: 'string(36)', listingId: 'string(36)', requesterId: 'string(36)', requestKey: 'string(80)', status: 'string(12)', data: 'string(1500)' }, unique: [['requestKey']], indexes: [['listingId'], ['familyId', 'requesterId']] },
  exchangeReservations: { columns: { familyId: 'string(36)', listingId: 'string(36)', requestId: 'string(36)', reservedFor: 'string(36)' }, unique: [['listingId']], indexes: [], note: 'row id = listingId as well, so the id itself also refuses a second reservation' },
  exchangeReports: { columns: { familyId: 'string(36)', listingId: 'string(36)', reporterId: 'string(36)', reportKey: 'string(80)', reason: 'string(60)', status: 'string(12)', handledBy: 'string(36)', data: 'string(1500)' }, unique: [['reportKey']], indexes: [['familyId', 'status'], ['listingId'], ['familyId', 'reporterId']] },
  exchangeEvents: { columns: { familyId: 'string(36)', listingId: 'string(36)', seq: 'integer', claimKey: 'string(80)', opKey: 'string(80)', actorId: 'string(36)', kind: 'string(24)', plan: 'string(12000)' }, unique: [['claimKey'], ['opKey']], indexes: [['listingId', 'seq']] },
  exchangeState: { columns: { familyId: 'string(36)', enabled: 'boolean', enabledBy: 'string(36)', enabledAt: 'string(32)' }, unique: [], indexes: [], note: 'row id = familyId' }
};
export const EXCHANGE_LIMITS = { ...R.LIMITS, rawFactor: 2, perMinute: 60, reportsPerDay: 10, requestsPerListing: 40, listingsPerMember: 50, homeMax: 300 };
export const REPORT_REASONS = ['Item looks unsafe or recalled', 'Not allowed on Family Exchange', 'Wrong category', 'Looks like spam or a scam', 'Other'];
const LIVE = ['available', 'open', 'reserved'];
const FINISHED = ['gone', 'fulfilled', 'closed'];
const DAY = 864e5;

export function createExchange(deps) {
  const { teams, listRows, createRow, updateRow, deleteRow, getRowOrNull, firstRow, requireMember, idOf, bad, forbidden, ApiError, sdkCode, now, profilesTable } = deps;
  /* Fail closed. A missing hook means nobody is eligible and nobody moderates. */
  const eligibility = typeof deps.eligibility === 'function' ? deps.eligibility : async () => false;
  const moderators = typeof deps.moderators === 'function' ? deps.moderators : async () => [];
  const newId = typeof deps.newId === 'function' ? deps.newId : () => ID.unique();
  const T = EXCHANGE_TABLES, L = EXCHANGE_LIMITS;
  const iso = () => new Date(now()).toISOString();
  const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const NA = () => new ApiError(404, 'not_available', 'That is not available.');
  const changed = () => new ApiError(409, 'changed', 'This listing already changed. Showing the latest.');
  const initialStatus = (kind) => (kind === 'wanted' ? 'open' : 'available');

  const hits = new Map();   // light per-person brake in memory: a brake, not a guarantee
  function brake(userId) {
    const t = now(), from = t - 60000, list = (hits.get(userId) || []).filter((x) => x > from);
    if (list.length >= L.perMinute) { hits.set(userId, list); throw new ApiError(429, 'rate_limited', 'You are doing that too quickly. Wait a few seconds and try again.'); }
    list.push(t); hits.set(userId, list);
    if (hits.size > 2000) hits.delete(hits.keys().next().value);
  }
  async function all(tableId, queries, max) {
    const out = []; let cursor = null;
    while (out.length < max) {
      const q = [...queries, Query.limit(100)]; if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await listRows(tableId, q); out.push(...page.rows);
      if (page.rows.length < 100) break; cursor = page.rows[page.rows.length - 1].$id;
    }
    return out;
  }
  const inFamily = (tableId, familyId, extra = [], max = 2000) => all(tableId, [Query.equal('familyId', [familyId]), ...extra], max);

  /* ---------- who is who: membership, the on/off switch, then the eligibility hook ---------- */
  async function context(user, familyIdRaw, { needOn = true } = {}) {
    const ctx = await requireMember(user, familyIdRaw);
    brake(user.$id);
    const state = await getRowOrNull(T.state, ctx.familyId);
    const enabled = !!(state && state.enabled === true);
    if (needOn && !enabled) throw NA();
    if (needOn) {
      let ok = false;
      try { ok = (await eligibility({ user, familyId: ctx.familyId, isOwner: ctx.isOwner })) === true; } catch (e) { ok = false; }
      if (!ok) throw NA();
    }
    const res = await teams.listMemberships({ teamId: ctx.familyId, queries: [Query.limit(100)] });
    const joined = res.memberships.filter((m) => m.confirm === true);
    const profs = await inFamily(profilesTable, ctx.familyId, [], 400);
    const by = new Map(profs.map((p) => [p.userId, p]));
    const names = new Map(joined.map((m) => [m.userId, (by.get(m.userId) && by.get(m.userId).displayName) || m.userName || 'Family member']));
    let mods = [];
    if (needOn) { try { const m = await moderators({ user, familyId: ctx.familyId }); if (Array.isArray(m)) mods = m.filter((id) => typeof id === 'string' && names.has(id)); } catch (e) { mods = []; } }
    return { ...ctx, me: user.$id, enabled, names, mods, isMod: mods.includes(user.$id) };
  }
  const nameOf = (c, id) => c.names.get(id) || 'Family member';

  /* ---------- plain data helpers ---------- */
  const dataOf = (l) => { const d = parse(l.data); return { title: String(d.title || ''), category: String(d.category || ''), condition: String(d.condition || ''), description: String(d.description || ''), area: String(d.area || '') }; };
  const reqNote = (r) => String(parse(r.data).note || '');
  function readDraft(body, kind) {
    const raw = (k) => (typeof body[k] === 'string' ? body[k] : '');
    const d = { kind, title: raw('title'), category: raw('category'), condition: kind === 'free' ? raw('condition') : '', description: raw('description'), area: raw('area') };
    if (body.photos !== undefined && body.photos !== null && !(Array.isArray(body.photos) && body.photos.length === 0)) d.photos = body.photos;
    const f = L.rawFactor;
    if (d.title.length > L.title * f || d.description.length > L.description * f || d.area.length > L.area * f) throw bad('That text is too long. Remove extra spaces or blank lines.');
    const v = R.validate(d);
    if (!v.ok) throw new ApiError(400, 'invalid', Object.values(v.errors)[0] || 'Check what you entered.');
    return { title: d.title, category: d.category, condition: d.condition, description: d.description, area: d.area };
  }
  function noteOf(value) {
    const note = typeof value === 'string' ? value.trim() : '';
    if (note.length > L.note) throw bad('Keep the note to ' + L.note + ' characters or fewer.');
    if (R.looksLikeContact(note) || R.looksLikeAddress(note)) throw bad('Please leave phone numbers, emails, links and street addresses out.');
    return note;
  }
  function opIdOf(body) {
    if (typeof body.opId !== 'string' || !/^[A-Za-z0-9]{8,32}$/.test(body.opId)) throw bad('opId is not valid.');
    return body.opId;
  }

  /* ---------- the claim, apply and repair machinery ---------- */
  const OPS_TABLES = new Set([T.listings, T.requests, T.reservations, T.reports]);
  const op = {
    set: (table, id, set) => ({ t: 'set', table, id, set }),
    create: (table, id, row) => ({ t: 'create', table, id, row }),
    del: (table, id) => ({ t: 'del', table, id })
  };
  async function doOp(o) {
    if (!OPS_TABLES.has(o.table)) throw new ApiError(500, 'server_error', 'Unknown table in plan.');
    if (o.t === 'set') { try { await updateRow(o.table, o.id, o.set); } catch (e) { if (sdkCode(e) !== 404 || o.table === T.listings) throw e; } }
    else if (o.t === 'create') { try { await createRow(o.table, o.id, o.row, []); } catch (e) { if (sdkCode(e) !== 409) throw e; } }
    else if (o.t === 'del') { try { await deleteRow(o.table, o.id); } catch (e) { if (sdkCode(e) !== 404) throw e; } }
  }
  /** Run a claimed plan. Safe to run again, and safe to run by someone else after a crash. Stops as soon as the listing row shows the event is done.
   * The fence is checked before every op of a short plan (and before the final listing write of a long one). It narrows but cannot close the window between check and write;
   * closing it needs a conditional write or verified Appwrite transaction conflict semantics, a Step 7 live check. */
  async function apply(ev) {
    const ops = parse(ev.plan).ops || [];
    for (let i = 0; i < ops.length; i++) {
      if (ops.length <= 12 || i % 4 === 0 || i === ops.length - 1) { const cur = await getRowOrNull(T.listings, ev.listingId); if (!cur || cur.seq >= ev.seq) return; }
      await doOp(ops[i]);
    }
  }
  async function repair(l) {
    const last = await firstRow(T.events, [Query.equal('listingId', [l.$id]), Query.orderDesc('seq')]);
    if (last && last.seq > l.seq) { await apply(last); return (await getRowOrNull(T.listings, l.$id)) || l; }
    return l;
  }
  /** build(listing) validates against fresh state and returns { ops, listingSet, info }. It must throw instead of returning when the change is not allowed. */
  async function mutate(c, listingId, opId, kind, build) {
    const opKey = listingId + '_' + opId;
    for (let attempt = 0; attempt < 4; attempt++) {
      let l = await getRowOrNull(T.listings, listingId);
      if (!l || l.familyId !== c.familyId) throw NA();
      const dup = await firstRow(T.events, [Query.equal('opKey', [opKey])]);
      if (dup) { if (dup.actorId !== c.me) throw bad('opId is not valid.'); await apply(dup); return { replay: true }; }
      l = await repair(l);
      const out = await build(l);
      const seq = l.seq + 1;
      const ops = [...(out.ops || []), op.set(T.listings, l.$id, { ...(out.listingSet || {}), seq })];
      let ev = null;
      try {
        ev = await createRow(T.events, newId(), { familyId: c.familyId, listingId: l.$id, seq, claimKey: l.$id + '_' + seq, opKey, actorId: c.me, kind, plan: JSON.stringify({ ops }) }, []);
      } catch (e) { if (sdkCode(e) !== 409) throw e; /* lost the claim, or a duplicate: the loop re-checks, repairs and validates again */ }
      if (ev) { await apply(ev); return { replay: false, info: out.info }; }
    }
    throw changed();
  }

  /* ---------- reach rules ---------- */
  async function reachable(c, listingId) {
    const l = await getRowOrNull(T.listings, idOf(listingId, 'listingId'));
    if (!l || l.familyId !== c.familyId || !c.names.has(l.ownerId)) throw NA();
    const mine = l.ownerId === c.me;
    const myReq = mine ? null : await firstRow(T.requests, [Query.equal('requestKey', [l.$id + '_' + c.me])]);
    if (l.status === 'draft' && !mine) throw NA();
    if (l.status === 'withdrawn' && !mine && !myReq) throw NA();
    if (l.status === 'hidden' && !mine) {
      const rep = c.isMod ? await firstRow(T.reports, [Query.equal('listingId', [l.$id])]) : null;
      if (!rep) throw NA();
    }
    return { l, mine, myReq };
  }
  async function ownListing(c, listingId) {
    const l = await getRowOrNull(T.listings, idOf(listingId, 'listingId'));
    if (!l || l.familyId !== c.familyId || l.ownerId !== c.me) throw NA();
    return l;
  }

  /* ---------- views: every response is built field by field, never from a stored row ---------- */
  const card = (c, l) => ({ id: l.$id, kind: l.kind, status: l.status, ...(({ title, category, condition, area }) => ({ title, category, condition, area }))(dataOf(l)), owner: nameOf(c, l.ownerId), mine: l.ownerId === c.me });
  async function detail(c, l, mine, myReq) {
    if (l.status === 'hidden' && !mine) return { id: l.$id, kind: l.kind, status: 'hidden', title: dataOf(l).title, description: dataOf(l).description, moderatorView: true };
    if (l.status === 'withdrawn' && !mine) return { id: l.$id, kind: l.kind, status: 'withdrawn', title: dataOf(l).title, owner: nameOf(c, l.ownerId), myRequest: { id: myReq.$id, status: myReq.status } };
    const v = { ...card(c, l), ...dataOf(l), rev: l.rev };
    if (mine) {
      const reqs = await all(T.requests, [Query.equal('listingId', [l.$id])], L.requestsPerListing + 10);
      v.requests = reqs.map((r) => ({ id: r.$id, from: nameOf(c, r.requesterId), status: r.status, note: reqNote(r), at: r.$createdAt }));
      const res = l.status === 'reserved' || l.status === 'hidden' ? await getRowOrNull(T.reservations, l.$id) : null;
      v.reservedFor = res ? { name: nameOf(c, res.reservedFor), requestId: res.requestId } : null;
      v.pending = l.pending ? { ...dataOf({ data: l.pending }) } : null;
      v.hiddenByModerator = l.status === 'hidden';
    } else {
      v.myRequest = myReq ? { id: myReq.$id, status: myReq.status, note: reqNote(myReq), reservedForMe: myReq.status === 'reserved' && l.status === 'reserved' } : null;
    }
    return v;
  }
  async function fresh(c, listingId) { const { l, mine, myReq } = await reachable(c, listingId); return { listing: await detail(c, l, mine, myReq) }; }

  const actions = {
    async exchangeStatus({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      return { enabled: c.enabled, canTurnOn: c.isOwner };
    },
    async exchangeSetState({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      if (!c.isOwner) throw forbidden('Only the family owner can turn Family Exchange on or off.');
      const enabled = body.enabled === true;
      const row = await getRowOrNull(T.state, c.familyId), data = { familyId: c.familyId, enabled, enabledBy: user.$id, enabledAt: iso() };
      if (row) await updateRow(T.state, c.familyId, data); else await createRow(T.state, c.familyId, data, []);
      return { enabled };
    },

    async exchangeHome({ user, body }) {
      const c = await context(user, body.familyId);
      const statuses = body.finished === true ? [...LIVE, ...FINISHED] : LIVE;
      const rows = await inFamily(T.listings, c.familyId, [Query.equal('status', statuses)], L.homeMax);
      return { listings: rows.filter((l) => c.names.has(l.ownerId)).map((l) => card(c, l)) };
    },
    async exchangeListingGet({ user, body }) {
      const c = await context(user, body.familyId);
      return fresh(c, body.listingId);
    },

    /** Create (no listingId) or edit. A reserved listing only ever takes PRIVATE edits. */
    async exchangeListingSave({ user, body }) {
      const c = await context(user, body.familyId);
      const opId = opIdOf(body), publish = body.publish === true;
      if (!body.listingId) {
        const kind = body.kind === 'wanted' ? 'wanted' : body.kind === 'free' ? 'free' : '';
        if (!kind) throw bad('Choose free item or wanted.');
        const d = readDraft(body, kind);
        const mineCount = (await inFamily(T.listings, c.familyId, [Query.equal('ownerId', [c.me])], L.listingsPerMember + 1)).length;
        if (mineCount >= L.listingsPerMember) throw new ApiError(409, 'limit', 'You can have up to ' + L.listingsPerMember + ' listings. Finish or withdraw one to add another.');
        const id = 'l' + opId;   // the retry key doubles as the row id, so a repeated tap cannot make a second listing
        const existing = await getRowOrNull(T.listings, id);
        if (existing) { if (existing.ownerId !== c.me) throw bad('opId is not valid.'); return fresh(c, id); }
        try { await createRow(T.listings, id, { familyId: c.familyId, ownerId: c.me, kind, status: publish ? initialStatus(kind) : 'draft', rev: 1, seq: 0, hiddenFrom: '', data: JSON.stringify(d), pending: '' }, []); }
        catch (e) { if (sdkCode(e) !== 409) throw e; }
        return { ...(await fresh(c, id)), saved: publish ? 'published' : 'draft' };
      }
      const l0 = await ownListing(c, body.listingId);
      const d = readDraft(body, l0.kind);
      const res = await mutate(c, l0.$id, opId, 'edit', async (l) => {
        if (Number(body.rev) !== l.rev) throw changed();
        if (l.status === 'draft') return { listingSet: { data: JSON.stringify(d), rev: l.rev + 1, ...(publish ? { status: initialStatus(l.kind) } : {}) }, info: { saved: publish ? 'published' : 'draft' } };
        if (l.status === 'available' || l.status === 'open') return { listingSet: { data: JSON.stringify(d), pending: '', rev: l.rev + 1 }, info: { saved: 'published' } };
        if (l.status === 'reserved') {
          if (!R.anyChanges(dataOf(l), d)) return { listingSet: { pending: '', rev: l.rev + 1 }, info: { saved: 'nochange' } };
          return { listingSet: { pending: JSON.stringify(d), rev: l.rev + 1 }, info: { saved: 'private', blocked: publish, materialChanges: R.materialChanges(dataOf(l), d) } };
        }
        throw new ApiError(409, 'not_editable', 'This listing cannot be edited now.');
      });
      return { ...(await fresh(c, l0.$id)), ...(res.info || {}) };
    },
    async exchangeListingDiscardPending({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), l0 = await ownListing(c, body.listingId);
      await mutate(c, l0.$id, opId, 'discard', async (l) => { if (!l.pending) throw changed(); return { listingSet: { pending: '', rev: l.rev + 1 } }; });
      return fresh(c, l0.$id);
    },
    /** Mark gone / fulfilled / closed, or withdraw. Closes every open request and frees the reservation row. */
    async exchangeListingEnd({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), l0 = await ownListing(c, body.listingId);
      const to = body.to;
      if (!['gone', 'fulfilled', 'closed', 'withdrawn'].includes(to)) throw bad('Choose how this ends.');
      await mutate(c, l0.$id, opId, 'end', async (l) => {
        const kindOk = to === 'withdrawn' || (to === 'gone' ? l.kind === 'free' : l.kind === 'wanted');
        if (!kindOk || !LIVE.includes(l.status)) throw changed();
        const reqs = await all(T.requests, [Query.equal('listingId', [l.$id])], L.requestsPerListing + 10);
        const ops = reqs.filter((r) => r.status === 'waiting' || r.status === 'reserved').map((r) => op.set(T.requests, r.$id, { status: 'closed' }));
        if (l.status === 'reserved') ops.push(op.del(T.reservations, l.$id));
        return { ops, listingSet: { status: to, hiddenFrom: '', pending: '', rev: l.rev + 1 } };
      });
      return fresh(c, l0.$id);
    },

    /** Ask (or ask again). Never reserves anyone. */
    async exchangeRequestCreate({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), { l: l0, mine } = await reachable(c, body.listingId);
      if (mine) throw bad('You cannot ask for your own listing.');
      const note = noteOf(body.note);
      await mutate(c, l0.$id, opId, 'ask', async (l) => {
        if (!LIVE.includes(l.status)) throw changed();
        const reqs = await all(T.requests, [Query.equal('listingId', [l.$id])], L.requestsPerListing + 10);
        const mineReq = reqs.find((r) => r.requesterId === c.me), data = JSON.stringify({ note });
        if (mineReq) {
          if (mineReq.status === 'declined') throw new ApiError(409, 'declined', 'The owner did not choose your request.');
          if (mineReq.status !== 'released' && mineReq.status !== 'cancelled') throw new ApiError(409, 'already_asked', 'You already asked for this.');
          return { ops: [op.set(T.requests, mineReq.$id, { status: 'waiting', data })] };
        }
        if (reqs.length >= L.requestsPerListing) throw new ApiError(409, 'limit', 'This listing has reached the most requests it can take.');
        return { ops: [op.create(T.requests, newId(), { familyId: c.familyId, listingId: l.$id, requesterId: c.me, requestKey: l.$id + '_' + c.me, status: 'waiting', data })] };
      });
      return fresh(c, l0.$id);
    },
    async exchangeRequestCancel({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), { l: l0, mine } = await reachable(c, body.listingId);
      if (mine) throw NA();
      await mutate(c, l0.$id, opId, 'cancelask', async (l) => {
        const r = await firstRow(T.requests, [Query.equal('requestKey', [l.$id + '_' + c.me])]);
        if (!r || r.status !== 'waiting' || !LIVE.includes(l.status)) throw changed();
        return { ops: [op.set(T.requests, r.$id, { status: 'cancelled' })] };
      });
      return fresh(c, l0.$id);
    },
    /** The reserved person backs out: the item returns to Available (or Open). */
    async exchangeCancelReservation({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), { l: l0, mine } = await reachable(c, body.listingId);
      if (mine) throw NA();
      await mutate(c, l0.$id, opId, 'cancelresv', async (l) => {
        const r = await firstRow(T.requests, [Query.equal('requestKey', [l.$id + '_' + c.me])]);
        const res = await getRowOrNull(T.reservations, l.$id);
        if (!r || r.status !== 'reserved' || l.status !== 'reserved' || !res || res.reservedFor !== c.me) throw changed();
        return { ops: [op.set(T.requests, r.$id, { status: 'cancelled' }), op.del(T.reservations, l.$id)], listingSet: { status: initialStatus(l.kind), rev: l.rev + 1 } };
      });
      return fresh(c, l0.$id);
    },
    /** Owner confirms one waiting request. One person at a time. Others stay waiting and are told nothing. */
    async exchangeReserve({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), l0 = await ownListing(c, body.listingId), requestId = idOf(body.requestId, 'requestId');
      await mutate(c, l0.$id, opId, 'reserve', async (l) => {
        const r = await getRowOrNull(T.requests, requestId);
        const res = await getRowOrNull(T.reservations, l.$id);
        if (!r || r.listingId !== l.$id || r.status !== 'waiting' || (l.status !== 'available' && l.status !== 'open') || res) throw changed();
        return { ops: [op.create(T.reservations, l.$id, { familyId: c.familyId, listingId: l.$id, requestId: r.$id, reservedFor: r.requesterId }), op.set(T.requests, r.$id, { status: 'reserved' })], listingSet: { status: 'reserved', rev: l.rev + 1 } };
      });
      return fresh(c, l0.$id);
    },
    async exchangeRequestDecline({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), l0 = await ownListing(c, body.listingId), requestId = idOf(body.requestId, 'requestId');
      await mutate(c, l0.$id, opId, 'decline', async (l) => {
        const r = await getRowOrNull(T.requests, requestId);
        if (!r || r.listingId !== l.$id || r.status !== 'waiting' || !LIVE.includes(l.status)) throw changed();
        return { ops: [op.set(T.requests, r.$id, { status: 'declined' })] };
      });
      return fresh(c, l0.$id);
    },
    /** Owner releases: Available again, the former recipient's request becomes Released, other waiting requests stay waiting, private edits stay private. */
    async exchangeRelease({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), l0 = await ownListing(c, body.listingId);
      await mutate(c, l0.$id, opId, 'release', async (l) => {
        const res = await getRowOrNull(T.reservations, l.$id);
        if (l.status !== 'reserved' || !res) throw changed();
        return { ops: [op.set(T.requests, res.requestId, { status: 'released' }), op.del(T.reservations, l.$id)], listingSet: { status: initialStatus(l.kind), rev: l.rev + 1 } };
      });
      return fresh(c, l0.$id);
    },

    async exchangeActivity({ user, body }) {
      const c = await context(user, body.familyId);
      const [mineReqs, myListings, waiting] = await Promise.all([
        inFamily(T.requests, c.familyId, [Query.equal('requesterId', [c.me])], 300),
        inFamily(T.listings, c.familyId, [Query.equal('ownerId', [c.me])], L.listingsPerMember + 1),
        inFamily(T.requests, c.familyId, [Query.equal('status', ['waiting'])], 1000)
      ]);
      const requests = [];
      for (const r of mineReqs) {
        const l = await getRowOrNull(T.listings, r.listingId);
        if (!l || l.familyId !== c.familyId || !c.names.has(l.ownerId) || l.status === 'draft' || l.status === 'hidden') continue;
        requests.push({ requestId: r.$id, status: r.status, listing: { id: l.$id, title: dataOf(l).title, status: l.status, owner: nameOf(c, l.ownerId) }, reservedForMe: r.status === 'reserved' && l.status === 'reserved' });
      }
      const count = new Map();
      for (const w of waiting) count.set(w.listingId, (count.get(w.listingId) || 0) + 1);
      const needsReply = myListings.filter((l) => (l.status === 'available' || l.status === 'open') && count.get(l.$id)).map((l) => ({ id: l.$id, title: dataOf(l).title, waiting: count.get(l.$id) }));
      const reserved = [];
      for (const l of myListings.filter((x) => x.status === 'reserved')) { const res = await getRowOrNull(T.reservations, l.$id); reserved.push({ id: l.$id, title: dataOf(l).title, for: res ? nameOf(c, res.reservedFor) : '' }); }
      const hidden = myListings.filter((l) => l.status === 'hidden').map((l) => ({ id: l.$id, title: dataOf(l).title }));
      return { requests, needsReply, reserved, hidden };
    },
    async exchangeMine({ user, body }) {
      const c = await context(user, body.familyId);
      const rows = await inFamily(T.listings, c.familyId, [Query.equal('ownerId', [c.me])], L.listingsPerMember + 1);
      return { listings: rows.map((l) => card(c, l)) };
    },

    /** A report is stored only if an independent handler exists. Otherwise the reporter is told plainly, and nothing is stored or sent to the owner. */
    async exchangeReport({ user, body }) {
      const c = await context(user, body.familyId), { l, mine } = await reachable(c, body.listingId);
      if (mine) throw bad('You cannot report your own listing.');
      if (!REPORT_REASONS.includes(body.reason)) throw bad('Choose a reason.');
      const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
      if (detail.length > L.note) throw bad('Keep the detail to ' + L.note + ' characters or fewer.');
      if (!c.mods.some((id) => id !== l.ownerId)) throw new ApiError(409, 'escalation_unavailable', 'This report could not be sent because no independent reviewer is available right now.');
      const mineToday = (await inFamily(T.reports, c.familyId, [Query.equal('reporterId', [c.me])], 200)).filter((r) => Date.parse(r.$createdAt) > now() - DAY).length;
      if (mineToday >= L.reportsPerDay) throw new ApiError(429, 'rate_limited', 'You have sent the most reports allowed for today.');
      try { await createRow(T.reports, newId(), { familyId: c.familyId, listingId: l.$id, reporterId: c.me, reportKey: l.$id + '_' + c.me, reason: body.reason, status: 'open', handledBy: '', data: JSON.stringify({ detail }) }, []); }
      catch (e) { if (sdkCode(e) !== 409) throw e; return { sent: true, already: true }; }
      return { sent: true };
    },
    async exchangeReportList({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.isMod) throw NA();
      const rows = await inFamily(T.reports, c.familyId, [], 200), out = [];
      for (const r of rows) {
        const l = await getRowOrNull(T.listings, r.listingId);
        if (!l || l.ownerId === c.me) continue;   // a report about your own listing is never shown to you: not its text, not its reporter, not a count
        out.push({ id: r.$id, status: r.status, reason: r.reason, detail: String(parse(r.data).detail || ''), reporter: nameOf(c, r.reporterId), at: r.$createdAt, listing: { id: l.$id, title: dataOf(l).title, status: l.status } });
      }
      return { reports: out };
    },
    async exchangeReportResolve({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body);
      if (!c.isMod) throw NA();
      const reportId = idOf(body.reportId, 'reportId'), decision = body.decision;
      if (!['keep', 'hide', 'restore'].includes(decision)) throw bad('Choose keep, hide or restore.');
      const r0 = await getRowOrNull(T.reports, reportId);
      if (!r0 || r0.familyId !== c.familyId) throw NA();
      const l0 = await getRowOrNull(T.listings, r0.listingId);
      if (!l0 || l0.ownerId === c.me) throw NA();   // the accused never acts on, or learns of, a report about themselves
      await mutate(c, l0.$id, opId, 'report-' + decision, async (l) => {
        const r = await getRowOrNull(T.reports, reportId);
        if (!r) throw NA();
        if (decision === 'keep' && r.status === 'open' && LIVE.includes(l.status)) return { ops: [op.set(T.reports, r.$id, { status: 'kept', handledBy: c.me })] };
        if (decision === 'hide' && r.status === 'open' && LIVE.includes(l.status)) return { ops: [op.set(T.reports, r.$id, { status: 'hidden', handledBy: c.me })], listingSet: { status: 'hidden', hiddenFrom: l.status, rev: l.rev + 1 } };
        if (decision === 'restore' && r.status === 'hidden' && l.status === 'hidden') return { ops: [op.set(T.reports, r.$id, { status: 'kept', handledBy: c.me })], listingSet: { status: l.hiddenFrom && LIVE.includes(l.hiddenFrom) ? l.hiddenFrom : initialStatus(l.kind), hiddenFrom: '', rev: l.rev + 1 } };
        throw changed();
      });
      return { ok: true };
    }
  };
  return { actions, EXCHANGE_TABLES, context };
}
