/*
 * Giving Center (family wishlists and gift reservations). All trusted logic lives here and runs inside family-api.
 * Ported from the Giving Center preview (giving-preview/giving-fake-server.js), which you tested on your phone. Same rules, real tables.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 *
 * STATUS: live, and off for each family until its owner turns it on. Nothing here runs for a family until its owner turns it on (givingSetEnabled), and the app has no screen for it yet.
 *
 * Trust model (same as board.js and chat.js)
 *  - `user` is the account Appwrite verified from the caller's own JWT. No body field can name a person.
 *  - The six giving tables have NO client permission at all: every read and write goes through an action below,
 *    which first checks the caller is a confirmed member of the family and that Giving Center is turned on for it.
 *  - Everyone is a kid until the owner, or a tree admin, marks them as an adult (never themselves). Owners are always adults.
 *    The flag is the `givingAdult` column on the person's profile row for that family (one row per family, so it is per family).
 *  - Surprise: the owner of a list, and every kid, receive NO reservation field of any kind. Reservations live in their own table and
 *    are never joined into list or item rows. No notice is created for the owner when someone reserves.
 *  - Anything the caller may not see (another family, nothing there, a hidden list, an adults-only list seen by a kid) answers the same way.
 */
import { Query, ID } from 'node-appwrite';
import { randomInt } from 'node:crypto';
import * as R from './giving-rules.js';

export const GIVING_TABLES = {
  lists: 'givingLists',               // familyId, ownerId, audience, hiddenAt, data (JSON: name)
  items: 'givingItems',               // familyId, listId, received, version, thumb (a small JPEG as text), data (JSON: title, notes, priority, url, priceCents, currency, photoId)
  reservations: 'givingReservations', // familyId, itemId (UNIQUE index), buyerId, version
  reports: 'givingReports',           // familyId, reporterId, kind, targetId, listId, data (JSON: reason, note)
  notices: 'givingNotices',           // familyId, userId, data (JSON: text)
  requests: 'givingRequests',         // familyId, ownerId, status (open|closed), approval (pending|approved), audience, hiddenAt, data (JSON: title, details, kind, needed, amount, neededBy)
  pledges: 'givingPledges',           // familyId, requestId, userId, status (pledged|done), pledgeKey (UNIQUE: requestId_userId), data (JSON: note)
  exchanges: 'givingExchanges',       // familyId, organiserId, status (open|drawn), round, data (JSON: name, date, limit, note, members, exclusions)
  exchangePairs: 'givingExchangePairs', // row id = the exchange's id; familyId, data (JSON: pairs). Private: only exchangeView reads it, and only to find the caller's own match
  gifts: 'givingGifts',               // familyId, organiserId, status (open|closed), data (JSON: title, note, forId, goalCents, eachCents, currency)
  giftParts: 'givingGiftParts',       // familyId, giftId, userId, status (marked|confirmed), partKey (UNIQUE: giftId_userId), data (JSON: cents, note)
  state: 'givingState'                // row id = familyId; enabled (bool), enabledBy, enabledAt
};
export const GIVING_LIMITS = { ...R.LIMITS, hideDays: 30, reportsPerPerson: 20, noticesShown: 20, perMinute: 60, thumbBytes: 10000, photoBytes: 250000, linkPicturesPer10Min: 10 };
const DAY = 864e5, HOUR = 36e5;
const MANAGER_NOTE = 'Ask another owner or tree admin to change your own setting.';

export function createGiving({ etsy, linkPicture, storage, photoBucket, teams, listRows, createRow, updateRow, deleteRow, getRowOrNull, firstRow, requireMember, idOf, bad, forbidden, missing, ApiError, sdkCode, now, profilesTable }) {
  const T = GIVING_TABLES, L = GIVING_LIMITS;
  const iso = (t) => new Date(t === undefined ? now() : t).toISOString();
  const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const NA = () => new ApiError(404, 'not_available', 'That is not available.');
  const invalid = (errors) => new ApiError(400, 'invalid', Object.values(errors)[0] || 'Check what you entered.');

  const linkHits = new Map();   // link pictures: a few tries per person per 10 minutes (in memory, so a brake)
  const hits = new Map();   // light per-person brake; it lives in memory, so it is a brake rather than a guarantee
  function brake(userId) {
    const k = userId, t = now(), from = t - 60000;
    const list = (hits.get(k) || []).filter((x) => x > from);
    if (list.length >= L.perMinute) { hits.set(k, list); throw new ApiError(429, 'rate_limited', 'You are doing that too quickly. Wait a few seconds and try again.'); }
    list.push(t); hits.set(k, list);
    if (hits.size > 2000) hits.delete(hits.keys().next().value);
  }

  async function all(tableId, queries, max) {
    const out = [];
    let cursor = null;
    while (out.length < max) {
      const q = [...queries, Query.limit(100)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await listRows(tableId, q);
      out.push(...page.rows);
      if (page.rows.length < 100) break;
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return out;
  }
  const inFamily = (tableId, familyId, extra = [], max = 5000) => all(tableId, [Query.equal('familyId', [familyId]), ...extra], max);

  /* ---------- who is who ---------- */
  async function context(user, familyIdRaw, { needOn = true } = {}) {
    const ctx = await requireMember(user, familyIdRaw);
    brake(user.$id);
    const res = await teams.listMemberships({ teamId: ctx.familyId, queries: [Query.limit(100)] });
    const joined = res.memberships.filter((m) => m.confirm === true);
    const profs = await inFamily(profilesTable, ctx.familyId, [], 400);
    const by = new Map(profs.map((p) => [p.userId, p]));
    const members = joined.map((m) => {
      const p = by.get(m.userId), owner = Array.isArray(m.roles) && m.roles.includes('owner');
      return { userId: m.userId, name: (p && p.displayName) || m.userName || 'Family member', owner, treeAdmin: !!(p && p.treeAdmin), adult: owner || !!(p && p.givingAdult === true) };
    });
    const me = members.find((m) => m.userId === user.$id) || { userId: user.$id, name: 'Someone', owner: ctx.isOwner, treeAdmin: false, adult: ctx.isOwner };
    const state = await getRowOrNull(T.state, ctx.familyId);
    const enabled = !!(state && state.enabled === true);
    if (needOn && !enabled) throw NA();
    return { ...ctx, members, me, enabled, manager: me.owner || me.treeAdmin, moderator: (me.owner || me.treeAdmin) && me.adult, names: new Map(members.map((m) => [m.userId, m.name])), byId: new Map(members.map((m) => [m.userId, m])) };
  }
  const nameOf = (c, id) => c.names.get(id) || 'Family member';

  /* ---------- reach rules ---------- */
  /** A list is reachable only if it exists in this family, is not hidden, its owner is still a member, and the viewer may see its audience. */
  function listOk(c, l) {
    if (!l || l.familyId !== c.familyId || l.hiddenAt || !c.names.has(l.ownerId)) return false;
    if (l.ownerId === c.me.userId) return true;
    if (l.audience === 'adults' && !c.me.adult) return false;
    return true;
  }
  async function listRow(c, id) {
    const l = await getRowOrNull(T.lists, idOf(id, 'listId'));
    if (!listOk(c, l)) throw NA();
    return l;
  }
  async function itemRow(c, id) {
    const it = await getRowOrNull(T.items, idOf(id, 'itemId'));
    if (!it || it.familyId !== c.familyId) throw NA();
    return { it, list: await listRow(c, it.listId) };
  }
  const liveRes = (c, r) => (r && r.familyId === c.familyId && c.names.has(r.buyerId) ? r : null);


  /* ---------- Gift exchanges (Phase C). The draw lives in its own table and is never returned to anyone but its giver, as one person. ---------- */
  const EX = R.EXCHANGE;
  const secureRand = () => randomInt(0, 2 ** 31) / 2 ** 31;
  const exData = (x) => { const d = parse(x.data); return { name: d.name || '', date: d.date || '', limit: d.limit || '', note: d.note || '', members: Array.isArray(d.members) ? d.members : [], exclusions: Array.isArray(d.exclusions) ? d.exclusions : [] }; };
  const exOk = (c, x) => !!(x && x.familyId === c.familyId && c.names.has(x.organiserId) && c.me.adult);
  async function exRow(c, id) { const x = await getRowOrNull(T.exchanges, idOf(id, 'exchangeId')); if (!exOk(c, x)) throw NA(); return x; }
  const exLive = (c, d) => d.members.filter((u) => c.byId.has(u) && c.byId.get(u).adult);
  async function pairsOf(x) { const row = await getRowOrNull(T.exchangePairs, x.$id); return row ? (parse(row.data).pairs || {}) : {}; }
  async function savePairs(x, familyId, pairs) {
    const data = JSON.stringify({ pairs });
    if (await getRowOrNull(T.exchangePairs, x.$id)) await updateRow(T.exchangePairs, x.$id, { data }); else await createRow(T.exchangePairs, x.$id, { familyId, data }, []);
  }
  function exRowView(c, x) {
    const d = exData(x);
    return { id: x.$id, name: d.name, date: d.date, limit: d.limit, status: x.status === 'drawn' ? 'drawn' : 'open', organiserName: nameOf(c, x.organiserId), mine: x.organiserId === c.me.userId, joined: d.members.includes(c.me.userId), count: exLive(c, d).length };
  }
  async function exView(c, x) {
    const d = exData(x), v = { ...exRowView(c, x), note: d.note, round: x.round || 0 };
    v.members = exLive(c, d).map((u) => ({ userId: u, name: nameOf(c, u), organiser: u === x.organiserId, me: u === c.me.userId }));
    if (x.organiserId === c.me.userId) {
      v.exclusions = d.exclusions.filter((p) => c.names.has(p[0]) && c.names.has(p[1])).map((p) => [{ userId: p[0], name: nameOf(c, p[0]) }, { userId: p[1], name: nameOf(c, p[1]) }]);
      v.canAdd = x.status === 'drawn' ? [] : c.members.filter((m) => m.adult && !d.members.includes(m.userId)).map((m) => ({ userId: m.userId, name: m.name }));
    }
    if (x.status === 'drawn' && d.members.includes(c.me.userId)) {
      const r = (await pairsOf(x))[c.me.userId];
      if (r && c.byId.has(r) && c.byId.get(r).adult) {
        const lists = (await inFamily(T.lists, c.familyId)).filter((l) => l.ownerId === r && listOk(c, l));
        const out = [];
        for (const l of lists) out.push({ id: l.$id, name: parse(l.data).name || '', count: (await all(T.items, [Query.equal('listId', [l.$id])], L.items + 20)).filter((i) => !i.received).length });
        v.match = { name: nameOf(c, r), lists: out };
      } else v.matchLeft = true;
    }
    return v;
  }
  async function exDrop(c, x, userId, why) {
    const d = exData(x), wasDrawn = x.status === 'drawn';
    d.members = d.members.filter((u) => u !== userId); d.exclusions = d.exclusions.filter((p) => p[0] !== userId && p[1] !== userId);
    await updateRow(T.exchanges, x.$id, { data: JSON.stringify(d) });
    if (!wasDrawn) return;
    const pairs = await pairsOf(x), givers = Object.keys(pairs).filter((g) => pairs[g] === userId);
    delete pairs[userId]; givers.forEach((g) => { delete pairs[g]; });
    await savePairs(x, c.familyId, pairs);
    for (const g of givers) await notify(c, g, 'Your match for ' + d.name + ' left the exchange. ' + nameOf(c, x.organiserId) + ' can draw again.');
    if (userId !== x.organiserId) await notify(c, x.organiserId, nameOf(c, userId) + ' ' + why + ' ' + d.name + '. You can draw again for everyone, or leave it as it is.');
  }
  async function exDraw(c, x, again) {
    const d = exData(x), ids = exLive(c, d);
    if (ids.length < EX.min) throw new ApiError(400, 'too_few', 'You need at least ' + EX.min + ' people to draw names.');
    const res = R.drawPairs(ids, d.exclusions, secureRand);
    if (!res.ok) throw new ApiError(400, 'cannot_draw', R.EXCHANGE_NO_DRAW);
    await savePairs(x, c.familyId, res.pairs);
    const saved = await updateRow(T.exchanges, x.$id, { status: 'drawn', round: (x.round || 0) + 1 });
    for (const u of ids) if (u !== c.me.userId) await notify(c, u, d.name + (again ? ' was drawn again. Tap to see who you have now.' : ' has been drawn. Tap to see who you have.'));
    return saved;
  }


  /* ---------- Group gifts (Phase D1). A tracker only: no money is taken, held or sent. The person a gift is for never reaches it. ---------- */
  const GF = R.GIFT;
  const gData = (g) => { const d = parse(g.data); return { title: d.title || '', note: d.note || '', forId: d.forId || '', goalCents: d.goalCents || 0, eachCents: d.eachCents || 0, currency: d.currency || 'USD' }; };
  const gOk = (c, g) => !!(g && g.familyId === c.familyId && c.me.adult && c.names.has(g.organiserId) && gData(g).forId !== c.me.userId);
  async function gRow(c, id) { const g = await getRowOrNull(T.gifts, idOf(id, 'giftId')); if (!gOk(c, g)) throw NA(); return g; }
  const partsOf = (g) => all(T.giftParts, [Query.equal('giftId', [g.$id])], GF.contributions + 20);
  const partData = (p) => { const d = parse(p.data); return { cents: d.cents || 0, note: d.note || '' }; };
  const gTotals = (c, parts) => { let conf = 0, pend = 0; for (const p of parts) if (c.names.has(p.userId)) { if (p.status === 'confirmed') conf += partData(p).cents; else pend += partData(p).cents; } return { confirmedCents: conf, pendingCents: pend }; };
  function gRowView(c, g, parts) {
    const d = gData(g), t = gTotals(c, parts), mine = parts.find((p) => p.userId === c.me.userId);
    const v = { id: g.$id, title: d.title, forName: d.forId ? nameOf(c, d.forId) : '', status: g.status === 'closed' ? 'closed' : 'open', currency: d.currency, goalCents: d.goalCents, confirmedCents: t.confirmedCents, organiserName: nameOf(c, g.organiserId), mine: g.organiserId === c.me.userId, reached: t.confirmedCents >= d.goalCents };
    if (mine) { v.myCents = partData(mine).cents; v.myStatus = mine.status; }
    if (v.mine) v.pendingCents = t.pendingCents;
    return v;
  }
  function gView(c, g, parts) {
    const d = gData(g), v = { ...gRowView(c, g, parts), note: d.note, eachCents: d.eachCents };
    const mine = parts.find((p) => p.userId === c.me.userId); if (mine) v.myNote = partData(mine).note;
    if (v.mine) {   // only the organiser ever receives who gave what
      v.contributions = parts.filter((p) => c.names.has(p.userId)).map((p) => ({ userId: p.userId, name: nameOf(c, p.userId), cents: partData(p).cents, status: p.status, note: partData(p).note }));
      v.canRecord = c.members.filter((m) => m.adult && m.userId !== d.forId && m.userId !== c.me.userId && !parts.some((p) => p.userId === m.userId)).map((m) => ({ userId: m.userId, name: m.name }));
    }
    return v;
  }
  async function gSetPart(c, g, parts, userId, cents, note, status) {
    const data = JSON.stringify({ cents, note }), key = g.$id + '_' + userId, old = parts.find((p) => p.userId === userId);
    if (old) return updateRow(T.giftParts, old.$id, { status, data });
    if (parts.length >= GF.contributions) throw new ApiError(400, 'full', 'This group gift already has ' + GF.contributions + ' contributions.');
    try { return await createRow(T.giftParts, ID.unique(), { familyId: c.familyId, giftId: g.$id, userId, status, partKey: key, data }, []); }
    catch (e) { if (sdkCode(e) !== 409) throw e; const again = (await listRows(T.giftParts, [Query.equal('partKey', [key]), Query.limit(1)])).rows[0]; if (!again) throw e; return updateRow(T.giftParts, again.$id, { status, data }); }
  }
  async function gOut(c, g) { return { gift: gView(c, g, await partsOf(g)) }; }

  /* ---------- shapes ---------- */
  function itemView(c, it, list, res) {
    const d = parse(it.data);
    const v = { id: it.$id, listId: it.listId, title: d.title || '', notes: d.notes || '', priority: d.priority || 'medium', url: d.url || '', priceCents: d.priceCents || 0, currency: d.currency || '', received: !!it.received, mine: list.ownerId === c.me.userId };
    if (d.photoId && it.thumb) v.thumb = it.thumb;   // a small picture, kept in the row; the full picture is fetched on request
    if (v.mine) return v;                       // the owner gets NO reservation fields of any kind
    if (!c.me.adult) { v.kid = true; return v; } // a kid gets none either, and cannot reserve
    const r = liveRes(c, res);
    v.reserved = !!r;
    if (r && r.buyerId === c.me.userId) { v.reservedByMe = true; v.changedSinceReserved = (r.version || 1) !== (it.version || 1); }
    return v;
  }
  function listSummary(c, l, items, resByItem) {
    const live = items.filter((i) => !i.received);
    const s = { id: l.$id, name: parse(l.data).name || '', audience: l.audience === 'adults' ? 'adults' : 'everyone', ownerId: l.ownerId, ownerName: nameOf(c, l.ownerId), mine: l.ownerId === c.me.userId, itemCount: live.length, receivedCount: items.length - live.length };
    if (!s.mine && c.me.adult) s.availableCount = live.filter((i) => !liveRes(c, resByItem.get(i.$id))).length;
    return s;
  }
  const byItem = (rows) => new Map(rows.map((r) => [r.itemId, r]));

  async function notify(c, userId, text) {
    if (!c.names.has(userId)) return;
    await createRow(T.notices, ID.unique(), { familyId: c.familyId, userId, data: JSON.stringify({ text }) }, []);
  }


  /* ---------- requests and pledges (Phase A) ---------- */
  const RQ = R.REQ;
  /** Reachable if it exists in this family, is not hidden, its owner is still a member, and the viewer may see it:
   *  approved ones follow the audience rule; one waiting for approval is seen only by its owner and by adult owners/tree admins. */
  function requestOk(c, r) {
    if (!r || r.familyId !== c.familyId || r.hiddenAt || !c.names.has(r.ownerId)) return false;
    if (r.ownerId === c.me.userId) return true;
    if (r.audience === 'chosen') return c.me.adult && (parse(r.data).helpers || []).includes(c.me.userId);   // an emergency: only the owner and the adults they chose (not admins)
    if (r.approval !== 'approved') return c.moderator;
    if (r.audience === 'adults' && !c.me.adult) return false;
    return true;
  }
  /** An emergency closes itself once its 48 hours are up (checked whenever it is read). */
  async function settle(r) {
    if (r && r.audience === 'chosen' && r.status !== 'closed' && now() >= (parse(r.data).expiresAt || 0)) { await updateRow(T.requests, r.$id, { status: 'closed' }); r.status = 'closed'; }
    return r;
  }
  async function requestRow(c, id) {
    const r = await getRowOrNull(T.requests, idOf(id, 'requestId'));
    if (!requestOk(c, r)) throw NA();
    return settle(r);
  }
  function requestView(c, r, pledgeRows, full) {
    const d = parse(r.data), live = pledgeRows.filter((p) => c.names.has(p.userId));
    const v = { id: r.$id, title: d.title || '', details: d.details || '', kind: d.kind || 'thing', kindLabel: R.REQUEST_KINDS[d.kind] || R.REQUEST_KINDS.thing, needed: d.needed || 1, amount: d.amount || '', neededBy: d.neededBy || '',
      audience: r.audience === 'adults' ? 'adults' : 'everyone', ownerName: nameOf(c, r.ownerId), mine: r.ownerId === c.me.userId, status: r.status === 'closed' ? 'closed' : 'open', approval: r.approval === 'approved' ? 'approved' : 'pending',
      pledgedCount: live.length, doneCount: live.filter((p) => p.status === 'done').length };
    v.stillNeeded = Math.max(0, v.needed - live.length);
    if (r.audience === 'chosen') {
      v.audience = 'chosen'; v.urgent = true; v.etype = d.etype || 'other'; v.etypeLabel = R.EMERGENCY_TYPES[d.etype] || ''; v.where = d.where || ''; v.pickup = d.pickup || ''; v.dropoff = d.dropoff || ''; v.loc = d.loc || null;
      v.hoursLeft = v.status === 'open' ? Math.max(0, Math.ceil(((d.expiresAt || 0) - now()) / HOUR)) : 0;
      if (v.mine) v.helperNames = (d.helpers || []).map((id) => nameOf(c, id));
    }
    if (full) {
      v.pledges = live.sort((a, b) => String(a.$createdAt).localeCompare(String(b.$createdAt))).map((p) => ({ id: p.$id, userId: p.userId, name: nameOf(c, p.userId), note: parse(p.data).note || '', eta: parse(p.data).eta || '', etaLabel: R.ETA[parse(p.data).eta] || '', status: p.status === 'done' ? 'done' : 'pledged', mine: p.userId === c.me.userId }));
      const mine = live.find((p) => p.userId === c.me.userId); if (mine) v.myPledgeId = mine.$id;
    }
    return v;
  }
  const pledgesFor = (requestId) => all(T.pledges, [Query.equal('requestId', [requestId])], RQ.pledges + 20);
  async function removeRequest(c, r, reason) {
    const title = parse(r.data).title || 'a request';
    for (const p of await pledgesFor(r.$id)) { if (reason && c.notify) await notify(c, p.userId, reason.replace('{request}', title)); await deleteRow(T.pledges, p.$id); }
    await dropReports('request', r.$id);
    await deleteRow(T.requests, r.$id);
  }
  const openCountOf = async (c, userId) => (await all(T.requests, [Query.equal('familyId', [c.familyId]), Query.equal('ownerId', [userId])], RQ.open + 20)).filter((x) => !x.hiddenAt && x.status !== 'closed' && x.audience !== 'chosen').length;
  /** A request whose owner left is hidden at once and deleted after 30 days (like wishlists); pledges made by people who left are removed (done ones too, there is nobody left to thank). */
  async function tidyRequests(c, rows) {
    for (const r of rows) {
      if (!r.hiddenAt && !c.names.has(r.ownerId)) { await updateRow(T.requests, r.$id, { hiddenAt: iso() }); r.hiddenAt = iso(); }
      else if (r.hiddenAt && Date.parse(r.hiddenAt) < now() - L.hideDays * DAY) await removeRequest({ ...c, notify: false }, r, '');
      else if (r.audience === 'chosen' && (parse(r.data).expiresAt || 0) < now() - L.hideDays * DAY) await removeRequest({ ...c, notify: false }, r, '');
    }
    for (const p of await inFamily(T.pledges, c.familyId)) if (!c.names.has(p.userId)) await deleteRow(T.pledges, p.$id);
  }

  /* ---------- removal helpers (take {familyId} so the scheduled cleanup can use them too) ---------- */
  async function dropReservations(c, itemId, reason, title) {
    const rows = await all(T.reservations, [Query.equal('itemId', [itemId])], 10);
    for (const r of rows) {
      await deleteRow(T.reservations, r.$id);
      if (reason && c.notify) await notify(c, r.buyerId, reason.replace('{item}', title || 'an item'));
    }
  }
  async function dropReports(kind, targetId) {
    const rows = await all(T.reports, [Query.equal('targetId', [targetId]), Query.equal('kind', [kind])], 200);
    for (const r of rows) await deleteRow(T.reports, r.$id);
  }
  async function dropPhoto(fileId) {
    if (!fileId || !storage) return;
    try { await storage.deleteFile({ bucketId: photoBucket, fileId }); } catch (e) { /* already gone, or storage not set up: nothing to delete */ }
  }
  async function removeItem(c, it, reason) {
    await dropPhoto(parse(it.data).photoId);
    await dropReservations(c, it.$id, reason, parse(it.data).title);
    await dropReports('item', it.$id);
    await deleteRow(T.items, it.$id);
  }
  async function removeList(c, l, reason) {
    const items = await all(T.items, [Query.equal('listId', [l.$id])], L.items + 20);
    for (const it of items) await removeItem(c, it, reason);
    await dropReports('list', l.$id);
    await deleteRow(T.lists, l.$id);
  }
  /** Hide lists whose owner left (30 days, then delete), release reservations held by people who left. Runs when the home screen loads. */
  async function tidy(c) {
    const lists = await inFamily(T.lists, c.familyId);
    for (const l of lists) {
      if (!l.hiddenAt && !c.names.has(l.ownerId)) {
        const items = await all(T.items, [Query.equal('listId', [l.$id])], L.items + 20);
        for (const it of items) await dropReservations({ ...c, notify: true }, it.$id, 'An item you reserved ({item}) is no longer available.', parse(it.data).title);
        await updateRow(T.lists, l.$id, { hiddenAt: iso() });
      } else if (l.hiddenAt && Date.parse(l.hiddenAt) < now() - L.hideDays * DAY) {
        await removeList({ ...c, notify: false }, l, '');
      }
    }
    const res = await inFamily(T.reservations, c.familyId);
    for (const r of res) if (!c.names.has(r.buyerId)) await deleteRow(T.reservations, r.$id);
  }
  /** Scheduled cleanup: delete lists that have been hidden for 30 days, in every family. */
  async function sweepGiving(deadline) {
    const cutoff = iso(now() - L.hideDays * DAY);
    let purged = 0;
    while (now() < deadline) {
      const page = await listRows(T.lists, [Query.lessThan('hiddenAt', cutoff), Query.limit(25)]);
      if (!page.rows.length) break;
      for (const l of page.rows) { await removeList({ familyId: l.familyId, notify: false }, l, ''); purged += 1; }
    }
    while (now() < deadline) {
      const page = await listRows(T.requests, [Query.lessThan('hiddenAt', cutoff), Query.limit(25)]);
      if (!page.rows.length) break;
      for (const r of page.rows) { await removeRequest({ familyId: r.familyId, notify: false }, r, ''); purged += 1; }
    }
    return { purged };
  }


  /** A picture sent as a data address. Only JPEG, checked by its first bytes (never by what the sender says it is), and only up to the size limit. */
  const JPEG_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;
  function jpegOf(url, max, label) {
    const m = typeof url === 'string' ? JPEG_URL.exec(url) : null;
    if (!m) throw bad('Choose a JPEG, PNG or WebP picture.');
    const buf = Buffer.from(m[1], 'base64');
    if (!buf.length || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('That picture could not be read.');
    if (buf.length > max) throw bad('The ' + label + ' picture is too large. Try a smaller picture.');
    return buf;
  }

  const setupHint = (e) => { if (sdkCode(e) === 400) throw bad('Giving Center needs one more setup step: add the givingAdult column to the profiles table (see GIVING-CENTER-SETUP.md).'); throw e; };

  const actions = {
    /** Anyone in the family can ask. Never refused just because the feature is off. */
    async givingStatus({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      return { enabled: c.enabled, canTurnOn: c.isOwner };
    },
    async givingSetEnabled({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      if (!c.isOwner) throw forbidden('Only the family owner can turn Giving Center on or off.');
      const enabled = body.enabled === true;
      const row = await getRowOrNull(T.state, c.familyId);
      const data = { familyId: c.familyId, enabled, enabledBy: user.$id, enabledAt: iso() };
      if (row) await updateRow(T.state, c.familyId, data); else await createRow(T.state, c.familyId, data, []);
      return { enabled };
    },

    async givingHome({ user, body }) {
      const c = await context(user, body.familyId);
      await tidy(c);
      const [lists, items, res, notes] = await Promise.all([
        inFamily(T.lists, c.familyId), inFamily(T.items, c.familyId), inFamily(T.reservations, c.familyId),
        listRows(T.notices, [Query.equal('familyId', [c.familyId]), Query.equal('userId', [user.$id]), Query.orderDesc('$createdAt'), Query.limit(L.noticesShown)])
      ]);
      const rb = byItem(res), mineFirst = (l) => (l.ownerId === c.me.userId ? 0 : 1);
      const visible = lists.filter((l) => listOk(c, l)).sort((a, b) => mineFirst(a) - mineFirst(b) || String(a.$createdAt).localeCompare(String(b.$createdAt)));
      const summaries = visible.map((l) => listSummary(c, l, items.filter((i) => i.listId === l.$id), rb));
      const vis = new Map(visible.map((l) => [l.$id, l]));
      const mine = !c.me.adult ? [] : res.filter((r) => r.buyerId === user.$id).map((r) => {
        const it = items.find((i) => i.$id === r.itemId), l = it && vis.get(it.listId);
        return l ? { itemId: it.$id, title: parse(it.data).title || '', listId: l.$id, ownerName: nameOf(c, l.ownerId), changedSinceReserved: (r.version || 1) !== (it.version || 1) } : null;
      }).filter(Boolean);
      const out = { lists: summaries, reservations: mine, notices: notes.rows.map((n) => ({ id: n.$id, text: parse(n.data).text || '' })), canCreateList: summaries.filter((x) => x.mine).length < L.lists, me: { adult: c.me.adult }, canManageAges: c.manager, canModerate: c.moderator };
      { const rq = (await inFamily(T.requests, c.familyId, [], 600)).filter((q) => requestOk(c, q)); out.requests = { open: rq.filter((q) => q.approval === 'approved' && q.status !== 'closed' && q.audience !== 'chosen').length, urgent: rq.filter((q) => q.audience === 'chosen' && q.status !== 'closed' && q.ownerId !== user.$id && now() < (parse(q.data).expiresAt || 0)).length }; if (c.moderator) out.requests.waiting = rq.filter((q) => q.audience !== 'chosen' && q.approval !== 'approved' && q.ownerId !== user.$id).length; }
      if (c.me.adult) out.exchanges = (await inFamily(T.exchanges, c.familyId, [], 200)).filter((x) => exOk(c, x) && exData(x).members.includes(user.$id)).length;
      if (c.me.adult) out.gifts = (await inFamily(T.gifts, c.familyId, [], 200)).filter((g) => gOk(c, g) && g.status === 'open').length;
      if (c.moderator) out.openReports = (await inFamily(T.reports, c.familyId)).length;   // everyone else gets no report field at all
      return out;
    },
    async givingNoticeDismiss({ user, body }) {
      const c = await context(user, body.familyId);
      const n = await getRowOrNull(T.notices, idOf(body.noticeId, 'noticeId'));
      if (n && n.familyId === c.familyId && n.userId === user.$id) await deleteRow(T.notices, n.$id);
      return {};
    },

    async givingListGet({ user, body }) {
      const c = await context(user, body.familyId);
      const l = await listRow(c, body.listId);
      const rows = await all(T.items, [Query.equal('listId', [l.$id]), Query.orderAsc('$createdAt')], L.items + 20);
      const rb = byItem(rows.length ? await all(T.reservations, [Query.equal('itemId', rows.map((r) => r.$id))], 200) : []);
      const views = rows.map((i) => itemView(c, i, l, rb.get(i.$id)));
      return { list: listSummary(c, l, rows, rb), items: views, me: { adult: c.me.adult }, totals: l.ownerId === c.me.userId ? R.totalsByCurrency(views) : undefined };
    },
    async givingListSave({ user, body }) {
      const c = await context(user, body.familyId);
      const v = R.validateList(body); if (!v.ok) throw invalid(v.errors);
      const audience = body.audience === undefined ? undefined : (R.AUDIENCES[body.audience] ? body.audience : 'everyone');
      if (audience === 'adults' && !c.me.adult) throw new ApiError(403, 'adults_only', 'Only adults can make a wishlist adults only.');
      const summary = async (l) => { const rows = await all(T.items, [Query.equal('listId', [l.$id])], L.items + 20); return listSummary(c, l, rows, new Map()); };
      if (body.listId) {
        const l = await listRow(c, body.listId);
        if (l.ownerId !== user.$id) throw NA();
        const patch = { data: JSON.stringify({ ...parse(l.data), name: v.value.name }) };
        if (audience) { if (!c.me.adult && audience !== l.audience) throw new ApiError(403, 'adults_only', 'Only adults can change who sees a wishlist.'); patch.audience = audience; }
        const saved = await updateRow(T.lists, l.$id, patch);
        return { list: await summary({ ...l, ...saved, ...patch }) };
      }
      const mineCount = (await all(T.lists, [Query.equal('familyId', [c.familyId]), Query.equal('ownerId', [user.$id])], L.lists + 5)).filter((x) => !x.hiddenAt).length;
      if (mineCount >= L.lists) throw new ApiError(409, 'limit', 'You can have up to ' + L.lists + ' wishlists. Delete one to add another.');
      const row = await createRow(T.lists, ID.unique(), { familyId: c.familyId, ownerId: user.$id, audience: audience || 'everyone', data: JSON.stringify({ name: v.value.name }) }, []);
      return { list: await summary(row) };
    },
    async givingListDelete({ user, body }) {
      const c = await context(user, body.familyId);
      const l = await listRow(c, body.listId);
      if (l.ownerId !== user.$id) throw NA();
      await removeList({ ...c, notify: true }, l, 'A wishlist with an item you reserved ({item}) was removed.');
      return {};
    },

    async givingItemSave({ user, body }) {
      const c = await context(user, body.familyId);
      const l = await listRow(c, body.listId);
      if (l.ownerId !== user.$id) throw NA();
      const v = R.validateItem(body); if (!v.ok) throw invalid(v.errors);
      if (body.itemId) {
        const it = await getRowOrNull(T.items, idOf(body.itemId, 'itemId'));
        if (!it || it.listId !== l.$id) throw NA();
        const o = parse(it.data), n = v.value;
        const material = o.title !== n.title || (o.url || '') !== n.url || (o.priceCents || 0) !== n.priceCents || (o.currency || '') !== n.currency;   // notes and priority are not a change a buyer needs to hear about
        const patch = { data: JSON.stringify({ ...o, ...n }), ...(material ? { version: (it.version || 1) + 1 } : {}) };   // keeps the photo id
        await updateRow(T.items, it.$id, patch);
        return { item: itemView(c, { ...it, ...patch }, l, null) };
      }
      const count = (await all(T.items, [Query.equal('listId', [l.$id])], L.items + 5)).length;
      if (count >= L.items) throw new ApiError(409, 'limit', 'A wishlist can have up to ' + L.items + ' items.');
      const row = await createRow(T.items, ID.unique(), { familyId: c.familyId, listId: l.$id, received: false, version: 1, data: JSON.stringify(v.value) }, []);
      return { item: itemView(c, row, l, null) };
    },
    async givingItemDelete({ user, body }) {
      const c = await context(user, body.familyId);
      const { it, list } = await itemRow(c, body.itemId);
      if (list.ownerId !== user.$id) throw NA();
      await removeItem({ ...c, notify: true }, it, 'An item you reserved ({item}) is no longer on the wishlist.');
      return {};
    },
    async givingItemReceived({ user, body }) {
      const c = await context(user, body.familyId);
      const { it, list } = await itemRow(c, body.itemId);
      if (list.ownerId !== user.$id) throw NA();
      const received = body.received !== false;
      await updateRow(T.items, it.$id, { received });
      if (received) await dropReservations({ ...c, notify: true }, it.$id, 'An item you reserved ({item}) was marked received.', parse(it.data).title);
      return { item: itemView(c, { ...it, received }, list, null) };
    },

    /* ----- photos (the owner of a list adds one picture per item) ----- */
    async givingPhotoSave({ user, body }) {
      const c = await context(user, body.familyId);
      const { it, list } = await itemRow(c, body.itemId);
      if (list.ownerId !== user.$id) throw NA();
      const thumb = jpegOf(body.thumb, L.thumbBytes, 'small'), full = jpegOf(body.photo, L.photoBytes, 'full-size');
      if (!storage) throw bad('Photos are not set up yet.');
      const fileId = ID.unique(), d = parse(it.data);
      try { await storage.createFile({ bucketId: photoBucket, fileId, file: new File([full], 'photo.jpg', { type: 'image/jpeg' }), permissions: [] }); }
      catch (e) { if (sdkCode(e) === 404) throw bad('Photos need one more setup step: check the storage bucket name (see GIVING-CENTER-SETUP.md).'); throw e; }
      const patch = { thumb: 'data:image/jpeg;base64,' + thumb.toString('base64'), data: JSON.stringify({ ...d, photoId: fileId }) };
      try { await updateRow(T.items, it.$id, patch); } catch (e) { await dropPhoto(fileId); if (sdkCode(e) === 400) throw bad('Photos need one more setup step: add the thumb column to the givingItems table (see GIVING-CENTER-SETUP.md).'); throw e; }
      await dropPhoto(d.photoId);
      return { item: itemView(c, { ...it, ...patch }, list, null) };
    },
    async givingPhotoRemove({ user, body }) {
      const c = await context(user, body.familyId);
      const { it, list } = await itemRow(c, body.itemId);
      if (list.ownerId !== user.$id) throw NA();
      const d = parse(it.data), photoId = d.photoId; delete d.photoId;
      const patch = { thumb: '', data: JSON.stringify(d) };
      await updateRow(T.items, it.$id, patch);
      await dropPhoto(photoId);
      return { item: itemView(c, { ...it, ...patch }, list, null) };
    },
    /** The full-size picture, for anyone who is allowed to see the item (the same checks as the list itself). */
    async givingPhotoGet({ user, body }) {
      const c = await context(user, body.familyId);
      const { it } = await itemRow(c, body.itemId);
      const photoId = parse(it.data).photoId;
      if (!photoId || !storage) throw NA();
      let bytes;
      try { bytes = await storage.getFileDownload({ bucketId: photoBucket, fileId: photoId }); } catch (e) { if (sdkCode(e) === 404) throw NA(); throw e; }
      return { photo: 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64') };
    },

    /** Only when the person taps "Get a picture from the link": visits the link they typed (see link-picture.js for the safety rules)
     *  and returns its preview picture. The app then shrinks it and saves it like an uploaded photo. Nothing is stored here. */
    async givingLinkPicture({ user, body }) {
      const c = await context(user, body.familyId);
      const url = R.cleanUrl(body.url);
      if (!url) throw new ApiError(400, 'invalid', 'Enter a web address that starts with https:// first.');
      if (!linkPicture) throw new ApiError(503, 'no_picture', 'Getting pictures from links is not available right now. You can add your own photo instead.');
      const t = now(), from = t - 600000, list = (linkHits.get(user.$id) || []).filter((x) => x > from);
      if (list.length >= L.linkPicturesPer10Min) throw new ApiError(429, 'rate_limited', 'You have tried several links. Wait a few minutes and try again, or add your own photo.');
      list.push(t); linkHits.set(user.$id, list); if (linkHits.size > 2000) linkHits.delete(linkHits.keys().next().value);
      try {
        const { mime, bytes } = await linkPicture(url);
        return { image: 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64'), host: new URL(url).hostname.replace(/^www\./, '') };
      } catch (e) {
        if (e && e.linkPicture) throw new ApiError(422, 'no_picture', (e.kind === 'blocked' ? 'That shop does not let Family Circle look at its pages (it shows a robot check). Save the picture to your phone and add it with the photo picker instead.' : e.kind === 'slow' ? 'That shop did not answer in time. Big shops often block this. Save the picture to your phone and add it with the photo picker instead.' : 'No picture could be found at that link. You can add your own photo instead.') + (e.trace && e.trace.length ? ' Details: ' + e.trace.join(' | ') : ''));
        throw e;
      }
    },

    /** A picture for an item whose link is an Etsy listing, from Etsy's own API (see etsy.js). Never stored: it lives in memory for up to 5 hours.
     *  Anyone who may see the item may ask. size 'thumb' for lists, 'full' for the big view. */
    async givingEtsyPicture({ user, body }) {
      const c = await context(user, body.familyId);
      const { it } = await itemRow(c, body.itemId);
      const id = etsy && etsy.listingId(parse(it.data).url || '');
      if (!id) throw NA();
      if (!etsy.enabled()) throw new ApiError(503, 'no_picture', 'Etsy pictures are not set up yet.');
      const size = body.size === 'full' ? 'full' : 'thumb', key = id + ':' + size;
      let hit = etsy.cache.get(key);
      if (!hit) {
        try { hit = await etsy.fetch(id, size); etsy.cache.set(key, hit); }
        catch (e) { if (e && e.linkPicture) throw new ApiError(e.kind === 'off' ? 503 : 422, 'no_picture', e.kind === 'off' ? 'Etsy pictures are not set up yet.' : 'No picture is available for that Etsy listing right now.'); throw e; }
      }
      return { image: 'data:' + hit.mime + ';base64,' + Buffer.from(hit.bytes).toString('base64'), notice: etsy.notice };
    },

    async givingReserve({ user, body }) {
      const c = await context(user, body.familyId);
      const { it, list } = await itemRow(c, body.itemId);
      if (list.ownerId === user.$id) throw new ApiError(400, 'own_item', 'You cannot reserve something from your own wishlist.');   // same answer whatever the reservation state
      if (!c.me.adult) throw new ApiError(403, 'adults_only', 'Gift reservations are for adults.');
      if (it.received) throw new ApiError(409, 'unavailable', 'This item is no longer available.');
      const row = { familyId: c.familyId, itemId: it.$id, buyerId: user.$id, version: it.version || 1 };
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await createRow(T.reservations, ID.unique(), row, []); return { item: itemView(c, it, list, row) }; }   // the unique index on itemId decides a tie: one winner
        catch (e) {
          if (sdkCode(e) !== 409) throw e;
          const cur = await firstRow(T.reservations, [Query.equal('itemId', [it.$id])]);
          if (!cur) continue;
          if (cur.buyerId === user.$id) return { already: true, item: itemView(c, it, list, cur) };   // the same person asking twice is safe
          if (!c.names.has(cur.buyerId)) { await deleteRow(T.reservations, cur.$id); continue; }       // held by someone who has left: free it and try again
          throw new ApiError(409, 'taken', 'Someone has already reserved this item.');
        }
      }
      throw new ApiError(409, 'taken', 'Someone has already reserved this item.');
    },
    async givingRelease({ user, body }) {
      const c = await context(user, body.familyId);
      const itemId = idOf(body.itemId, 'itemId');
      const r = await firstRow(T.reservations, [Query.equal('itemId', [itemId])]);
      if (!r || r.buyerId !== user.$id || r.familyId !== c.familyId) throw NA();   // someone else's reservation looks exactly like none
      const { it, list } = await itemRow(c, itemId);
      await deleteRow(T.reservations, r.$id);
      return { item: itemView(c, it, list, null) };
    },

    /* ----- who is an adult: owners and tree admins ----- */
    async givingMembers({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.manager) throw NA();
      return { members: c.members.map((m) => ({ userId: m.userId, name: m.name, adult: m.adult, owner: m.owner, self: m.userId === user.$id })) };
    },
    async givingMemberSetAdult({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.manager) throw NA();
      const t = c.byId.get(idOf(body.userId, 'userId'));
      if (!t) throw NA();
      if (t.userId === user.$id) throw new ApiError(400, 'self', MANAGER_NOTE);
      if (t.owner) throw new ApiError(400, 'owner', 'Owners are always adults.');
      const adult = body.adult === true;
      const prof = await firstRow(profilesTable, [Query.equal('profileKey', [`${c.familyId}_${t.userId}`])]);
      if (!prof) throw missing('That person has no profile in this family yet.');
      try { await updateRow(profilesTable, prof.$id, { givingAdult: adult }); } catch (e) { setupHint(e); }
      if (t.adult && !adult) {   // a new kid: their reservations are released, and they are told only that
        const mine = (await inFamily(T.reservations, c.familyId)).filter((r) => r.buyerId === t.userId);
        for (const r of mine) await deleteRow(T.reservations, r.$id);
        if (mine.length) await notify(c, t.userId, 'Your gift reservations were released.');
      }
      return { adult };
    },


    /* ----- Requests and pledges (Phase A) ----- */

    /* ----- Emergency requests (Phase B): a request seen only by the owner and up to 8 chosen adults, closing itself after 48 hours ----- */
    async givingEmergencyHelpers({ user, body }) {
      const c = await context(user, body.familyId);
      return { helpers: c.members.filter((m) => m.adult && m.userId !== user.$id).map((m) => ({ userId: m.userId, name: m.name })), max: R.EMERGENCY.helpers };
    },
    async givingEmergencySave({ user, body }) {
      const c = await context(user, body.familyId);
      const v = R.validateEmergency(body); if (!v.ok) throw invalid(v.errors);
      if (v.value.helpers.some((id) => { const m = c.byId.get(id); return !m || !m.adult || id === user.$id; })) throw new ApiError(400, 'invalid', 'You can only ask other adults in your family.');
      const mine = (await all(T.requests, [Query.equal('familyId', [c.familyId]), Query.equal('ownerId', [user.$id])], RQ.open + 20)).filter((x) => x.audience === 'chosen' && !x.hiddenAt && x.status !== 'closed' && now() < (parse(x.data).expiresAt || 0));
      if (mine.length) throw new ApiError(400, 'limit', 'You already have an emergency request open. Close it before sending another.');
      const data = JSON.stringify({ title: v.value.title, details: v.value.details, kind: 'time', needed: v.value.helpers.length, amount: '', neededBy: '', helpers: v.value.helpers, etype: v.value.type, where: v.value.where, pickup: v.value.pickup, dropoff: v.value.dropoff, loc: v.value.loc, expiresAt: now() + R.EMERGENCY.hours * HOUR });
      const row = await createRow(T.requests, ID.unique(), { familyId: c.familyId, ownerId: user.$id, status: 'open', approval: 'approved', audience: 'chosen', data }, []);
      for (const id of v.value.helpers) await notify(c, id, nameOf(c, user.$id) + ' needs help. Tap to open.');
      return { request: requestView(c, row, [], true) };
    },
    async givingEmergencyAllSet({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.requestId);
      if (r.audience !== 'chosen' || r.ownerId !== user.$id) throw NA();
      if (r.status !== 'closed') {
        await updateRow(T.requests, r.$id, { status: 'closed' }); r.status = 'closed';
        for (const id of parse(r.data).helpers || []) await notify(c, id, 'No longer needed: "' + (parse(r.data).title || '') + '". Thank you.');
      }
      return { request: requestView(c, r, await pledgesFor(r.$id), true) };
    },
    async givingEmergencyKeepOpen({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.requestId);
      if (r.audience !== 'chosen' || r.ownerId !== user.$id) throw NA();
      const saved = await updateRow(T.requests, r.$id, { status: 'open', data: JSON.stringify({ ...parse(r.data), expiresAt: now() + R.EMERGENCY.hours * HOUR }) });
      return { request: requestView(c, saved, await pledgesFor(r.$id), true) };
    },

    /* ----- Gift exchanges (Phase C). Adults only. ----- */
    async givingExchangesHome({ user, body }) {
      const c = await context(user, body.familyId); if (!c.me.adult) throw NA();
      const rows = (await inFamily(T.exchanges, c.familyId, [], 200)).filter((x) => exOk(c, x)).sort((a, b) => String(b.$createdAt).localeCompare(String(a.$createdAt)));
      return { exchanges: rows.map((x) => exRowView(c, x)) };
    },
    async givingExchangeGet({ user, body }) { const c = await context(user, body.familyId); return { exchange: await exView(c, await exRow(c, body.exchangeId)) }; },
    async givingExchangeSave({ user, body }) {
      const c = await context(user, body.familyId); if (!c.me.adult) throw NA();
      let x = null;
      if (body.exchangeId) { x = await exRow(c, body.exchangeId); if (x.organiserId !== user.$id || x.status === 'drawn') throw NA(); }
      const d = x ? exData(x) : { members: [user.$id], exclusions: [] };
      const v = R.validateExchange(body, d.members); if (!v.ok) throw invalid(v.errors);
      const data = JSON.stringify({ name: v.value.name, date: v.value.date, limit: v.value.limit, note: v.value.note, members: d.members, exclusions: x ? v.value.exclusions : [] });
      if (x) x = await updateRow(T.exchanges, x.$id, { data });
      else {
        const mine = (await inFamily(T.exchanges, c.familyId, [], 200)).filter((e) => e.organiserId === user.$id && exOk(c, e)).length;
        if (mine >= 5) throw new ApiError(400, 'limit', 'You can organise up to 5 exchanges at a time. Delete one to add another.');
        x = await createRow(T.exchanges, ID.unique(), { familyId: c.familyId, organiserId: user.$id, status: 'open', round: 0, data }, []);
      }
      return { exchange: await exView(c, x) };
    },
    async givingExchangeJoin({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      if (x.status === 'drawn') throw new ApiError(409, 'already_drawn', 'Names were already drawn, so no one can join now. Ask the organiser.');
      const d = exData(x); if (d.members.length >= EX.members) throw new ApiError(400, 'full', 'This exchange is full.');
      if (!d.members.includes(user.$id)) { d.members.push(user.$id); x.data = JSON.stringify(d); await updateRow(T.exchanges, x.$id, { data: x.data }); }
      return { exchange: await exView(c, x) };
    },
    async givingExchangeLeave({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      if (!exData(x).members.includes(user.$id)) throw NA();
      if (x.organiserId === user.$id) throw new ApiError(400, 'organiser', 'You organise this one. Delete it instead of leaving.');
      await exDrop(c, x, user.$id, 'left'); return { exchange: await exView(c, await exRow(c, x.$id)) };
    },
    async givingExchangeAddMember({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      if (x.organiserId !== user.$id || x.status === 'drawn') throw NA();
      const t = c.byId.get(idOf(body.userId, 'userId')); if (!t || !t.adult) throw NA();
      const d = exData(x); if (d.members.length >= EX.members) throw new ApiError(400, 'full', 'This exchange is full.');
      if (!d.members.includes(t.userId)) { d.members.push(t.userId); x.data = JSON.stringify({ ...d }); await updateRow(T.exchanges, x.$id, { data: x.data }); await notify(c, t.userId, nameOf(c, user.$id) + ' added you to ' + d.name + '.'); }
      return { exchange: await exView(c, x) };
    },
    async givingExchangeRemoveMember({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      const uid = idOf(body.userId, 'userId');
      if (x.organiserId !== user.$id || !exData(x).members.includes(uid)) throw NA();
      if (uid === user.$id) throw new ApiError(400, 'organiser', 'You organise this one. Delete it instead.');
      await exDrop(c, x, uid, 'was removed from'); await notify(c, uid, 'You were removed from ' + exData(x).name + '.');
      return { exchange: await exView(c, await exRow(c, x.$id)) };
    },
    async givingExchangeDraw({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      if (x.organiserId !== user.$id) throw NA();
      if (x.status === 'drawn') throw new ApiError(409, 'already_drawn', 'Names were already drawn. Use Draw again to start over.');
      return { exchange: await exView(c, await exDraw(c, x, false)) };
    },
    async givingExchangeRedraw({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      if (x.organiserId !== user.$id || x.status !== 'drawn') throw NA();
      return { exchange: await exView(c, await exDraw(c, x, true)) };
    },
    async givingExchangeDelete({ user, body }) {
      const c = await context(user, body.familyId); const x = await exRow(c, body.exchangeId);
      if (x.organiserId !== user.$id) throw NA();
      const d = exData(x);
      for (const u of d.members) if (u !== user.$id) await notify(c, u, d.name + ' was deleted by ' + nameOf(c, user.$id) + '.');
      if (await getRowOrNull(T.exchangePairs, x.$id)) await deleteRow(T.exchangePairs, x.$id);
      await deleteRow(T.exchanges, x.$id); return {};
    },

    /* ----- Group gifts (Phase D1). Adults only; the person a gift is for never sees it. ----- */
    async givingGiftsHome({ user, body }) {
      const c = await context(user, body.familyId); if (!c.me.adult) throw NA();
      const gs = (await inFamily(T.gifts, c.familyId, [], 200)).filter((g) => gOk(c, g)).sort((a, b) => String(b.$createdAt).localeCompare(String(a.$createdAt)));
      const parts = await inFamily(T.giftParts, c.familyId, [], 5000);
      return { gifts: gs.map((g) => gRowView(c, g, parts.filter((p) => p.giftId === g.$id))), who: c.members.filter((m) => m.userId !== user.$id).map((m) => ({ userId: m.userId, name: m.name })) };
    },
    async givingGiftGet({ user, body }) { const c = await context(user, body.familyId); return gOut(c, await gRow(c, body.giftId)); },
    async givingGiftSave({ user, body }) {
      const c = await context(user, body.familyId); if (!c.me.adult) throw NA();
      let g = null;
      if (body.giftId) { g = await gRow(c, body.giftId); if (g.organiserId !== user.$id || g.status === 'closed') throw NA(); }
      const v = R.validateGift(body, c.members.filter((m) => m.userId !== user.$id).map((m) => m.userId)); if (!v.ok) throw invalid(v.errors);
      const data = JSON.stringify({ title: v.value.title, note: v.value.note, forId: v.value.forId, goalCents: v.value.goalCents, eachCents: v.value.eachCents, currency: v.value.currency });
      if (g) {
        g = await updateRow(T.gifts, g.$id, { data });
        if (v.value.forId) { const mine = (await partsOf(g)).find((p) => p.userId === v.value.forId); if (mine) await deleteRow(T.giftParts, mine.$id); }   // the person it is for cannot have a part in it
      } else {
        const open = (await inFamily(T.gifts, c.familyId, [], 200)).filter((x) => x.organiserId === user.$id && x.status === 'open' && gOk(c, x)).length;
        if (open >= GF.open) throw new ApiError(400, 'limit', 'You can run up to ' + GF.open + ' open group gifts. Close one to start another.');
        g = await createRow(T.gifts, ID.unique(), { familyId: c.familyId, organiserId: user.$id, status: 'open', data }, []);
        for (const m of c.members) if (m.adult && m.userId !== user.$id && m.userId !== v.value.forId) await notify(c, m.userId, nameOf(c, user.$id) + ' started a group gift: ' + v.value.title + '. Tap to open.');
      }
      return gOut(c, g);
    },
    async givingGiftContribute({ user, body }) {
      const c = await context(user, body.familyId); const g = await gRow(c, body.giftId);
      if (g.status === 'closed') throw new ApiError(409, 'closed', 'This group gift is closed.');
      const parts = await partsOf(g), cur = parts.find((p) => p.userId === user.$id);
      if (cur && cur.status === 'confirmed') throw new ApiError(409, 'confirmed', 'Your contribution was already confirmed. Ask ' + nameOf(c, g.organiserId) + ' if it needs to change.');
      const v = R.validateContribution(body); if (!v.ok) throw invalid(v.errors);
      const mine = g.organiserId === user.$id;
      await gSetPart(c, g, parts, user.$id, v.value.cents, v.value.note, mine ? 'confirmed' : 'marked');
      if (!mine) await notify(c, g.organiserId, nameOf(c, user.$id) + ' marked a contribution to ' + gData(g).title + '. Confirm it when you have it.');
      return gOut(c, g);
    },
    async givingGiftWithdraw({ user, body }) {
      const c = await context(user, body.familyId); const g = await gRow(c, body.giftId);
      const mine = (await partsOf(g)).find((p) => p.userId === user.$id); if (!mine) throw NA();
      if (mine.status === 'confirmed' && g.organiserId !== user.$id) throw new ApiError(409, 'confirmed', 'Your contribution was already confirmed. Ask ' + nameOf(c, g.organiserId) + ' if it needs to change.');
      await deleteRow(T.giftParts, mine.$id); return gOut(c, g);
    },
    async givingGiftConfirm({ user, body }) {
      const c = await context(user, body.familyId); const g = await gRow(c, body.giftId); if (g.organiserId !== user.$id) throw NA();
      const p = (await partsOf(g)).find((x) => x.userId === idOf(body.userId, 'userId')); if (!p) throw NA();
      await updateRow(T.giftParts, p.$id, { status: 'confirmed' }); await notify(c, p.userId, 'Your contribution to ' + gData(g).title + ' was confirmed. Thank you.');
      return gOut(c, g);
    },
    async givingGiftDecline({ user, body }) {
      const c = await context(user, body.familyId); const g = await gRow(c, body.giftId); if (g.organiserId !== user.$id) throw NA();
      const p = (await partsOf(g)).find((x) => x.userId === idOf(body.userId, 'userId')); if (!p) throw NA();
      await deleteRow(T.giftParts, p.$id); await notify(c, p.userId, nameOf(c, user.$id) + ' could not confirm your contribution to ' + gData(g).title + '. Please check with them.');
      return gOut(c, g);
    },
    async givingGiftRecord({ user, body }) {
      const c = await context(user, body.familyId); const g = await gRow(c, body.giftId); if (g.organiserId !== user.$id) throw NA();
      const t = c.byId.get(idOf(body.userId, 'userId')); if (!t || !t.adult || t.userId === gData(g).forId || t.userId === user.$id) throw NA();
      if (g.status === 'closed') throw new ApiError(409, 'closed', 'This group gift is closed.');
      const v = R.validateContribution(body); if (!v.ok) throw invalid(v.errors);
      await gSetPart(c, g, await partsOf(g), t.userId, v.value.cents, v.value.note, 'confirmed');
      await notify(c, t.userId, nameOf(c, user.$id) + ' recorded your contribution to ' + gData(g).title + '. Thank you.');
      return gOut(c, g);
    },
    async givingGiftSetStatus({ user, body }) {
      const c = await context(user, body.familyId); let g = await gRow(c, body.giftId); if (g.organiserId !== user.$id) throw NA();
      g = await updateRow(T.gifts, g.$id, { status: body.closed ? 'closed' : 'open' }); return gOut(c, g);
    },
    async givingGiftDelete({ user, body }) {
      const c = await context(user, body.familyId); const g = await gRow(c, body.giftId); if (g.organiserId !== user.$id) throw NA();
      const parts = await partsOf(g);
      for (const p of parts) { if (p.userId !== user.$id) await notify(c, p.userId, gData(g).title + ' was deleted by ' + nameOf(c, user.$id) + '.'); await deleteRow(T.giftParts, p.$id); }
      await deleteRow(T.gifts, g.$id); return {};
    },
    async givingRequestsHome({ user, body }) {
      const c = await context(user, body.familyId);
      const rows = await inFamily(T.requests, c.familyId, [], 600);
      for (const r of rows) await settle(r);
      await tidyRequests(c, rows);
      const pledges = await inFamily(T.pledges, c.familyId);
      const byReq = new Map(); for (const p of pledges) { if (!byReq.has(p.requestId)) byReq.set(p.requestId, []); byReq.get(p.requestId).push(p); }
      const reach = rows.filter((r) => requestOk(c, r) && !(r.audience === 'chosen' && now() > (parse(r.data).expiresAt || 0) + 30 * DAY)).sort((a, b) => String(b.$createdAt).localeCompare(String(a.$createdAt)));
      const view = (r) => requestView(c, r, byReq.get(r.$id) || [], false);
      const urgent = reach.filter((r) => r.audience === 'chosen' && r.status !== 'closed');
      const shown = reach.filter((r) => (r.approval === 'approved' || r.ownerId === c.me.userId) && !(r.audience === 'chosen' && r.status !== 'closed'));
      const mineOpen = rows.filter((r) => r.ownerId === user.$id && !r.hiddenAt && r.status !== 'closed' && r.audience !== 'chosen').length;
      return { me: { adult: c.me.adult }, canModerate: c.moderator, canCreate: mineOpen < RQ.open,
        urgent: urgent.map(view), open: shown.filter((r) => r.status !== 'closed').map(view), closed: shown.filter((r) => r.status === 'closed').slice(0, 20).map(view),
        waiting: c.moderator ? reach.filter((r) => r.audience !== 'chosen' && r.approval !== 'approved' && r.ownerId !== user.$id).map(view) : [] };
    },
    async givingRequestGet({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.requestId);
      return { request: requestView(c, r, await pledgesFor(r.$id), true), me: { adult: c.me.adult }, canModerate: c.moderator };
    },
    async givingRequestSave({ user, body }) {
      const c = await context(user, body.familyId);
      const v = R.validateRequest(body); if (!v.ok) throw invalid(v.errors);
      if (v.value.audience === 'adults' && !c.me.adult) throw new ApiError(403, 'adults_only', 'Only adults can make a request adults only.');
      const { audience, ...rest } = v.value, data = JSON.stringify(rest);
      const view = async (r) => requestView(c, r, await pledgesFor(r.$id), true);
      if (body.requestId) {
        const r = await requestRow(c, body.requestId);
        if (r.ownerId !== user.$id || r.audience === 'chosen') throw NA();
        const patch = { audience, data }; if (!c.me.adult) patch.approval = 'pending';   // a kid's edit goes back for an adult to look at again
        return { request: await view(await updateRow(T.requests, r.$id, patch)) };
      }
      if ((await openCountOf(c, user.$id)) >= RQ.open) throw new ApiError(400, 'limit', 'You can have up to ' + RQ.open + ' open requests. Close one to add another.');
      const approval = c.me.adult ? 'approved' : 'pending';
      const row = await createRow(T.requests, ID.unique(), { familyId: c.familyId, ownerId: user.$id, status: 'open', approval, audience, data }, []);
      return { request: await view(row), waitingForApproval: approval === 'pending' };
    },
    async givingRequestApprove({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.moderator) throw NA();
      const r = await getRowOrNull(T.requests, idOf(body.requestId, 'requestId'));
      if (!r || r.familyId !== c.familyId || r.hiddenAt || !c.names.has(r.ownerId) || r.approval === 'approved') throw NA();
      if (r.ownerId === user.$id) throw new ApiError(400, 'self', 'Ask another owner or tree admin to approve your own request.');
      await updateRow(T.requests, r.$id, { approval: 'approved' });
      await notify(c, r.ownerId, 'Your request "' + (parse(r.data).title || '') + '" was approved and the family can see it.');
      return {};
    },
    async givingRequestReject({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.moderator) throw NA();
      const r = await getRowOrNull(T.requests, idOf(body.requestId, 'requestId'));
      if (!r || r.familyId !== c.familyId || r.hiddenAt || !c.names.has(r.ownerId) || r.approval === 'approved') throw NA();
      await notify(c, r.ownerId, 'Your request "' + (parse(r.data).title || '') + '" was not posted. An owner or tree admin can tell you why.');
      await removeRequest({ ...c, notify: false }, r, '');
      return {};
    },
    async givingRequestClose({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.requestId);
      if (r.ownerId !== user.$id) throw NA();
      if (body.reopen && r.audience === 'chosen') throw new ApiError(400, 'invalid', 'Use Keep open for an emergency request.');
      if (body.reopen && r.status === 'closed' && (await openCountOf(c, user.$id)) >= RQ.open) throw new ApiError(400, 'limit', 'You can have up to ' + RQ.open + ' open requests. Close one to reopen this.');
      const saved = await updateRow(T.requests, r.$id, { status: body.reopen ? 'open' : 'closed' });
      return { request: requestView(c, saved, await pledgesFor(r.$id), true) };
    },
    async givingRequestDelete({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.requestId);
      if (r.ownerId !== user.$id) throw NA();
      await removeRequest({ ...c, notify: true }, r, 'A request you pledged to ("{request}") was removed.');
      return {};
    },
    async givingPledgeSave({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.requestId);
      if (r.approval !== 'approved') throw NA();
      if (!c.me.adult) throw new ApiError(403, 'adults_only', 'Pledging is for adults.');
      if (r.ownerId === user.$id) throw new ApiError(400, 'own_request', 'You cannot pledge to your own request.');
      if (r.status === 'closed') throw new ApiError(409, 'closed', 'This request is closed.');
      const v = R.validatePledge(body); if (!v.ok) throw invalid(v.errors);
      const rows = (await pledgesFor(r.$id)).filter((p) => c.names.has(p.userId));
      const mine = rows.find((p) => p.userId === user.$id);
      if (mine) {
        if (mine.status === 'done') throw new ApiError(409, 'done', 'Your pledge is already marked done.');
        await updateRow(T.pledges, mine.$id, { data: JSON.stringify(v.value) });
      } else {
        if (rows.length >= RQ.pledges) throw new ApiError(400, 'limit', 'This request already has ' + RQ.pledges + ' pledges.');
        try { await createRow(T.pledges, ID.unique(), { familyId: c.familyId, requestId: r.$id, userId: user.$id, status: 'pledged', pledgeKey: r.$id + '_' + user.$id, data: JSON.stringify(v.value) }, []); }
        catch (e) { if (sdkCode(e) !== 409) throw e; /* two taps at once: the first one stands */ }
        const urgent = r.audience === 'chosen', eta = v.value.eta ? R.ETA[v.value.eta].toLowerCase() : '';
        await notify(c, r.ownerId, nameOf(c, user.$id) + (urgent ? ' can help' + (eta ? ' (' + eta + ')' : '') + ' with "' : ' pledged to help with "') + (parse(r.data).title || '') + '".');
      }
      return { request: requestView(c, r, await pledgesFor(r.$id), true) };
    },
    async givingPledgeWithdraw({ user, body }) {
      const c = await context(user, body.familyId);
      const p = await getRowOrNull(T.pledges, idOf(body.pledgeId, 'pledgeId'));
      const r = p && p.familyId === c.familyId ? await getRowOrNull(T.requests, p.requestId) : null;
      if (!p || !requestOk(c, r) || p.userId !== user.$id) throw NA();
      if (p.status === 'done') throw new ApiError(409, 'done', 'A pledge marked done cannot be withdrawn. Ask the person who made the request.');
      await deleteRow(T.pledges, p.$id);
      await notify(c, r.ownerId, nameOf(c, user.$id) + ' withdrew a pledge on "' + (parse(r.data).title || '') + '".');
      return { request: requestView(c, r, await pledgesFor(r.$id), true) };
    },
    async givingPledgeDone({ user, body }) {
      const c = await context(user, body.familyId);
      const p = await getRowOrNull(T.pledges, idOf(body.pledgeId, 'pledgeId'));
      const r = p && p.familyId === c.familyId ? await getRowOrNull(T.requests, p.requestId) : null;
      if (!p || !requestOk(c, r) || r.ownerId !== user.$id) throw NA();
      const done = body.done !== false;
      await updateRow(T.pledges, p.$id, { status: done ? 'done' : 'pledged' });
      if (done) await notify(c, p.userId, 'Thank you. "' + (parse(r.data).title || '') + '" marked your help as done.');
      return { request: requestView(c, r, await pledgesFor(r.$id), true) };
    },
    async givingRequestReport({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await requestRow(c, body.targetId);
      if (r.approval !== 'approved') throw NA();
      if (r.ownerId === user.$id) throw new ApiError(400, 'own_content', 'You cannot report your own request.');
      const v = R.validateReport(body); if (!v.ok) throw invalid(v.errors);
      const mineRows = await all(T.reports, [Query.equal('familyId', [c.familyId]), Query.equal('reporterId', [user.$id])], L.reportsPerPerson + 5);
      if (!mineRows.some((x) => x.kind === 'request' && x.targetId === r.$id)) {
        if (mineRows.length >= L.reportsPerPerson) throw new ApiError(429, 'limit', 'You have sent a lot of reports. An admin will review them first.');
        await createRow(T.reports, ID.unique(), { familyId: c.familyId, reporterId: user.$id, kind: 'request', targetId: r.$id, listId: r.$id, data: JSON.stringify(v.value) }, []);
      }
      return { message: 'Thanks. An owner or tree admin will take a look. The person who wrote it is not told who reported it.' };
    },

    /* ----- reporting ----- */
    async givingReport({ user, body }) {
      const c = await context(user, body.familyId);
      const kind = body.kind === 'list' ? 'list' : 'item';
      let list, targetId;
      if (kind === 'item') { const r = await itemRow(c, body.targetId); list = r.list; targetId = r.it.$id; } else { list = await listRow(c, body.targetId); targetId = list.$id; }
      if (list.ownerId === user.$id) throw new ApiError(400, 'own_content', 'You cannot report your own wishlist.');
      const v = R.validateReport(body); if (!v.ok) throw invalid(v.errors);
      const mineRows = await all(T.reports, [Query.equal('familyId', [c.familyId]), Query.equal('reporterId', [user.$id])], L.reportsPerPerson + 5);
      if (!mineRows.some((r) => r.kind === kind && r.targetId === targetId)) {
        if (mineRows.length >= L.reportsPerPerson) throw new ApiError(429, 'limit', 'You have sent a lot of reports. An admin will review them first.');
        await createRow(T.reports, ID.unique(), { familyId: c.familyId, reporterId: user.$id, kind, targetId, listId: list.$id, data: JSON.stringify(v.value) }, []);
      }
      return { message: 'Thanks. An owner or tree admin will take a look. The person who wrote it is not told who reported it.' };   // the same answer whether or not it was a repeat
    },
    async givingReports({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.moderator) throw NA();
      const out = [];
      for (const r of await inFamily(T.reports, c.familyId, [], 200)) {
        if (r.kind === 'request') {
          const q = await getRowOrNull(T.requests, r.targetId), rd = parse(r.data);
          if (!q || q.familyId !== c.familyId || q.hiddenAt || !c.names.has(q.ownerId)) continue;
          out.push({ id: r.$id, kind: 'request', reasonLabel: R.REPORT_REASONS[rd.reason] || 'Something else', note: rd.note || '', reporterName: nameOf(c, r.reporterId), ownerName: nameOf(c, q.ownerId), listName: 'Family requests', title: parse(q.data).title || '', notes: parse(q.data).details || '', url: '' });
          continue;
        }
        const l = await getRowOrNull(T.lists, r.listId);
        if (!l || l.familyId !== c.familyId || l.hiddenAt || !c.names.has(l.ownerId)) continue;
        const it = r.kind === 'item' ? await getRowOrNull(T.items, r.targetId) : null;
        if (r.kind === 'item' && !it) continue;
        const d = parse(r.data), id = it ? parse(it.data) : {};
        out.push({ id: r.$id, kind: r.kind, reasonLabel: R.REPORT_REASONS[d.reason] || 'Something else', note: d.note || '', reporterName: nameOf(c, r.reporterId), ownerName: nameOf(c, l.ownerId), listName: parse(l.data).name || '',
          title: it ? id.title || '' : parse(l.data).name || '', notes: it ? id.notes || '' : '', url: it ? id.url || '' : '' });   // content only: never anything about reservations
      }
      return { reports: out };
    },
    async givingReportResolve({ user, body }) {
      const c = await context(user, body.familyId);
      if (!c.moderator) throw NA();
      const r = await getRowOrNull(T.reports, idOf(body.reportId, 'reportId'));
      if (!r || r.familyId !== c.familyId) throw NA();
      if (body.resolution === 'remove' && r.kind === 'request') {
        const q = await getRowOrNull(T.requests, r.targetId);
        if (q && q.familyId === c.familyId) { await notify(c, q.ownerId, 'Your request was removed by a family admin.'); await removeRequest({ ...c, notify: true }, q, 'A request you pledged to ("{request}") was removed.'); }
      } else if (body.resolution === 'remove') {
        const l = await getRowOrNull(T.lists, r.listId);
        if (l && l.familyId === c.familyId) {
          const rc = { ...c, notify: true };
          if (r.kind === 'item') {
            const it = await getRowOrNull(T.items, r.targetId);
            if (it) { await removeItem(rc, it, 'An item you reserved ({item}) is no longer on the wishlist.'); await notify(c, l.ownerId, 'An item on your wishlist was removed by a family admin.'); }
          } else { await removeList(rc, l, 'A wishlist with an item you reserved ({item}) was removed.'); await notify(c, l.ownerId, 'Your wishlist was removed by a family admin.'); }
        }
      }
      const still = await getRowOrNull(T.reports, r.$id);
      if (still) await deleteRow(T.reports, r.$id);
      return {};
    }
  };

  return { actions, sweepGiving };
}
