/* Giving Center screens. Used by the preview (on the in-memory fake server) and, with `real: true`, by the app (through giving.js).
 * Talks only to the `server` object it is given, so these screens never reach Appwrite by themselves.
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

  /* Real photos: whatever picture type the browser can open (JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC where supported) is converted to JPEG and
     made smaller on the person's own device before anything is sent: a small one for the list and one for the full view (at most 250 KB). */
  var PIC_SIZES = { small: 600, balanced: 800, sharp: 1000 };
  function fitPicture(src, max, quality, limit) {
    var w = src.width, h2 = src.height, s = Math.min(1, max / Math.max(w, h2)), url = '';
    for (var tries = 0; tries < 10; tries++) {
      var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h2 * s)), cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(src, 0, 0, cw, ch);
      url = cv.toDataURL('image/jpeg', quality);
      if ((url.length - 23) * 0.75 <= limit) return url;
      if (quality > 0.45) quality -= 0.12; else s *= 0.8;
    }
    throw new Error('That picture could not be made small enough. Try a different one.');
  }
  function openPicture(file) {
    var heic = /heic|heif/i.test(file.type + ' ' + file.name);
    var fail = function () { throw new Error(heic ? 'This browser cannot open HEIC pictures. On an iPhone, open the picture in Photos, tap Share, and choose a JPEG copy, or set Camera formats to Most Compatible. Then choose it again.' : 'That picture could not be read. Try a JPEG, PNG, WebP, GIF or BMP picture.'); };
    if (window.createImageBitmap) return createImageBitmap(file).catch(function () { return viaImage(file).catch(fail); });
    return viaImage(file).catch(fail);
  }
  function viaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    }).then(function (img) { return { width: img.naturalWidth, height: img.naturalHeight, img: img }; }).then(function (o) { var c = document.createElement('canvas'); c.width = o.width; c.height = o.height; c.getContext('2d').drawImage(o.img, 0, 0); return c; });
  }
  function shrinkPicture(file, size) {
    if (file.size > 60 * 1024 * 1024) return Promise.reject(new Error('That picture file is over 60 MB. Choose a smaller one.'));
    return openPicture(file).then(function (src) {
      if (!src.width || !src.height) throw new Error('That picture could not be read.');
      var out = { photo: fitPicture(src, PIC_SIZES[size] || 800, 0.82, 240000), thumb: fitPicture(src, 128, 0.7, 9500) };
      if (src.close) src.close();
      return out;
    });
  }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function dataBytes(u) { return Math.round((u.length - 23) * 0.75); }

  function mount(o) {
    var server = o.server, viewers = o.viewers, main = o.main, controls = o.controls, toasts = o.toasts, net = o.net || { mode: 'normal', wrap: function (run) { return Promise.resolve(run()); } };
    var real = !!o.real;
    if (real) { main = document.createElement('div'); o.main.appendChild(main); }   // the app puts its own "Back to Hub" link in its main area first; these screens fill only their own box
    var st = { userId: real ? 'me' : viewers[0].userId, familyId: real ? (o.famId ? o.famId() : null) : null, gen: 0, data: null };

    /* One entry point for every request. A reply that arrives after the person or family changed is dropped, never drawn. */
    function api(action, body, opts) {
      var gen = st.gen, uid = st.userId, fam = real && o.famId ? o.famId() : st.familyId;
      var b = Object.assign({ familyId: fam }, body || {});
      return Promise.resolve().then(function () { return net.wrap(function () { return server.call(uid, action, b); }); })
        .catch(function () { return { ok: false, error: 'network', message: 'Could not reach the server. Check your connection and try again.' }; })
        .then(function (r) { if (gen !== st.gen && !(opts && opts.keep)) return { ok: false, error: 'stale', stale: true }; return r; });
    }
    function toast(msg) { if (o.toast) return o.toast(msg); var t = h('div', { class: 'toast', text: msg }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
    function route() {
      var p = (location.hash || '').replace(/^#\/?/, '').split('/');
      if (p[0] !== 'giving') return { name: 'home' };
      if (p[1] === 'requests') {
        if (p[2] === 'new') return { name: 'requestNew' };
        if (p[2] && p[3] === 'edit') return { name: 'requestEdit', id: p[2] };
        if (p[2]) return { name: 'request', id: p[2] };
        return { name: 'requests' };
      }
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
    /* real app only: Giving Center is off for the family. The owner sees a button; everyone else is told it is not turned on. */
    function renderOff(status) {
      var box = h('section', { class: 'card gv-blocked gv-off' }, h('h1', { text: 'Giving Center', 'data-focus': '' }),
        h('p', { text: 'Giving Center is not turned on for your family yet.' }), h('div', { class: 'gv-errslot' }));
      if (status && status.canTurnOn) {
        box.appendChild(h('p', { class: 'muted', text: 'You are the family owner, so you can turn it on. Until you do, no one in the family sees wishlists or gift reservations.' }));
        box.appendChild(h('button', { type: 'button', class: 'btn', id: 'gv-turnon', text: 'Turn on Giving Center', onclick: function () {
          confirmDialog('Turn on Giving Center?', 'Everyone in your family will be able to make wishlists. Everyone starts as a kid; you choose who is an adult. You can turn it off again at any time.', 'Turn on', function () {
            api('setEnabled', { enabled: true }).then(function (r) { if (r.stale) return; if (!r.ok) return showErr(r); toast('Giving Center is on.'); render(); }); }, true); } }));
      } else box.appendChild(h('p', { class: 'muted', text: 'Ask the family owner to turn it on.' }));
      return box;
    }
    function ownerSwitchPanel() {
      var box = h('section', { class: 'card gv-panel', id: 'gv-switch' }, h('h2', { class: 'gv-sub', text: 'Giving Center is on' }),
        h('p', { class: 'muted', text: 'Turning it off hides it from everyone. Nothing is deleted, and turning it on again brings everything back.' }), h('div', { class: 'gv-errslot' }));
      box.appendChild(h('button', { type: 'button', class: 'btn secondary small', id: 'gv-turnoff', text: 'Turn off Giving Center', onclick: function () {
        confirmDialog('Turn off Giving Center?', 'No one in the family will see wishlists or reservations until you turn it on again. Nothing is deleted.', 'Turn off', function () {
          api('setEnabled', { enabled: false }).then(function (r) { if (r.stale) return; if (!r.ok) return showErr(r); toast('Giving Center is off.'); render(); }); }, true); } }));
      return box;
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
    function confirmDialog(title, text, okText, onOk, plain) {
      var d = h('dialog', { class: 'gv-dialog', 'aria-labelledby': 'gv-d-h' });
      var cancel = h('button', { type: 'button', class: 'btn secondary', id: 'gv-d-cancel', text: 'Cancel', onclick: function () { d.close(); } });
      d.appendChild(h('h2', { id: 'gv-d-h', text: title })); d.appendChild(h('p', { text: text }));
      d.appendChild(h('div', { class: 'gv-actions' }, cancel, h('button', { type: 'button', class: plain ? 'btn' : 'btn danger', id: 'gv-d-ok', text: okText, onclick: function () { d.close(); onOk(); } })));
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
      if (!real) page.appendChild(h('a', { class: 'gv-row gv-requestslink', id: 'gv-requestslink', href: '#/giving/requests' },
        h('strong', { text: 'Family requests' }), h('span', { class: 'muted', text: r.requests ? (r.requests.open + (r.requests.open === 1 ? ' open request' : ' open requests') + (r.requests.waiting ? ', ' + r.requests.waiting + ' waiting for approval' : '')) : 'Ask for help and pledge to help' })));
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
        var meta = l.mine ? l.itemCount + ' to give' + (l.receivedCount ? ', ' + l.receivedCount + ' received' : '') : (l.availableCount === undefined ? l.itemCount + (l.itemCount === 1 ? ' item' : ' items') : l.availableCount + ' of ' + l.itemCount + ' still available');
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
            h('strong', { text: (x.kind === 'list' ? 'Wishlist: ' : x.kind === 'request' ? 'Request: ' : 'Item: ') + x.title }),
            h('p', { class: 'muted', text: (x.kind === 'request' ? 'Asked by ' + x.ownerName + '. Reported by ' : 'On ' + x.ownerName + '’s list “' + x.listName + '”. Reported by ') + '' + x.reporterName + ': ' + x.reasonLabel + '.' }),
            x.note ? h('p', { class: 'gv-notes', text: 'Their note: ' + x.note }) : null,
            x.notes ? h('p', { class: 'gv-notes', text: 'Notes on the item: ' + x.notes }) : null,
            x.url ? h('p', { class: 'muted', text: 'Link: ' + C.hostOf(x.url) }) : null,
            h('div', { class: 'gv-actions' },
              h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'dismiss', text: 'Dismiss report', onclick: function () { api('reportResolve', { reportId: x.id, action: 'dismiss' }).then(function (y) { if (y.stale) return; toast('Report dismissed.'); refresh(); }); } }),
              h('button', { type: 'button', class: 'btn danger small', 'data-act': 'remove', text: x.kind === 'list' ? 'Remove wishlist' : x.kind === 'request' ? 'Remove request' : 'Remove item', onclick: function () {
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
        api(kind === 'request' ? 'requestReport' : 'report', { kind: kind, targetId: targetId, reason: reason.value, note: note.value }).then(function (r) {
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

    /* Etsy listing links get their picture from Etsy's own API, shown but never saved here (Etsy's rules). The function says when it is not set up; then the tile stays. */
    var ETSY_NOTE = "The term 'Etsy' is a trademark of Etsy, Inc. This application uses Etsy's API but is not endorsed or certified by Etsy.";
    var etsyPics = {}, etsyOff = false;
    function etsyListing(url) { return real && /^https?:\/\/(www\.)?etsy\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/\d{5,14}(?:[\/?#]|$)/i.test(url || ''); }
    function etsyNote(from) {
      var page = from.closest ? from.closest('main') || document.body : document.body;
      if (!page.querySelector('.gv-etsy-note')) page.appendChild(h('p', { class: 'hint gv-etsy-note', text: ETSY_NOTE }));
    }
    function etsyLoad(it, img, hint) {
      if (etsyOff) return;
      var got = function (url) { if (!img.isConnected) return; img.src = url; img.removeAttribute('data-from-link'); img.classList.remove('is-from-link'); if (hint) hint.textContent = 'Picture from Etsy.'; etsyNote(img); };
      if (etsyPics[it.id]) return got(etsyPics[it.id]);
      api('etsyPicture', { itemId: it.id, size: 'thumb' }).then(function (r) {
        if (r.stale) return;
        if (r.ok && r.image) { etsyPics[it.id] = r.image; return got(r.image); }
        if (r.error === 'no_picture' && /not set up/.test(r.message || '')) etsyOff = true;
        if (hint) hint.textContent = 'Placeholder picture. Etsy has no picture to show for this listing right now.';
      });
    }

    function dataUrlToFile(url, name) {
      var m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+\/=]+)$/i.exec(url || ''); if (!m) return null;
      try { var bin = atob(m[2]), n = bin.length, arr = new Uint8Array(n); for (var i = 0; i < n; i++) arr[i] = bin.charCodeAt(i); return new File([arr], name, { type: m[1] }); } catch (e) { return null; }
    }

    function photoDialog(it) {
      var d = h('dialog', { class: 'gv-dialog', 'aria-labelledby': 'gv-p-h' });
      var img = h('img', { class: 'gv-bigphoto', src: it.thumb || etsyPics[it.id] || '', alt: 'Picture of ' + it.title }), note = h('p', { class: 'hint', id: 'gv-p-note', text: 'Loading the full picture…' });
      d.appendChild(h('h2', { id: 'gv-p-h', text: it.title })); d.appendChild(img); d.appendChild(note);
      d.appendChild(h('div', { class: 'gv-actions' }, h('button', { type: 'button', class: 'btn secondary', id: 'gv-p-close', text: 'Close', onclick: function () { d.close(); } })));
      d.addEventListener('close', function () { d.remove(); });
      document.body.appendChild(d); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      if (!it.thumb && etsyListing(it.url)) {
        d.insertBefore(h('p', { class: 'hint gv-etsy-note', text: ETSY_NOTE }), d.querySelector('.gv-actions'));
        return api('etsyPicture', { itemId: it.id, size: 'full' }).then(function (r) { if (r.stale || !d.isConnected) return; if (r.ok && r.image) { img.src = r.image; note.textContent = ''; } else note.textContent = 'The full picture is not available right now.'; });
      }
      api('photoGet', { itemId: it.id }).then(function (r) { if (r.stale || !d.isConnected) return; if (r.ok && r.photo) { img.src = r.photo; note.textContent = ''; } else note.textContent = 'The full picture is not available right now.'; });
    }

    /* ---------- one list ---------- */
    function itemCard(it, listId) {
      var li = h('li', { class: 'gv-item' + (it.received ? ' is-received' : ''), 'data-item': it.id });
      var src = it.thumb || photoSrc(it.photo), fromLink = false;
      if (!src && it.url) { src = linkTile(it.url); fromLink = true; }
      li.appendChild(h('div', { class: 'gv-item-top' },
        it.thumb ? h('button', { type: 'button', class: 'gv-photo-btn', 'data-act': 'photo', 'aria-label': 'View the picture of ' + it.title, onclick: function () { photoDialog(it); } }, h('img', { class: 'gv-photo', src: src, alt: '', width: 56, height: 56 }))
          : src && !it.thumb && etsyListing(it.url) ? h('button', { type: 'button', class: 'gv-photo-btn', 'data-act': 'photo', 'data-etsy': 'true', 'aria-label': 'View the picture of ' + it.title, onclick: function () { photoDialog(it); } }, h('img', { class: 'gv-photo is-from-link', src: src, alt: '', width: 56, height: 56, 'data-from-link': 'true' }))
          : src ? h('img', { class: 'gv-photo' + (fromLink ? ' is-from-link' : ''), src: src, alt: '', width: 56, height: 56, 'data-from-link': fromLink ? 'true' : null }) : null,
        h('div', { class: 'gv-item-main' },
          h('strong', { class: 'gv-item-title', text: it.title }),
          h('p', { class: 'gv-badges' }, badge(C.PRIORITY_LABEL[it.priority], 'is-prio-' + it.priority), itemStatus(it)),
          money(it) ? h('p', { class: 'muted gv-price', text: money(it) }) : null,
          it.notes ? h('p', { class: 'gv-notes', text: it.notes }) : null,
          it.url ? h('p', { class: 'gv-link' }, h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer nofollow', text: 'Open link (' + C.hostOf(it.url) + ')' }), h('span', { class: 'muted', text: ' Opens another website.' })) : null,
          fromLink ? h('p', { class: 'hint gv-linkpic', text: real ? 'Placeholder picture. Edit the item to add your own photo, or tap "Get a picture from the link".' : 'Picture from the link (simulated in this preview).' }) : null)));
      var etsyBtn = li.querySelector('[data-etsy] img');
      if (etsyBtn) etsyLoad(it, etsyBtn, li.querySelector('.gv-linkpic'));
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
      f.photo = real ? null : h('select', { id: 'gv-photo' }, Object.keys(PHOTO_LABEL).map(function (k) { return h('option', { value: k, text: PHOTO_LABEL[k], selected: existing && existing.photo === k }); }));
      var removePhoto = false;
      if (real) {
        f.file = h('input', { type: 'file', id: 'gv-photofile', accept: 'image/*,.heic,.heif,.avif,.bmp,.gif', 'aria-describedby': 'gv-photofile-hint gv-photoinfo' });
        f.prev = h('div', { class: 'gv-photoprev', id: 'gv-photoprev' });
        f.size = h('select', { id: 'gv-photosize', 'aria-label': 'Picture size' }, h('option', { value: 'small', text: 'Smaller file (600 px)' }), h('option', { value: 'balanced', text: 'Balanced (800 px)', selected: true }), h('option', { value: 'sharp', text: 'Sharper (1000 px)' }));
        f.info = h('p', { class: 'hint', id: 'gv-photoinfo', role: 'status' });
        f.debug = h('p', { class: 'hint gv-debug', id: 'gv-linkdebug' });
        var ready = null, working = 0;
        var showPrev = function (src) { f.prev.textContent = ''; if (src) f.prev.appendChild(h('img', { class: 'gv-photo', src: src, alt: 'Picture to use for this item', width: 56, height: 56 })); };
        if (existing && existing.thumb) {
          showPrev(existing.thumb);
          f.prev.appendChild(h('button', { type: 'button', class: 'btn ghost small', id: 'gv-photoremove', text: 'Remove the picture', onclick: function () { removePhoto = true; ready = null; chosen = null; f.file.value = ''; f.info.textContent = ''; f.sizeRow.hidden = true; showPrev(''); toast('The picture will be removed when you save.'); } }));
        }
        f.sizeRow = h('div', { class: 'gv-sizerow', hidden: true }, h('label', { for: 'gv-photosize', text: 'Picture size' }), f.size);
        var chosen = null;   // the picture to send: a file the person picked, or one fetched from the link
        var process = function (given) {
          var file = given && given.name !== undefined ? given : chosen; if (!file) return;
          var token = ++working; ready = null; f.info.textContent = 'Converting and compressing…'; setErr('gv-photofile', '');
          ready = shrinkPicture(file, f.size.value).then(function (p) {
            if (token !== working) return null;
            f.info.textContent = 'Original ' + kb(file.size) + (file.type ? ' (' + file.type.replace('image/', '').toUpperCase() + ')' : '') + '. Will be sent as a JPEG of ' + kb(dataBytes(p.photo)) + '.';
            showPrev(p.thumb); f.sizeRow.hidden = false; return p;
          }, function (e) { if (token !== working) return null; f.info.textContent = ''; f.sizeRow.hidden = true; f.file.value = ''; ready = null; showPrev(existing && existing.thumb || ''); setErr('gv-photofile', e.message); return null; });
        };
        f.size.addEventListener('change', function () { process(); });
        f.file.addEventListener('change', function () {
          var file = f.file.files && f.file.files[0]; removePhoto = false; setErr('gv-photofile', ''); chosen = file || null;
          if (!file) { ready = null; f.info.textContent = ''; f.sizeRow.hidden = true; return showPrev(existing && existing.thumb || ''); }
          process(file);
        });
        f.linkBtn = h('button', { type: 'button', class: 'btn secondary small', id: 'gv-linkpic', text: 'Get a picture from the link', onclick: function () {
          var url = f.url.value.trim(); setErr('gv-url', ''); setErr('gv-photofile', '');
          if (!/^https?:\/\/\S+\.\S+/i.test(url)) return setErr('gv-url', 'Enter a web address that starts with https:// first.');
          f.linkBtn.disabled = true; f.debug.textContent = ''; f.info.textContent = 'Looking for a picture at the link…';
          var t0 = Date.now(), dbg = function (m) { if (f.debug.isConnected) f.debug.textContent += (f.debug.textContent ? ' ' : '') + m; };
          dbg('Request sent.');
          var timedOut = false, slow = setTimeout(function () { timedOut = true; if (f.debug.isConnected) f.debug.textContent += ' No answer after 20 s.'; f.linkBtn.disabled = false; f.info.textContent = ''; setErr('gv-photofile', 'That is taking too long. Big shops often block this. Save the picture to your phone and add it with the photo picker instead.'); }, 20000);
          // keep: true. The answer is for THIS form, so it is used even if the screen refreshed in the background meanwhile (a refresh must not leave "Looking…" on screen forever).
          api('linkPicture', { url: url }, { keep: true }).then(function (r) {
            clearTimeout(slow); if (timedOut || !f.info.isConnected) return;
            f.linkBtn.disabled = false;
            dbg('Answer after ' + Math.round((Date.now() - t0) / 100) / 10 + ' s (' + (r.ok ? 'picture found' : (r.error || 'no picture')) + ').');
            if (!r.ok) {
              f.info.textContent = ''; var parts = String(r.message || '').split(' Details: ');
              if (parts[1]) dbg('What happened, step by step: ' + parts[1]);
              return setErr('gv-photofile', parts[0]);
            }
            // Not fetch(data:...): the page's security rules (connect-src) do not allow fetching data: addresses. Decode the picture directly instead.
            var file = dataUrlToFile(r.image, 'from-link');
            if (!file) { f.info.textContent = ''; return setErr('gv-photofile', 'The picture came back in a form this browser could not read. Add your own photo instead.'); }
            chosen = file; removePhoto = false; f.file.value = ''; process(file);
            f.info.textContent = 'Picture found at ' + r.host + '. Converting and compressing…';
          }).catch(function (e) { clearTimeout(slow); if (timedOut || !f.info.isConnected) return; f.linkBtn.disabled = false; f.info.textContent = ''; setErr('gv-photofile', 'Something went wrong while getting the picture. Try again, or add your own photo.'); dbg('Error: ' + String((e && e.message) || e).slice(0, 120)); });
        } });
        f.getReady = function () { return ready; };
      }
      var msg = h('p', { class: 'ev-formmsg gv-formmsg', role: 'alert' });
      var ids = { title: 'gv-title', notes: 'gv-notes', priority: 'gv-priority', url: 'gv-url', price: 'gv-price', currency: 'gv-currency' };
      var form = h('form', { class: 'card gv-form', novalidate: '', onsubmit: function (e) {
        e.preventDefault(); msg.textContent = ''; Object.keys(ids).forEach(function (k) { setErr(ids[k], ''); });
        var body = { listId: listId, itemId: existing && existing.id, title: f.title.value, notes: f.notes.value, priority: f.priority.value, url: f.url.value, price: f.price.value, currency: f.currency.value };
        if (f.photo) body.photo = f.photo.value;
        api('itemSave', body).then(function (r) {
          if (r.stale) return;
          if (!r.ok) { var first = null; Object.keys(r.fields || {}).forEach(function (k) { setErr(ids[k], r.fields[k]); if (!first) first = document.getElementById(ids[k]); }); msg.textContent = r.message; if (first) first.focus(); return; }
          var file = real && chosen, itemId = r.item && r.item.id;
          var done = function (note) { toast(note || 'Item saved.'); go('#/giving/list/' + listId); };
          if (file) {
            msg.textContent = 'Sending the picture…';
            return Promise.resolve(f.getReady()).then(function (p) { if (!p) throw new Error('the picture could not be prepared'); return api('photoSave', { itemId: itemId, thumb: p.thumb, photo: p.photo }); })
              .then(function (x) { if (x.stale) return; done(x.ok ? 'Item saved.' : 'Item saved, but the picture was not added: ' + x.message); }, function (e) { done('Item saved, but the picture was not added: ' + e.message); });
          }
          if (real && removePhoto && existing && existing.thumb) return api('photoRemove', { itemId: itemId }).then(function (x) { if (x.stale) return; done(); });
          done();
        });
      } },
        h('h1', { text: existing ? 'Edit item' : 'Add an item', 'data-focus': '' }),
        field('gv-title', 'Title', f.title), field('gv-notes', 'Notes (optional)', f.notes, '', 'Anything that helps someone pick the right one: size, color, model, where you saw it.'), field('gv-priority', 'How much do you want it?', f.priority),
        field('gv-url', 'Link (optional)', f.url, '', real ? 'A web address you choose. Family Circle only visits it if you tap "Get a picture from the link" under Photo. Etsy listing links show their picture automatically, straight from Etsy.' : 'A web address you choose. Family Circle does not visit it or look anything up.'),
        h('div', { class: 'gv-pair' }, field('gv-price', 'Estimated price (optional)', f.price, '', 'A guess for reference. Not a charge.'), field('gv-currency', 'Currency', f.currency)),
        real ? h('div', { class: 'gv-field' }, h('label', { for: 'gv-photofile', text: 'Photo (optional)' }), f.file, f.linkBtn, f.prev, f.sizeRow, f.info, f.debug, h('p', { class: 'hint', id: 'gv-photofile-hint', text: 'Any picture type works. It is converted to a JPEG and made smaller on your device before it is sent, so big photos are fine. Leave it empty to use the placeholder from your link.' }), h('p', { class: 'gv-fielderr', id: 'gv-photofile-err', role: 'alert' })) : null,
        f.photo ? field('gv-photo', 'Photo (optional)', f.photo, '', 'Leave this blank and the picture can come from your link. Real photo upload is not part of this preview, so this only picks a sample picture.') : null,
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
      if (rt.name === 'home') return api('home').then(function (r) {
        if (r.stale) return;
        if (!r.ok && real && r.error === 'not_available') return api('status').then(function (s) { if (s.stale) return; fin(s.ok && !s.enabled ? renderOff(s) : blocked(r)); });
        if (!r.ok) return fin(r.error === 'network' || r.error === 'server' ? errorWithRetry(r) : blocked(r));
        st.data = r; var page = renderHome(r); fin(page);
        if (real) api('status').then(function (s) { if (s.stale || mine !== token || !s.ok || !s.canTurnOn || !page.isConnected) return; page.appendChild(ownerSwitchPanel()); });
      });
      if (rt.name === 'requests' || rt.name === 'requestNew') return api('requestsHome').then(function (r) {
        if (r.stale) return; if (!r.ok) return fin(r.error === 'network' || r.error === 'server' ? errorWithRetry(r) : blocked(r));
        if (rt.name === 'requestNew') return fin(r.canCreate ? renderRequestForm(null, r.me.adult) : requestLimitMsg());
        fin(renderRequests(r));
      });
      if (rt.name === 'request' || rt.name === 'requestEdit') return api('requestGet', { requestId: rt.id }).then(function (r) {
        if (r.stale) return; if (!r.ok) return fin(r.error === 'network' || r.error === 'server' ? errorWithRetry(r) : blocked(r));
        if (rt.name === 'requestEdit') return fin(r.request.mine ? renderRequestForm(r.request, r.me.adult) : blocked({ error: 'not_available' }));
        fin(renderRequest(r));
      });
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

    /* ---------- requests and pledges (Phase A) ---------- */
    function requestRows(rs) {
      return h('ul', { class: 'gv-rows' }, rs.map(function (q) {
        var meta = q.kindLabel + ' · ' + (q.status === 'closed' ? 'Closed' : q.stillNeeded ? q.stillNeeded + ' still needed' : 'Everyone needed has pledged') + (q.neededBy ? ' · by ' + q.neededBy : '');
        return h('li', null, h('a', { class: 'gv-row', href: '#/giving/requests/' + q.id, 'data-request': q.id },
          h('strong', { text: q.title }), h('span', { class: 'muted', text: (q.mine ? 'Yours' : q.ownerName) + ' · ' + meta }),
          q.approval === 'pending' ? badge('Waiting for approval', 'is-warn') : null, q.audience === 'adults' ? badge('Adults only', 'is-adults') : null));
      }));
    }
    function renderRequests(r) {
      var page = h('div', { class: 'gv-page' }, backLink('#/giving', 'Back to Giving Center'));
      page.appendChild(h('div', { class: 'gv-head' }, h('h1', { text: 'Family requests', 'data-focus': '' }), r.canCreate ? h('a', { class: 'btn small', href: '#/giving/requests/new', id: 'gv-newrequest', text: 'New request' }) : null));
      page.appendChild(h('p', { class: 'muted', text: 'Ask for something specific and let family members pledge to help. Nothing is paid or bought through Family Circle. If money is involved, people sort it out themselves and you confirm.' }));
      if (!r.me.adult) page.appendChild(h('p', { class: 'hint', id: 'gv-kidreq', text: 'You can ask for help. An adult looks at your request before the family sees it. Pledging to help is for adults.' }));
      if (r.canModerate && r.waiting.length) { page.appendChild(h('h2', { class: 'gv-sub', text: 'Waiting for your approval' })); page.appendChild(requestRows(r.waiting)); }
      page.appendChild(h('h2', { class: 'gv-sub', text: 'Open requests' }));
      if (!r.open.length) page.appendChild(h('p', { class: 'muted', id: 'gv-noreq', text: 'No open requests right now.' })); else page.appendChild(requestRows(r.open));
      if (r.closed.length) { page.appendChild(h('h2', { class: 'gv-sub', text: 'Closed' })); page.appendChild(requestRows(r.closed)); }
      return page;
    }
    function requestLimitMsg() { return h('section', { class: 'card' }, h('h1', { text: 'New request', 'data-focus': '' }), h('p', { text: 'You have ' + C.REQ.open + ' open requests, which is the limit. Close one to add another.' }), h('a', { class: 'btn secondary', href: '#/giving/requests', text: 'Back to requests' })); }
    function renderRequestForm(existing, adult) {
      var f = {};
      f.title = h('input', { type: 'text', id: 'gv-rtitle', autocomplete: 'off', value: existing ? existing.title : '' });
      f.kind = h('select', { id: 'gv-rkind' }, Object.keys(C.REQUEST_KINDS).map(function (k) { return h('option', { value: k, text: C.REQUEST_KINDS[k], selected: (existing ? existing.kind : 'thing') === k }); }));
      f.details = h('textarea', { id: 'gv-rdetails', rows: 4, placeholder: 'For example: where, when, what size, what would help most' }); f.details.value = existing ? existing.details : '';
      f.needed = h('input', { type: 'number', id: 'gv-rneeded', min: 1, max: C.REQ.needed, inputmode: 'numeric', value: existing ? existing.needed : 1 });
      f.by = h('input', { type: 'date', id: 'gv-rby', value: existing ? existing.neededBy : '' });
      f.amount = h('input', { type: 'text', id: 'gv-ramount', autocomplete: 'off', placeholder: 'For example: about $40 (optional)', value: existing ? existing.amount : '' });
      f.audience = adult ? h('select', { id: 'gv-raudience' }, Object.keys(C.AUDIENCES).map(function (k) { return h('option', { value: k, text: C.AUDIENCES[k], selected: (existing ? existing.audience : 'everyone') === k }); })) : null;
      var ids = { title: 'gv-rtitle', kind: 'gv-rkind', details: 'gv-rdetails', needed: 'gv-rneeded', neededBy: 'gv-rby', amount: 'gv-ramount' };
      var msg = h('p', { class: 'ev-formmsg gv-formmsg', role: 'alert' });
      var form = h('form', { class: 'card gv-form', novalidate: '', onsubmit: function (e) {
        e.preventDefault(); msg.textContent = ''; Object.keys(ids).forEach(function (k) { setErr(ids[k], ''); });
        api('requestSave', { requestId: existing && existing.id, title: f.title.value, kind: f.kind.value, details: f.details.value, needed: f.needed.value, neededBy: f.by.value, amount: f.amount.value, audience: f.audience ? f.audience.value : 'everyone' }).then(function (r) {
          if (r.stale) return;
          if (!r.ok) { var first = null; Object.keys(r.fields || {}).forEach(function (k) { setErr(ids[k], r.fields[k]); if (!first) first = document.getElementById(ids[k]); }); msg.textContent = r.message; if (first) first.focus(); return; }
          toast(r.waitingForApproval || (r.request && r.request.approval === 'pending') ? 'Saved. An adult will look at it before the family sees it.' : 'Request saved.'); go('#/giving/requests/' + r.request.id);
        });
      } }, h('h1', { text: existing ? 'Edit request' : 'New request', 'data-focus': '' }),
        field('gv-rtitle', 'What do you need?', f.title, '', 'A short title, up to ' + C.REQ.title + ' characters.'),
        field('gv-rkind', 'It is', f.kind), field('gv-rdetails', 'Details (optional)', f.details),
        field('gv-rneeded', 'How many helpers or items', f.needed), field('gv-rby', 'Needed by (optional)', f.by),
        field('gv-ramount', 'Money, if any (optional)', f.amount, '', 'Plain text for reference only. Family Circle never collects or sends money.'),
        f.audience ? field('gv-raudience', 'Who can see it', f.audience, '', 'Adults only keeps it from kids, for example a gift for a child.') : h('p', { class: 'hint', text: 'An adult will look at your request before the family sees it.' }), msg,
        h('div', { class: 'gv-actions' }, h('button', { type: 'submit', class: 'btn', id: 'gv-rsave', text: 'Save request' }), h('a', { class: 'btn secondary', href: existing ? '#/giving/requests/' + existing.id : '#/giving/requests', text: 'Cancel' })));
      return h('div', { class: 'gv-page' }, backLink(existing ? '#/giving/requests/' + existing.id : '#/giving/requests', 'Back'), form);
    }
    function renderRequest(r) {
      var q = r.request, page = h('div', { class: 'gv-page' }, backLink('#/giving/requests', 'Back to requests'));
      page.appendChild(h('div', { class: 'gv-head' }, h('h1', { text: q.title, 'data-focus': '' })));
      page.appendChild(h('p', { class: 'gv-badges' }, badge(q.kindLabel, ''), q.status === 'closed' ? badge('Closed', 'is-done') : null, q.approval === 'pending' ? badge('Waiting for approval', 'is-warn') : null, q.audience === 'adults' ? badge('Adults only', 'is-adults') : null));
      page.appendChild(h('p', { class: 'muted', text: (q.mine ? 'Your request' : 'Asked by ' + q.ownerName) + (q.neededBy ? ' · needed by ' + q.neededBy : '') }));
      if (q.details) page.appendChild(h('p', { class: 'gv-notes', text: q.details }));
      if (q.amount) page.appendChild(h('p', { class: 'muted', id: 'gv-ramounttext', text: 'Money: ' + q.amount + ' (for reference; handled outside Family Circle)' }));
      page.appendChild(h('p', { id: 'gv-rcount', text: q.pledgedCount + ' of ' + q.needed + ' pledged' + (q.doneCount ? ', ' + q.doneCount + ' done' : '') + (q.stillNeeded ? ' · ' + q.stillNeeded + ' still needed' : '') }));
      if (q.approval === 'pending') {
        if (r.canModerate && !q.mine) {
          page.appendChild(h('div', { class: 'gv-actions' },
            h('button', { type: 'button', class: 'btn', id: 'gv-rapprove', text: 'Approve', onclick: function () { api('requestApprove', { requestId: q.id }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); toast('Approved.'); go('#/giving/requests'); }); } }),
            h('button', { type: 'button', class: 'btn danger', id: 'gv-rreject', text: 'Do not post', onclick: function () { confirmDialog('Do not post this request?', 'It will be removed and the person is told it was not posted.', 'Do not post', function () { api('requestReject', { requestId: q.id }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); toast('Removed.'); go('#/giving/requests'); }); }); } })));
        } else if (q.mine) page.appendChild(h('p', { class: 'hint', id: 'gv-rwait', text: 'An adult will look at this before the family sees it. You can still edit it.' }));
      }
      page.appendChild(h('div', { class: 'gv-errslot' }));
      page.appendChild(h('h2', { class: 'gv-sub', text: 'Pledges' }));
      if (!q.pledges.length) page.appendChild(h('p', { class: 'muted', id: 'gv-nopledge', text: 'No one has pledged yet.' }));
      else page.appendChild(h('ul', { class: 'gv-rows', id: 'gv-pledges' }, q.pledges.map(function (p) {
        return h('li', { class: 'gv-pledge', 'data-pledge': p.id }, h('strong', { text: p.mine ? 'You' : p.name }), p.status === 'done' ? badge('Done', 'is-done') : null,
          p.note ? h('span', { class: 'muted', text: p.note }) : null,
          q.mine ? h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'done', text: p.status === 'done' ? 'Mark as not done' : 'Mark as done', 'aria-label': (p.status === 'done' ? 'Mark as not done: ' : 'Mark as done: ') + p.name,
            onclick: function () { api('pledgeDone', { pledgeId: p.id, done: p.status !== 'done' }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); render(); }); } }) : null,
          p.mine && p.status !== 'done' ? h('button', { type: 'button', class: 'btn ghost small', 'data-act': 'withdraw', text: 'Withdraw', 'aria-label': 'Withdraw your pledge',
            onclick: function () { api('pledgeWithdraw', { pledgeId: p.id }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); toast('Pledge withdrawn.'); render(); }); } }) : null);
      })));
      if (!q.mine && q.approval === 'approved' && q.status === 'open') {
        if (!r.me.adult) page.appendChild(h('p', { class: 'hint', id: 'gv-kidpledge', text: 'Pledging to help is for adults.' }));
        else {
          var note = h('textarea', { id: 'gv-pnote', rows: 2, placeholder: 'For example: I can come after 10, or I will bring the van' });
          var mineP = q.pledges.filter(function (p) { return p.mine; })[0]; if (mineP) note.value = mineP.note;
          var pm = h('p', { class: 'ev-formmsg gv-formmsg', role: 'alert' });
          page.appendChild(h('form', { class: 'card gv-form', id: 'gv-pledgeform', novalidate: '', onsubmit: function (e) {
            e.preventDefault(); pm.textContent = ''; setErr('gv-pnote', '');
            api('pledgeSave', { requestId: q.id, note: note.value }).then(function (x) { if (x.stale) return; if (!x.ok) { if (x.fields && x.fields.note) setErr('gv-pnote', x.fields.note); pm.textContent = x.message; return; } toast(mineP ? 'Pledge updated.' : 'Thank you for pledging.'); render(); });
          } }, h('h2', { class: 'gv-sub', text: mineP ? 'Your pledge' : 'Pledge to help' }), field('gv-pnote', 'A short note (optional)', note), pm,
            h('div', { class: 'gv-actions' }, h('button', { type: 'submit', class: 'btn', id: 'gv-pledge', text: mineP ? 'Update pledge' : 'I will help' }))));
        }
      }
      var acts = h('div', { class: 'gv-actions' });
      if (q.mine) {
        acts.appendChild(h('a', { class: 'btn secondary small', href: '#/giving/requests/' + q.id + '/edit', 'data-act': 'edit', text: 'Edit' }));
        if (q.approval === 'approved') acts.appendChild(h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'close', text: q.status === 'open' ? 'Close request' : 'Reopen request',
          onclick: function () { api('requestClose', { requestId: q.id, reopen: q.status !== 'open' }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); toast(q.status === 'open' ? 'Closed.' : 'Reopened.'); render(); }); } }));
        acts.appendChild(h('button', { type: 'button', class: 'btn danger small', 'data-act': 'delete', text: 'Delete', 'aria-label': 'Delete ' + q.title,
          onclick: function () { confirmDialog('Delete this request?', '“' + q.title + '” will be removed and anyone who pledged is told.', 'Delete request', function () { api('requestDelete', { requestId: q.id }).then(function (x) { if (x.stale) return; if (!x.ok) return showErr(x); toast('Request deleted.'); go('#/giving/requests'); }); }); } }));
      } else if (q.approval === 'approved') acts.appendChild(h('button', { type: 'button', class: 'btn ghost small', 'data-act': 'report', text: 'Report', 'aria-label': 'Report: ' + q.title, onclick: function () { reportDialog('request', q.id, q.title); } }));
      if (acts.childNodes.length) page.appendChild(acts);
      return page;
    }
    function limitMsg() { return h('section', { class: 'card' }, h('h1', { text: 'New wishlist', 'data-focus': '' }), h('p', { text: 'You have reached the limit of ' + C.LIMITS.lists + ' wishlists. Delete one to add another.' }), h('a', { class: 'btn secondary', href: '#/giving', text: 'Back' })); }
    function errorWithRetry(r) { return h('section', { class: 'card' }, h('h1', { text: 'Giving Center', 'data-focus': '' }), errorBox(r), h('button', { type: 'button', class: 'btn', id: 'gv-retry', text: 'Try again', onclick: function () { render(); } })); }
    function refresh() {
      var y = window.scrollY; var rt = route(), mineToken = ++token;
      if (/^request/.test(rt.name)) return render();
      var redo = rt.name === 'home' ? api('home') : api('listGet', { listId: rt.id });
      return redo.then(function (r) {
        if (r.stale || mineToken !== token) return;
        if (!r.ok) { if (rt.name !== 'home') { main.textContent = ''; main.appendChild(blocked(r)); } return; }
        main.removeAttribute('aria-busy');
        var node = rt.name === 'home' ? renderHome(r) : renderList(r, rt.id);
        main.textContent = ''; main.appendChild(node); window.scrollTo(0, y);
        if (real && rt.name === 'home') api('status').then(function (s) { if (s.stale || mineToken !== token || !s.ok || !s.canTurnOn || !node.isConnected) return; node.appendChild(ownerSwitchPanel()); });
      });
    }
    if (real) { render(); return { state: st, render: render, refresh: refresh, destroy: function () { token++; st.gen++; } }; }
    window.addEventListener('hashchange', render);
    drawControls(); render();
    return { state: st, render: render, refresh: refresh };
  }
  root.GivingUI = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
