/* Recipes publishing preview: the FAKE SERVER (PREVIEW CODE, not wired into the live app).
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 * An in-memory simulation of what the proposed family-api actions would enforce, using the shared rules in recipes-pub-core.js.
 * Invented people and recipes only. No network, nothing survives a reload. It does NOT prove Appwrite enforcement: no table or function exists.
 * Every call is  server.call(userId, action, body). Owner, admin and tree-admin roles grant NO reading or editing rights over anyone's recipes. */
(function (root, factory) {
  var C = typeof module === 'object' && module.exports ? require('../recipes-pub-core.js') : root.RecipesPubCore;
  var api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RecipesPubFake = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var fail = function (error, message, extra) { return Object.assign({ ok: false, error: error, message: message }, extra || {}); };
  var NA = function () { return fail('not_available', 'That is not available.'); };

  var SQUARE_PIC = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivGPaCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=', WIDE_PIC = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivGPaCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==';
  var VIEWERS = [
    { userId: 'u-rae', name: 'Rae Sample' }, { userId: 'u-sam', name: 'Sam Sample' }, { userId: 'u-tia', name: 'Tia Sample' }, { userId: 'u-una', name: 'Una Sample' }
  ];
  /* The recipes each person has on THEIR OWN device (private drafts). The real app keeps these in the browser, so they are not on the server. */
  /** Each person's saved cookbooks as the cookbook maker keeps them on their own device. */
  function sampleBooks() {
    var rec = function (slug, name, extra) { return Object.assign({ slug: slug, name: name, ingredients: ['2 cups flour'], steps: ['Mix.', 'Bake.'] }, extra || {}); };
    return {
      'u-rae': [{ id: 'bk-rae', name: 'Rae Cookbook', settings: { title: 'Rae Family Cookbook', author: 'Rae', intro: 'Recipes we love.' }, sections: [{ id: 's1', title: 'Breads', items: ['grans-sourdough'] }, { id: 's2', title: '', items: ['sunday-pancakes'] }],
        snap: { 'grans-sourdough': rec('grans-sourdough', "Gran's Sourdough"), 'sunday-pancakes': rec('sunday-pancakes', 'Sunday Pancakes') }, extras: {} }],
      'u-sam': [], 'u-tia': [], 'u-una': []
    };
  }
  function sampleDrafts() {
    var r = function (slug, name, o) { return Object.assign({ slug: slug, id: 'book-' + slug, name: name, description: '', yield: '4 servings', total: '30 minutes', ingredients: ['2 cups flour', '1 cup water', '1 teaspoon salt'], steps: ['Mix everything.', 'Cook until done.'], categories: [], tags: [], notes: '', parts: [], image: '', imageW: 0, imageH: 0 }, o || {}); };
    return {
      'u-rae': [r('grans-sourdough', "Gran's Sourdough", { description: 'Slow, chewy, worth the wait.', total: '1 day', categories: ['Bread'], ingredients: ['500 g bread flour', '350 g water', '100 g active starter', '10 g salt'], steps: ['Mix and rest 30 minutes.', 'Fold every 30 minutes, four times.', 'Shape, proof overnight in the fridge.', 'Bake at 450°F in a covered pot, 20 minutes lidded, 20 minutes open.'] }),
        r('sunday-pancakes', 'Sunday Pancakes', { categories: ['Breakfast'], ingredients: ['2 cups flour', '2 eggs', '1 3/4 cups milk'], steps: ['Whisk.', 'Cook on a hot griddle.'] }),
        r('brunch-plate', 'Brunch Plate', { parts: ['sunday-pancakes'], ingredients: ['Fresh fruit'], steps: ['Serve together.'] }),
        r('secret-spice-rub', 'Secret Spice Rub', { notes: 'Only for me.', ingredients: ['1 tablespoon paprika', '1 teaspoon cumin'], steps: ['Mix.'] })],
      'u-sam': [r('sams-chili', "Sam's Chili", { categories: ['Soups'], ingredients: ['1 pound ground beef', '2 cans beans', '1 can tomatoes'], steps: ['Brown the beef.', 'Add the rest and simmer 1 hour.'] }),
        r('wide-photo-toast', 'Wide Photo Toast', { image: WIDE_PIC, ingredients: ['2 slices bread'], steps: ['Toast it.'] })],
      'u-tia': [r('lemon-bars', 'Lemon Bars', { categories: ['Dessert'], ingredients: ['1 cup butter', '2 cups flour', '4 eggs', '1 cup lemon juice'], steps: ['Bake the crust.', 'Pour the filling and bake 20 minutes.'] }),
        r('tias-tea-notes', "Tia's Tea Notes", { ingredients: ['1 tea bag'], steps: ['Steep.'] })],
      'u-una': [r('beta-chili', 'Beta Family Chili', { categories: ['Soups'], ingredients: ['2 cans beans', '1 onion'], steps: ['Simmer 40 minutes.'] })]
    };
  }

  function create(options) {
    options = options || {};
    var families = {}, members = [], rows = {}, brows = {}, seq = 0, nowDay = 0;
    var nid = function (p) { return p + (++seq); };
    var famName = function (id) { return families[id] ? families[id].name : ''; };
    var mem = function (userId, familyId) { return members.filter(function (m) { return m.userId === userId && m.familyId === familyId && m.active; })[0] || null; };
    var nameOf = function (userId) { var v = VIEWERS.filter(function (x) { return x.userId === userId; })[0]; return v ? v.name : 'Family member'; };
    var gate = function (userId, familyId) { var m = families[familyId] && mem(userId, familyId); return m ? { m: m } : { err: NA() }; };
    var summary = function (row, m) { var s = row.snapshot; return { id: row.id, name: s.name, description: s.description, yield: s.yield, total: s.total, categories: s.categories, hasImage: !!row.thumb, thumb: row.thumb, authorName: nameOf(row.authorId), mine: row.authorId === m.userId, version: row.version, publishedDay: row.publishedDay }; };

    function addMember(userId, familyId, role) { var m = { membershipId: nid('mb-'), userId: userId, familyId: familyId, role: role, active: true }; members.push(m); return m; }
    function seed() {
      families.fHappy = { id: 'fHappy', name: 'Happy Family' }; families.fBeta = { id: 'fBeta', name: 'Beta Family' };
      addMember('u-rae', 'fHappy', 'owner'); addMember('u-sam', 'fHappy', 'admin'); addMember('u-tia', 'fHappy', 'member'); addMember('u-rae', 'fBeta', 'member'); addMember('u-una', 'fBeta', 'owner');
      var d = sampleDrafts();
      [['u-rae', 'fHappy', 'grans-sourdough'], ['u-tia', 'fHappy', 'lemon-bars'], ['u-una', 'fBeta', 'beta-chili']].forEach(function (x) {
        var draft = d[x[0]].filter(function (r) { return r.slug === x[2]; })[0];
        publish(mem(x[0], x[1]), draft, picsOf(draft), C.imageKeyOf(draft));
      });
    }
    function picsOf(draft) { return draft && draft.image ? { photo: draft.image, thumb: draft.image } : null; }
    function publish(m, draft, pics, imageKey) {
      var v = C.validate(draft, pics, imageKey); if (!v.ok) return fail('invalid', v.message, { fields: v.fields });
      var slug = String((draft && (draft.id || draft.slug)) || '').slice(0, 80); if (!slug) return fail('invalid', 'That recipe has no id.');
      var mine = Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) { return r.familyId === m.familyId && r.authorId === m.userId; });
      if (mine.some(function (r) { return r.sourceSlug === slug; })) return fail('exists', 'This recipe is already published. Use "Update published version".');
      if (mine.length >= C.LIMITS.publishedPerAuthor) return fail('limit', 'You have reached the limit of published recipes.');
      var id = nid('rp-');
      rows[id] = { id: id, familyId: m.familyId, authorId: m.userId, authorMembershipId: m.membershipId, sourceSlug: slug, snapshot: v.snapshot, hash: v.hash, photo: v.hasPhoto ? pics.photo : '', thumb: v.hasPhoto ? pics.thumb : '', version: 1, status: 'published', hiddenAt: null, publishedDay: nowDay };
      return { ok: true, id: id, version: 1, hash: rows[id].hash };
    }
    function rowFor(m, id) { var r = rows[id]; return r && r.familyId === m.familyId ? r : null; }

    var enabledFor = { }; var isOwner = function (userId, familyId) { return !!members.filter(function (m) { return m.userId === userId && m.familyId === familyId && m.active && m.role === 'owner'; })[0]; };
    var actions = {
      /* cookbooks */
      bookMine: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; return { ok: true, pubs: Object.keys(brows).map(function (k) { return brows[k]; }).filter(function (r) { return C.canAuthor(g.m, r) && r.familyId === g.m.familyId; }).map(function (r) { return { id: r.id, sourceSlug: r.sourceId, hash: r.hash, version: r.version }; }) }; },
      bookLibrary: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err;
        return { ok: true, family: famName(b.familyId), books: Object.keys(brows).map(function (k) { return brows[k]; }).filter(function (r) { return C.canRead(g.m, r, mem(r.authorId, r.familyId)); }).map(function (r) { return { id: r.id, name: r.snapshot.name, authorName: nameOf(r.authorId), mine: r.authorId === g.m.userId, count: r.count, version: r.version }; }) }; },
      bookGet: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; var r = brows[String(b.id || '')]; if (!r || r.familyId !== g.m.familyId || !C.canRead(g.m, r, mem(r.authorId, r.familyId))) return NA();
        return { ok: true, book: Object.assign({}, r.snapshot, { id: r.id, authorName: nameOf(r.authorId), mine: r.authorId === g.m.userId, version: r.version }) }; },
      bookPublish: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; var v = C.validateBook(b.book); if (!v.ok) return fail('invalid', v.message);
        var sid = String((b.book && b.book.id) || ''); if (Object.keys(brows).some(function (k) { return brows[k].authorId === userId && brows[k].familyId === b.familyId && brows[k].sourceId === sid && C.canAuthor(g.m, brows[k]); })) return fail('exists', 'This cookbook is already published. Use "Update published version".');
        var id = nid('bp-'); brows[id] = { id: id, familyId: g.m.familyId, authorId: userId, authorMembershipId: g.m.membershipId, sourceId: sid, snapshot: v.snapshot, hash: v.hash, count: v.count, version: 1, status: 'published', hiddenAt: null }; return { ok: true, id: id, version: 1, hash: v.hash }; },
      bookUpdate: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; var r = brows[String(b.id || '')]; if (!r || !C.canAuthor(g.m, r)) return NA(); var v = C.validateBook(b.book); if (!v.ok) return fail('invalid', v.message);
        r.snapshot = v.snapshot; r.hash = v.hash; r.count = v.count; r.version += 1; return { ok: true, id: r.id, version: r.version, hash: r.hash }; },
      bookUnpublish: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; var r = brows[String(b.id || '')]; if (!r || !C.canAuthor(g.m, r)) return NA(); delete brows[r.id]; return { ok: true }; },
      status: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; return { ok: true, enabled: enabledFor[b.familyId] !== false, canTurnOn: isOwner(userId, b.familyId) }; },
      setEnabled: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; if (!isOwner(userId, b.familyId)) return fail('not_owner', 'Only the family owner can do that.'); enabledFor[b.familyId] = !!b.enabled; return { ok: true, enabled: !!b.enabled }; },
      families: function (userId) { return { ok: true, families: members.filter(function (m) { return m.userId === userId && m.active; }).map(function (m) { return { id: m.familyId, name: famName(m.familyId) }; }) }; },
      /** The Family Library: only THIS family's published, visible recipes. Title search only. Never a draft, never another family. */
      library: function (userId, b) {
        var g = gate(userId, b.familyId); if (g.err) return g.err;
        var q = C.snapshotOf({ name: b.q || '' }).name.toLowerCase().slice(0, C.LIMITS.search);
        var out = Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) { return C.canRead(g.m, r, mem(r.authorId, r.familyId)) && (!q || r.snapshot.name.toLowerCase().indexOf(q) !== -1); })
          .sort(function (a, c) { return a.snapshot.name.localeCompare(c.snapshot.name); }).map(function (r) { return summary(r, g.m); });
        return { ok: true, family: famName(b.familyId), recipes: out };
      },
      /** Opening one by id: the same "not available" for a missing id, another family's id, an unpublished one and a hidden one. */
      get: function (userId, b) {
        var g = gate(userId, b.familyId); if (g.err) return g.err;
        var r = rowFor(g.m, String(b.id || '')); if (!r || !C.canRead(g.m, r, mem(r.authorId, r.familyId))) return NA();
        return { ok: true, recipe: Object.assign({}, r.snapshot, { image: r.photo, id: r.id, authorName: nameOf(r.authorId), mine: r.authorId === g.m.userId, version: r.version }) };
      },
      /** What the caller has published here, so their screen can mark each draft. Only rows the caller still owns under their CURRENT membership. */
      mine: function (userId, b) {
        var g = gate(userId, b.familyId); if (g.err) return g.err;
        return { ok: true, pubs: Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) { return C.canAuthor(g.m, r) && r.hiddenAt == null; }).map(function (r) { return { id: r.id, sourceSlug: r.sourceSlug, hash: r.hash, version: r.version }; }) };
      },
      publish: function (userId, b) { var g = gate(userId, b.familyId); if (g.err) return g.err; return publish(g.m, b.draft, b.pics, b.imageKey); },
      update: function (userId, b) {
        var g = gate(userId, b.familyId); if (g.err) return g.err;
        var r = rowFor(g.m, String(b.id || '')); if (!r || !C.canAuthor(g.m, r) || r.hiddenAt != null) return NA();
        var v = C.validate(b.draft, b.pics, b.imageKey); if (!v.ok) return fail('invalid', v.message, { fields: v.fields });
        r.snapshot = v.snapshot; r.hash = v.hash; r.photo = v.hasPhoto ? b.pics.photo : ''; r.thumb = v.hasPhoto ? b.pics.thumb : ''; r.version += 1;
        return { ok: true, id: r.id, version: r.version, hash: r.hash };
      },
      unpublish: function (userId, b) {
        var g = gate(userId, b.familyId); if (g.err) return g.err;
        var r = rowFor(g.m, String(b.id || '')); if (!r || !C.canAuthor(g.m, r)) return NA();
        delete rows[r.id]; return { ok: true };
      },
      /** "Edit a copy of the published version": gives the author their own snapshot back as a draft on this device. */
      copyBack: function (userId, b) {
        var g = gate(userId, b.familyId); if (g.err) return g.err;
        var r = rowFor(g.m, String(b.id || '')); if (!r || !C.canAuthor(g.m, r) || r.hiddenAt != null) return NA();
        return { ok: true, draft: Object.assign({ slug: r.sourceSlug, image: r.photo }, r.snapshot) };
      }
    };

    var admin = {
      /* things that happen in the family, outside this feature */
      removeMember: function (userId, familyId) { members.forEach(function (m) { if (m.userId === userId && m.familyId === familyId && m.active) { m.active = false; } }); Object.keys(rows).forEach(function (k) { var r = rows[k]; if (r.authorId === userId && r.familyId === familyId && r.hiddenAt == null) r.hiddenAt = nowDay; }); },
      reinvite: function (userId, familyId) { return addMember(userId, familyId, 'member'); },
      deleteAccount: function (userId) { members.forEach(function (m) { if (m.userId === userId) m.active = false; }); Object.keys(rows).forEach(function (k) { if (rows[k].authorId === userId) delete rows[k]; }); },
      deleteFamily: function (familyId) { Object.keys(rows).forEach(function (k) { if (rows[k].familyId === familyId) delete rows[k]; }); members.forEach(function (m) { if (m.familyId === familyId) m.active = false; }); delete families[familyId]; },
      advanceDays: function (n) { nowDay += n; Object.keys(rows).forEach(function (k) { var r = rows[k]; if (r.hiddenAt != null && nowDay - r.hiddenAt >= C.HIDDEN_DAYS) delete rows[k]; }); },
      day: function () { return nowDay; },
      rowCount: function () { return Object.keys(rows).length; },
      hiddenCount: function (familyId) { return Object.keys(rows).filter(function (k) { return rows[k].familyId === familyId && rows[k].hiddenAt != null; }).length; },
      roleOf: function (userId, familyId) { var m = mem(userId, familyId); return m ? m.role : ''; }
    };
    if (options.seed !== false) seed(); else { families.fHappy = { id: 'fHappy', name: 'Happy Family' }; families.fBeta = { id: 'fBeta', name: 'Beta Family' }; }
    return { setSharing: function (familyId, on) { enabledFor[familyId] = !!on; }, call: function (userId, action, body) { if (!Object.prototype.hasOwnProperty.call(actions, action)) return fail('bad_action', 'Unknown action.'); try { return actions[action](userId, body || {}); } catch (e) { return fail('server', 'Something went wrong.'); } }, admin: admin, addMember: addMember, publish: function (userId, familyId, draft) { return publish(mem(userId, familyId), draft, picsOf(draft), C.imageKeyOf(draft)); } };
  }
  return { create: create, VIEWERS: VIEWERS, sampleDrafts: sampleDrafts, sampleBooks: sampleBooks, SQUARE_PIC: SQUARE_PIC, WIDE_PIC: WIDE_PIC };
});
