/* Recipes family publishing: the extra SCREEN PARTS added to the Recipes screen (badges, tabs, publish panel, Family Library).
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 * recipes.js uses this only when the app hands it over as X.publish; without it the Recipe Book behaves exactly as before.
 * It never touches the network itself: every request goes through o.call(action, body), which the preview points at a FAKE server. */
(function () {
  'use strict';
  var C = window.RecipesPubCore, T = C.TEXT;

  /* o: { h, icon, toast, confirmDialog, call(action, body) -> Promise, family() -> {id,name}|null, reroute() } */
  function create(o) {
    var h = o.h, icon = o.icon, toast = o.toast;
    var st = { section: 'mine', sub: 'recipes', q: '', pubs: {}, key: null, loading: false, find: null, enabled: null, canTurnOn: false, show: 'all' };
    var famName = function () { var f = o.family(); return f ? f.name : ''; };
    var famId = function () { var f = o.family(); return f ? f.id : ''; };

    /** What gets published for a recipe: its own fields plus the sub-recipes it is made from, copied in (so a reader never needs the author's other recipes). */
    function draftOf(r) {
      var parts = (r.parts || []).map(function (sl) { return st.find ? st.find(sl) : null; }).filter(Boolean).map(function (p) { return { name: p.name, ingredients: p.ingredients, steps: p.steps }; });
      return Object.assign({}, r, { parts: parts });
    }
    function reset() { st.pubs = {}; st.key = null; st.loading = false; st.q = ''; st.section = 'mine'; st.sub = 'recipes'; st.enabled = null; st.canTurnOn = false; st.show = 'all'; }
    /** Asks whether sharing is turned on for this family; if so loads what the signed-in person has published here (once per family), then redraws.
     *  Any failure (including a server that does not know these actions yet) leaves sharing OFF, so the Recipe Book looks exactly as it did before. */
    function ensure() {
      var id = famId(); if (!id || st.key === id || st.loading) return;
      st.loading = true; var asked = id; st.enabled = null; st.canTurnOn = false; st.pubs = {};
      Promise.resolve(o.call('status', {})).then(function (s) {
        if (famId() !== asked) return null;
        st.enabled = !!(s && s.ok && s.enabled); st.canTurnOn = !!(s && s.ok && s.canTurnOn);
        return st.enabled ? o.call('mine', {}) : null;
      }).then(function (r) {
        if (famId() !== asked) { st.loading = false; return; }
        st.pubs = {}; (r && r.ok ? r.pubs : []).forEach(function (p) { st.pubs[p.sourceSlug] = Object.assign({}, p, { serverId: p.id }); });
        st.key = asked; st.loading = false; o.reroute();
      }, function () { if (famId() === asked) { st.enabled = false; st.key = asked; } st.loading = false; });
    }
    var on = function () { return st.enabled === true && st.key === famId(); };
    var pubOf = function (r) { return st.pubs[r.id] || null; };
    var stateOf = function (r) { return C.stateOf(draftOf(r), pubOf(r)); };

    function badgeEls(r) {
      var s = stateOf(r), out = [h('span', { class: 'rc-pub is-' + s }, icon(s === 'private' ? 'lock' : 'users'), h('span', { text: s === 'private' ? T.privateLabel : T.publishedLabel(famName()) }))];
      if (s === 'changed') out.push(h('span', { class: 'rc-pub is-changed', text: T.changedLabel }));
      return out;
    }
    function badge(r) { ensure(); if (!famId() || st.enabled === false) return null; return h('p', { class: 'rc-pubrow' }, st.key === famId() ? badgeEls(r) : h('span', { class: 'rc-pub', text: 'Checking…' })); }

    /* ---- tabs: My Recipes / My Cookbooks / Family Library ---- */
    function tabs() {
      ensure();
      if (famId() && st.enabled !== true) return st.enabled === false && st.canTurnOn ? turnOnCard() : null;
      var set = function (sec, sub) { st.section = sec; if (sub) st.sub = sub; st.q = ''; o.reroute(); };
      var group = h('div', { class: 'rc-chips rc-sections', role: 'group', 'aria-label': 'Recipes sections' }, [['mine', T.mine], ['cookbooks', T.cookbooks], ['library', T.library]].map(function (t) {
        return h('button', { type: 'button', class: 'chip', 'data-section': t[0], 'aria-pressed': String(st.section === t[0]), onclick: function () { set(t[0]); } }, t[1]);
      }));
      var filt = st.section === 'mine' ? h('div', { class: 'rc-chips', role: 'group', 'aria-label': 'Show recipes' }, [['all', 'All'], ['private', 'Private'], ['published', 'Published']].map(function (t) {
        return h('button', { type: 'button', class: 'chip', 'data-show': t[0], 'aria-pressed': String(st.show === t[0]), onclick: function () { st.show = t[0]; o.reroute(); } }, t[1]); })) : null;
      return h('div', null, group, filt, h('p', { class: 'small muted', id: 'rc-sharing', text: famName() ? 'Sharing with: ' + famName() : 'You are not in a family yet, so nothing can be published.' }));
    }
    function section() { return on() || !famId() ? st.section : 'mine'; }
    /** Which of My Recipes to list: all, only private, or only published. */
    function showIt(r) { if (!on() || st.show === 'all') return true; var p = stateOf(r) !== 'private'; return st.show === 'published' ? p : !p; }
    /** Only the family owner ever sees this, and only while sharing is off. */
    function turnOnCard() {
      var fam = famName();
      return h('div', { class: 'card rc-turnon', id: 'rc-turnon' }, h('h2', { text: 'Share recipes with ' + fam }),
        h('p', { class: 'muted', text: 'Everything stays private to each person until they choose to publish it. Published recipes can be read and printed by members of ' + fam + ' only.' }),
        h('button', { type: 'button', class: 'btn secondary', onclick: function () { o.confirmDialog('Turn on recipe sharing for ' + fam + '?', 'Members will be able to publish their own recipes to ' + fam + ' and read what others publish. Nothing is shared until a person publishes it.', 'Turn on').then(function (yes) { if (!yes) return; o.call('setEnabled', { enabled: true }).then(function (r) { if (r.stale) return; if (!r.ok) return toast(r.message || 'That did not work.'); toast('Recipe sharing is on.'); st.key = null; st.enabled = null; o.reroute(); }); }); } }, 'Turn on sharing'));
    }
    function libraryLink() { return h('p', { class: 'rc-crumb' }, h('a', { class: 'link-btn', href: '#/recipes', onclick: function () { st.section = 'library'; } }, '← ' + T.library)); }

    /* ---- the publish panel on a recipe page ---- */
    function panel(r) {
      ensure();
      if (st.enabled === false || !famId()) return null;
      var box = h('section', { class: 'card rc-pubpanel rc-noprint', 'aria-label': 'Sharing' });
      if (st.key !== famId()) { box.appendChild(h('p', { class: 'muted', text: 'Checking what is shared…' })); return box; }
      var s = stateOf(r), pub = pubOf(r), fam = famName();
      box.appendChild(h('h2', { text: 'Sharing' })); box.appendChild(h('p', { class: 'rc-pubrow' }, badgeEls(r)));
      box.appendChild(h('p', { class: 'small muted', text: s === 'private' ? 'Only you can see this recipe. Publishing shows a copy to members of ' + fam + '.' : s === 'changed' ? 'Your edits are private. ' + fam + ' still sees the last published version until you update it.' : fam + ' can see this recipe. Your edits stay private until you publish them.' }));
      var row = h('div', { class: 'row' });
      var run = function (p, ok) { return p.then(function (res) { if (res.stale) return; if (!res.ok) { toast(res.message || 'That did not work.'); return; } toast(ok); st.key = null; o.reroute(); }); };
      if (s === 'private') row.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () {
        o.confirmDialog('Publish to ' + fam + '?', T.publishConfirm(fam), T.publishBtn).then(function (yes) { if (yes) run(send('publish', r), 'Published to ' + fam + '.'); }); } }, T.publishBtn));
      if (s === 'changed') row.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () {
        o.confirmDialog('Update the published version?', 'The version ' + fam + ' sees will be replaced with this recipe as it is now. ' + T.publishConfirm(fam), T.updateBtn).then(function (yes) { if (yes) run(send('update', r, pub.serverId), 'Published version updated.'); }); } }, T.updateBtn));
      if (pub) row.appendChild(h('button', { type: 'button', class: 'btn secondary', onclick: function () {
        o.confirmDialog('Unpublish “' + r.name + '”?', 'It leaves the ' + T.library + ' for ' + fam + '. ' + T.unpublishNote, T.unpublishBtn).then(function (yes) { if (yes) run(o.call('unpublish', { id: pub.serverId }), 'Unpublished.'); }); } }, T.unpublishBtn));
      box.appendChild(row); return box;
    }
    /** Sends the recipe's words, plus (when it has a photo) a small square copy and a thumbnail made on this device. */
    function send(action, r, id) {
      var body = { draft: draftOf(r), imageKey: C.imageKeyOf(r) }, bad = { ok: false, message: 'That photo could not be prepared. Try choosing it again.' };
      if (id) body.id = id;
      if (!r.image) return o.call(action, body);
      return Promise.resolve(o.pictures ? o.pictures(r.image) : null).then(function (pics) { if (!pics) return bad; body.pics = pics; return o.call(action, body); }, function () { return bad; });
    }
    function isPublished(r) { return on() && !!pubOf(r); }
    /** Removing a recipe that is published: say what happens to the published copy and let her choose. */
    function removeChoice(r) {
      return new Promise(function (resolve) {
        var fam = famName(), dlg = h('dialog', { 'aria-labelledby': 'dlg-title' }), done = function (v) { dlg.close(); dlg.remove(); resolve(v); };
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); done('cancel'); });
        dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Remove “' + r.name + '”?' }));
        dlg.appendChild(h('p', { text: 'It is also published to ' + fam + '. Removing it from your book does not remove the published copy; that stays until you unpublish it. Any cookbook that uses it keeps its own copy.' }));
        dlg.appendChild(h('p', { class: 'small muted', text: T.unpublishNote }));
        dlg.appendChild(h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn secondary', onclick: function () { done('cancel'); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn danger', onclick: function () { var pub = pubOf(r); o.call('unpublish', { id: pub.serverId }).then(function () { st.key = null; done('both'); }); } }, 'Remove and unpublish'),
          h('button', { type: 'button', class: 'btn danger', onclick: function () { done('draft'); } }, 'Remove from my book only')));
        document.body.appendChild(dlg); dlg.showModal();
      });
    }

    /* ---- My Cookbooks (placeholder in this slice) and the Family Library ---- */
    function body(main) {
      if (st.section === 'cookbooks') {
        main.appendChild(h('div', { class: 'card rc-empty', id: 'rc-cb-empty' }, h('h2', { text: 'No cookbooks yet' }),
          h('p', { class: 'muted', text: 'Soon you will be able to pick your own recipes, put them in order, preview the cookbook and publish it to ' + (famName() || 'your family') + '. For now, the printable recipe book maker still works.' }),
          h('a', { class: 'btn secondary', href: '#/recipes/cookbook' }, icon('book'), h('span', { text: 'Make printable recipe book' }))));
        return;
      }
      var sub = h('div', { class: 'rc-chips', role: 'group', 'aria-label': 'Family Library' }, [['recipes', T.shared], ['cookbooks', T.sharedCookbooks]].map(function (t) {
        return h('button', { type: 'button', class: 'chip', 'data-sub': t[0], 'aria-pressed': String(st.sub === t[0]), onclick: function () { st.sub = t[0]; o.reroute(); } }, t[1]); }));
      main.appendChild(sub);
      var holder = h('div', { id: 'rc-lib' });
      if (st.sub === 'cookbooks') { main.appendChild(h('div', { class: 'card rc-empty', id: 'rc-lib-empty' }, h('h2', { text: 'No shared cookbooks yet' }), h('p', { class: 'muted', text: 'Cookbooks published to ' + (famName() || 'your family') + ' will appear here.' }))); return; }
      var q = h('input', { id: 'rc-q', type: 'search', autocomplete: 'off', placeholder: 'Search by title', 'aria-label': 'Search shared recipes by title', maxlength: C.LIMITS.search, value: st.q });
      main.appendChild(h('div', { class: 'rc-controls' }, q)); main.appendChild(holder);
      var gen = ++libGen;
      holder.appendChild(h('p', { class: 'muted', text: 'Loading…' }));
      o.call('library', { q: st.q }).then(function (r) {
        if (r.stale || gen !== libGen || !holder.isConnected) return;
        holder.replaceChildren();
        if (!r.ok) { holder.appendChild(h('div', { class: 'alert error', role: 'alert', id: 'rc-blocked', text: 'The Family Library is not available for this account.' })); return; }
        if (!r.recipes.length) { holder.appendChild(h('div', { class: 'card rc-empty', id: 'rc-lib-empty' }, h('h2', { text: st.q ? 'No shared recipe has that title' : 'No shared recipes yet' }), h('p', { class: 'muted', text: st.q ? 'Try a different search.' : 'When someone in ' + r.family + ' publishes a recipe, it appears here.' }))); return; }
        var grid = h('ul', { class: 'rc-grid', id: 'rc-grid' });
        r.recipes.forEach(function (x) {
          grid.appendChild(h('li', null, h('a', { class: 'card rc-card', href: '#/recipes/shared/' + encodeURIComponent(x.id), 'data-id': x.id },
            h('div', { class: 'rc-photo' }, x.thumb ? h('img', { src: x.thumb, alt: '' }) : h('span', { class: 'rc-ph', 'aria-hidden': 'true' }, icon('book'))),
            h('h3', null, x.name), h('p', { class: 'small muted', text: 'By ' + x.authorName + (x.mine ? ' · Yours' : '') }),
            h('p', { class: 'rc-pubrow' }, h('span', { class: 'rc-pub is-kind', text: 'Recipe' }), x.mine ? h('span', { class: 'rc-pub is-published' }, icon('users'), h('span', { text: 'Yours' })) : null))));
        });
        holder.appendChild(grid);
      });
      var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { st.q = q.value.trim(); var pos = q.selectionStart; o.reroute(); setTimeout(function () { var n = document.getElementById('rc-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 0); }, 250); });
    }
    var libGen = 0;
    function get(id) { return o.call('get', { id: id }).then(function (r) { return r.ok ? r.recipe : null; }); }

    return { attach: function (x) { st.find = x.find; }, reset: reset, tabs: tabs, section: section, badge: badge, panel: panel, body: body, get: get, libraryLink: libraryLink,
      sharing: function () { return on(); }, showIt: showIt, isPublished: isPublished, removeChoice: removeChoice, publishedLabel: function () { return T.publishedLabel(famName()); } };
  }
  window.RecipesPubUI = { create: create };
})();
