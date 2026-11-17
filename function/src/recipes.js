/*
 * Recipes family publishing. All trusted logic lives here and runs inside family-api.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 *
 * STATUS: built, and off for each family until its owner turns it on (recipesSetEnabled). Nothing here runs for a family until then.
 *
 * Trust model (same as giving.js, board.js and chat.js)
 *  - `user` is the account Appwrite verified from the caller's own JWT. No body field can name a person or a family the caller is not in.
 *  - A recipe is private on the author's device until the author publishes a SNAPSHOT of it. Only that snapshot is ever stored here.
 *  - The two tables have NO client permission at all: every read and write goes through an action below, which first checks the caller
 *    holds a confirmed membership of the family and that recipe sharing is turned on for it.
 *  - Owner, tree-admin and chat-admin roles grant nothing here. Only the author edits or unpublishes, and only readers who are
 *    confirmed members read.
 *  - A row is readable only while the author's CURRENT membership is the one that published it. If the author is removed and invited
 *    again they have a new membership, so the old rows stay hidden (and are deleted after 30 days); nothing is revived.
 *  - Anything the caller may not see (another family, nothing there, unpublished, hidden) answers the same way: "not available".
 *  - The photo is a fixed small square JPEG. The text lives in `data`, a small copy in `thumb`, the full photo in the media bucket
 *    (no client permission).
 */
import { Query, ID } from 'node-appwrite';
import * as R from './recipes-rules.js';

export const RECIPE_TABLES = {
  pubs: 'recipePubs',     // familyId, authorId, authorMembershipId, sourceId, pubKey (UNIQUE: familyId_authorId_sourceId), hash, imageKey, photoId, status, hiddenAt, version, publishedAt, thumb (text), data (text: JSON snapshot)
  books: 'recipeBooks',   // cookbooks: same columns as recipePubs minus the photo ones, plus count (integer); data (text) = JSON cookbook snapshot
  state: 'recipeState'    // row id = familyId; enabled (bool), enabledBy, enabledAt
};
export const RECIPE_LIMITS = { ...R.LIMITS, perMinute: 60, libraryMax: 500 };
const DAY = 864e5;

export function createRecipes({ storage, photoBucket, teams, listRows, createRow, updateRow, deleteRow, getRowOrNull, requireMember, idOf, bad, forbidden, ApiError, sdkCode, now }) {
  const T = RECIPE_TABLES, L = RECIPE_LIMITS;
  const iso = (t) => new Date(t === undefined ? now() : t).toISOString();
  const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const NA = () => new ApiError(404, 'not_available', 'That is not available.');

  const hits = new Map();   // light per-person brake; it lives in memory, so it is a brake rather than a guarantee
  function brake(userId) {
    const t = now(), from = t - 60000;
    const list = (hits.get(userId) || []).filter((x) => x > from);
    if (list.length >= L.perMinute) { hits.set(userId, list); throw new ApiError(429, 'rate_limited', 'You are doing that too quickly. Wait a few seconds and try again.'); }
    list.push(t); hits.set(userId, list);
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

  /* ---------- who is who ---------- */
  /** The caller's confirmed membership (with its own id), plus every confirmed member's membership id by user. */
  async function context(user, familyIdRaw, { needOn = true } = {}) {
    const ctx = await requireMember(user, familyIdRaw);
    brake(user.$id);
    const res = await teams.listMemberships({ teamId: ctx.familyId, queries: [Query.limit(100)] });
    const joined = res.memberships.filter((m) => m.confirm === true);
    const byUser = new Map(joined.map((m) => [m.userId, { userId: m.userId, familyId: ctx.familyId, membershipId: m.$id, active: true, name: m.userName }]));
    const me = byUser.get(user.$id);
    if (!me) throw forbidden('You are not a member of this family.');
    const state = await getRowOrNull(T.state, ctx.familyId);
    const enabled = !!(state && state.enabled === true);
    if (needOn && !enabled) throw NA();
    return { ...ctx, me, byUser, enabled };
  }
  const rowRule = (r) => ({ familyId: r.familyId, status: r.status, hiddenAt: r.hiddenAt || null, authorId: r.authorId, authorMembershipId: r.authorMembershipId });
  const readable = (c, r) => !!(r && R.canRead(c.me, rowRule(r), c.byUser.get(r.authorId)));
  const mineRow = (c, r) => !!(r && R.canAuthor(c.me, rowRule(r)));
  const nameOf = (c, id) => { const m = c.byUser.get(id); return (m && m.name) || 'Family member'; };

  async function rowFor(c, idRaw) {
    const r = await getRowOrNull(T.pubs, idOf(idRaw, 'id'));
    if (!r || r.familyId !== c.familyId) return null;
    return r;
  }
  async function dropPhoto(fileId) {
    if (!fileId || !storage) return;
    try { await storage.deleteFile({ bucketId: photoBucket, fileId }); } catch (e) { /* already gone, or storage not set up: nothing to delete */ }
  }
  async function removeRow(r, table = T.pubs) { await dropPhoto(r.photoId); await deleteRow(table, r.$id); }

  /** A picture sent as a data address. Only JPEG, checked by its first bytes, and only up to the size limit. */
  const JPEG_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;
  function jpegBytes(url) {
    const m = typeof url === 'string' ? JPEG_URL.exec(url) : null;
    const buf = m ? Buffer.from(m[1], 'base64') : null;
    if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('The photo must be a square JPEG under about 120 KB.');
    return buf;
  }
  const bodyOf = (b) => ({ draft: b && typeof b.draft === 'object' && b.draft ? b.draft : {}, pics: b && typeof b.pics === 'object' ? b.pics : null, imageKey: b && typeof b.imageKey === 'string' ? b.imageKey : '' });
  const invalid = (v) => new ApiError(400, 'invalid', v.message || 'Check the recipe.');

  /** Store the (already checked) photo; returns { photoId, thumb } or empty strings when the recipe has no photo. */
  async function savePhoto(v, pics) {
    if (!v.hasPhoto) return { photoId: '', thumb: '' };
    jpegBytes(pics.thumb); const full = jpegBytes(pics.photo);
    if (!storage) throw bad('Photos are not set up yet.');
    const fileId = ID.unique();
    try { await storage.createFile({ bucketId: photoBucket, fileId, file: new File([full], 'photo.jpg', { type: 'image/jpeg' }), permissions: [] }); }
    catch (e) { if (sdkCode(e) === 404) throw bad('Photos need the storage bucket to be set up.'); throw e; }
    return { photoId: fileId, thumb: pics.thumb };
  }

  const summary = (c, r) => { const d = parse(r.data); return { id: r.$id, name: d.name || '', description: d.description || '', yield: d.yield || '', total: d.total || '', categories: Array.isArray(d.categories) ? d.categories : [], hasImage: !!r.photoId, thumb: r.thumb || '', authorName: nameOf(c, r.authorId), mine: r.authorId === c.me.userId, version: r.version || 1, publishedAt: r.publishedAt || '' };
  };

  /** Hide rows whose author's membership is gone (or is not the one that published them); delete them after 30 days. Runs when the library loads. */
  async function tidy(c, table = T.pubs) {
    const rows = await all(table, [Query.equal('familyId', [c.familyId])], L.libraryMax * 4);
    for (const r of rows) {
      const am = c.byUser.get(r.authorId);
      const stale = !am || am.membershipId !== r.authorMembershipId;
      if (stale && !r.hiddenAt) { r.hiddenAt = iso(); await updateRow(table, r.$id, { hiddenAt: r.hiddenAt }); }
      else if (stale && Date.parse(r.hiddenAt) < now() - R.HIDDEN_DAYS * DAY) await removeRow(r, table);
    }
  }
  /** Scheduled cleanup in every family: delete rows hidden for 30 days. */
  async function sweepRecipes(deadline) {
    const cutoff = iso(now() - R.HIDDEN_DAYS * DAY);
    let purged = 0;
    for (const table of [T.pubs, T.books]) {
      while (now() < deadline) {
        let page;
        try { page = await listRows(table, [Query.lessThan('hiddenAt', cutoff), Query.limit(25)]); } catch (e) { if (table === T.books) break; throw e; }   // the cookbook table may not be set up yet
        if (!page.rows.length) break;
        for (const r of page.rows) { await removeRow(r, table); purged += 1; }
      }
    }
    return { purged };
  }
  /** When a family is deleted. */
  async function purgeFamily(familyId, deleteWhere, deadline) {
    if (!(await deleteWhere(T.pubs, [Query.equal('familyId', [familyId])], deadline, (r) => dropPhoto(r.photoId)))) return false;
    try { await deleteWhere(T.books, [Query.equal('familyId', [familyId])], deadline); } catch (e) { /* cookbook table not set up */ }
    try { await deleteRow(T.state, familyId); } catch (e) { /* none */ }
    return true;
  }

  const actions = {
    /** Anyone in the family can ask. Never refused just because the feature is off. */
    async recipesStatus({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      return { enabled: c.enabled, canTurnOn: c.isOwner };
    },
    async recipesSetEnabled({ user, body }) {
      const c = await context(user, body.familyId, { needOn: false });
      if (!c.isOwner) throw forbidden('Only the family owner can turn recipe sharing on or off.');
      const enabled = body.enabled === true;
      const row = await getRowOrNull(T.state, c.familyId);
      const data = { familyId: c.familyId, enabled, enabledBy: user.$id, enabledAt: iso() };
      if (row) await updateRow(T.state, c.familyId, data); else await createRow(T.state, c.familyId, data, []);
      return { enabled };
    },

    /** What the caller has published here, so their own screen can mark each draft. Only rows the caller still owns under their CURRENT membership. */
    async recipesMine({ user, body }) {
      const c = await context(user, body.familyId);
      const rows = await all(T.pubs, [Query.equal('familyId', [c.familyId]), Query.equal('authorId', [user.$id])], L.publishedPerAuthor + 20);
      return { pubs: rows.filter((r) => mineRow(c, r) && !r.hiddenAt).map((r) => ({ id: r.$id, sourceSlug: r.sourceId, hash: r.hash, version: r.version || 1 })) };
    },
    /** The Family Library: this family's published, visible recipes. Title search only. Never a draft, never another family. */
    async recipesLibrary({ user, body }) {
      const c = await context(user, body.familyId);
      await tidy(c);
      const q = R.snapshotOf({ name: body.q || '' }).name.toLowerCase().slice(0, L.search);
      const rows = await all(T.pubs, [Query.equal('familyId', [c.familyId])], L.libraryMax * 4);
      const out = rows.filter((r) => readable(c, r)).map((r) => summary(c, r)).filter((s) => !q || s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, L.libraryMax);
      const fam = c.family && (c.family.name || c.family.familyName);
      return { family: fam || 'your family', recipes: out };
    },
    /** One recipe, with its full photo. The same "not available" for a missing id, another family's id, an unpublished one and a hidden one. */
    async recipesGet({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await rowFor(c, body.id);
      if (!readable(c, r)) throw NA();
      const out = { ...parse(r.data), id: r.$id, authorName: nameOf(c, r.authorId), mine: r.authorId === c.me.userId, version: r.version || 1, image: '' };
      if (r.photoId && storage) {
        try { out.image = 'data:image/jpeg;base64,' + Buffer.from(await storage.getFileDownload({ bucketId: photoBucket, fileId: r.photoId })).toString('base64'); }
        catch (e) { if (sdkCode(e) !== 404) throw e; }
      }
      return { recipe: out };
    },
    async recipesPublish({ user, body }) {
      const c = await context(user, body.familyId);
      const { draft, pics, imageKey } = bodyOf(body);
      const sourceId = String(draft.id || draft.slug || '').slice(0, 80);
      if (!sourceId) throw bad('That recipe has no id.');
      const v = R.validate(draft, pics, imageKey);
      if (!v.ok) throw invalid(v);
      const pubKey = (c.familyId + '_' + user.$id + '_' + sourceId).slice(0, 190);
      const mine = await all(T.pubs, [Query.equal('familyId', [c.familyId]), Query.equal('authorId', [user.$id])], L.publishedPerAuthor + 20);
      if (mine.some((r) => r.sourceId === sourceId && mineRow(c, r) && !r.hiddenAt)) throw new ApiError(409, 'exists', 'This recipe is already published. Use "Update published version".');
      if (mine.filter((r) => mineRow(c, r) && !r.hiddenAt).length >= L.publishedPerAuthor) throw new ApiError(409, 'limit', 'You have reached the limit of published recipes.');
      // a hidden or stale row of the same recipe (from an earlier membership) is cleared out so it cannot block or revive
      for (const r of mine) if (r.sourceId === sourceId && !mineRow(c, r)) await removeRow(r);
      const pic = await savePhoto(v, pics);
      const id = ID.unique();
      try {
        await createRow(T.pubs, id, { familyId: c.familyId, authorId: user.$id, authorMembershipId: c.me.membershipId, sourceId, pubKey, hash: v.hash, imageKey: v.imageKey, photoId: pic.photoId, thumb: pic.thumb, status: 'published', version: 1, publishedAt: iso(), data: JSON.stringify(v.snapshot) }, []);
      } catch (e) {
        await dropPhoto(pic.photoId);
        if (sdkCode(e) === 409) throw new ApiError(409, 'exists', 'This recipe is already published. Use "Update published version".');
        if (sdkCode(e) === 400) throw bad('Recipe sharing needs one more setup step: check the recipePubs table columns (see RECIPES-SHARING-CONSOLE-COMMANDS.md).');
        throw e;
      }
      return { id, version: 1, hash: v.hash };
    },
    async recipesUpdate({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await rowFor(c, body.id);
      if (!mineRow(c, r) || r.hiddenAt) throw NA();
      const { draft, pics, imageKey } = bodyOf(body);
      const v = R.validate(draft, pics, imageKey);
      if (!v.ok) throw invalid(v);
      const pic = await savePhoto(v, pics);
      const version = (r.version || 1) + 1, oldPhoto = r.photoId;
      try { await updateRow(T.pubs, r.$id, { hash: v.hash, imageKey: v.imageKey, photoId: pic.photoId, thumb: pic.thumb, version, data: JSON.stringify(v.snapshot) }); }
      catch (e) { await dropPhoto(pic.photoId); throw e; }
      await dropPhoto(oldPhoto);
      return { id: r.$id, version, hash: v.hash };
    },
    async recipesUnpublish({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await rowFor(c, body.id);
      if (!mineRow(c, r)) throw NA();
      await removeRow(r);
      return {};
    },

    /* ----- cookbooks: the author's saved cookbook (from the cookbook maker on their device) is copied as a text snapshot ----- */
    async recipesBookMine({ user, body }) {
      const c = await context(user, body.familyId);
      const rows = await all(T.books, [Query.equal('familyId', [c.familyId]), Query.equal('authorId', [user.$id])], L.publishedPerAuthor + 20);
      return { pubs: rows.filter((r) => mineRow(c, r) && !r.hiddenAt).map((r) => ({ id: r.$id, sourceSlug: r.sourceId, hash: r.hash, version: r.version || 1 })) };
    },
    async recipesBookLibrary({ user, body }) {
      const c = await context(user, body.familyId);
      await tidy(c, T.books);
      const q = R.snapshotOf({ name: body.q || '' }).name.toLowerCase().slice(0, L.search);
      const rows = await all(T.books, [Query.equal('familyId', [c.familyId])], L.libraryMax * 4);
      const out = rows.filter((r) => readable(c, r)).map((r) => { const d = parse(r.data); return { id: r.$id, name: d.name || '', author: d.author || '', count: r.count || 0, authorName: nameOf(c, r.authorId), mine: r.authorId === c.me.userId, version: r.version || 1 }; })
        .filter((s) => !q || s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, L.libraryMax);
      return { family: (c.family && (c.family.name || c.family.familyName)) || 'your family', books: out };
    },
    async recipesBookGet({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await getRowOrNull(T.books, idOf(body.id, 'id'));
      if (!r || r.familyId !== c.familyId || !readable(c, r)) throw NA();
      return { book: { ...parse(r.data), id: r.$id, authorName: nameOf(c, r.authorId), mine: r.authorId === c.me.userId, version: r.version || 1 } };
    },
    async recipesBookPublish({ user, body }) {
      const c = await context(user, body.familyId);
      const book = body && typeof body.book === 'object' && body.book ? body.book : {};
      const sourceId = String(book.id || '').slice(0, 80);
      if (!sourceId) throw bad('That cookbook has no id.');
      const v = R.validateBook(book);
      if (!v.ok) throw invalid(v);
      const pubKey = (c.familyId + '_' + user.$id + '_' + sourceId).slice(0, 190);
      const mine = await all(T.books, [Query.equal('familyId', [c.familyId]), Query.equal('authorId', [user.$id])], L.publishedPerAuthor + 20);
      if (mine.some((r) => r.sourceId === sourceId && mineRow(c, r) && !r.hiddenAt)) throw new ApiError(409, 'exists', 'This cookbook is already published. Use "Update published version".');
      if (mine.filter((r) => mineRow(c, r) && !r.hiddenAt).length >= 50) throw new ApiError(409, 'limit', 'You have reached the limit of published cookbooks.');
      for (const r of mine) if (r.sourceId === sourceId && !mineRow(c, r)) await removeRow(r, T.books);
      const id = ID.unique();
      try { await createRow(T.books, id, { familyId: c.familyId, authorId: user.$id, authorMembershipId: c.me.membershipId, sourceId, pubKey, hash: v.hash, status: 'published', version: 1, count: v.count, publishedAt: iso(), data: JSON.stringify(v.snapshot) }, []); }
      catch (e) {
        if (sdkCode(e) === 409) throw new ApiError(409, 'exists', 'This cookbook is already published. Use "Update published version".');
        if (sdkCode(e) === 400 || sdkCode(e) === 404) throw bad('Cookbook sharing needs one more setup step: add the recipeBooks table (see RECIPES-SHARING-CONSOLE-COMMANDS.md).');
        throw e;
      }
      return { id, version: 1, hash: v.hash };
    },
    async recipesBookUpdate({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await getRowOrNull(T.books, idOf(body.id, 'id'));
      if (!r || r.familyId !== c.familyId || !mineRow(c, r) || r.hiddenAt) throw NA();
      const v = R.validateBook(body && typeof body.book === 'object' && body.book ? body.book : {});
      if (!v.ok) throw invalid(v);
      const version = (r.version || 1) + 1;
      await updateRow(T.books, r.$id, { hash: v.hash, count: v.count, version, data: JSON.stringify(v.snapshot) });
      return { id: r.$id, version, hash: v.hash };
    },
    async recipesBookUnpublish({ user, body }) {
      const c = await context(user, body.familyId);
      const r = await getRowOrNull(T.books, idOf(body.id, 'id'));
      if (!r || r.familyId !== c.familyId || !mineRow(c, r)) throw NA();
      await removeRow(r, T.books);
      return {};
    }
  };

  return { actions, sweepRecipes, purgeFamily, tables: T };
}
