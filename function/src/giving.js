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
import * as R from './giving-rules.js';

export const GIVING_TABLES = {
  lists: 'givingLists',               // familyId, ownerId, audience, hiddenAt, data (JSON: name)
  items: 'givingItems',               // familyId, listId, received, version, thumb (a small JPEG as text), data (JSON: title, notes, priority, url, priceCents, currency, photoId)
  reservations: 'givingReservations', // familyId, itemId (UNIQUE index), buyerId, version
  reports: 'givingReports',           // familyId, reporterId, kind, targetId, listId, data (JSON: reason, note)
  notices: 'givingNotices',           // familyId, userId, data (JSON: text)
  state: 'givingState'                // row id = familyId; enabled (bool), enabledBy, enabledAt
};
export const GIVING_LIMITS = { ...R.LIMITS, hideDays: 30, reportsPerPerson: 20, noticesShown: 20, perMinute: 60, thumbBytes: 10000, photoBytes: 250000, linkPicturesPer10Min: 10 };
const DAY = 864e5;
const MANAGER_NOTE = 'Ask another owner or tree admin to change your own setting.';

export function createGiving({ linkPicture, storage, photoBucket, teams, listRows, createRow, updateRow, deleteRow, getRowOrNull, firstRow, requireMember, idOf, bad, forbidden, missing, ApiError, sdkCode, now, profilesTable }) {
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
        if (e && e.linkPicture) throw new ApiError(422, 'no_picture', e.kind === 'blocked' ? 'That shop does not let Family Circle look at its pages (it shows a robot check). Save the picture to your phone and add it with the photo picker instead.' : 'No picture could be found at that link. You can add your own photo instead.');
        throw e;
      }
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
      if (body.resolution === 'remove') {
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
