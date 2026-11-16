/* Recipes family publishing: the shared RULES (used by the preview page, its fake server and the tests; the real function would carry a mirror).
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 * Nothing here talks to a network. A recipe is PRIVATE to its author until the author publishes a SNAPSHOT of it to the one current family.
 * Editing the private draft never changes the snapshot. Only "Update published version" does. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RecipesPubCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMITS = { title: 80, description: 300, line: 160, step: 700, notes: 1500, ingredients: 60, steps: 40, tags: 10, tag: 30, categories: 5, parts: 5, search: 60, imageChars: 160000, publishedPerAuthor: 200 };
  var HIDDEN_DAYS = 30;   // an author who left: their published recipes stay hidden this long, then are deleted
  var TEXT = {
    mine: 'My Recipes', cookbooks: 'My Cookbooks', library: 'Family Library', shared: 'Shared Recipes', sharedCookbooks: 'Shared Cookbooks',
    privateLabel: 'Private to you',
    publishedLabel: function (family) { return 'Published to ' + family; },
    publishBtn: 'Publish to family', unpublishBtn: 'Unpublish', updateBtn: 'Update published version',
    publishConfirm: function (family) { return 'This recipe will be visible to members of ' + family + '. They can print it or save a copy using their device.'; },
    unpublishNote: 'Unpublishing removes it from the library and blocks opening it. It cannot recall pages already printed, files already downloaded, screenshots or copies people saved.',
    changedLabel: 'Changes not published yet'
  };
  var str = function (v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); };
  var list = function (v, maxItems, maxLen) { return (Array.isArray(v) ? v : []).map(function (x) { return str(x, maxLen); }).filter(Boolean).slice(0, maxItems); };

  /** Width and height read from the JPEG's own header (so the size is checked, not taken on trust). null when it is not a readable JPEG data URL. */
  function jpegDims(url) {
    if (typeof url !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(url) || url.length > LIMITS.imageChars) return null;
    var b64 = url.slice(23), bytes;
    try { var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'); bytes = bin; } catch (e) { return null; }
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
  function squareJpeg(url) { var d = jpegDims(url); return !!(d && d.w > 0 && d.w === d.h); }
  /** What a snapshot may contain. Never copies ids, ownership, favourites, source links or anything private. */
  function snapshotOf(r) {
    r = r || {};
    var snap = {
      name: str(r.name, LIMITS.title), description: str(r.description, LIMITS.description), yield: str(r.yield, 40), prep: str(r.prep, 40), cook: str(r.cook, 40), total: str(r.total, 40),
      ingredients: list(r.ingredients, LIMITS.ingredients, LIMITS.line), steps: list(r.steps, LIMITS.steps, LIMITS.step),
      categories: list(r.categories, LIMITS.categories, LIMITS.tag), tags: list(r.tags, LIMITS.tags, LIMITS.tag), notes: str(r.notes, LIMITS.notes),
      parts: (Array.isArray(r.parts) ? r.parts : []).slice(0, LIMITS.parts).map(function (p) { return p && typeof p === 'object' ? { name: str(p.name, LIMITS.title), ingredients: list(p.ingredients, LIMITS.ingredients, LIMITS.line), steps: list(p.steps, LIMITS.steps, LIMITS.step) } : null; }).filter(function (p) { return p && p.name; }),
      image: ''
    };
    if (squareJpeg(r.image)) snap.image = r.image;
    return snap;
  }
  /** { ok:true, snapshot } or { ok:false, fields:{...}, message } */
  function validate(draft) {
    var s = snapshotOf(draft), fields = {};
    if (!s.name) fields.name = 'Give the recipe a name.';
    if (!s.ingredients.length) fields.ingredients = 'Add at least one ingredient.';
    if (!s.steps.length) fields.steps = 'Add at least one step.';
    if (draft && draft.image && !s.image) fields.image = 'The photo must be a square JPEG under about 120 KB.';
    var keys = Object.keys(fields);
    return keys.length ? { ok: false, fields: fields, message: fields[keys[0]] } : { ok: true, snapshot: s };
  }
  /** A short fixed fingerprint of a snapshot, to tell "draft differs from the published version" without storing two copies in the screen. */
  function hashOf(snap) {
    var s = JSON.stringify(snap), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16);
  }
  /** 'private' (never published), 'published' (same as the draft), 'changed' (draft differs from what the family sees). */
  function stateOf(draft, pub) {
    if (!pub) return 'private';
    return hashOf(snapshotOf(draft)) === pub.hash ? 'published' : 'changed';
  }
  /** Reading: a current, confirmed membership of THAT family, and the author's own membership must still be the one that published it. Roles add nothing. */
  function canRead(member, row) {
    return !!(member && member.active && row && row.familyId === member.familyId && row.status === 'published' && row.hiddenAt == null);
  }
  /** Authoring: the caller wrote it AND is still in the same membership (a person removed and re-invited has a new one and does not get it back). */
  function canAuthor(member, row) {
    return !!(member && member.active && row && row.familyId === member.familyId && row.authorId === member.userId && row.authorMembershipId === member.membershipId);
  }
  return { LIMITS: LIMITS, HIDDEN_DAYS: HIDDEN_DAYS, TEXT: TEXT, snapshotOf: snapshotOf, validate: validate, hashOf: hashOf, jpegDims: jpegDims, squareJpeg: squareJpeg, stateOf: stateOf, canRead: canRead, canAuthor: canAuthor };
});
