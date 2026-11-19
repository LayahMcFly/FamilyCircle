/* Family Exchange preview screens (PREVIEW CODE, sample only). Everything lives in memory and is gone on reload.
 * Copyright Leia. Licence for this file: not yet marked; it follows the repository licensing decision, which is still open.
 * No network request, no Appwrite, no account, no storage. All text is set with textContent so typed text stays as typed. */
(function () {
  'use strict';
  var S = window.ExchangeSample, R = window.ExchangeRules, A = window.ExchangeFakeApi, L = R.LIMITS;
  var DB, ST, main = document.getElementById('main'), controls = document.getElementById('pv-controls'), toasts = document.getElementById('toasts');
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function reset() { DB = { listings: clone(S.LISTINGS), requests: clone(S.REQUESTS), reports: clone(S.REPORTS), seq: 100 }; ST = ST || {}; ST.acked = {}; }
  ST = { viewer: 'ava', cond: 'normal', handler: 'on', tab: 'free', q: '', cat: '', finished: false, failed: false };
  reset();

  function h(tag, a) {
    var el = document.createElement(tag); a = a || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k]; if (v == null || v === false) return;
      if (k === 'text') el.textContent = v; else if (k === 'class') el.className = v; else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]); return el;
  }
  function add(el, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(el, x); }); else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  function viewer() { return S.VIEWERS.filter(function (v) { return v.id === ST.viewer; })[0]; }
  function person(id) { return S.VIEWERS.filter(function (v) { return v.id === id; })[0] || { name: 'Someone', id: id }; }
  function photo(id) { return S.PHOTOS.filter(function (p) { return p.id === id; })[0]; }
  function find(id) { return DB.listings.filter(function (l) { return l.id === id; })[0]; }
  function toast(msg) { var t = h('div', { class: 'toast', text: msg }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  var label = { available: 'Available', reserved: 'Reserved', gone: 'Gone', draft: 'Draft, only you can see this', withdrawn: 'Withdrawn', released: 'Released', closed: 'Closed', open: 'Open', fulfilled: 'Fulfilled', hidden: 'Hidden' };
  function lbl(l) { return l.kind === 'wanted' && l.status === 'reserved' ? 'Offer accepted' : label[l.status]; }
  function canSee(l) { var v = viewer(); if (l.status === 'draft') return l.owner === v.id; if (l.status === 'hidden') return l.owner === v.id || (!!v.moderator && DB.reports.some(function (r) { return r.listing === l.id; })); if (l.status === 'withdrawn') return l.owner === v.id || DB.requests.some(function (r) { return r.listing === l.id && r.from === v.id; }); return true; }
  function ended(s) { return s === 'gone' || s === 'fulfilled' || s === 'closed' || s === 'withdrawn'; }
  /* One place for every status change. It re-reads the listing first, so a stale screen (changed on another device) cannot act on old state. */
  function change(id, to, from, msg) {
    var cur = find(id); if (!cur || from.indexOf(cur.status) < 0) { toast('This listing already changed. Showing the latest.'); return render(); }
    cur.status = to; if (ended(to)) DB.requests.forEach(function (r) { if (r.listing === cur.id) r.status = 'closed'; });
    toast(msg); render();
  }
  function lifeDlg(l, to, from, title, text, ok, done) { confirmDlg(title, text, ok, function () { change(l.id, to, from, done); }); }
  function publishDraft(l) {
    var v = viewer(), go2 = function () { confirmDlg('Publish to the ' + S.FAMILY + '?', 'Everyone in the family who is eligible for Family Exchange will be able to see this. You can edit it afterwards.', 'Publish', function () { change(l.id, l.kind === 'wanted' ? 'open' : 'available', ['draft'], 'Published to the sample family.'); }); };
    if (!ST.acked[v.id]) rules(function () { ST.acked[v.id] = true; go2(); }); else go2();
  }

  /* ---------- dialogs ---------- */
  function dialog(title, body, buttons, onClose) {
    var opener = document.activeElement, dlg = h('dialog', { class: 'ex-dlg', 'aria-labelledby': 'ex-dlg-t' }, h('h2', { id: 'ex-dlg-t', text: title }), body,
      h('div', { class: 'row ex-dlg-actions' }, buttons.map(function (b) { return h('button', { type: 'button', class: 'btn ' + (b.cls == null ? 'secondary' : b.cls), text: b.text, onclick: function () { if (b.fn && b.fn(dlg) === false) return; dlg.close(); } }); })));
    dlg.addEventListener('close', function () { dlg.remove(); if (opener && opener.focus) opener.focus(); if (onClose) onClose(); });
    document.body.appendChild(dlg); dlg.showModal(); return dlg;
  }
  function confirmDlg(title, text, ok, fn) { dialog(title, h('p', { text: text }), [{ text: 'Cancel' }, { text: ok, cls: '', fn: function () { fn(); } }]); }

  /* ---------- shell ---------- */
  function renderControls() {
    function sel(id, lab, opts, val, fn) { return h('div', null, h('label', { for: id, text: lab }), h('select', { id: id, onchange: function (e) { fn(e.target.value); } }, opts.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === val }); }))); }
    controls.textContent = '';
    controls.appendChild(h('div', { class: 'pv-row' },
      sel('pv-who', 'Viewing as (sample account)', S.VIEWERS.map(function (v) { return [v.id, v.name + ', ' + v.note]; }), ST.viewer, function (v) { ST.viewer = v; ST.failed = false; if (/^#\/(reports|new|edit|mine|activity)/.test(location.hash)) location.hash = '#/browse'; render(); }),
      sel('pv-net', 'Connection', [['normal', 'Normal'], ['slow', 'Slow (1.5 seconds)'], ['loading', 'Stuck loading'], ['failonce', 'Fails once, then works'], ['error', 'Always fails'], ['denied', 'Server says no access']], ST.cond, function (v) { ST.cond = v; ST.failed = false; render(); }),
      sel('pv-handler', 'Independent case handler (Dana)', [['on', 'Available'], ['off', 'Not available']], ST.handler, function (v) { ST.handler = v; toast(v === 'on' ? 'A moderator is available for new reports.' : 'No independent handler for new reports.'); }),
      h('div', { class: 'pv-reset' }, h('button', { type: 'button', class: 'btn secondary small', id: 'pv-reset', text: 'Reset sample data', onclick: function () { location.hash = '#/browse'; location.reload(); } }))),
      h('p', { class: 'hint', text: 'These accounts, the moderator and the eligibility states are made up for this preview. Production eligibility and moderator assignment are not decided.' }));
  }
  function header(active) {
    var v = viewer(), tabs = [['#/browse', 'Browse', 'browse'], ['#/mine', 'My listings', 'mine'], ['#/activity', 'My activity', 'activity']]; if (v.moderator) tabs.push(['#/reports', 'Reports', 'reports']);
    return h('header', { class: 'ex-head' }, h('div', { class: 'row between ex-sign' }, h('div', null, h('h1', { text: 'Family Exchange' }), h('p', { class: 'muted ex-sub', text: 'Free items and wanted posts for the ' + S.FAMILY })),
      h('a', { class: 'btn', href: '#/new', id: 'ex-new', text: 'New listing' })),
      h('nav', { class: 'tabs', 'aria-label': 'Exchange sections' }, tabs.map(function (t) { return h('a', { class: 'tab ex-tab', href: t[0], 'aria-current': active === t[2] ? 'page' : null, 'aria-pressed': active === t[2] ? 'true' : 'false', text: t[1] }); })));
  }
  function skeleton() { return h('div', { class: 'ex-grid', 'aria-busy': 'true', 'aria-label': 'Loading' }, [1, 2, 3, 4].map(function () { return h('div', { class: 'card ex-card ex-skel' }, h('div', { class: 'ex-thumb' }), h('div', { class: 'ex-line' }), h('div', { class: 'ex-line short' })); }), h('p', { class: 'muted ex-loading', role: 'status' }, h('span', { class: 'spinner sm' }), ' Loading listings'));
  }
  function stateCard(kind, title, text, actions) {
    return h('div', { class: 'card ex-state ex-state-' + kind, role: kind === 'error' ? 'alert' : 'status' }, h('h2', { text: title }), h('p', { text: text }), actions ? h('div', { class: 'row' }, actions) : null);
  }
  /* the fake network: every screen asks through here */
  function ask(run, done, again) {
    var c = ST.cond;
    if (c === 'loading') return done({ loading: true });
    if (c === 'denied') return done({ error: 'denied' });
    if (c === 'error' || (c === 'failonce' && !ST.failed)) { if (c === 'failonce') ST.failed = true; return done({ error: 'server', retry: again }); }
    if (c === 'slow') { done({ loading: true }); return setTimeout(function () { var cur = location.hash; done(run(), true, cur); }, 1500); }
    done(run());
  }

  /* ---------- screens ---------- */
  var seq = 0;
  function render() {
    var my = ++seq, v = viewer(), hash = location.hash || '#/browse', m = hash.match(/^#\/([a-z]+)(?:\/([\w-]+))?/) || [0, 'browse'];
    renderControls(); main.textContent = ''; main.setAttribute('data-view', 'exchange-' + m[1]); document.title = 'Family Exchange preview (sample data) | Family Circle';
    if (!v.eligible) { main.appendChild(stateCard('denied', 'Family Exchange is not available for this account', 'Family Exchange is only open to eligible adult members of the family.')); return; }
    var body = h('div', { class: 'ex-body' }), active = m[1] === 'listing' || m[1] === 'browse' ? 'browse' : m[1] === 'mine' ? 'mine' : m[1] === 'activity' ? 'activity' : m[1] === 'reports' ? 'reports' : null;
    main.appendChild(header(active)); main.appendChild(body);
    function paint(res, late, hashThen) {
      if (my !== seq || (late && hashThen !== location.hash)) return;
      body.textContent = '';
      if (res.loading) return body.appendChild(skeleton());
      if (res.error === 'denied') return body.appendChild(stateCard('denied', 'Family Exchange is not available right now', 'The server did not allow this request. Nothing was changed.'));
      if (res.error) return body.appendChild(stateCard('error', 'Could not load Family Exchange', 'Something went wrong on our side. Nothing was changed.', [h('button', { type: 'button', class: 'btn', id: 'ex-retry', text: 'Try again', onclick: function () { render(); } })]));
      screen(m[1], m[2], body);
    }
    if (m[1] === 'new' || m[1] === 'edit') return ask(function () { return {}; }, paint, render);
    ask(function () { return {}; }, paint, render);
  }
  function screen(name, id, body) {
    if (name === 'listing') return detail(id, body);
    if (name === 'new') { var tpl = id ? find(id) : null; if (tpl && tpl.owner !== viewer().id) tpl = null; return form(null, body, tpl); }
    if (name === 'edit') { var l = find(id); if (!l || l.owner !== viewer().id || (l.status !== 'draft' && l.status !== 'available' && l.status !== 'open' && l.status !== 'reserved')) return body.appendChild(stateCard('missing', 'This listing is not available', 'It may have been removed, or it may not be yours to edit.', [h('a', { class: 'btn secondary', href: '#/browse', text: 'Back to browse' })])); return form(l, body); }
    if (name === 'mine') return mine(body);
    if (name === 'activity') return activity(body);
    if (name === 'reports') return reports(body);
    browse(body);
  }

  function card(l) {
    var p = l.photos.length ? photo(l.photos[0]) : null, o = person(l.owner), done = l.status === 'gone' || l.status === 'fulfilled' || l.status === 'closed';
    return h('a', { class: 'card ex-card' + (l.kind === 'wanted' ? ' ex-wanted' : ' ex-freeitem') + (done ? ' ex-done' : ''), href: '#/listing/' + l.id, 'data-id': l.id },
      h('div', { class: 'ex-thumb' + (p ? '' : ' ex-nophoto') }, p ? h('img', { src: p.src, alt: p.alt, loading: 'lazy', width: 160, height: 160 }) : h('span', { text: l.kind === 'wanted' ? 'Wanted' : 'No photo' })),
      h('div', { class: 'ex-card-body' }, h('h3', { text: l.title }), h('p', { class: 'muted ex-meta', text: l.category + (l.kind === 'free' && l.condition ? ' · ' + l.condition : '') }),
        h('div', { class: 'row ex-row' }, h('span', { class: 'badge ex-badge ex-' + l.status, text: lbl(l).split(',')[0] }), h('span', { class: 'muted ex-meta', text: o.name + ' · ' + l.ago }))));
  }
  function browse(body) {
    var q = ST.q.toLowerCase(), v = viewer();
    var list = DB.listings.filter(function (l) {
      if (!canSee(l) || l.status === 'draft' || l.status === 'withdrawn' || l.status === 'hidden') return false;
      if ((l.kind === 'wanted') !== (ST.tab === 'wanted')) return false;
      if (!ST.finished && (l.status === 'gone' || l.status === 'fulfilled' || l.status === 'closed')) return false;
      if (ST.cat && l.category !== ST.cat) return false;
      return !q || (l.title + ' ' + l.description + ' ' + l.category).toLowerCase().indexOf(q) >= 0;
    });
    body.appendChild(h('div', { class: 'tabs ex-kind', role: 'group', 'aria-label': 'Kind of listing' }, [['free', 'Free items'], ['wanted', 'Wanted']].map(function (t) { return h('button', { type: 'button', class: 'tab', 'aria-pressed': ST.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { ST.tab = t[0]; render(); } }); })));
    body.appendChild(h('div', { class: 'card ex-filters' },
      h('div', { class: 'ex-filter-grid' },
        h('div', null, h('label', { for: 'ex-q', text: 'Search' }), h('input', { type: 'text', id: 'ex-q', value: ST.q, placeholder: 'Try “chair” or “books”', maxlength: 60, autocomplete: 'off', oninput: function (e) { ST.q = e.target.value; var pos = e.target.selectionStart; render(); var n = document.getElementById('ex-q'); n.focus(); n.setSelectionRange(pos, pos); } })),
        h('div', null, h('label', { for: 'ex-cat', text: 'Category' }), h('select', { id: 'ex-cat', onchange: function (e) { ST.cat = e.target.value; render(); } }, [h('option', { value: '', text: 'All categories' })].concat(R.CATEGORIES.map(function (c) { return h('option', { value: c, text: c, selected: ST.cat === c }); })))),
        h('div', { class: 'ex-fin' }, h('button', { type: 'button', class: 'chip', id: 'ex-finished', 'aria-pressed': ST.finished ? 'true' : 'false', text: 'Show finished', onclick: function () { ST.finished = !ST.finished; render(); } })))));
    if (!list.length) {
      var filtered = ST.q || ST.cat || ST.finished;
      return body.appendChild(stateCard('empty', filtered ? 'Nothing matches' : (ST.tab === 'wanted' ? 'No wanted posts yet' : 'No free items yet'), filtered ? 'Try a different word or category.' : 'Be the first to post something for the ' + S.FAMILY + '.',
        [filtered ? h('button', { type: 'button', class: 'btn secondary', id: 'ex-clear', text: 'Clear search', onclick: function () { ST.q = ''; ST.cat = ''; ST.finished = false; render(); } }) : h('a', { class: 'btn', href: '#/new', text: 'New listing' })]));
    }
    body.appendChild(h('div', { class: 'ex-grid', id: 'ex-grid' }, list.map(card)));
    body.appendChild(h('p', { class: 'hint ex-foot', text: 'Sample listings only. Nothing here is real.' }));
  }

  function gallery(l) {
    var ps = l.photos.map(photo); if (!ps.length) return null; var idx = 0, wrap = h('div', { class: 'ex-gallery' });
    function draw() {
      wrap.textContent = ''; var p = ps[idx];
      wrap.appendChild(h('div', { class: 'ex-photo' }, h('img', { src: p.src, alt: p.alt, width: p.w, height: p.h, 'data-w': p.w, 'data-h': p.h })));
      if (ps.length > 1) wrap.appendChild(h('div', { class: 'ex-thumbs', role: 'group', 'aria-label': 'Photos' }, ps.map(function (q, i) { return h('button', { type: 'button', class: 'ex-tb', 'aria-pressed': i === idx ? 'true' : 'false', 'aria-label': 'Photo ' + (i + 1) + ' of ' + ps.length + ': ' + q.alt, onclick: function () { idx = i; draw(); wrap.querySelectorAll('.ex-tb')[i].focus(); } }, h('img', { src: q.src, alt: '', width: 64, height: 64 })); })));
    }
    draw(); return wrap;
  }
  function detail(id, body) {
    var l = find(id), v = viewer();
    if (!l || !canSee(l)) return body.appendChild(stateCard('missing', 'This listing is not available', 'It may have been removed, or it may not be shared with you.', [h('a', { class: 'btn secondary', href: '#/browse', text: 'Back to browse' })]));
    var own = l.owner === v.id, o = person(l.owner), reqs = DB.requests.filter(function (r) { return r.listing === l.id; }), mine = reqs.filter(function (r) { return r.from === v.id; })[0], wanted = l.kind === 'wanted';
    body.appendChild(h('a', { class: 'btn ghost small', href: '#/browse', id: 'ex-back', text: 'Back to browse' }));
    var art = h('article', { class: 'card ex-detail' }); body.appendChild(art);
    if (l.status === 'withdrawn' && !own) {
      /* a minimal closed record: no photos, no description, no pickup area, no other applicants */
      art.appendChild(h('div', { class: 'row ex-row' }, h('span', { class: 'badge ex-badge ex-withdrawn', text: 'Withdrawn' }), h('span', { class: 'badge', text: wanted ? 'Wanted' : 'Free item' })));
      art.appendChild(h('h2', { class: 'ex-title', text: l.title }));
      art.appendChild(h('p', { class: 'muted', id: 'ex-minimal', text: 'Posted by ' + o.name + '. The details are no longer shared.' }));
      art.appendChild(h('p', { class: 'alert ok ex-mine', role: 'status', text: 'The owner withdrew this listing. Your request is closed.' }));
      return;
    }
    if (l.status === 'hidden' && !own) {
      /* moderator view of a hidden listing: no request, report or interest actions */
      art.appendChild(h('div', { class: 'row ex-row' }, h('span', { class: 'badge ex-badge ex-hidden', text: 'Hidden' }), h('span', { class: 'badge', text: wanted ? 'Wanted' : 'Free item' })));
      art.appendChild(h('h2', { class: 'ex-title', text: l.title })); art.appendChild(h('p', { class: 'ex-desc', text: l.description }));
      art.appendChild(h('p', { class: 'alert', id: 'ex-hidden-mod', role: 'status', text: 'Hidden from the family. You can see it because you are the simulated moderator. Decide on the Reports tab.' })); return;
    }
    var gal = gallery(l); if (gal) art.appendChild(gal);
    art.appendChild(h('div', { class: 'row ex-row' }, h('span', { class: 'badge ex-badge ex-' + l.status, text: lbl(l) }), h('span', { class: 'badge', text: wanted ? 'Wanted' : 'Free item' })));
    art.appendChild(h('h2', { class: 'ex-title', text: l.title }));
    art.appendChild(h('dl', { class: 'ex-facts' }, fact('Posted by', o.name + (own ? ' (you)' : '')), fact('Posted', l.ago), fact('Category', l.category), l.condition ? fact('Condition', l.condition) : null, fact('Pickup area', l.area || 'Not given')));
    art.appendChild(h('p', { class: 'ex-desc', text: l.description }));
    var act = h('div', { class: 'ex-actions' }); art.appendChild(act);
    if (own && l.status === 'hidden') art.appendChild(h('p', { class: 'alert', id: 'ex-hidden-own', role: 'status', text: 'A moderator hid this listing. Only you and moderators can see it, and requests on it are on hold. You are not told who reported it. You cannot edit or change it while it is hidden.' }));
    if (own) {
      var live = l.status === 'available' || l.status === 'open' || l.status === 'reserved', LIVE = ['available', 'open', 'reserved'];
      if (l.status === 'draft' || live) act.appendChild(h('a', { class: 'btn secondary', href: '#/edit/' + l.id, id: 'ex-edit', text: l.status === 'draft' ? 'Edit draft' : 'Edit' }));
      if (l.status === 'draft') act.appendChild(h('button', { type: 'button', class: 'btn', id: 'ex-publish-draft', text: 'Publish to the family', onclick: function () { publishDraft(l); } }));
      if (live && !wanted) act.appendChild(h('button', { type: 'button', class: 'btn secondary', id: 'ex-gone', text: 'Mark as gone', onclick: function () { lifeDlg(l, 'gone', LIVE, 'Mark as gone?', 'Anyone who asked will see that it is gone, and their requests close. A finished listing cannot be reopened in this preview.', 'Mark as gone', 'Marked as gone.'); } }));
      if (live && wanted) { act.appendChild(h('button', { type: 'button', class: 'btn secondary', id: 'ex-fulfilled', text: 'Mark as fulfilled', onclick: function () { lifeDlg(l, 'fulfilled', LIVE, 'Mark as fulfilled?', 'You got what you were looking for. Offers close, and a finished post cannot be reopened in this preview.', 'Mark as fulfilled', 'Marked as fulfilled.'); } })); act.appendChild(h('button', { type: 'button', class: 'btn secondary', id: 'ex-close', text: 'Close post', onclick: function () { lifeDlg(l, 'closed', LIVE, 'Close this wanted post?', 'Use this when you no longer need it. Offers close, and a closed post cannot be reopened in this preview.', 'Close post', 'Wanted post closed.'); } })); }
      if (live) act.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'ex-withdraw', text: 'Withdraw', onclick: function () { lifeDlg(l, 'withdrawn', LIVE, 'Withdraw this listing?', 'It leaves Browse. People who already asked can still open it and will see it was withdrawn. It cannot be put back in this preview.', 'Withdraw', 'Listing withdrawn.'); } }));
      if (ended(l.status)) { act.appendChild(h('a', { class: 'btn', id: 'ex-again', href: '#/new/' + l.id, text: 'Start a new listing from this one' })); act.appendChild(h('p', { class: 'hint', text: 'Finished listings cannot be reopened. Whether relisting should be allowed is not decided, so this makes a fresh draft instead.' })); }
      if (l.status === 'reserved') act.appendChild(h('button', { type: 'button', class: 'btn secondary', id: 'ex-release', text: wanted ? 'Release accepted offer' : 'Release reservation', onclick: function () { confirmDlg('Release this reservation?', 'The item will become available again. ' + person(l.reservedFor).name + '’s request will show as Released, and they can ask again. Other waiting requests stay waiting. Your private edits stay private until you publish them yourself.', 'Release', function () { var cur = find(l.id); if (!cur || cur.status !== 'reserved') { toast('This listing already changed. Showing the latest.'); return render(); } DB.requests.forEach(function (r) { if (r.listing === cur.id && r.status === 'reserved') r.status = 'released'; }); cur.status = 'available'; cur.reservedFor = null; toast('Reservation released.'); render(); }); } }));
      if (l.pending) { var pn = h('div', { class: 'alert', id: 'ex-pending', role: 'status' }, h('p', { text: l.status === 'reserved' ? 'You have private edits. Other members still see the item as agreed. Release the reservation to publish them.' : 'You have private edits that are not published yet.' }), h('button', { type: 'button', class: 'btn small secondary', id: 'ex-discard', text: 'Discard private edits', onclick: function () { confirmDlg('Discard private edits?', 'Your saved edits are removed. The listing stays as it is now.', 'Discard', function () { delete find(l.id).pending; toast('Private edits discarded.'); render(); }); } })); art.appendChild(pn); }
      if (l.status === 'draft') act.appendChild(h('p', { class: 'alert', text: 'This draft is only visible to you. It is not shared until you publish it.' }));
      var rs = h('section', { class: 'ex-requests', 'aria-labelledby': 'ex-req-h' }, h('h3', { id: 'ex-req-h', text: wanted ? 'Offers to help' : 'Requests' }));
      if (!reqs.length) rs.appendChild(h('p', { class: 'muted', text: wanted ? 'No offers yet.' : 'No one has asked yet.' }));
      reqs.forEach(function (r) { rs.appendChild(reqRow(l, r, live)); });
      if (l.status !== 'draft') art.appendChild(rs);
      if (l.status === 'reserved') act.appendChild(pickupBtn(person(l.reservedFor)));
    } else {
      if (mine) art.appendChild(h('p', { class: 'alert ok ex-mine', role: 'status', text: mineMsg(mine, l, o, wanted) }));
      var open = l.status === 'available' || l.status === 'open';
      if (mine && mine.status === 'reserved' && l.status === 'reserved') { act.appendChild(pickupBtn(o)); act.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'ex-cancel-resv', text: 'Cancel my reservation', onclick: function () { cancelMine(l, mine, true); } })); }
      else if (mine && mine.status === 'waiting' && !ended(l.status)) act.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'ex-cancel-req', text: 'Cancel my request', onclick: function () { cancelMine(l, mine, false); } }));
      else if ((!mine || mine.status === 'released' || mine.status === 'cancelled') && open) act.appendChild(h('button', { type: 'button', class: 'btn', id: 'ex-interest', text: mine ? 'Ask again' : (wanted ? 'I can help' : 'I’m interested'), onclick: function () { interest(l); } }));
      else if ((!mine || mine.status === 'released' || mine.status === 'cancelled') && l.status === 'reserved') act.appendChild(h('p', { class: 'alert', text: 'This has been reserved for someone else.' }));
      else if (!mine && ended(l.status)) act.appendChild(h('p', { class: 'alert', text: { gone: 'This item is gone.', fulfilled: 'This wanted post has been fulfilled.', closed: 'The poster closed this wanted post.', withdrawn: 'The owner withdrew this listing.' }[l.status] }));
      art.appendChild(h('p', { class: 'hint', text: 'Only ' + o.name + ' can see who asked. You see only your own request.' }));
      act.appendChild(h('button', { type: 'button', class: 'btn ghost', id: 'ex-report', text: 'Report this listing', onclick: function () { report(l); } }));
    }
  }

  /* ---------- Step 3: requests and reservations (sample only) ---------- */
  function mineMsg(mine, l, o, wanted) {
    if (mine.status === 'released') return 'The owner released the reservation. You can ask again.';
    if (mine.status === 'closed') return 'This is no longer available (' + label[l.status].toLowerCase() + '). Your request is closed.';
    if (mine.status === 'reserved') return wanted ? o.name + ' accepted your offer. Use Messages to arrange it.' : 'This is reserved for you. Use Messages to arrange pickup.';
    if (mine.status === 'declined') return 'The owner did not choose your request. You cannot send another request for this listing.';
    if (mine.status === 'cancelled') return 'You cancelled your request. You can ask again while it is still available.';
    if (l.status === 'reserved') return 'This is reserved for someone else for now. Your request stays waiting in case it is released.';
    return wanted ? 'You offered to help. Waiting for ' + o.name + '.' : 'You asked for this. Waiting for ' + o.name + ' to decide.';
  }
  function reqRow(l, r, live) {
    var wanted = l.kind === 'wanted', who = person(r.from).name, names = { reserved: wanted ? 'Offer accepted' : 'Reserved for them', closed: 'Closed', released: 'Released', declined: 'You declined', cancelled: 'They cancelled', waiting: 'Waiting for you' }, acts = [];
    if (r.status === 'waiting' && live) {
      if (l.status === 'reserved') acts.push(h('span', { class: 'hint', text: 'Release the current reservation to choose someone else.' }));
      else acts.push(h('button', { type: 'button', class: 'btn small', 'data-act': 'confirm', 'data-req': r.id, text: wanted ? 'Accept offer from ' + who : 'Reserve for ' + who, onclick: function () { confirmRequest(l, r); } }));
      acts.push(h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'decline', 'data-req': r.id, text: 'Decline', onclick: function () { declineRequest(l, r); } }));
    }
    return h('div', { class: 'ex-req card inner', 'data-req': r.id }, h('div', { class: 'row between' }, h('strong', { text: who }), h('span', { class: 'muted ex-meta', text: r.ago })), h('p', { text: r.note || 'No note.' }), h('div', { class: 'row' }, h('span', { class: 'badge', text: (l.status === 'hidden' && r.status === 'waiting' ? 'On hold' : names[r.status] || r.status) }), acts));
  }
  function stale() { toast('This listing already changed. Showing the latest.'); render(); }
  function confirmRequest(l, r) {
    var wanted = l.kind === 'wanted', who = person(r.from).name;
    confirmDlg(wanted ? 'Accept this offer?' : 'Reserve this for ' + who + '?',
      (wanted ? 'Your wanted post will show that you accepted ' + who + '’s offer.' : 'The listing will show as Reserved, and ' + who + ' will see it is reserved for them.') + ' One person at a time. Other waiting requests stay waiting, and they are not told anything unless you release this. Use Messages to arrange pickup. Nothing is sent from this preview.',
      wanted ? 'Accept offer' : 'Reserve', function () {
        var cur = find(l.id), req = DB.requests.filter(function (x) { return x.id === r.id; })[0];
        if (!cur || !req || (cur.status !== 'available' && cur.status !== 'open') || req.status !== 'waiting') return stale();
        cur.status = 'reserved'; cur.reservedFor = req.from; req.status = 'reserved'; toast(wanted ? 'Offer accepted.' : 'Reserved for ' + who + '.'); render();
      });
  }
  function declineRequest(l, r) {
    var who = person(r.from).name;
    confirmDlg('Decline this request?', who + ' will see that you did not choose their request. They are not told why, and they cannot send another request for this listing. Other requests are not affected.', 'Decline', function () {
      var cur = find(l.id), req = DB.requests.filter(function (x) { return x.id === r.id; })[0];
      if (!cur || !req || ended(cur.status) || req.status !== 'waiting') return stale();
      req.status = 'declined'; toast('Request declined.'); render();
    });
  }
  function cancelMine(l, r, reserved) {
    confirmDlg(reserved ? 'Cancel your reservation?' : 'Cancel your request?',
      reserved ? 'The item becomes available again for others, and the owner will see that you cancelled. You can ask again while it is still available.' : 'The owner will see that you cancelled. You can ask again while it is still available.',
      reserved ? 'Cancel reservation' : 'Cancel request', function () {
        var cur = find(l.id), req = DB.requests.filter(function (x) { return x.id === r.id; })[0];
        if (!cur || !req || ended(cur.status) || req.status !== (reserved ? 'reserved' : 'waiting') || (reserved && cur.reservedFor !== req.from)) return stale();
        req.status = 'cancelled'; if (reserved) { cur.status = cur.kind === 'wanted' ? 'open' : 'available'; cur.reservedFor = null; }
        toast(reserved ? 'Reservation cancelled.' : 'Request cancelled.'); render();
      });
  }
  function activity(body) {
    var v = viewer(), mineReqs = DB.requests.filter(function (r) { return r.from === v.id && find(r.listing) && canSee(find(r.listing)); }), owned = DB.listings.filter(function (l) { return l.owner === v.id; });
    var needs = owned.filter(function (l) { return (l.status === 'available' || l.status === 'open') && DB.requests.some(function (r) { return r.listing === l.id && r.status === 'waiting'; }); });
    var held = owned.filter(function (l) { return l.status === 'reserved'; }), hid = owned.filter(function (l) { return l.status === 'hidden'; });
    body.appendChild(h('p', { class: 'muted', text: 'Requests you sent, and requests waiting on your listings. Only you see this.' }));
    if (!needs.length && !held.length && !hid.length && !mineReqs.length) return body.appendChild(stateCard('empty', 'No activity yet', 'When you ask for an item, or someone asks for yours, it shows up here.', [h('a', { class: 'btn', href: '#/browse', text: 'Browse the Exchange' })]));
    function row(l, text, id) { return h('a', { class: 'card inner ex-act', href: '#/listing/' + l.id, 'data-id': id || l.id }, h('strong', { text: l.title }), h('span', { class: 'muted ex-meta', text: text })); }
    function section(id, title, rows) { if (!rows.length) return; body.appendChild(h('section', { class: 'ex-actsec', 'aria-labelledby': id }, h('h3', { id: id, text: title }), rows)); }
    section('ex-act-needs', 'Needs your reply', needs.map(function (l) { var n = DB.requests.filter(function (r) { return r.listing === l.id && r.status === 'waiting'; }).length; return row(l, n + ' waiting ' + (n > 1 ? 'requests' : 'request')); }));
    section('ex-act-held', 'Reserved by you', held.map(function (l) { return row(l, 'Reserved for ' + person(l.reservedFor).name + '. Arrange it in Messages.'); }));
    section('ex-act-hid', 'Hidden by a moderator', hid.map(function (l) { return row(l, 'Only you and moderators can see it. Requests are on hold.'); }));
    section('ex-act-mine', 'Your requests', mineReqs.map(function (r) { var l = find(r.listing), o = person(l.owner); return row(l, mineMsgShort(r, l, o), r.id); }));
  }
  function mineMsgShort(r, l, o) {
    if (r.status === 'waiting') return l.status === 'reserved' ? 'Reserved for someone else for now. Still waiting.' : 'Waiting for ' + o.name;
    return { reserved: 'Reserved for you', released: 'Released. You can ask again.', cancelled: 'You cancelled', declined: 'Not chosen', closed: 'Closed (' + label[l.status].toLowerCase() + ')' }[r.status] || r.status;
  }
  function fact(k, val) { return val == null ? null : h('div', { class: 'ex-fact' }, h('dt', { text: k }), h('dd', { text: val })); }
  function pickupBtn(other) {
    return h('button', { type: 'button', class: 'btn', id: 'ex-pickup', text: 'Message ' + other.name + ' about pickup', onclick: function () { dialog('Pickup in Messages', h('p', { text: 'In the real app this would open your existing Messages conversation with ' + other.name + ', and pickup details stay there. Nothing is sent from this preview.' }), [{ text: 'Close' }]); } });
  }
  function interest(l) {
    var wanted = l.kind === 'wanted', ta = h('textarea', { id: 'ex-note', maxlength: L.note, rows: 3, 'aria-describedby': 'ex-note-h' });
    dialog(wanted ? 'Offer to help' : 'Ask for this item', h('div', null, h('p', { text: (wanted ? 'Tell ' : 'Tell ') + person(l.owner).name + ' you are interested. This is a request, not a reservation. They choose who gets it.' }), h('label', { for: 'ex-note', text: 'Note (optional)' }), ta, h('p', { class: 'hint', id: 'ex-note-h', text: 'Up to ' + L.note + ' characters. Please do not add a street address or phone number. Use Messages after they reply.' })),
      [{ text: 'Cancel' }, { text: 'Send request', cls: '', fn: function () {
        var n = ta.value.trim(); if (R.looksLikeContact(n) || R.looksLikeAddress(n)) { ta.setAttribute('aria-invalid', 'true'); document.getElementById('ex-note-h').textContent = 'Please remove phone numbers, emails, links and street addresses.'; ta.focus(); return false; }
        var old = DB.requests.filter(function (r) { return r.listing === l.id && r.from === viewer().id && (r.status === 'released' || r.status === 'cancelled'); })[0]; if (old) { old.status = 'waiting'; old.note = n; old.ago = 'Just now'; } else DB.requests.push({ id: 'r' + (++DB.seq), listing: l.id, from: viewer().id, note: n, status: 'waiting', ago: 'Just now', offer: wanted }); toast('Request sent (sample only).'); setTimeout(render, 0);
      } }]);
  }
  function report(l) {
    var reasons = ['Item looks unsafe or recalled', 'Not allowed on Family Exchange', 'Wrong category', 'Looks like spam or a scam', 'Other'], sel = h('select', { id: 'ex-reason' }, reasons.map(function (r) { return h('option', { value: r, text: r }); })), ta = h('textarea', { id: 'ex-rdetail', maxlength: 300, rows: 3 });
    dialog('Report this listing', h('div', null, h('p', { text: 'Reports go to a person who is not the one who posted this. The member who posted it is not shown who reported.' }), h('label', { for: 'ex-reason', text: 'Reason' }), sel, h('label', { for: 'ex-rdetail', text: 'Details (optional)' }), ta),
      [{ text: 'Cancel' }, { text: 'Send report', cls: '', fn: function () {
        var handler = ST.handler === 'on' && l.owner !== 'dana';
        setTimeout(function () {
          if (handler) { DB.reports.push({ id: 'p' + (++DB.seq), listing: l.id, by: viewer().id, reason: sel.value, detail: ta.value.trim(), ago: 'Just now' }); dialog('Report sent', h('p', { text: 'Your report went to the Exchange moderator for review. The owner is not shown your name. In this preview nothing is really sent.' }), [{ text: 'Close' }]); }
          else dialog('Report could not be sent', h('p', { text: 'No one independent of this listing’s owner is set up to review reports right now, so your report was not saved and nothing was sent to the owner. Please tell a trusted adult in your family.' }), [{ text: 'Close' }]);
        }, 0);
      } }]);
  }

  function mine(body) {
    var v = viewer(), all = DB.listings.filter(function (l) { return l.owner === v.id; }), f = ST.mineFilter || 'all';
    var groups = { all: function () { return true; }, draft: function (l) { return l.status === 'draft'; }, live: function (l) { return l.status === 'available' || l.status === 'open' || l.status === 'reserved'; }, done: function (l) { return ended(l.status); } };
    var list = all.filter(groups[f]);
    body.appendChild(h('p', { class: 'muted', text: 'Everything you posted, including drafts that only you can see.' }));
    if (!all.length) return body.appendChild(stateCard('empty', 'You have not posted anything yet', 'Free items and wanted posts you make will show up here.', [h('a', { class: 'btn', href: '#/new', text: 'New listing' })]));
    body.appendChild(h('div', { class: 'ex-chips', role: 'group', 'aria-label': 'Filter my listings' }, [['all', 'All'], ['draft', 'Drafts'], ['live', 'Live'], ['done', 'Finished']].map(function (t) { return h('button', { type: 'button', class: 'chip', 'data-f': t[0], 'aria-pressed': f === t[0] ? 'true' : 'false', text: t[1], onclick: function () { ST.mineFilter = t[0]; render(); } }); })));
    if (!list.length) return body.appendChild(stateCard('empty', 'Nothing here', 'None of your listings are in this group.'));
    body.appendChild(h('div', { class: 'ex-grid', id: 'ex-grid' }, list.map(card)));
  }
  function reports(body) {
    var v = viewer(), res = JSON.parse(A.listReports(DB, S.VIEWERS, v.id));   /* only what the fake server returns for this account is ever drawn */
    if (!res.ok) return body.appendChild(stateCard('denied', 'Reports are not available for this account', 'Only the simulated Exchange moderator sees reports in this preview.'));
    body.appendChild(h('p', { class: 'muted', text: 'Simulated moderator view. Who can moderate in the real app is not decided.' }));
    if (!res.reports.length) return body.appendChild(stateCard('empty', 'No reports', 'Nothing has been reported.'));
    res.reports.forEach(function (r) {
      var l = find(r.listingId), bs = { open: 'Open', kept: 'Kept', hidden: 'Hidden' };
      var acts;
      if (r.status === 'open' && l && !ended(l.status) && l.status !== 'hidden') acts = h('div', { class: 'row' }, h('a', { class: 'btn small ghost', href: '#/listing/' + l.id, text: 'Open listing' }), h('button', { type: 'button', class: 'btn small secondary', 'data-act': 'keep', 'data-rep': r.id, text: 'Keep listing', onclick: function () { keepReport(r); } }), h('button', { type: 'button', class: 'btn small', 'data-act': 'hide', 'data-rep': r.id, text: 'Hide listing', onclick: function () { hideListing(r); } }));
      else if (r.status === 'hidden' && l && l.status === 'hidden') acts = h('div', { class: 'row' }, h('a', { class: 'btn small ghost', href: '#/listing/' + l.id, text: 'Open listing' }), h('button', { type: 'button', class: 'btn small secondary', 'data-act': 'restore', 'data-rep': r.id, text: 'Restore listing', onclick: function () { restoreListing(r); } }));
      else acts = h('p', { class: 'muted ex-meta', text: r.status === 'open' ? 'The listing has already ended, so there is nothing left to decide.' : 'Decision recorded. Nothing more to do.' });
      body.appendChild(h('div', { class: 'card ex-report', 'data-id': r.id }, h('div', { class: 'row between' }, h('strong', { text: r.title }), h('span', { class: 'muted ex-meta', text: r.ago })), h('div', { class: 'row' }, h('span', { class: 'badge ex-rstatus', text: bs[r.status] || r.status })), h('p', { text: r.reason + (r.detail ? ': ' + r.detail : '') }), h('p', { class: 'muted ex-meta', text: 'Reported by ' + r.reporter + ' (only the handler sees this)' }), acts));
    });
  }
  function repOf(r) { return DB.reports.filter(function (x) { return x.id === r.id; })[0]; }
  function keepReport(r) {
    confirmDlg('Keep this listing?', 'The report is closed and the listing stays exactly as it is. The owner is not told about the report.', 'Keep listing', function () {
      var rep = repOf(r), l = rep && find(rep.listing); if (!A.canResolve(DB, S.VIEWERS, viewer().id, r.id) || !rep || rep.status !== 'open' || !l || l.owner === viewer().id || !viewer().moderator) return stale2();
      rep.status = 'kept'; toast('Report closed. Listing kept.'); render();
    });
  }
  function hideListing(r) {
    confirmDlg('Hide this listing?', 'It leaves Browse for everyone but the owner and moderators. Requests on it go on hold, and anyone who asked will see it is not available. The owner is told a moderator hid it. They are not told who reported it.', 'Hide listing', function () {
      var rep = repOf(r), l = rep && find(rep.listing); if (!A.canResolve(DB, S.VIEWERS, viewer().id, r.id) || !rep || rep.status !== 'open' || !l || l.owner === viewer().id || !viewer().moderator || (l.status !== 'available' && l.status !== 'open' && l.status !== 'reserved')) return stale2();
      l.hiddenFrom = l.status; l.status = 'hidden'; rep.status = 'hidden'; toast('Listing hidden.'); render();
    });
  }
  function restoreListing(r) {
    confirmDlg('Restore this listing?', 'It returns to how it was before it was hidden, and it shows in Browse again. Requests on it come off hold.', 'Restore listing', function () {
      var rep = repOf(r), l = rep && find(rep.listing); if (!A.canResolve(DB, S.VIEWERS, viewer().id, r.id) || !rep || rep.status !== 'hidden' || !l || l.status !== 'hidden' || l.owner === viewer().id || !viewer().moderator) return stale2();
      l.status = l.hiddenFrom || (l.kind === 'wanted' ? 'open' : 'available'); delete l.hiddenFrom; rep.status = 'kept'; toast('Listing restored.'); render();
    });
  }
  function stale2() { toast('This report already changed. Showing the latest.'); render(); }

  /* ---------- create / edit ---------- */
  function form(l, body, tpl) {
    var v = viewer(), d = l ? Object.assign(clone(l), l.pending ? clone(l.pending) : {}) : tpl ? { kind: tpl.kind, title: tpl.title, category: tpl.category, condition: tpl.condition || '', description: tpl.description, area: tpl.area, photos: tpl.photos.slice() } : { kind: ST.tab === 'wanted' ? 'wanted' : 'free', title: '', category: '', condition: '', description: '', area: '', photos: [] }, errs = {}, wrap = h('div', { class: 'ex-form-wrap' });
    var editing = !!l, reqs = l ? DB.requests.filter(function (r) { return r.listing === l.id; }).length : 0;
    body.appendChild(h('a', { class: 'btn ghost small', href: editing ? '#/listing/' + l.id : '#/browse', text: editing ? 'Back to listing' : 'Back to browse' }));
    body.appendChild(h('h2', { text: editing ? 'Edit listing' : 'New listing' })); if (tpl) body.appendChild(h('p', { class: 'alert', id: 'ex-tpl-note', text: 'Started from your earlier listing. It is a fresh draft: requests and status do not carry over.' })); body.appendChild(wrap);
    function field(id, lab, ctl, hint) { return h('div', { class: 'ex-field' }, h('label', { for: id, text: lab }), ctl, hint ? h('p', { class: 'hint', id: id + '-h', text: hint }) : null, h('p', { class: 'ex-err', id: id + '-e', role: 'alert', text: errs[id.slice(3)] || '' })); }
    function draw(focusId) {
      wrap.textContent = ''; var free = d.kind === 'free', f = h('form', { class: 'card ex-form', novalidate: true, onsubmit: function (e) { e.preventDefault(); } });
      if (Object.keys(errs).length) f.appendChild(h('div', { class: 'alert error', id: 'ex-summary', role: 'alert', tabindex: -1, text: 'Please fix the ' + Object.keys(errs).length + ' highlighted field' + (Object.keys(errs).length > 1 ? 's' : '') + '.' }));
      if (!editing) f.appendChild(h('div', null, h('span', { class: 'ex-lab', id: 'ex-kind-l', text: 'What are you posting?' }), h('div', { class: 'tabs ex-kindpick', role: 'group', 'aria-labelledby': 'ex-kind-l' }, [['free', 'Free item'], ['wanted', 'Wanted']].map(function (t) { return h('button', { type: 'button', class: 'tab', 'aria-pressed': d.kind === t[0] ? 'true' : 'false', text: t[1], onclick: function () { sync(); d.kind = t[0]; if (t[0] === 'wanted') d.photos = []; draw(); } }); }))));
      f.appendChild(field('ex-title', 'Title', h('input', { type: 'text', id: 'ex-title', value: d.title, maxlength: L.title + 20, 'aria-invalid': errs.title ? 'true' : null, 'aria-describedby': 'ex-title-e', autocomplete: 'off', oninput: function () { d.title = this.value; prev(); } })));
      f.appendChild(field('ex-category', 'Category', h('select', { id: 'ex-category', 'aria-invalid': errs.category ? 'true' : null, 'aria-describedby': 'ex-category-e', onchange: function () { d.category = this.value; prev(); } }, [h('option', { value: '', text: 'Choose a category' })].concat(R.CATEGORIES.map(function (c) { return h('option', { value: c, text: c, selected: d.category === c }); })))));
      if (free) f.appendChild(field('ex-condition', 'Condition', h('select', { id: 'ex-condition', 'aria-invalid': errs.condition ? 'true' : null, 'aria-describedby': 'ex-condition-e', onchange: function () { d.condition = this.value; prev(); } }, [h('option', { value: '', text: 'Choose the condition' })].concat(R.CONDITIONS.map(function (c) { return h('option', { value: c, text: c, selected: d.condition === c }); })))));
      var ta = h('textarea', { id: 'ex-description', rows: 5, 'aria-invalid': errs.description ? 'true' : null, 'aria-describedby': 'ex-description-h ex-description-e', oninput: function () { d.description = this.value; prev(); } }); ta.value = d.description;
      f.appendChild(field('ex-description', free ? 'Description' : 'What are you looking for?', ta, 'Up to ' + L.description + ' characters. Keep phone numbers and street addresses out.'));
      if (free) f.appendChild(h('div', { class: 'ex-field' }, h('span', { class: 'ex-lab', id: 'ex-photos-l', text: 'Photos (up to ' + L.photos + ')' }), h('p', { class: 'hint', id: 'ex-photos-h', text: 'This preview has no uploads. Pick from the sample photos instead. Real uploads are built later. In the real app each photo would be shrunk to ' + L.photoEdge + ' pixels on the longest side and about ' + L.photoKB + ' KB, and your original shape is kept.' }),
        h('div', { class: 'ex-pick', role: 'group', 'aria-labelledby': 'ex-photos-l', 'aria-describedby': 'ex-photos-h' }, S.PHOTOS.map(function (p) { var on = d.photos.indexOf(p.id) >= 0; return h('button', { type: 'button', class: 'ex-pickbtn', 'aria-pressed': on ? 'true' : 'false', 'aria-label': p.alt + (on ? ', selected' : ''), 'data-id': p.id, onclick: function () { sync(); if (on) d.photos = d.photos.filter(function (x) { return x !== p.id; }); else if (d.photos.length < L.photos) d.photos.push(p.id); else { toast('You can pick up to ' + L.photos + ' photos.'); return; } draw('pick:' + p.id); } }, h('img', { src: p.src, alt: '', width: 72, height: 72 })); })),
        h('p', { class: 'muted ex-meta', id: 'ex-photo-count', text: d.photos.length + ' of ' + L.photos + ' chosen' }), h('p', { class: 'ex-err', id: 'ex-photos-e', role: 'alert', text: errs.photos || '' })));
      f.appendChild(field('ex-area', 'Pickup area (optional)', h('input', { type: 'text', id: 'ex-area', value: d.area, maxlength: L.area + 20, 'aria-invalid': errs.area ? 'true' : null, 'aria-describedby': 'ex-area-h ex-area-e', placeholder: 'For example: near the library', autocomplete: 'off', oninput: function () { d.area = this.value; prev(); } }), 'A broad area only. Never a street address. Work out exact pickup details in Messages.'));
      if (editing && l.status === 'reserved') f.appendChild(h('p', { class: 'alert', id: 'ex-reserved-note', text: 'This item is reserved. Your edits stay private until you release the reservation. Other members keep seeing the item as agreed.' }));
      if (editing && l.pending && l.status !== 'reserved') f.appendChild(h('p', { class: 'alert', id: 'ex-pending-note', text: 'You are continuing private edits that are not published yet.' }));
      if (editing && reqs) f.appendChild(h('p', { class: 'alert', id: 'ex-edit-note', text: 'This listing has ' + reqs + ' request' + (reqs > 1 ? 's' : '') + '. In this preview, editing leaves requests as they are. What editing should do to requests in the real app is not decided yet.' }));
      var resv = editing && l.status === 'reserved', live2 = editing && l.status !== 'draft';
      f.appendChild(h('div', { class: 'row ex-submit' }, h('button', { type: 'button', class: 'btn secondary', id: 'ex-save', text: live2 ? 'Cancel' : 'Save draft', onclick: function () { sync(); if (live2) return go('#/listing/' + l.id); submit(false); } }),
        resv ? h('button', { type: 'button', class: 'btn secondary', id: 'ex-private', text: 'Save private edits', onclick: function () { sync(); savePrivate(); } }) : null,
        h('button', { type: 'button', class: 'btn', id: 'ex-publish', text: resv ? 'Publish changes' : live2 ? 'Save changes' : 'Publish to the family', onclick: function () { sync(); if (resv) return publishWhileReserved(); submit(true); } })));
      wrap.appendChild(h('div', { class: 'ex-form-grid' }, f, h('aside', { class: 'ex-prevcol', 'aria-label': 'Preview of your listing' }, h('h3', { text: 'How it will look' }), h('div', { id: 'ex-prev' }))));
      prev(); var t = focusId && (focusId.indexOf('pick:') === 0 ? wrap.querySelector('[data-id="' + focusId.slice(5) + '"]') : document.getElementById(focusId)); if (t) t.focus();
    }
    function sync() { var g = function (id) { var n = document.getElementById(id); return n ? n.value : null; }; ['title', 'description', 'area'].forEach(function (k) { var x = g('ex-' + k); if (x != null) d[k] = x; }); }
    function prev() {
      var box = document.getElementById('ex-prev'); if (!box) return; box.textContent = '';
      box.appendChild(card({ id: 'preview', kind: d.kind, status: editing && l.status !== 'draft' ? l.status : (d.kind === 'wanted' ? 'open' : 'available'), owner: v.id, title: R.clean(d.title) || (d.kind === 'wanted' ? 'Your wanted post' : 'Your title'), category: d.category || 'Category', condition: d.condition, photos: d.photos, ago: 'Just now' }));
      box.firstChild.removeAttribute('href'); box.firstChild.setAttribute('role', 'group'); var c = document.getElementById('ex-photo-count'); if (c) c.textContent = d.photos.length + ' of ' + L.photos + ' chosen';
    }
    function privateOk() { var r = R.validate(d); if (!R.clean(d.title)) r.errors.title = r.errors.title || 'Add a title.'; errs = r.errors; if (!r.ok) { draw(); var s2 = document.getElementById('ex-summary'); if (s2) s2.focus(); return false; } return true; }
    function savePrivate(quiet) {
      if (!privateOk()) return false;
      var rec = find(l.id); if (!rec || rec.status !== 'reserved') { toast('This listing already changed. Showing the latest.'); go('#/listing/' + l.id); return false; }
      rec.pending = { title: d.title, category: d.category, condition: d.condition, description: d.description, area: d.area, photos: d.photos.slice() };
      if (!quiet) { toast('Private edits saved. Only you can see them.'); go('#/listing/' + l.id); } return true;
    }
    function publishWhileReserved() {
      if (!privateOk()) return; var changes = R.materialChanges(l, d);
      if (!R.anyChanges(l, d)) { delete find(l.id).pending; return toast('No changes to publish.'); }
      if (!savePrivate(true)) return;
      dialog('Cannot publish while reserved', h('div', null, h('p', { text: 'Someone has this item reserved, so the public listing has to stay as agreed. ' + (changes.length ? 'Your changes to the ' + changes.join(', ') + ' were saved as private edits.' : 'Your spacing and line-break changes were saved as private edits, and your text is kept exactly as you typed it.') }), h('p', { text: 'To publish them, release the reservation first from the listing page.' })), [{ text: 'Back to the listing', cls: '', fn: function () { setTimeout(function () { go('#/listing/' + l.id); }, 0); } }]);
    }
    function submit(publish) {
      var r = R.validate(d); if (!publish) { r = { ok: !!R.clean(d.title), errors: R.clean(d.title) ? {} : { title: 'Add a title so you can find your draft again.' } }; var rr = R.validate(d); if (rr.errors.area) { r.ok = false; r.errors.area = rr.errors.area; } if (rr.errors.description && /phone|street/.test(rr.errors.description)) { r.ok = false; r.errors.description = rr.errors.description; } }
      errs = r.errors; if (!r.ok) { draw(); var s = document.getElementById('ex-summary'); if (s) s.focus(); return; }
      function save() {
        var rec = l || { id: 'n' + (++DB.seq), owner: v.id, ago: 'Just now' }; if (!l) DB.listings.unshift(rec); delete rec.pending;
        ['kind', 'category', 'condition', 'area', 'photos'].forEach(function (k) { rec[k] = d[k]; }); rec.title = d.title; rec.description = d.description; if (d.kind === 'wanted') rec.condition = undefined;
        if (publish) { if (rec.status === 'draft' || !l) rec.status = d.kind === 'wanted' ? 'open' : 'available'; } else rec.status = 'draft';
        toast(publish ? (editing && l.status !== 'draft' ? 'Changes saved (sample only).' : 'Published to the sample family.') : 'Draft saved. Only you can see it.'); go('#/listing/' + rec.id);
      }
      if (publish && !editing && !ST.acked[v.id]) return rules(function () { ST.acked[v.id] = true; confirmDlg('Publish to the ' + S.FAMILY + '?', 'Everyone in the family who is eligible for Family Exchange will be able to see this. You can edit it afterwards.', 'Publish', save); });
      if (publish && !editing) return confirmDlg('Publish to the ' + S.FAMILY + '?', 'Everyone in the family who is eligible for Family Exchange will be able to see this. You can edit it afterwards.', 'Publish', save);
      save();
    }
    draw();
  }
  function rules(onOk) {
    var items = ['Weapons, ammunition and anything made to hurt people', 'Alcohol, tobacco, vapes and drugs, including medicine', 'Anything recalled or unsafe, such as drop-side cribs or old car seats', 'Live animals', 'Opened or perishable food', 'Stolen items, or things that are not yours to give', 'Anything that asks for money, a payment or a trade'];
    var ack = h('button', { type: 'button', id: 'ex-ack', class: 'chip ex-ack', role: 'switch', 'aria-checked': 'false', 'aria-pressed': 'false', text: 'I have read these rules', onclick: function () { var on = ack.getAttribute('aria-pressed') !== 'true'; ack.setAttribute('aria-pressed', on ? 'true' : 'false'); ack.setAttribute('aria-checked', on ? 'true' : 'false'); } });
    dialog('Before your first listing', h('div', null, h('p', { text: 'Family Exchange is for free items only. Please do not post:' }), h('ul', { class: 'ex-rules' }, items.map(function (t) { return h('li', { text: t }); })), h('p', { class: 'hint', text: 'Sample wording for the preview. The real rules are not decided.' }),
      h('div', { class: 'ex-ackrow' }, ack)), [{ text: 'Cancel' }, { text: 'Continue', cls: '', fn: function (dlg) { if (ack.getAttribute('aria-pressed') !== 'true') { ack.focus(); toast('Tick the box to continue.'); return false; } setTimeout(onOk, 0); } }]);
  }

  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/browse'; else render();
  window.ExchangePreview = { state: function () { return { db: DB, st: ST }; } };
})();
