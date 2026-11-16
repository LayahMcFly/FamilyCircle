/* Recipes publishing preview: the SCREENS (PREVIEW CODE, not wired into the live app).
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 * Talks only to the fake server. Private drafts live in this page's memory, standing in for the browser storage the real Recipe Book uses. */
(function () {
  'use strict';
  var C = window.RecipesPubCore, F = window.RecipesPubFake, T = C.TEXT;
  var main = document.getElementById('main'), controls = document.getElementById('pv-controls'), toasts = document.getElementById('toasts');
  var server = F.create(), DRAFTS = F.sampleDrafts();
  var SQUARE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  var st = { userId: 'u-rae', familyId: 'fHappy', gen: 0, tab: 'mine', q: '', pubs: {} };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'text') el.textContent = v; else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v); });
    var add = function (c) { if (c == null || c === false) return; if (Array.isArray(c)) return c.forEach(add); el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); };
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }
  function toast(msg) { var t = h('div', { class: 'toast', text: msg }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
  function call(action, body) { var gen = st.gen; var r = server.call(st.userId, action, Object.assign({ familyId: st.familyId }, body || {})); return Promise.resolve(r).then(function (x) { return gen !== st.gen ? { ok: false, stale: true } : x; }); }
  function familyName() { var f = server.call(st.userId, 'families').families.filter(function (x) { return x.id === st.familyId; })[0]; return f ? f.name : ''; }
  function myDrafts() { return DRAFTS[st.userId] || (DRAFTS[st.userId] = []); }
  function badge(text, cls) { return h('span', { class: 'rp-badge ' + (cls || ''), text: text }); }
  function field(id, label, control, err, hint) { return h('div', { class: 'rp-field' }, h('label', { for: id, text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null, h('p', { class: 'rp-err', id: id + '-err', role: 'alert', text: err || '' })); }

  /* ---- dialogs ---- */
  function dialog(title, bodyNodes, buttons) {
    var dlg = h('dialog', { class: 'sheet-dialog rp-dialog', 'aria-labelledby': 'rp-dlg-title' });
    var close = function () { if (dlg.open) dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    var row = h('div', { class: 'rp-btns' }); buttons.forEach(function (b) { row.appendChild(h('button', { type: 'button', class: 'btn ' + (b.cls || 'secondary'), text: b.label, onclick: function () { if (b.keep) { b.run(close); } else { close(); if (b.run) b.run(); } } })); });
    dlg.appendChild(h('div', { class: 'rp-dlg' }, h('h2', { id: 'rp-dlg-title', text: title }), bodyNodes, row));
    document.body.appendChild(dlg); dlg.showModal(); return dlg;
  }
  function confirm(title, text, okLabel, onOk, extra) { return dialog(title, [h('p', { text: text }), extra || null], [{ label: 'Cancel', cls: 'secondary' }, { label: okLabel, cls: 'btn-primary', run: onOk }]); }

  /* ---- reading a recipe (the same view for the author and for readers; readers get no edit, delete or republish) ---- */
  function viewRecipe(r, opts) {
    var body = [
      opts.byline ? h('p', { class: 'hint', text: opts.byline }) : null, r.description ? h('p', { text: r.description }) : null,
      h('p', { class: 'hint', text: [r.total, r.yield].filter(Boolean).join(' · ') }),
      r.image ? h('p', { class: 'rp-photo', 'aria-label': 'Square photo', role: 'img' }) : null,
      h('h3', { text: 'Ingredients' }), h('ul', null, r.ingredients.map(function (x) { return h('li', { text: x }); })),
      h('h3', { text: 'Steps' }), h('ol', null, r.steps.map(function (x) { return h('li', { text: x }); })),
      r.notes ? h('p', { class: 'hint', text: r.notes }) : null,
      h('p', { class: 'hint', text: 'Cook mode, scaling and timers use the existing recipe screen in the real app.' })
    ];
    dialog(r.name, body, [{ label: 'Print', cls: 'secondary', run: function () { window.print(); } }, { label: 'Close', cls: 'btn-primary' }]);
  }

  /* ---- editing a private draft ---- */
  function editDraft(d) {
    var isNew = !d, draft = d || { slug: 'new-' + Date.now(), name: '', description: '', yield: '4 servings', total: '', ingredients: [], steps: [], categories: [], tags: [], notes: '', parts: [], image: '', imageW: 0, imageH: 0 };
    var name = h('input', { type: 'text', id: 'rp-name', maxlength: C.LIMITS.title, value: draft.name });
    var ing = h('textarea', { id: 'rp-ing', rows: 5 }); ing.value = draft.ingredients.join('\n');
    var stp = h('textarea', { id: 'rp-steps', rows: 5 }); stp.value = draft.steps.join('\n');
    var photo = h('select', { id: 'rp-photo' }, h('option', { value: 'none', text: 'No photo' }), h('option', { value: 'square', text: 'Sample square photo' }), h('option', { value: 'wide', text: 'Sample wide photo (will be refused)' }));
    photo.value = draft.image ? 'square' : 'none';
    var form = h('div', { class: 'rp-form' }, field('rp-name', 'Name', name), field('rp-ing', 'Ingredients (one per line)', ing), field('rp-steps', 'Steps (one per line)', stp),
      field('rp-photo', 'Photo (optional)', photo, '', 'Photos are cropped to a square, so every recipe takes the same space.'));
    dialog(isNew ? 'New recipe' : 'Edit recipe', [form, h('p', { class: 'hint', text: 'Saving changes the private draft only. People in the family see a published recipe change only when you tap "Update published version".' })],
      [{ label: 'Cancel', cls: 'secondary' }, { label: 'Save draft', cls: 'btn-primary', keep: true, run: function (close) {
        var split = function (v) { return v.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
        var next = Object.assign({}, draft, { name: name.value.trim(), ingredients: split(ing), steps: split(stp) });
        next.image = photo.value === 'none' ? '' : SQUARE; next.imageW = photo.value === 'square' ? 800 : photo.value === 'wide' ? 800 : 0; next.imageH = photo.value === 'square' ? 800 : photo.value === 'wide' ? 600 : 0;
        if (!next.name) { document.getElementById('rp-name-err').textContent = 'Give the recipe a name.'; return; }
        var list = myDrafts(), i = list.indexOf(d); if (i >= 0) list[i] = next; else list.unshift(next);
        close(); toast('Draft saved. Still private to you.'); render();
      } }]);
  }

  /* ---- My Recipes ---- */
  function statusBadge(d) {
    var pub = st.pubs[d.slug], s = C.stateOf(d, pub);
    if (s === 'private') return badge(T.privateLabel, 'is-private');
    if (s === 'published') return badge(T.publishedLabel(familyName()), 'is-published');
    return [badge(T.publishedLabel(familyName()), 'is-published'), badge(T.changedLabel, 'is-changed')];
  }
  function publishFlow(d) {
    var fam = familyName();
    confirm('Publish "' + d.name + '"?', T.publishConfirm(fam), T.publishBtn, function () {
      call('publish', { draft: d }).then(function (r) { if (r.stale) return; if (!r.ok) return toast(r.message); toast('Published to ' + fam + '.'); render(); });
    });
  }
  function updateFlow(d, pub) {
    var fam = familyName();
    confirm('Update the published version?', 'The version ' + fam + ' sees will be replaced with this draft. ' + T.publishConfirm(fam), T.updateBtn, function () {
      call('update', { id: pub.id, draft: d }).then(function (r) { if (r.stale) return; if (!r.ok) return toast(r.message); toast('Published version updated.'); render(); });
    });
  }
  function unpublishFlow(d, pub, then) {
    confirm('Unpublish "' + d.name + '"?', 'It will leave the Family Library for ' + familyName() + '.', T.unpublishBtn, function () {
      call('unpublish', { id: pub.id }).then(function (r) { if (r.stale) return; toast(r.ok ? 'Unpublished.' : r.message); if (then) then(); render(); });
    }, h('p', { class: 'hint rp-note', text: T.unpublishNote }));
  }
  function deleteFlow(d) {
    var pub = st.pubs[d.slug];
    var text = pub ? 'This deletes your private draft on this device. It is also published to ' + familyName() + ', and that published copy stays until you unpublish it. Any cookbook that uses it keeps its own copy.' : 'This deletes your private draft from this device.';
    dialog('Delete "' + d.name + '"?', [h('p', { text: text }), pub ? h('p', { class: 'hint rp-note', text: T.unpublishNote }) : null],
      [{ label: 'Cancel', cls: 'secondary' }].concat(pub ? [{ label: 'Delete and unpublish', cls: 'danger', run: function () { call('unpublish', { id: pub.id }).then(function () { removeDraft(d); }); } }] : [])
        .concat([{ label: pub ? 'Delete draft only' : 'Delete', cls: 'danger', run: function () { removeDraft(d); } }]));
  }
  function removeDraft(d) { var l = myDrafts(), i = l.indexOf(d); if (i >= 0) l.splice(i, 1); toast('Draft deleted.'); render(); }
  function draftCard(d) {
    var pub = st.pubs[d.slug], state = C.stateOf(d, pub);
    var acts = h('div', { class: 'rp-acts' },
      h('button', { type: 'button', class: 'btn secondary small', text: 'Preview', onclick: function () { viewRecipe(C.snapshotOf(d), { byline: 'Preview. This is how the family would see it.' }); } }),
      h('button', { type: 'button', class: 'btn secondary small', text: 'Edit', onclick: function () { editDraft(d); } }),
      state === 'private' ? h('button', { type: 'button', class: 'btn small', text: T.publishBtn, onclick: function () { publishFlow(d); } }) : null,
      state === 'changed' ? h('button', { type: 'button', class: 'btn small', text: T.updateBtn, onclick: function () { updateFlow(d, pub); } }) : null,
      pub ? h('button', { type: 'button', class: 'btn secondary small', text: T.unpublishBtn, onclick: function () { unpublishFlow(d, pub); } }) : null,
      h('button', { type: 'button', class: 'btn secondary small danger-text', text: 'Delete', onclick: function () { deleteFlow(d); } }));
    return h('li', { class: 'card rp-card', 'data-slug': d.slug }, h('h3', { text: d.name }), h('div', { class: 'rp-badges' }, statusBadge(d)), acts);
  }
  function renderMine() {
    return call('mine').then(function (r) {
      if (r.stale) return null;
      st.pubs = {}; (r.ok ? r.pubs : []).forEach(function (p) { st.pubs[p.sourceSlug] = p; });
      var list = myDrafts();
      return h('div', null, h('div', { class: 'rp-bar' }, h('button', { type: 'button', class: 'btn', id: 'rp-new', text: 'New recipe', onclick: function () { editDraft(null); } })),
        list.length ? h('ul', { class: 'rp-list' }, list.map(draftCard)) : h('p', { class: 'empty', text: 'No recipes yet. Everything you add is private to you until you publish it.' }));
    });
  }

  /* ---- Family Library ---- */
  function renderLibrary(sub) {
    if (sub === 'cookbooks') return Promise.resolve(h('p', { class: 'empty', id: 'rp-empty', text: 'No shared cookbooks yet. Cookbooks come in the next step of this feature.' }));
    return call('library', { q: st.q }).then(function (r) {
      if (r.stale) return null;
      if (!r.ok) return h('p', { class: 'empty', id: 'rp-blocked', text: 'This is not available for your account.' });
      var box = h('div', null);
      var search = h('input', { type: 'search', id: 'rp-search', 'aria-label': 'Search by title', placeholder: 'Search by title', maxlength: C.LIMITS.search, autocomplete: 'off', value: st.q });
      search.addEventListener('input', function () { st.q = search.value; clearTimeout(search._t); search._t = setTimeout(function () { render(true); }, 120); });
      box.appendChild(h('div', { class: 'rp-bar' }, search));
      if (!r.recipes.length) box.appendChild(h('p', { class: 'empty', id: 'rp-empty', text: st.q ? 'No shared recipe has that title.' : 'No shared recipes yet. When someone in ' + r.family + ' publishes one, it appears here.' }));
      else box.appendChild(h('ul', { class: 'rp-list' }, r.recipes.map(function (x) {
        return h('li', { class: 'card rp-card', 'data-id': x.id }, h('h3', { text: x.name }), h('p', { class: 'hint', text: 'By ' + x.authorName + (x.mine ? ' (you)' : '') }),
          h('div', { class: 'rp-badges' }, badge('Recipe', 'is-kind'), x.mine ? badge(T.publishedLabel(r.family), 'is-published') : null),
          h('div', { class: 'rp-acts' }, h('button', { type: 'button', class: 'btn secondary small', text: 'View', onclick: function () {
            call('get', { id: x.id }).then(function (g) { if (g.stale) return; if (!g.ok) { toast('That recipe is no longer available.'); return render(); } viewRecipe(g.recipe, { byline: 'By ' + g.recipe.authorName + ' · Published to ' + r.family }); });
          } })));
      })));
      return box;
    });
  }

  /* ---- shell ---- */
  var sub = 'recipes';
  function render(keepFocus) {
    var gen = ++st.gen, tabs = [['mine', T.mine], ['cookbooks', T.cookbooks], ['library', T.library]];
    var bar = h('div', { class: 'rp-tabs', role: 'tablist' }, tabs.map(function (t) { return h('button', { type: 'button', role: 'tab', class: 'rp-tab' + (st.tab === t[0] ? ' is-on' : ''), 'aria-selected': st.tab === t[0] ? 'true' : 'false', 'data-tab': t[0], text: t[1], onclick: function () { st.tab = t[0]; st.q = ''; render(); } }); }));
    var subbar = st.tab === 'library' ? h('div', { class: 'rp-tabs rp-subtabs', role: 'tablist' }, [['recipes', T.shared], ['cookbooks', T.sharedCookbooks]].map(function (t) { return h('button', { type: 'button', role: 'tab', class: 'rp-tab' + (sub === t[0] ? ' is-on' : ''), 'data-sub': t[0], 'aria-selected': sub === t[0] ? 'true' : 'false', text: t[1], onclick: function () { sub = t[0]; render(); } }); })) : null;
    var fam = familyName();
    var head = h('div', null, h('h1', { text: 'Recipes' }), h('p', { class: 'hint', id: 'rp-fam', text: 'Sharing with: ' + (fam || 'no family') }), bar, subbar);
    var body = h('div', { class: 'rp-body', 'aria-busy': 'true' }, h('p', { class: 'hint', text: 'Loading…' }));
    if (!keepFocus || !document.getElementById('rp-search')) { main.textContent = ''; main.appendChild(head); main.appendChild(body); }
    else { var keep = document.querySelector('.rp-body'); keep.setAttribute('aria-busy', 'true'); }
    var p = st.tab === 'mine' ? renderMine() : st.tab === 'library' ? renderLibrary(sub) : Promise.resolve(h('div', null, h('p', { class: 'empty', id: 'rp-empty', text: 'No cookbooks yet. Cookbooks come in the next step of this feature.' }), h('p', { class: 'hint', text: 'A cookbook will let you pick your own recipes, put them in order, preview and publish it to ' + (fam || 'your family') + '.' })));
    p.then(function (node) {
      if (gen !== st.gen || !node) return;
      var hadSearch = document.activeElement && document.activeElement.id === 'rp-search', pos = hadSearch ? document.activeElement.selectionStart : 0;
      var b = document.querySelector('.rp-body'); b.textContent = ''; b.appendChild(node); b.removeAttribute('aria-busy');
      if (hadSearch) { var s = document.getElementById('rp-search'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) {} } }
    });
  }

  /* ---- preview controls ---- */
  function buildControls() {
    controls.textContent = '';
    var who = h('select', { id: 'pv-who', 'aria-label': 'Who is signed in' }, F.VIEWERS.map(function (v) { return h('option', { value: v.userId, text: v.name }); })); who.value = st.userId;
    var fams = server.call(st.userId, 'families').families;
    var fam = h('select', { id: 'pv-fam', 'aria-label': 'Current family' }, fams.length ? fams.map(function (f) { return h('option', { value: f.id, text: f.name }); }) : h('option', { value: '', text: 'No family' })); fam.value = st.familyId || '';
    who.addEventListener('change', function () { st.userId = who.value; var f = server.call(st.userId, 'families').families; st.familyId = f.length ? f[0].id : ''; st.tab = 'mine'; st.q = ''; st.pubs = {}; buildControls(); render(); });
    fam.addEventListener('change', function () { st.familyId = fam.value; st.q = ''; st.pubs = {}; main.textContent = ''; render(); });
    var sim = h('div', { class: 'rp-sim' }, h('p', { class: 'hint', text: 'Family changes (these happen outside this feature). They act on Tia Sample in Happy Family.' }),
      [['Remove Tia', function () { server.admin.removeMember('u-tia', 'fHappy'); }], ['Re-invite Tia', function () { server.admin.reinvite('u-tia', 'fHappy'); }], ['Delete Tia\'s account', function () { server.admin.deleteAccount('u-tia'); }], ['Pass 31 days', function () { server.admin.advanceDays(31); }]]
        .map(function (b) { return h('button', { type: 'button', class: 'btn secondary small', text: b[0], onclick: function () { b[1](); toast(b[0] + ' done.'); buildControls(); render(); } }); }));
    controls.appendChild(h('div', { class: 'pv-row' }, h('div', null, h('label', { for: 'pv-who', text: 'Signed in as' }), who), h('div', null, h('label', { for: 'pv-fam', text: 'Current family' }), fam),
      h('div', { class: 'pv-reset' }, h('button', { type: 'button', class: 'btn secondary', id: 'pv-reset', text: 'Reset preview', onclick: function () { location.reload(); } }))));
    controls.appendChild(sim);
  }
  buildControls(); render();
})();
