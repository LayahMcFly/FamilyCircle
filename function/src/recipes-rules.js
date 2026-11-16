/* Recipes family publishing rules for the real backend. Copied from recipes-pub-core.js (the version the preview and its tests use) and
 * converted to a module. function/test/recipes.test.js checks both copies give the same answers, so they cannot drift apart.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt). */
var LIMITS = { title: 80, description: 300, line: 160, step: 700, notes: 1500, ingredients: 60, steps: 40, tags: 10, tag: 30, categories: 5, parts: 5, search: 60, photoBytes: 120000, thumbBytes: 10000, publishedPerAuthor: 200, snapshotChars: 60000 };
var HIDDEN_DAYS = 30;   // an author who left: their published recipes stay hidden this long, then are deleted
var str = function (v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); };
var list = function (v, maxItems, maxLen) { return (Array.isArray(v) ? v : []).map(function (x) { return str(x, maxLen); }).filter(Boolean).slice(0, maxItems); };

/** Width and height read from the JPEG's own header (so the size is checked, not taken on trust). null when it is not a readable JPEG data URL within the byte limit. */
function jpegDims(url, maxBytes) {
  if (typeof url !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(url) || (url.length - 23) * 0.75 > (maxBytes || LIMITS.photoBytes)) return null;
  var bytes;
  try { bytes = typeof atob === 'function' ? atob(url.slice(23)) : Buffer.from(url.slice(23), 'base64').toString('binary'); } catch (e) { return null; }
  if (bytes.charCodeAt(0) !== 0xFF || bytes.charCodeAt(1) !== 0xD8) return null;
  var i = 2;
  while (i + 9 < bytes.length) {
    if (bytes.charCodeAt(i) !== 0xFF) return null;
    var m = bytes.charCodeAt(i + 1), len = (bytes.charCodeAt(i + 2) << 8) | bytes.charCodeAt(i + 3);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (bytes.charCodeAt(i + 5) << 8) | bytes.charCodeAt(i + 6), w: (bytes.charCodeAt(i + 7) << 8) | bytes.charCodeAt(i + 8) };
    i += 2 + len;
  }
  return null;
}
function squareJpeg(url, maxBytes) { var d = jpegDims(url, maxBytes); return !!(d && d.w > 0 && d.w === d.h); }

/** What a snapshot may contain (text only; the photo is kept apart). Never copies ids, ownership, favourites, source links or anything private. */
function snapshotOf(r) {
  r = r || {};
  return {
    name: str(r.name, LIMITS.title), description: str(r.description, LIMITS.description), yield: str(r.yield, 40), prep: str(r.prep, 40), cook: str(r.cook, 40), total: str(r.total, 40),
    ingredients: list(r.ingredients, LIMITS.ingredients, LIMITS.line), steps: list(r.steps, LIMITS.steps, LIMITS.step),
    categories: list(r.categories, LIMITS.categories, LIMITS.tag), tags: list(r.tags, LIMITS.tags, LIMITS.tag), notes: str(r.notes, LIMITS.notes),
    parts: (Array.isArray(r.parts) ? r.parts : []).slice(0, LIMITS.parts).map(function (p) { return p && typeof p === 'object' ? { name: str(p.name, LIMITS.title), ingredients: list(p.ingredients, LIMITS.ingredients, LIMITS.line), steps: list(p.steps, LIMITS.steps, LIMITS.step) } : null; }).filter(function (p) { return p && p.name; })
  };
}
/** A short fixed fingerprint of a string. */
function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }
/** The photo's fingerprint on the author's own device ('' when there is no photo). The server only stores it; it lets the screen tell "photo changed". */
function imageKeyOf(r) { return r && typeof r.image === 'string' && r.image ? fnv(r.image) : ''; }
var KEY = /^[0-9a-f]{0,12}$/;
var hashOf = function (snap, imageKey) { return fnv(JSON.stringify(snap)) + '.' + (imageKey || ''); };

/** { ok:true, snapshot, imageKey, hash } or { ok:false, fields, message }. `pics` = { photo, thumb } (small square JPEG data URLs) when the recipe has a photo. */
function validate(draft, pics, imageKey) {
  var s = snapshotOf(draft), fields = {}, hasPhoto = !!(draft && draft.image);
  if (!s.name) fields.name = 'Give the recipe a name.';
  if (!s.ingredients.length) fields.ingredients = 'Add at least one ingredient.';
  if (!s.steps.length) fields.steps = 'Add at least one step.';
  if (JSON.stringify(s).length > LIMITS.snapshotChars) fields.size = 'This recipe is too long to publish. Shorten the steps, notes or sub-recipes.';
  if (hasPhoto) {
    if (!pics || !squareJpeg(pics.photo, LIMITS.photoBytes) || !squareJpeg(pics.thumb, LIMITS.thumbBytes)) fields.photo = 'The photo must be a square JPEG under about 120 KB.';
    if (imageKey !== undefined && !KEY.test(String(imageKey))) fields.photo = 'The photo could not be read.';
  }
  var keys = Object.keys(fields);
  if (keys.length) return { ok: false, fields: fields, message: fields[keys[0]] };
  var key = hasPhoto ? String(imageKey === undefined ? imageKeyOf(draft) : imageKey) : '';
  return { ok: true, snapshot: s, imageKey: key, hash: hashOf(s, key), hasPhoto: hasPhoto };
}
/** 'private' (never published), 'published' (same as the draft), 'changed' (draft differs from what the family sees). */
function stateOf(draft, pub) { return !pub ? 'private' : hashOf(snapshotOf(draft), imageKeyOf(draft)) === pub.hash ? 'published' : 'changed'; }
/** Reading: a current, confirmed membership of THAT family, and the author's own membership must still be the one that published it. Roles add nothing. */
function canRead(member, row, authorMember) {
  return !!(member && member.active && row && row.familyId === member.familyId && row.status === 'published' && row.hiddenAt == null && authorMember && authorMember.active && authorMember.membershipId === row.authorMembershipId);
}
/** Authoring: the caller wrote it AND is still in the same membership (a person removed and re-invited has a new one and does not get it back). */
function canAuthor(member, row) {
  return !!(member && member.active && row && row.familyId === member.familyId && row.authorId === member.userId && row.authorMembershipId === member.membershipId);
}

export { LIMITS, HIDDEN_DAYS, snapshotOf, validate, hashOf, imageKeyOf, stateOf, canRead, canAuthor, jpegDims, squareJpeg };
