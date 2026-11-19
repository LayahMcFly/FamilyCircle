/*
 * Family Exchange backend: free items and Wanted posts between family members. Server side only.
 * Copyright (C) 2026 Leia.
 *
 * STATUS: built on branch exchange-step6 as code only. NOT deployed, NOT enabled for any family, no tables exist yet, and the app has no screen for it.
 * Design: EXCHANGE-BACKEND-DESIGN.md (section 12 decisions are unresolved; nothing here settles them).
 *
 * Trust model (same as board.js, chat.js and giving.js)
 *  - `user` is the account Appwrite verified from the caller's own JWT. No body field can name a person.
 *  - The exchange tables have NO client permission: every read and write goes through an action below, which first checks that the caller
 *    is a confirmed family member, that Exchange is turned on for the family, that the persistence gate is open, and that the caller passes the ELIGIBILITY hook.
 *  - ELIGIBILITY, MODERATORS and PERSISTENCE VERIFIED are injected and default to "no": nobody is eligible, nobody moderates, and the whole feature stays
 *    unavailable until the unique-index checks of Step 7 have passed and someone sets the gate. These are placeholders, not production safeguards.
 *    No adult flag, tree-admin right or new profile column is invented here.
 *  - A listing the caller may not see (another family, missing, hidden, draft, withdrawn, orphaned) answers with the same "not available" body.
 *  - Applicants never see each other. Reporters are never shown to the reported member. A report about your own listing is never listed to you.
 *
 * Membership binding
 *  Rights belong to a MEMBERSHIP INSTANCE (the Appwrite team membership id), not to an account. Each listing stores the owner's membership id, each request
 *  the requester's, each reservation the recipient's. If someone is removed and invited again they get a new membership id, so they do not get back the
 *  listings, requests or reservation they had before. Such a listing is "orphaned": nobody can open or change it, and it does not count toward any limit.
 *
 * Persistence: ONE atomic write per change (no apply step, no repair step, nothing is ever overwritten)
 *  The authoritative state of a listing (listing, requests, reservation, reports) is an append-only chain of immutable snapshots in `exchangeEvents`.
 *  Snapshot n+1 is created by inserting ONE row whose claimKey (listingId_n+1) has a UNIQUE index. A single row insert is atomic, and the unique index lets
 *  exactly one writer win each sequence number. The loser gets HTTP 409, re-reads the head, validates its intent against the winner's result and tries again.
 *  A writer holding a stale view can never overwrite anything, because the only write is a create that fails if that sequence number exists.
 *  A second unique key (opKey = listingId_opId) makes a duplicate retry of the same action a no-op.
 *  Other tables are create-only hints for finding things (who owns what, who asked, who reported), plus one flag, exchangeListings.ended, that only ever
 *  goes false -> true and only after a terminal snapshot exists, so a late or repeated write of it can never be wrong. State is always read from the chain.
 *  Remaining assumption (Step 7 live probe before the gate is opened): Appwrite enforces UNIQUE indexes under concurrent inserts and returns 409.
 */
import { Query, ID } from 'node-appwrite';
import { createHash } from 'node:crypto';
import * as R from './exchange-rules.js';

export const EXCHANGE_TABLES = {
  listings: 'exchangeListings',
  requests: 'exchangeRequests',
  reports: 'exchangeReports',
  events: 'exchangeEvents',
  state: 'exchangeState'
};
/* The exact schema this code expects. Nothing creates it: schema work is a separate approval (Step 7). The tests run against this shape. */
export const EXCHANGE_SCHEMA = {
  exchangeListings: { columns: { familyId: 'string(36)', ownerId: 'string(36)', ownerMembership: 'string(36)', kind: 'string(8)', ended: 'boolean' }, unique: [], indexes: [['familyId', 'ended'], ['ownerMembership', 'ended']], note: 'row id = listingId. Create-only hint row. `ended` only ever goes false -> true, after a terminal snapshot exists.' },
  exchangeRequests: { columns: { familyId: 'string(36)', listingId: 'string(36)', requesterId: 'string(36)', requesterMembership: 'string(36)', requestKey: 'string(80)' }, unique: [['requestKey']], indexes: [['listingId'], ['familyId', 'requesterId']], note: 'create-only hint row; requestKey = listingId_membershipId. The request itself lives in the snapshot.' },
  exchangeReports: { columns: { familyId: 'string(36)', listingId: 'string(36)', reporterId: 'string(36)', reporterMembership: 'string(36)', reportKey: 'string(80)' }, unique: [['reportKey']], indexes: [['familyId'], ['familyId', 'reporterId']], note: 'create-only hint row; reportKey = listingId_membershipId. The report itself lives in the snapshot.' },
  exchangeEvents: { columns: { familyId: 'string(36)', listingId: 'string(36)', seq: 'integer', claimKey: 'string(80)', opKey: 'string(80)', actorId: 'string(36)', kind: 'string(24)', state: 'text(65535 bytes; the code refuses snapshots over 60000 bytes)' }, unique: [['claimKey'], ['opKey']], indexes: [['listingId', 'seq']], note: 'append-only: rows are never updated or deleted. This is the authoritative state.' },
  exchangeState: { columns: { familyId: 'string(36)', enabled: 'boolean', enabledBy: 'string(36)', enabledAt: 'string(32)' }, unique: [], indexes: [], note: 'row id = familyId' }
};
export const EXCHANGE_LIMITS = { ...R.LIMITS, rawFactor: 2, perMinute: 60, reportsPerDay: 10, reportsPerListing: 20, requestsPerListing: 40, requestEntriesMax: 100, listingsPerMember: 50, homeMax: 300, stateBytesMax: 60000, membershipPagesMax: 50 };
export const REPORT_REASONS = ['Item looks unsafe or recalled', 'Not allowed on Family Exchange', 'Wrong category', 'Looks like spam or a scam', 'Other'];
const LIVE = ['available', 'open', 'reserved'];
const FINISHED = ['gone', 'fulfilled', 'closed'];
const TERMINAL = [...FINISHED, 'withdrawn'];   // after one of these nothing about a listing changes again
const DAY = 864e5;

export function createExchange(deps) {
  const { teams, listRows, createRow, updateRow, getRowOrNull, firstRow, requireMember, idOf, bad, forbidden, ApiError, sdkCode, now, profilesTable } = deps;
  /* Fail closed. A missing hook means nobody is eligible, nobody moderates, and persistence has not been verified. */
  const eligibility = typeof deps.eligibility === 'function' ? deps.eligibility : async () => false;
  const moderators = typeof deps.moderators === 'function' ? deps.moderators : async () => [];
  const persistenceVerified = deps.persistenceVerified === true;
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
  /** Every confirmed and unconfirmed membership, page by page. A family too large to read completely fails closed rather than being cut off. */
  async function allMemberships(teamId) {
    const out = []; let cursor = null;
    for (let page = 0; page < L.membershipPagesMax; page++) {
      const q = [Query.limit(100)]; if (cursor) q.push(Query.cursorAfter(cursor));
      const res = await teams.listMemberships({ teamId, queries: q });
      const ms = (res && res.memberships) || [];
      out.push(...ms);
      if (ms.length < 100) return out;
      cursor = ms[ms.length - 1].$id;
    }
    throw new ApiError(503, 'server_error', 'This family is too large to check right now.');
  }
  /** Current confirmed members: userId -> { mid (membership id), name, owner }. */
  async function memberMap(familyId) {
    const joined = (await allMemberships(familyId)).filter((m) => m.confirm === true);
    const profs = await inFamily(profilesTable, familyId, [], 5000);
    const by = new Map(profs.map((p) => [p.userId, p]));
    return new Map(joined.map((m) => [m.userId, { mid: m.$id, name: (by.get(m.userId) && by.get(m.userId).displayName) || m.userName || 'Family member', owner: Array.isArray(m.roles) && m.roles.includes('owner') }]));
  }

  /* ---------- who is who: membership, the on/off switch, the persistence gate, then the eligibility hook ---------- */
  async function context(user, familyIdRaw, { needOn = true } = {}) {
    const ctx = await requireMember(user, familyIdRaw);
    brake(user.$id);
    const state = await getRowOrNull(T.state, ctx.familyId);
    const enabled = !!(state && state.enabled === true);
    if (needOn && (!enabled || !persistenceVerified)) throw NA();
    const mem = await memberMap(ctx.familyId);
    const mine = mem.get(user.$id);
    if (!mine) throw NA();
    if (needOn) {
      let ok = false;
      try { ok = (await eligibility({ user, familyId: ctx.familyId, isOwner: ctx.isOwner, membershipId: mine.mid })) === true; } catch (e) { ok = false; }
      if (!ok) throw NA();
    }
    const names = new Map([...mem].map(([id, v]) => [id, v.name]));
    let mods = [];
    if (needOn) { try { const m = await moderators({ user, familyId: ctx.familyId }); if (Array.isArray(m)) mods = m.filter((id) => typeof id === 'string' && mem.has(id)); } catch (e) { mods = []; } }
    return { ...ctx, me: user.$id, mid: mine.mid, enabled, mem, names, mods, isMod: mods.includes(user.$id) };
  }
  const nameOf = (c, id) => c.names.get(id) || 'Family member';
  /** True only while the person still holds the SAME membership instance that the right was created under. */
  const holds = (c, uid, mid) => !!uid && !!mid && !!c.mem.get(uid) && c.mem.get(uid).mid === mid;
  const ownerValid = (c, s) => holds(c, s.ownerId, s.ownerM);

  /* ---------- plain data helpers ---------- */
  const dataOf = (s) => { const d = s.data || {}; return { title: String(d.title || ''), category: String(d.category || ''), condition: String(d.condition || ''), description: String(d.description || ''), area: String(d.area || '') }; };
  const pendingOf = (s) => (s.pending ? dataOf({ data: s.pending }) : null);
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

  /* ---------- the chain: head, claim ---------- */
  /** The newest snapshot of a listing, or null. Always read from the chain, never from a hint row. A stale read here can only cause a harmless 409 later. */
  async function head(listingId) {
    const row = await firstRow(T.events, [Query.equal('listingId', [listingId]), Query.orderDesc('seq')]);
    if (!row) return null;
    const s = parse(row.state);
    if (!s || s.v !== 1 || !Array.isArray(s.reqs) || !Array.isArray(s.reps)) return null;
    return { ...s, $id: listingId, seq: row.seq };
  }
  async function headsOf(ids) {
    const uniq = [...new Set(ids)], out = new Map();
    for (let i = 0; i < uniq.length; i += 8) await Promise.all(uniq.slice(i, i + 8).map(async (id) => { out.set(id, await head(id)); }));
    return out;
  }
  const snapshot = (s) => { const { $id, seq, ...rest } = s; return JSON.stringify(rest); };
  async function noteEnded(s) {
    if (!TERMINAL.includes(s.status)) return;
    try { await updateRow(T.listings, s.id, { ended: true }); } catch (e) { /* a hint only; a missing flag over-counts, never under-counts, and is repaired when next counted */ }
  }
  /** build(head) validates against the FRESH head and returns { state, info }. It must throw instead of returning when the change is not allowed.
   *  The only write is the claim: one atomic insert. There is nothing to apply, repair or fence afterwards. */
  async function mutate(c, listingId, opId, kind, build) {
    const opKey = listingId + '_' + opId;
    for (let attempt = 0; attempt < 5; attempt++) {
      const dup = await firstRow(T.events, [Query.equal('opKey', [opKey])]);
      if (dup) { if (dup.actorId !== c.me) throw bad('opId is not valid.'); return { replay: true }; }
      const h = await head(listingId);
      if (!h || h.familyId !== c.familyId) throw NA();
      const out = await build(h);
      const next = out.state, seq = h.seq + 1, body = snapshot({ ...next, v: 1, id: listingId, familyId: c.familyId });
      if (Buffer.byteLength(body) > L.stateBytesMax) throw new ApiError(409, 'limit', 'This listing has grown too large to change.');
      try {
        await createRow(T.events, newId(), { familyId: c.familyId, listingId, seq, claimKey: listingId + '_' + seq, opKey, actorId: c.me, kind, state: body }, []);
      } catch (e) {
        if (sdkCode(e) === 409) continue;   // lost the claim, or a duplicate: re-check the duplicate key, re-read the head, validate again
        throw e;
      }
      await noteEnded(next);
      return { replay: false, info: out.info };
    }
    throw changed();
  }

  /* ---------- reach rules ---------- */
  const requestOf = (c, s, uid = c.me, mid = c.mid) => s.reqs.find((r) => r.uid === uid && r.m === mid) || null;
  async function reachable(c, listingId) {
    const s = await head(idOf(listingId, 'listingId'));
    if (!s || s.familyId !== c.familyId || !ownerValid(c, s)) throw NA();
    const mine = s.ownerId === c.me;
    const myReq = mine ? null : requestOf(c, s);
    if (s.status === 'draft' && !mine) throw NA();
    if (s.status === 'withdrawn' && !mine && !myReq) throw NA();
    if (s.status === 'hidden' && !mine && !(c.isMod && s.reps.length > 0)) throw NA();
    return { s, mine, myReq };
  }
  async function ownListing(c, listingId) {
    const s = await head(idOf(listingId, 'listingId'));
    if (!s || s.familyId !== c.familyId || s.ownerId !== c.me || !ownerValid(c, s)) throw NA();
    return s;
  }

  /* ---------- views: every response is built field by field, never from a stored snapshot ---------- */
  const card = (c, s) => ({ id: s.id, kind: s.kind, status: s.status, ...(({ title, category, condition, area }) => ({ title, category, condition, area }))(dataOf(s)), owner: nameOf(c, s.ownerId), mine: s.ownerId === c.me });
  function detail(c, s, mine, myReq) {
    if (s.status === 'hidden' && !mine) return { id: s.id, kind: s.kind, status: 'hidden', title: dataOf(s).title, description: dataOf(s).description, moderatorView: true };
    if (s.status === 'withdrawn' && !mine) return { id: s.id, kind: s.kind, status: 'withdrawn', title: dataOf(s).title, owner: nameOf(c, s.ownerId), myRequest: { id: myReq.id, status: myReq.st } };
    const v = { ...card(c, s), ...dataOf(s), rev: s.rev };
    if (mine) {
      v.requests = s.reqs.filter((r) => holds(c, r.uid, r.m)).map((r) => ({ id: r.id, from: nameOf(c, r.uid), status: r.st, note: r.note, at: r.at }));
      const res = s.resv, req = res ? s.reqs.find((r) => r.id === res.rid) : null;
      v.reservedFor = res && req ? { name: nameOf(c, res.uid), requestId: res.rid, unavailable: !holds(c, res.uid, res.m) } : null;
      v.pending = pendingOf(s);
      v.hiddenByModerator = s.status === 'hidden';
    } else {
      v.myRequest = myReq ? { id: myReq.id, status: myReq.st, note: myReq.note, reservedForMe: myReq.st === 'reserved' && s.status === 'reserved' && !!s.resv && s.resv.rid === myReq.id } : null;
    }
    return v;
  }
  async function fresh(c, listingId) { const { s, mine, myReq } = await reachable(c, listingId); return { listing: detail(c, s, mine, myReq) }; }

  /** Create-only hint rows. Getting one that already exists is not an error: the hint can only point at a listing, it never grants a right. */
  async function ensureHint(table, key, keyField, row, preferredId) {
    try { return await createRow(table, preferredId, { ...row, [keyField]: key }, []); }
    catch (e) {
      if (sdkCode(e) !== 409) throw e;
      const existing = await firstRow(table, [Query.equal(keyField, [key])]);
      if (existing) return existing;
      return createRow(table, newId(), { ...row, [keyField]: key }, []);
    }
  }
  /** Live listings this membership still owns. Counts the real state, so finishing or withdrawing a listing frees a place at once. Soft under simultaneous creates. */
  async function activeCount(c) {
    const rows = await inFamily(T.listings, c.familyId, [Query.equal('ownerMembership', [c.mid]), Query.equal('ended', [false])], L.listingsPerMember * 2);
    if (rows.length >= L.listingsPerMember * 2) return L.listingsPerMember;
    const heads = await headsOf(rows.map((r) => r.$id));
    let n = 0;
    for (const r of rows) {
      const s = heads.get(r.$id);
      if (!s) continue;                                   // a hint with no snapshot is not a listing
      if (TERMINAL.includes(s.status)) { await noteEnded(s); continue; }
      n++;
    }
    return n;
  }

  const actions = {
    async exchangeStatus({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      return { enabled: c.enabled, canTurnOn: c.isOwner, ready: persistenceVerified };
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
      const rows = await inFamily(T.listings, c.familyId, [...(body.finished === true ? [] : [Query.equal('ended', [false])]), Query.orderDesc('$createdAt')], L.homeMax);
      const heads = await headsOf(rows.map((r) => r.$id));
      return { listings: rows.map((r) => heads.get(r.$id)).filter((s) => s && statuses.includes(s.status) && ownerValid(c, s)).map((s) => card(c, s)) };
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
        const id = 'l' + opId;   // the retry key doubles as the listing id, so a repeated tap cannot make a second listing
        const existing = await getRowOrNull(T.listings, id);
        if (existing && (existing.ownerId !== c.me || existing.ownerMembership !== c.mid || existing.familyId !== c.familyId)) throw bad('opId is not valid.');
        if (!existing) {
          if ((await activeCount(c)) >= L.listingsPerMember) throw new ApiError(409, 'limit', 'You can have up to ' + L.listingsPerMember + ' listings. Finish or withdraw one to add another.');
          try { await createRow(T.listings, id, { familyId: c.familyId, ownerId: c.me, ownerMembership: c.mid, kind, ended: false }, []); }
          catch (e) { if (sdkCode(e) !== 409) throw e; }
        }
        const first = { v: 1, id, familyId: c.familyId, ownerId: c.me, ownerM: c.mid, kind, status: publish ? initialStatus(kind) : 'draft', rev: 1, hiddenFrom: '', data: d, pending: null, reqs: [], resv: null, reps: [] };
        try { await createRow(T.events, newId(), { familyId: c.familyId, listingId: id, seq: 1, claimKey: id + '_1', opKey: id + '_' + opId, actorId: c.me, kind: 'create', state: snapshot(first) }, []); }
        catch (e) { if (sdkCode(e) !== 409) throw e; }
        return { ...(await fresh(c, id)), saved: publish ? 'published' : 'draft' };
      }
      const s0 = await ownListing(c, body.listingId);
      const d = readDraft(body, s0.kind);
      const res = await mutate(c, s0.id, opId, 'edit', async (s) => {
        if (!ownerValid(c, s) || s.ownerId !== c.me) throw NA();
        if (Number(body.rev) !== s.rev) throw changed();
        if (s.status === 'draft') { s.data = d; s.rev++; if (publish) s.status = initialStatus(s.kind); return { state: s, info: { saved: publish ? 'published' : 'draft' } }; }
        if (s.status === 'available' || s.status === 'open') { s.data = d; s.pending = null; s.rev++; return { state: s, info: { saved: 'published' } }; }
        if (s.status === 'reserved') {
          if (!R.anyChanges(dataOf(s), d)) { s.pending = null; s.rev++; return { state: s, info: { saved: 'nochange' } }; }
          const material = R.materialChanges(dataOf(s), d);
          s.pending = d; s.rev++;
          return { state: s, info: { saved: 'private', blocked: publish, materialChanges: material } };
        }
        throw new ApiError(409, 'not_editable', 'This listing cannot be edited now.');
      });
      return { ...(await fresh(c, s0.id)), ...(res.info || {}) };
    },
    async exchangeListingDiscardPending({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), s0 = await ownListing(c, body.listingId);
      await mutate(c, s0.id, opId, 'discard', async (s) => { if (!ownerValid(c, s) || s.ownerId !== c.me) throw NA(); if (!s.pending) throw changed(); s.pending = null; s.rev++; return { state: s }; });
      return fresh(c, s0.id);
    },
    /** Mark gone / fulfilled / closed, or withdraw. Closes every open request and drops the reservation. */
    async exchangeListingEnd({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), s0 = await ownListing(c, body.listingId);
      const to = body.to;
      if (!['gone', 'fulfilled', 'closed', 'withdrawn'].includes(to)) throw bad('Choose how this ends.');
      await mutate(c, s0.id, opId, 'end', async (s) => {
        if (!ownerValid(c, s) || s.ownerId !== c.me) throw NA();
        const kindOk = to === 'withdrawn' || (to === 'gone' ? s.kind === 'free' : s.kind === 'wanted');
        if (!kindOk || !LIVE.includes(s.status)) throw changed();
        for (const r of s.reqs) if (r.st === 'waiting' || r.st === 'reserved') r.st = 'closed';
        s.resv = null; s.status = to; s.hiddenFrom = ''; s.pending = null; s.rev++;
        return { state: s };
      });
      return fresh(c, s0.id);
    },

    /** Ask (or ask again). Never reserves anyone. */
    async exchangeRequestCreate({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), { s: s0, mine } = await reachable(c, body.listingId);
      if (mine) throw bad('You cannot ask for your own listing.');
      const note = noteOf(body.note);
      const hint = await ensureHint(T.requests, s0.id + '_' + c.mid, 'requestKey', { familyId: c.familyId, listingId: s0.id, requesterId: c.me, requesterMembership: c.mid }, 'q' + opId);
      await mutate(c, s0.id, opId, 'ask', async (s) => {
        if (!ownerValid(c, s) || s.ownerId === c.me) throw NA();
        if (!LIVE.includes(s.status)) throw changed();
        const had = requestOf(c, s);
        if (had) {
          if (had.st === 'declined') throw new ApiError(409, 'declined', 'The owner did not choose your request.');
          if (had.st !== 'released' && had.st !== 'cancelled') throw new ApiError(409, 'already_asked', 'You already asked for this.');
          had.st = 'waiting'; had.note = note;
          return { state: s };
        }
        const open = s.reqs.filter((r) => r.st === 'waiting' || r.st === 'reserved').length;
        if (open >= L.requestsPerListing || s.reqs.length >= L.requestEntriesMax) throw new ApiError(409, 'limit', 'This listing has reached the most requests it can take.');
        s.reqs.push({ id: hint.$id, uid: c.me, m: c.mid, st: 'waiting', note, at: iso() });
        return { state: s };
      });
      return fresh(c, s0.id);
    },
    async exchangeRequestCancel({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), { s: s0, mine } = await reachable(c, body.listingId);
      if (mine) throw NA();
      await mutate(c, s0.id, opId, 'cancelask', async (s) => {
        const r = requestOf(c, s);
        if (!ownerValid(c, s) || !r || r.st !== 'waiting' || !LIVE.includes(s.status)) throw changed();
        r.st = 'cancelled';
        return { state: s };
      });
      return fresh(c, s0.id);
    },
    /** The reserved person backs out: the item returns to Available (or Open). */
    async exchangeCancelReservation({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), { s: s0, mine } = await reachable(c, body.listingId);
      if (mine) throw NA();
      await mutate(c, s0.id, opId, 'cancelresv', async (s) => {
        const r = requestOf(c, s);
        if (!ownerValid(c, s) || !r || r.st !== 'reserved' || s.status !== 'reserved' || !s.resv || s.resv.rid !== r.id || s.resv.m !== c.mid) throw changed();
        r.st = 'cancelled'; s.resv = null; s.status = initialStatus(s.kind); s.rev++;
        return { state: s };
      });
      return fresh(c, s0.id);
    },
    /** Owner confirms one waiting request. One person at a time. Others stay waiting and are told nothing.
     *  Before claiming, the chosen person is checked again against the CURRENT membership list and the eligibility hook (see "consistency boundary" in the progress file). */
    async exchangeReserve({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), s0 = await ownListing(c, body.listingId), requestId = idOf(body.requestId, 'requestId');
      await mutate(c, s0.id, opId, 'reserve', async (s) => {
        if (!ownerValid(c, s) || s.ownerId !== c.me) throw NA();
        const r = s.reqs.find((x) => x.id === requestId);
        if (!r || r.st !== 'waiting' || (s.status !== 'available' && s.status !== 'open') || s.resv) throw changed();
        const nowMembers = await memberMap(c.familyId);          // fresh read on every attempt, immediately before the claim
        const mm = nowMembers.get(r.uid);
        let ok = !!mm && mm.mid === r.m;
        if (ok) { try { ok = (await eligibility({ user: { $id: r.uid }, familyId: c.familyId, isOwner: mm.owner, membershipId: mm.mid })) === true; } catch (e) { ok = false; } }
        if (!ok) throw new ApiError(409, 'recipient_unavailable', 'That person cannot be chosen right now.');
        s.resv = { rid: r.id, uid: r.uid, m: r.m }; r.st = 'reserved'; s.status = 'reserved'; s.rev++;
        return { state: s };
      });
      return fresh(c, s0.id);
    },
    async exchangeRequestDecline({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), s0 = await ownListing(c, body.listingId), requestId = idOf(body.requestId, 'requestId');
      await mutate(c, s0.id, opId, 'decline', async (s) => {
        if (!ownerValid(c, s) || s.ownerId !== c.me) throw NA();
        const r = s.reqs.find((x) => x.id === requestId);
        if (!r || r.st !== 'waiting' || !LIVE.includes(s.status)) throw changed();
        r.st = 'declined';
        return { state: s };
      });
      return fresh(c, s0.id);
    },
    /** Owner releases: Available again, the former recipient's request becomes Released, other waiting requests stay waiting, private edits stay private. */
    async exchangeRelease({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body), s0 = await ownListing(c, body.listingId);
      await mutate(c, s0.id, opId, 'release', async (s) => {
        if (!ownerValid(c, s) || s.ownerId !== c.me) throw NA();
        if (s.status !== 'reserved' || !s.resv) throw changed();
        const r = s.reqs.find((x) => x.id === s.resv.rid);
        if (r) r.st = 'released';
        s.resv = null; s.status = initialStatus(s.kind); s.rev++;
        return { state: s };
      });
      return fresh(c, s0.id);
    },

    async exchangeActivity({ user, body }) {
      const c = await context(user, body.familyId);
      const [askRows, ownRows] = await Promise.all([
        inFamily(T.requests, c.familyId, [Query.equal('requesterId', [c.me]), Query.orderDesc('$createdAt')], 300),
        inFamily(T.listings, c.familyId, [Query.equal('ownerMembership', [c.mid]), Query.equal('ended', [false])], L.listingsPerMember * 2)
      ]);
      const heads = await headsOf([...askRows.map((r) => r.listingId), ...ownRows.map((r) => r.$id)]);
      const requests = [];
      for (const hint of askRows) {
        if (hint.requesterMembership !== c.mid) continue;
        const s = heads.get(hint.listingId);
        if (!s || s.familyId !== c.familyId || !ownerValid(c, s) || s.status === 'draft' || s.status === 'hidden') continue;
        const r = requestOf(c, s);
        if (!r) continue;
        requests.push({ requestId: r.id, status: r.st, listing: { id: s.id, title: dataOf(s).title, status: s.status, owner: nameOf(c, s.ownerId) }, reservedForMe: r.st === 'reserved' && s.status === 'reserved' && !!s.resv && s.resv.rid === r.id });
      }
      const mineLive = ownRows.map((r) => heads.get(r.$id)).filter((s) => s && s.ownerId === c.me && ownerValid(c, s));
      const needsReply = mineLive.filter((s) => (s.status === 'available' || s.status === 'open')).map((s) => ({ s, n: s.reqs.filter((r) => r.st === 'waiting' && holds(c, r.uid, r.m)).length })).filter((x) => x.n).map((x) => ({ id: x.s.id, title: dataOf(x.s).title, waiting: x.n }));
      const reserved = mineLive.filter((s) => s.status === 'reserved').map((s) => ({ id: s.id, title: dataOf(s).title, for: s.resv ? nameOf(c, s.resv.uid) : '' }));
      const hidden = mineLive.filter((s) => s.status === 'hidden').map((s) => ({ id: s.id, title: dataOf(s).title }));
      return { requests, needsReply, reserved, hidden };
    },
    async exchangeMine({ user, body }) {
      const c = await context(user, body.familyId);
      const rows = await inFamily(T.listings, c.familyId, [Query.equal('ownerMembership', [c.mid]), Query.orderDesc('$createdAt')], 200);
      const heads = await headsOf(rows.map((r) => r.$id));
      return { listings: rows.map((r) => heads.get(r.$id)).filter((s) => s && s.ownerId === c.me && ownerValid(c, s)).map((s) => card(c, s)) };
    },

    /** A report is stored only if an independent handler exists. Otherwise the reporter is told plainly, and nothing is stored or sent to the owner. */
    async exchangeReport({ user, body }) {
      const c = await context(user, body.familyId), { s, mine } = await reachable(c, body.listingId);
      if (mine) throw bad('You cannot report your own listing.');
      if (!REPORT_REASONS.includes(body.reason)) throw bad('Choose a reason.');
      const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
      if (detail.length > L.note) throw bad('Keep the detail to ' + L.note + ' characters or fewer.');
      if (!c.mods.some((id) => id !== s.ownerId)) throw new ApiError(409, 'escalation_unavailable', 'This report could not be sent because no independent reviewer is available right now.');
      if (s.reps.some((r) => r.uid === c.me && r.m === c.mid)) return { sent: true, already: true };
      const key = s.id + '_' + c.mid;
      const had = await firstRow(T.reports, [Query.equal('reportKey', [key])]);
      if (!had) {
        const today = (await inFamily(T.reports, c.familyId, [Query.equal('reporterId', [c.me])], 300)).filter((r) => Date.parse(r.$createdAt) > now() - DAY).length;
        if (today >= L.reportsPerDay) throw new ApiError(429, 'rate_limited', 'You have sent the most reports allowed for today.');
      }
      const hint = had || await ensureHint(T.reports, key, 'reportKey', { familyId: c.familyId, listingId: s.id, reporterId: c.me, reporterMembership: c.mid }, newId());
      const opId = 'r' + createHash('sha256').update(c.mid).digest('hex').slice(0, 20);   // one report per membership per listing, however many times it is sent
      const res = await mutate(c, s.id, opId, 'report', async (h) => {
        if (!ownerValid(c, h) || h.ownerId === c.me) throw NA();
        if (h.reps.some((r) => r.uid === c.me && r.m === c.mid)) throw new ApiError(200, 'already', 'already');
        if (h.reps.length >= L.reportsPerListing) throw new ApiError(409, 'limit', 'This listing has already been reported by several people.');
        h.reps.push({ id: hint.$id, uid: c.me, m: c.mid, reason: body.reason, detail, st: 'open', by: '', at: iso() });
        return { state: h };
      }).catch((e) => { if (e && e.code === 'already') return { replay: true }; throw e; });
      return res.replay ? { sent: true, already: true } : { sent: true };
    },
    async exchangeReportList({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.isMod) throw NA();
      const rows = await inFamily(T.reports, c.familyId, [Query.orderDesc('$createdAt')], 300);
      const heads = await headsOf(rows.map((r) => r.listingId)), out = [];
      for (const row of rows) {
        const s = heads.get(row.listingId);
        if (!s || s.familyId !== c.familyId || s.ownerId === c.me || !ownerValid(c, s)) continue;   // a report about your own listing is never shown to you: not its text, not its reporter, not a count
        const r = s.reps.find((x) => x.id === row.$id);
        if (!r) continue;
        out.push({ id: r.id, status: r.st, reason: r.reason, detail: r.detail, reporter: nameOf(c, r.uid), at: r.at, listing: { id: s.id, title: dataOf(s).title, status: s.status } });
      }
      return { reports: out };
    },
    async exchangeReportResolve({ user, body }) {
      const c = await context(user, body.familyId), opId = opIdOf(body);
      if (!c.isMod) throw NA();
      const reportId = idOf(body.reportId, 'reportId'), decision = body.decision;
      if (!['keep', 'hide', 'restore'].includes(decision)) throw bad('Choose keep, hide or restore.');
      const hint = await getRowOrNull(T.reports, reportId);
      if (!hint || hint.familyId !== c.familyId) throw NA();
      const s0 = await head(hint.listingId);
      if (!s0 || s0.familyId !== c.familyId || s0.ownerId === c.me || !ownerValid(c, s0)) throw NA();   // the accused never acts on, or learns of, a report about themselves
      await mutate(c, s0.id, opId, 'report-' + decision, async (s) => {
        if (s.ownerId === c.me || !ownerValid(c, s)) throw NA();
        const r = s.reps.find((x) => x.id === reportId);
        if (!r) throw NA();
        if (decision === 'keep' && r.st === 'open' && LIVE.includes(s.status)) { r.st = 'kept'; r.by = c.me; return { state: s }; }
        if (decision === 'hide' && r.st === 'open' && LIVE.includes(s.status)) { r.st = 'hidden'; r.by = c.me; s.hiddenFrom = s.status; s.status = 'hidden'; s.rev++; return { state: s }; }
        if (decision === 'restore' && r.st === 'hidden' && s.status === 'hidden') { r.st = 'kept'; r.by = c.me; s.status = s.hiddenFrom && LIVE.includes(s.hiddenFrom) ? s.hiddenFrom : initialStatus(s.kind); s.hiddenFrom = ''; s.rev++; return { state: s }; }
        throw changed();
      });
      return { ok: true };
    }
  };
  return { actions, EXCHANGE_TABLES, context };
}
