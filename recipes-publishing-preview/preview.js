/* Recipes publishing preview: starts the REAL Recipes screen (recipes.js) on a small stand-in app shell, with the sharing parts on the FAKE server.
 * PREVIEW CODE, not wired into the live app. No Appwrite, no account, no network. Each person's private recipes live in memory only. */
(function () {
  'use strict';
  /* In-memory storage: recipes.js keeps a person's book in localStorage; here nothing may outlive the page. */
  var mem = {}, fake = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; }, clear: function () { mem = {}; }, key: function (i) { return Object.keys(mem)[i] || null; }, get length() { return Object.keys(mem).length; } };
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });

  var F = window.RecipesPubFake, server = F.create(), main = document.getElementById('main'), controls = document.getElementById('pv-controls'), toasts = document.getElementById('toasts');
  var st = { userId: 'u-rae', familyId: 'fHappy', gen: 0 };

  /* each person's own private book (what the real app keeps in that browser) */
  var drafts = F.sampleDrafts();
  F.VIEWERS.forEach(function (v) { mem['fcrb:' + v.userId + ':rb_recipes'] = JSON.stringify(drafts[v.userId]); });

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'value') el.value = v; else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v)); });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) { if (c == null || c === false) return; if (Array.isArray(c)) return c.forEach(function (x) { add(el, x); }); el.appendChild(c.nodeType ? c : document.createTextNode(String(c))); }
  var PATHS = { plus: 'M12 5v14M5 12h14', book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13', pencil: 'M4 20l4-1 11-11-3-3L5 16z', heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z' };
  function icon(name) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ic'); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATHS[name] || PATHS.book); s.appendChild(p); return s; }
  function toast(msg) { var t = h('div', { class: 'toast', text: msg }); toasts.appendChild(t); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4500); }
  function confirmDialog(title, message, confirmLabel) {   // same markup as the app's own confirm dialog
    return new Promise(function (resolve) {
      var dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
      var ok = h('button', { class: 'btn danger', type: 'button', text: confirmLabel }), cancel = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel' });
      function done(v) { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); resolve(v); }
      ok.addEventListener('click', function () { done(true); }); cancel.addEventListener('click', function () { done(false); });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      dlg.appendChild(h('h2', { id: 'dlg-title', text: title })); dlg.appendChild(h('p', { text: message })); dlg.appendChild(h('div', { class: 'row' }, cancel, ok));
      document.body.appendChild(dlg); dlg.showModal(); cancel.focus();
    });
  }

  var families = function () { return server.call(st.userId, 'families').families; };
  var family = function () { var f = families().filter(function (x) { return x.id === st.familyId; })[0]; return f || null; };
  function call(action, body) {
    var gen = st.gen; var r = server.call(st.userId, action, Object.assign({ familyId: st.familyId }, body || {}));
    return Promise.resolve().then(function () { return gen !== st.gen ? { ok: false, stale: true } : r; });
  }
  var X = { S: { user: { $id: st.userId } }, VIEWS: {}, h: h, icon: icon, toast: toast, confirmDialog: confirmDialog, reroute: function () { render(); } };
  var P = window.RecipesPubUI.create({ h: h, icon: icon, toast: toast, confirmDialog: confirmDialog, call: call, family: family, reroute: function () { render(); } });
  X.publish = P;
  window.FCRecipes.install(X);

  var token = 0;
  function render() {
    var m = /^#\/recipes(?:\/([^\/]+))?(?:\/(.+))?$/.exec(location.hash) || [];
    X.S.user = { $id: st.userId };
    main.replaceChildren(); token++;
    X.VIEWS.recipes(main, token, m[1], m[2]);
  }
  window.addEventListener('hashchange', render);

  function setWho(u) { st.userId = u; var f = families(); st.familyId = f.length ? f[0].id : ''; st.gen++; P.reset(); location.hash = '#/recipes'; buildControls(); render(); }
  function setFam(f) { st.familyId = f; st.gen++; P.reset(); location.hash = '#/recipes'; main.replaceChildren(); render(); }
  function buildControls() {
    controls.replaceChildren();
    var who = h('select', { id: 'pv-who', 'aria-label': 'Who is signed in' }, F.VIEWERS.map(function (v) { return h('option', { value: v.userId, text: v.name }); })); who.value = st.userId;
    var fs = families();
    var fam = h('select', { id: 'pv-fam', 'aria-label': 'Current family' }, fs.length ? fs.map(function (f) { return h('option', { value: f.id, text: f.name }); }) : h('option', { value: '', text: 'No family' })); fam.value = st.familyId || '';
    who.addEventListener('change', function () { setWho(who.value); }); fam.addEventListener('change', function () { setFam(fam.value); });
    var sim = h('div', { class: 'pv-sim' }, h('p', { class: 'hint', text: 'Family changes (these happen outside this feature). They act on Tia Sample in Happy Family.' }),
      [['Remove Tia', function () { server.admin.removeMember('u-tia', 'fHappy'); }], ['Re-invite Tia', function () { server.admin.reinvite('u-tia', 'fHappy'); }], ['Delete Tia\'s account', function () { server.admin.deleteAccount('u-tia'); }], ['Pass 31 days', function () { server.admin.advanceDays(31); }]]
        .map(function (b) { return h('button', { type: 'button', class: 'btn secondary small', text: b[0], onclick: function () { b[1](); toast(b[0] + ' done.'); st.gen++; P.reset(); var f = families(); if (!f.some(function (x) { return x.id === st.familyId; })) st.familyId = f.length ? f[0].id : ''; buildControls(); render(); } }); }));
    controls.appendChild(h('div', { class: 'pv-row' }, h('div', null, h('label', { for: 'pv-who', text: 'Signed in as' }), who), h('div', null, h('label', { for: 'pv-fam', text: 'Current family' }), fam),
      h('div', { class: 'pv-reset' }, h('button', { type: 'button', class: 'btn secondary', id: 'pv-reset', text: 'Reset preview', onclick: function () { location.hash = '#/recipes'; location.reload(); } }))));
    controls.appendChild(sim);
  }
  if (!/^#\/recipes/.test(location.hash)) location.hash = '#/recipes';
  buildControls(); render();
})();
