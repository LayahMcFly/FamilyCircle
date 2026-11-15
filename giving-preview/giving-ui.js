/* Giving Center preview: the screens (PREVIEW CODE, not wired into the live app).
 * Talks only to the `server` object it is given (the in-memory fake in the preview), so nothing here reaches Appwrite.
 * Text is always set with textContent, so anything typed into a field is shown as plain text and keeps the case it was typed in.
 * Private state (lists, reservations, notices) is held only in `st` and is cleared whenever the person or family changes.
 * No localStorage, sessionStorage, cookies or URL parameters carry any of it. */
(function (root) {
  'use strict';
  var C = root.GivingCore;
  var PHOTO_LABEL = { '': 'No photo (use the link\u2019s picture)', mug: 'Sample photo: mug', book: 'Sample photo: book', plant: 'Sample photo: plant', lamp: 'Sample photo: lamp' };
  var PHOTO_COLOR = { mug: '#5b8def', book: '#d9825b', plant: '#5bb584', lamp: '#d9b45b' };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'value') el.value = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(el, x); }); else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  function badge(text, cls) { return h('span', { class: 'gv-badge' + (cls ? ' ' + cls : ''), text: text }); }
  /* PREVIEW ONLY: stands in for the picture the live version would take from the item's link. Nothing is fetched. */
  function linkTile(url) {
    var host = C.hostOf(url) || '?', letter = host.charAt(0).toUpperCase().replace(/[^A-Z0-9]/, '?');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="#8a94a6"/><text x="48" y="62" font-size="44" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">' + letter + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function photoSrc(kind) {
    if (!PHOTO_COLOR[kind]) return '';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="' + PHOTO_COLOR[kind] + '"/><circle cx="48" cy="44" r="20" fill="#fff" fill-opacity=".85"/><rect x="26" y="70" width="44" height="8" rx="4" fill="#fff" fill-opacity=".85"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function mount(o) {
    var server = o.server, viewers = o.viewers, main = o.main, controls = o.controls, toasts = o.toasts, net = o.net || { mode: 'normal' };
    var st = { userId: viewers[0].userId, familyId: null, gen: 0, data: null };

    /* One entry point for every request. A reply that arrives after the person or family changed is dropped, never drawn. */
    function api(action, body) {
      var gen = st.gen, uid = st.userId, fam = st.familyId;
      var b = Object.assign({ familyId: fam }, body || {});
      return Promise.resolve().then(function () { return net.wrap(function () { return server.call(uid, action, b); }); })
        .catch(function () { return { ok: false, error: 'network', message: 'Could not reach the server. Check your connection and try again.' }; })
        .then(function (r) { if (gen !== st.gen) return { ok: false, error: 'stale', stale: true }; return r; });
    }
    function toast(msg) { var t = h('div', { class: 'toast', text: msg }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
    function route() {
      var p = (location.hash || '').replace(/^#\/?/, '').split('/');
      if (p[0] !== 'giving') return { name: 'home' };
      if (p[1] === 'list' && p[2] === 'new') return { name: 'listNew' };
      if (p[1] === 'list' && p[2]) {
        if (p[3] === 'edit') return { name: 'listEdit', id: p[2] };
        if (p[3] === 'item' && p[4] === 'new') return { name: 'itemNew', id: p[2] };
        if (p[3] === 'item' && p[4] && p[5] === 'edit') return { name: 'itemEdit', id: p[2], item: p[4] };
        return { name: 'list', id: p[2] };
      }
      return { name: 'home' };
    }
    function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
    function focusHeading() { var t = main.querySelector('[data-focus]'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: false }); } }
    function clearPrivate() { st.gen++; st.data = null; main.textContent = ''; }

    /* ---------- the "previewing as" controls ---------- */
    function drawControls() {
      var who = h('select', { id: 'pv-who', 'aria-describedby': 'pv-note' }), fam = h('select', { id: 'pv-fam' }), nm = h('select', { id: 'pv-net' });
      viewers.forEach(function (v) { who.appendChild(h('option', { value: v.userId, text: v.name, selected: v.userId === st.userId })); });
      var fams = server.familiesOf(st.userId);
      if (!st.familyId || !fams.some(function (f) { return f.id === st.familyId; })) st.familyId = fams.length ? fams[0].id : 'none';
      fams.forEach(function (f) { fam.appendChild(h('option', { value: f.id, text: f.name, selected: f.id === st.familyId })); });
      if (!fams.length) fam.appendChild(h('option', { value: 'none', text: 'No families' }));
      [['normal', 'Normal'], ['slow', 'Slow (1.5 seconds)'], ['error', 'Server error'], ['failonce', 'Fail the next request'], ['denied', 'Access denied']].forEach(function (p) { nm.appendChild(h('option', { value: p[0], text: p[1], selected: net.mode === p[0] })); });
      who.addEventListener('change', function () { clearPrivate(); st.userId = who.value; st.familyId = null; location.hash = '#/giving'; drawControls(); render(); });
      fam.addEventListener('change', function () { clearPrivate(); st.familyId = fam.value; location.hash = '#/giving'; render(); });
      nm.addEventListener('change', function () { net.mode = nm.value; });
      var v = viewers.filter(function (x) { return x.userId === st.userId; })[0];
      controls.textContent = '';
      controls.appendChild(h('div', { class: 'pv-row' },
        h('div', null, h('label', { for: 'pv-who', text: 'Previewing as' }), who),
        h('div', null, h('label', { for: 'pv-fam', text: 'Family' }), fam),
        h('div', null, h('label', { for: 'pv-net', text: 'Network' }), nm),
        h('div', { class: 'pv-reset' }, h('button', { type: 'button', class: 'btn secondary small', id: 'pv-reset', text: 'Reset sample data', onclick: function () { if (o.onReset) o.onReset(); } }))));
      controls.appendChild(h('p', { class: 'hint', id: 'pv-note', text: v.note + ' Switching person shows what that person would see.' }));
    }

    /* ---------- shared pieces ---------- */
    function errorBox(r) { return h('p', { class: 'alert error', role: 'alert', text: r.message || 'Something went wrong. Try again.' }); }
    function blocked(r) {
      return h('section', { class: 'card gv-blocked' }, h('h1', { text: 'Giving Center', 'data-focus': '' }), h('p', { text: r.error === 'no_access' ? 'Giving Center is not available for this account.' : 'That is not available.' }),
        h('p', { class: 'muted', text: 'Nothing about wishlists or gifts is shown here.' }));
    }
    function backLink(href, text) { return h('p', { class: 'gv-back' }, h('a', { class: 'link-btn back-btn', href: href, text: text })); }
    function money(it) { return it.priceCents && it.currency ? C.fmtMoney(it.priceCents, it.currency) + ' (estimate)' : ''; }
    function itemStatus(it) {
      var b = [];
      if (it.received) b.push(badge('Received', 'is-done'));
      if (!it.mine) {
        if (it.reservedByMe) b.push(badge('Reserved by you', 'is-mine'));
        else if (it.reserved) b.push(badge('Reserved', 'is-reserved'));
        if (it.changedSinceReserved) b.push(badge('Changed since you reserved', 'is-warn'));
      }
      return b;
    }
    function confirmDialog(title, text, okText, onOk) {
      var d = h('dialog', { class: 'gv-dialog', 'aria-labelledby': 'gv-d-h' });
      var cancel = h('button', { type: 'button', class: 'btn secondary', id: 'gv-d-cancel', text: 'Cancel', onclick: function () { d.close(); } });
      d.appendChild(h('h2', { id: 'gv-d-h', text: title })); d.appendChild(h('p', { text: text }));
      d.appendChild(h('div', { class: 'gv-actions' }, cancel, h('button', { type: 'button', class: 'btn danger', id: 'gv-d-ok', text: okText, onclick: function () { d.close(); onOk(); } })));
      d.addEventListener('close', function () { d.remove(); });
      document.body.appendChild(d);
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      cancel.focus();
    }

    /* ---------- home ---------- */
    function renderHome(r) {
      var page = h('div', { class: 'gv-page' });
      page.appendChild(h('div', { class: 'gv-head' }, h('h1', { text: 'Giving Center', 'data-focus': '' }),
        r.canCreateList ? h('a', { class: 'btn small', href: '#/giving/list/new', id: 'gv-newlist', text: 'New wishlist' }) : null));
      page.appendChild(h('p', { class: 'muted', text: 'Wishlists for the people in your family. Prices are estimates for reference only. Nothing here is bought or paid through Family Circle.' }));
      if (!r.me.adult) page.appendChild(h('p', { class: 'hint', id: 'gv-kidnote', text: 'You can make your own wishlist and see the family’s lists. Gift reservations are for adults.' }));
      if (r.canModerate) page.appendChild(reportsPanel(r.openReports));
      (r.notices || []).forEach(function (n) {
        page.appendChild(h('div', { class: 'gv-notice', role: 'status' }, h('span', { text: n.text }),
          h('button', { type: 'button', class: 'btn ghost small', 'data-notice': n.id, text: 'Dismiss', onclick: function () { api('noticeDismiss', { noticeId: n.id }).then(function (x) { if (x.stale) return; refresh(); }); } })));
      });
      var mine = r.lists.filter(function (l) { return l.mine; }), others = r.lists.filter(function (l) { return !l.mine; });
      page.appendChild(h('h2', { class: 'gv-sub', text: 'Your wishlists' }));
      if (!mine.length) page.appendChild(h('p', { class: 'muted', text: 'You have no wishlists yet.' }));
      else page.appendChild(listRows(mine));
      page.appendChild(h('h2', { class: 'gv-sub', text: 'Family wishlists' }));
      if (!others.length) page.appendChild(h('p', { class: 'muted', text: 'No one else has shared a wishlist yet.' })); else page.appendChild(listRows(others));
      if (r.canManageAges) page.appendChild(membersPanel());
      if (r.me.adult) page.appendChild(h('h2', { class: 'gv-sub', text: 'Items you reserved' }));
      if (!r.me.adult) { /* kids have no reservations section */ }
      else if (!r.reservations.length) page.appendChild(h('p', { class: 'muted', id: 'gv-noresv', text: 'You have not reserved anything. Only you can see your reservations.' }));
      else page.appendChild(h('ul', { class: 'gv-rows', id: 'gv-resv' }, r.reservations.map(function (x) {
        return h('li', null, h('a', { class: 'gv-row', href: '#/giving/list/' + x.listId, 'data-resv': x.itemId },
          h('strong', { text: x.title }), h('span', { class: 'muted', text: 'On ' + x.ownerName + '’s wishlist' }),
          x.changedSinceReserved ? badge('Changed since you reserved', 'is-warn') : null));
      })));
      return page;
    }
    function listRows(ls) {
      return h('ul', { class: 'gv-rows' }, ls.map(function (l) {
        var meta = l.mine ? l.itemCount + ' to give' + (l.receivedCount ? ', ' + l.receivedCount + ' received' : '') : (l.availableCount === undefined ? l.itemCount + ' items' : l.availableCount + ' of ' + l.itemCount + ' still available');
        return h('li', null, h('a', { class: 'gv-row', href: '#/giving/list/' + l.id, 'data-list': l.id },
          h('strong', { class: 'gv-row-title', text: l.name }), h('span', { class: 'muted', text: l.mine ? 'Yours' : l.ownerName }), l.audience === 'adults' ? badge('Adults only', 'is-adults') : null, h('span', { class: 'muted', text: meta })));
      }));
    }

    /* ---------- who is an adult (owners, admins and family-tree admins only) ---------- */
    function membersPanel() {
      var box = h('section', { class: 'card gv-panel', id: 'gv-members' }, h('h2', { class: 'gv-sub', text: 'Family members: adult or kid' }),
        h('p', { class: 'muted', text: 'Everyone is a kid until an owner, admin or family tree admin marks them as an adult. Adults can reserve gifts and keep a wishlist adults only.' }));
      var ul = h('ul', { class: 'gv-rows' }); box.appendChild(ul);
      api('members').then(function (r) {
        if (r.stale || !r.ok) return;
        r.members.forEach(function (m) {
          ul.appendChild(h('li', { class: 'gv-member', 'data-member': m.userId }, h('span', null, h('strong', { text: m.name }), ' ', badge(m.adult ? 'Adult' : 'Kid', m.adult ? 'is-mine' : '')),
            m.self ? h('span', { class: 'muted', text: 'This is you' }) : h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'age', text: m.adult ? 'Mark as kid' : 'Mark as adult', 'aria-label': (m.adult ? 'Mark as kid: ' : 'Mark as adult: ') + m.name,
              onclick: function () { api('memberSetAdult', { userId: m.userId, adult: !m.adult }).then(function (x) { if (x.stale) return; if (!x.ok) return toast(x.message); toast(m.name + ' is now marked as ' + (m.adult ? 'a kid.' : 'an adult.')); refresh(); }); } })));
        });
      });
      return box;
    }
    function reportsPanel(count) {
      var box = h('section', { class: 'card gv-panel', id: 'gv-reports' }, h('h2', { class: 'gv-sub', text: 'Reports (' + count + ')' }));
      if (!count) { box.appendChild(h('p', { class: 'muted', text: 'Nothing has been reported.' })); return box; }
      var ul = h('ul', { class: 'gv-rows' }); box.appendChild(ul);
      api('reports').then(function (r) {
        if (r.stale || !r.ok) return;
        r.reports.forEach(function (x) {
          ul.appendChild(h('li', { class: 'gv-report', 'data-report': x.id },
            h('strong', { text: (x.kind === 'list' ? 'Wishlist: ' : 'Item: ') + x.title }),
            h('p', { class: 'muted', text: 'On ' + x.ownerName + '’s list “' + x.listName + '”. Reported by ' + x.reporterName + ': ' + x.reasonLabel + '.' }),
            x.note ? h('p', { class: 'gv-notes', text: 'Their note: ' + x.note }) : null,
            x.notes ? h('p', { class: 'gv-notes', text: 'Notes on the item: ' + x.notes }) : null,
            x.url ? h('p', { class: 'muted', text: 'Link: ' + C.hostOf(x.url) }) : null,
            h('div', { class: 'gv-actions' },
              h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'dismiss', text: 'Dismiss report', onclick: function () { api('reportResolve', { reportId: x.id, action: 'dismiss' }).then(function (y) { if (y.stale) return; toast('Report dismissed.'); refresh(); }); } }),
              h('button', { type: 'button', class: 'btn danger small', 'data-act': 'remove', text: x.kind === 'list' ? 'Remove wishlist' : 'Remove item', onclick: function () {
                confirmDialog('Remove this?', '“' + x.title + '” will be removed and the owner is told an admin removed it. They are not told who reported it.', 'Remove', function () { api('reportResolve', { reportId: x.id, action: 'remove' }).then(function (y) { if (y.stale) return; toast('Removed.'); refresh(); }); }); } }))));
        });
      });
      return box;
    }
    function reportDialog(kind, targetId, title) {
      var d = h('dialog', { class: 'gv-dialog', 'aria-labelledby': 'gv-r-h' });
      var reason = h('select', { id: 'gv-r-reason' }, h('option', { value: '', text: 'Choose a reason' }), Object.keys(C.REPORT_REASONS).map(function (k) { return h('option', { value: k, text: C.REPORT_REASONS[k] }); }));
      var note = h('textarea', { id: 'gv-r-note', rows: 3, placeholder: 'For example: the link goes somewhere that is not a store' });
      var msg = h('p', { class: 'gv-formmsg', role: 'alert' });
      var send = h('button', { type: 'submit', class: 'btn', id: 'gv-r-send', text: 'Send report' });
      var form = h('form', { novalidate: '', onsubmit: function (e) {
        e.preventDefault(); msg.textContent = ''; setErr('gv-r-reason', ''); send.disabled = true;
        api('report', { kind: kind, targetId: targetId, reason: reason.value, note: note.value }).then(function (r) {
          send.disabled = false; if (r.stale) { d.close(); return; }
          if (!r.ok) { if (r.fields && r.fields.reason) setErr('gv-r-reason', r.fields.reason); msg.textContent = r.fields ? '' : r.message; return; }
          d.close(); toast(r.message);
        });
      } }, field('gv-r-reason', 'Why are you reporting this?', reason), field('gv-r-note', 'More detail (optional)', note), msg,
        h('div', { class: 'gv-actions' }, h('button', { type: 'button', class: 'btn secondary', id: 'gv-r-cancel', text: 'Cancel', onclick: function () { d.close(); } }), send));
      d.appendChild(h('h2', { id: 'gv-r-h', text: 'Report this' })); d.appendChild(h('p', { class: 'muted', text: '“' + title + '”. An owner or admin will review it. The person who wrote it is not told who reported it.' })); d.appendChild(form);
      d.addEventListener('close', function () { d.remove(); });
      document.body.appendChild(d); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); reason.focus();
    }

    /* ---------- one list ---------- */
    function itemCard(it, listId) {
      var li = h('li', { class: 'gv-item' + (it.received ? ' is-received' : ''), 'data-item': it.id });
      var src = photoSrc(it.photo), fromLink = false;
      if (!src && it.url) { src = linkTile(it.url); fromLink = true; }
      li.appendChild(h('div', { class: 'gv-item-top' },
        src ? h('img', { class: 'gv-photo' + (fromLink ? ' is-from-link' : ''), src: src, alt: '', width: 56, height: 56, 'data-from-link': fromLink ? 'true' : null }) : null,
        h('div', { class: 'gv-item-main' },
          h('strong', { class: 'gv-item-title', text: it.title }),
          h('p', { class: 'gv-badges' }, badge(C.PRIORITY_LABEL[it.priority], 'is-prio-' + it.priority), itemStatus(it)),
          money(it) ? h('p', { class: 'muted gv-price', text: money(it) }) : null,
          it.notes ? h('p', { class: 'gv-notes', text: it.notes }) : null,
          it.url ? h('p', { class: 'gv-link' }, h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer nofollow', text: 'Open link (' + C.hostOf(it.url) + ')' }), h('span', { class: 'muted', text: ' Opens another website.' })) : null,
          fromLink ? h('p', { class: 'hint gv-linkpic', text: 'Picture from the link (simulated in this preview).' }) : null)));
      var acts = h('div', { class: 'gv-actions' });
      if (it.mine) {
        acts.appendChild(h('a', { class: 'btn secondary small', href: '#/giving/list/' + listId + '/item/' + it.id + '/edit', 'data-act': 'edit', text: 'Edit', 'aria-label': 'Edit ' + it.title }));
        acts.appendChild(h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'received', text: it.received ? 'Mark as not received' : 'Mark as received', 'aria-label': (it.received ? 'Mark as not received: ' : 'Mark as received: ') + it.title,
          onclick: function () { api('itemReceived', { itemId: it.id, received: !it.received }).then(function (r) { if (r.stale) return; if (!r.ok) return showErr(r); toast(it.received ? 'Moved back to your list.' : 'Marked as received.'); refresh(); }); } }));
        acts.appendChild(h('button', { type: 'button', class: 'btn danger small', 'data-act': 'delete', text: 'Delete', 'aria-label': 'Delete ' + it.title,
          onclick: function () { confirmDialog('Delete this item?', '“' + it.title + '” will be removed from your wishlist.', 'Delete item', function () { api('itemDelete', { itemId: it.id }).then(function (r) { if (r.stale) return; if (!r.ok) return showErr(r); toast('Item deleted.'); refresh(); }); }); } }));
      } else if (it.kid) {
        /* kids see no reservation controls at all */
      } else if (it.reservedByMe) {
        acts.appendChild(h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'release', text: 'Release reservation', 'aria-label': 'Release reservation: ' + it.title,
          onclick: function () { api('release', { itemId: it.id }).then(function (r) { if (r.stale) return; if (!r.ok) return showErr(r); toast('Reservation released.'); refresh(); }); } }));
      } else if (!it.reserved && !it.received) {
        acts.appendChild(h('button', { type: 'button', class: 'btn small', 'data-act': 'reserve', text: 'Reserve this gift', 'aria-label': 'Reserve this gift: ' + it.title,
          onclick: function () { api('reserve', { itemId: it.id }).then(function (r) { if (r.stale) return; if (!r.ok) { toast(r.message); return refresh(); } toast('Reserved. Only you can see this.'); refresh(); }); } }));
      }
      if (!it.mine) acts.appendChild(h('button', { type: 'button', class: 'btn ghost small', 'data-act': 'report', text: 'Report', 'aria-label': 'Report: ' + it.title, onclick: function () { reportDialog('item', it.id, it.title); } }));
      if (acts.childNodes.length) li.appendChild(acts);
      return li;
    }
    function showErr(r) { var box = main.querySelector('.gv-errslot'); if (box) { box.textContent = ''; box.appendChild(errorBox(r)); } else toast(r.message); }
    function renderList(r, id) {
      var l = r.list, page = h('div', { class: 'gv-page' });
      page.appendChild(backLink('#/giving', 'Back to Giving Center'));
      page.appendChild(h('div', { class: 'gv-head' }, h('h1', { text: l.name, 'data-focus': '' }),
        l.mine ? h('a', { class: 'btn small', href: '#/giving/list/' + id + '/item/new', id: 'gv-additem', text: 'Add an item' }) : null));
      page.appendChild(h('p', { class: 'muted', text: l.mine ? (l.audience === 'adults' ? 'Your wishlist. Only adults can see it.' : 'Your wishlist. Family members can see what is on it.') : (r.me.adult ? l.ownerName + '’s wishlist. Reserving is private: ' + l.ownerName + ' will not know who reserved what.' : l.ownerName + '’s wishlist.') }));
      if (l.audience === 'adults') page.appendChild(h('p', null, badge('Adults only', 'is-adults')));
      if (!l.mine) page.appendChild(h('p', null, h('button', { type: 'button', class: 'btn ghost small', id: 'gv-reportlist', text: 'Report this wishlist', onclick: function () { reportDialog('list', id, l.name); } })));
      page.appendChild(h('div', { class: 'gv-errslot' }));
      if (l.mine) page.appendChild(h('div', { class: 'gv-actions' },
        h('a', { class: 'btn secondary small', href: '#/giving/list/' + id + '/edit', id: 'gv-renamelist', text: 'Rename wishlist' }),
        h('button', { type: 'button', class: 'btn danger small', id: 'gv-deletelist', text: 'Delete wishlist', onclick: function () {
          confirmDialog('Delete this wishlist?', '“' + l.name + '” and everything on it will be removed.', 'Delete wishlist', function () { api('listDelete', { listId: id }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); toast('Wishlist deleted.'); go('#/giving'); }); }); } })));
      var open = r.items.filter(function (i) { return !i.received; }), done = r.items.filter(function (i) { return i.received; });
      if (!r.items.length) page.appendChild(h('p', { class: 'muted', id: 'gv-empty', text: l.mine ? 'This wishlist is empty. Add something you would like.' : 'Nothing on this wishlist yet.' }));
      if (open.length) page.appendChild(h('ul', { class: 'gv-items', id: 'gv-items' }, open.map(function (i) { return itemCard(i, id); })));
      if (l.mine && r.totals && r.totals.length) page.appendChild(h('p', { class: 'muted', id: 'gv-totals', text: 'Estimated total, for reference only: ' + r.totals.map(function (t) { return t.text; }).join(' and ') + '. Different currencies are never added together.' }));
      if (done.length) { page.appendChild(h('h2', { class: 'gv-sub', text: 'Received' })); page.appendChild(h('ul', { class: 'gv-items', id: 'gv-received' }, done.map(function (i) { return itemCard(i, id); }))); }
      return page;
    }

    /* ---------- forms ---------- */
    function field(id, label, control, err, hint) {
      return h('div', { class: 'gv-field' }, h('label', { for: id, text: label }), control, hint ? h('p', { class: 'hint', id: id + '-hint', text: hint }) : null, h('p', { class: 'gv-fielderr', id: id + '-err', role: 'alert', text: err || '' }));
    }
    function renderListForm(existing, adult) {
      var audience = adult ? h('select', { id: 'gv-audience' }, Object.keys(C.AUDIENCES).map(function (k) { return h('option', { value: k, text: C.AUDIENCES[k], selected: (existing ? existing.audience : 'everyone') === k }); })) : null;
      var name = h('input', { type: 'text', id: 'gv-name', maxlength: C.LIMITS.listName * 2, autocomplete: 'off', value: existing ? existing.name : '' }), msg = h('p', { class: 'ev-formmsg gv-formmsg', role: 'alert' });
      var form = h('form', { class: 'card gv-form', novalidate: '', onsubmit: function (e) {
        e.preventDefault(); msg.textContent = ''; setErr('gv-name', '');
        api('listSave', { listId: existing && existing.id, name: name.value, audience: audience ? audience.value : undefined }).then(function (r) {
          if (r.stale) return; if (!r.ok) { if (r.fields && r.fields.name) setErr('gv-name', r.fields.name); msg.textContent = r.message; return; }
          toast('Wishlist saved.'); go('#/giving/list/' + r.list.id);
        });
      } }, h('h1', { text: existing ? 'Rename wishlist' : 'New wishlist', 'data-focus': '' }), field('gv-name', 'Wishlist name', name, '', 'Up to ' + C.LIMITS.listName + ' characters.'),
        audience ? field('gv-audience', 'Who can see it', audience, '', 'Choose Adults only for a list that must stay a surprise, such as gift ideas for a child.') : null, msg,
        h('div', { class: 'gv-actions' }, h('button', { type: 'submit', class: 'btn', id: 'gv-save', text: 'Save' }), h('a', { class: 'btn secondary', href: existing ? '#/giving/list/' + existing.id : '#/giving', text: 'Cancel' })));
      return h('div', { class: 'gv-page' }, backLink(existing ? '#/giving/list/' + existing.id : '#/giving', 'Back'), form);
    }
    function setErr(id, text) { var e = document.getElementById(id + '-err'), c = document.getElementById(id); if (e) e.textContent = text; if (c) { if (text) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid'); } }
    function renderItemForm(listId, existing) {
      var f = {};
      f.title = h('input', { type: 'text', id: 'gv-title', autocomplete: 'off', value: existing ? existing.title : '' });
      f.notes = h('textarea', { id: 'gv-notes', rows: 3, placeholder: 'For example: size medium, blue if they have it, the one that makes big bubbles' }); f.notes.value = existing ? existing.notes : '';
      f.priority = h('select', { id: 'gv-priority' }, C.PRIORITIES.map(function (p) { return h('option', { value: p, text: C.PRIORITY_LABEL[p], selected: (existing ? existing.priority : 'medium') === p }); }));
      f.url = h('input', { type: 'text', id: 'gv-url', inputmode: 'url', autocomplete: 'off', value: existing ? existing.url : '' });
      f.price = h('input', { type: 'text', id: 'gv-price', inputmode: 'decimal', autocomplete: 'off', value: existing && existing.priceCents ? (existing.priceCents / 100).toFixed(2) : '' });
      f.currency = h('select', { id: 'gv-currency' }, h('option', { value: '', text: 'Choose currency' }), Object.keys(C.CURRENCIES).map(function (c) { return h('option', { value: c, text: c + ' \u00b7 ' + C.CURRENCIES[c].name, selected: existing && existing.currency === c }); }));
      f.photo = h('select', { id: 'gv-photo' }, Object.keys(PHOTO_LABEL).map(function (k) { return h('option', { value: k, text: PHOTO_LABEL[k], selected: existing && existing.photo === k }); }));
      var msg = h('p', { class: 'ev-formmsg gv-formmsg', role: 'alert' });
      var ids = { title: 'gv-title', notes: 'gv-notes', priority: 'gv-priority', url: 'gv-url', price: 'gv-price', currency: 'gv-currency' };
      var form = h('form', { class: 'card gv-form', novalidate: '', onsubmit: function (e) {
        e.preventDefault(); msg.textContent = ''; Object.keys(ids).forEach(function (k) { setErr(ids[k], ''); });
        var body = { listId: listId, itemId: existing && existing.id, title: f.title.value, notes: f.notes.value, priority: f.priority.value, url: f.url.value, price: f.price.value, currency: f.currency.value, photo: f.photo.value };
        api('itemSave', body).then(function (r) {
          if (r.stale) return;
          if (!r.ok) { var first = null; Object.keys(r.fields || {}).forEach(function (k) { setErr(ids[k], r.fields[k]); if (!first) first = document.getElementById(ids[k]); }); msg.textContent = r.message; if (first) first.focus(); return; }
          toast('Item saved.'); go('#/giving/list/' + listId);
        });
      } },
        h('h1', { text: existing ? 'Edit item' : 'Add an item', 'data-focus': '' }),
        field('gv-title', 'Title', f.title), field('gv-notes', 'Notes (optional)', f.notes, '', 'Anything that helps someone pick the right one: size, color, model, where you saw it.'), field('gv-priority', 'How much do you want it?', f.priority),
        field('gv-url', 'Link (optional)', f.url, '', 'A web address you choose. Family Circle does not visit it or look anything up.'),
        h('div', { class: 'gv-pair' }, field('gv-price', 'Estimated price (optional)', f.price, '', 'A guess for reference. Not a charge.'), field('gv-currency', 'Currency', f.currency)),
        field('gv-photo', 'Photo (optional)', f.photo, '', 'Leave this blank and the picture can come from your link. Real photo upload is not part of this preview, so this only picks a sample picture.'),
        msg, h('div', { class: 'gv-actions' }, h('button', { type: 'submit', class: 'btn', id: 'gv-save', text: 'Save item' }), h('a', { class: 'btn secondary', href: '#/giving/list/' + listId, text: 'Cancel' })));
      return h('div', { class: 'gv-page' }, backLink('#/giving/list/' + listId, 'Back to wishlist'), form);
    }

    /* ---------- routing ---------- */
    var token = 0;
    function put(node) { main.textContent = ''; main.appendChild(node); focusHeading(); }
    function render() {
      var rt = route(), mine = ++token;
      main.setAttribute('aria-busy', 'true');
      var fin = function (node) { if (mine !== token) return; main.removeAttribute('aria-busy'); put(node); };
      if (st.familyId === 'none') return fin(blocked({ error: 'not_available' }));
      if (rt.name === 'home') return api('home').then(function (r) { if (r.stale) return; if (!r.ok) return fin(r.error === 'network' || r.error === 'server' ? errorWithRetry(r) : blocked(r)); st.data = r; fin(renderHome(r)); });
      if (rt.name === 'listNew') return api('home').then(function (r) { if (r.stale) return; if (!r.ok) return fin(blocked(r)); fin(r.canCreateList ? renderListForm(null, r.me.adult) : limitMsg()); });
      if (rt.name === 'listEdit' || rt.name === 'itemNew' || rt.name === 'itemEdit' || rt.name === 'list') {
        return api('listGet', { listId: rt.id }).then(function (r) {
          if (r.stale) return; if (!r.ok) return fin(r.error === 'network' || r.error === 'server' ? errorWithRetry(r) : blocked(r));
          if (rt.name === 'list') return fin(renderList(r, rt.id));
          if (!r.list.mine) return fin(blocked({ error: 'not_available' }));   // only the owner reaches a form
          if (rt.name === 'listEdit') return fin(renderListForm(r.list, r.me.adult));
          if (rt.name === 'itemNew') return fin(renderItemForm(rt.id, null));
          var it = r.items.filter(function (i) { return i.id === rt.item; })[0];
          fin(it ? renderItemForm(rt.id, it) : blocked({ error: 'not_available' }));
        });
      }
    }
    function limitMsg() { return h('section', { class: 'card' }, h('h1', { text: 'New wishlist', 'data-focus': '' }), h('p', { text: 'You have reached the limit of ' + C.LIMITS.lists + ' wishlists. Delete one to add another.' }), h('a', { class: 'btn secondary', href: '#/giving', text: 'Back' })); }
    function errorWithRetry(r) { return h('section', { class: 'card' }, h('h1', { text: 'Giving Center', 'data-focus': '' }), errorBox(r), h('button', { type: 'button', class: 'btn', id: 'gv-retry', text: 'Try again', onclick: function () { render(); } })); }
    function refresh() {
      var y = window.scrollY; var rt = route(), mineToken = ++token;
      var redo = rt.name === 'home' ? api('home') : api('listGet', { listId: rt.id });
      return redo.then(function (r) {
        if (r.stale || mineToken !== token) return;
        if (!r.ok) { if (rt.name !== 'home') { main.textContent = ''; main.appendChild(blocked(r)); } return; }
        main.removeAttribute('aria-busy');
        main.textContent = ''; main.appendChild(rt.name === 'home' ? renderHome(r) : renderList(r, rt.id)); window.scrollTo(0, y);
      });
    }
    window.addEventListener('hashchange', render);
    drawControls(); render();
    return { state: st, render: render, refresh: refresh };
  }
  root.GivingUI = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
