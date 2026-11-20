/* Release check: tells people when a newer published version of Family Circle exists, and updates only when they say so.
 *
 * How it works (details in UPDATE-GUIDE.md):
 *  - Every published release has an id that comes from its own files (tools/stamp-release.js). The running page carries it in <meta name="fc-release">;
 *    the published copy is in release.json. Ids are compared for equality only, never as ordered version numbers, so a rollback counts as an update too.
 *  - release.json is fetched with cache "no-store" and a throwaway query, so neither the browser cache nor any future service worker can answer it.
 *  - A newer id is announced only after the published index.html for that id is confirmed to carry the same id, so a half-finished deploy never shows a notice.
 *  - Errors, offline and invalid answers are silent: they never announce anything and only slow the next check down.
 *  - Nothing reloads by itself. "Update now" asks first when there is unsaved work, then loads the page again with a cache-busting ?r=<id>, and the new page
 *    checks that it really is that release. If it is not, it says so and offers Try again once per tap, so there is no reload loop.
 *  - No service worker, no storage, no notification permission, no tracking: the only request is a GET of two files from this site. */
(function () {
  'use strict';
  var ID_RE = /^[a-f0-9]{16}$/;
  var meta = document.querySelector('meta[name="fc-release"]');
  var RUNNING = meta && ID_RE.test(meta.getAttribute('content') || '') ? meta.getAttribute('content') : null;
  var T = window.__FC_RELEASE_CFG || {};
  var CFG = { periodMs: T.periodMs || 5 * 60 * 1000, minGapMs: T.minGapMs !== undefined ? T.minGapMs : 30 * 1000, timeoutMs: T.timeoutMs || 8000, maxBackoffMs: T.maxBackoffMs || 30 * 60 * 1000, baseBackoffMs: T.baseBackoffMs || 60 * 1000 };

  /* A page opened by "Update now" carries ?r=<target>. Remember it, then remove it from the address bar. */
  var attempt = null;
  try {
    var u0 = new URL(location.href), r0 = u0.searchParams.get('r');
    if (r0 !== null) { attempt = ID_RE.test(r0) ? r0 : null; u0.searchParams.delete('r'); u0.searchParams.delete('n'); history.replaceState(history.state, '', u0.pathname + (u0.search || '') + u0.hash); }
  } catch (e) { /* leave the address alone */ }

  var hooks = { confirm: null, toast: null };
  var published = null, lastStart = 0, failures = 0, inflight = null, mode = 'hidden', failed = false, busy = false, announced = null;
  var unsavedFns = {}, edited = (typeof WeakSet === 'function') ? new WeakSet() : null, ui = null;

  /* ---------- unsaved work ---------- */
  var TEXTY = /^(text|email|url|tel|number|password|date|time|datetime-local)$/;
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!edited || !e.isTrusted || !el || el.nodeType !== 1) return;
    var tag = el.tagName;
    if ((tag === 'INPUT' && TEXTY.test(el.type)) || tag === 'TEXTAREA' || el.isContentEditable) { if (!el.hasAttribute('data-no-dirty')) edited.add(el); }
  }, true);
  function hasUnsaved() {
    var k;
    for (k in unsavedFns) { try { if (unsavedFns[k]()) return true; } catch (e) { return true; } }
    var fields = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!edited || !edited.has(el) || el.disabled) continue;
      var v = el.isContentEditable ? el.textContent : el.value;
      if (v && String(v).trim() !== '' && v !== el.defaultValue) return true;
    }
    return false;
  }
  function registerUnsaved(name, fn) { unsavedFns[name] = fn; }

  /* ---------- checking ---------- */
  var url = function (file, extra) { return new URL(file, document.baseURI).href.split('#')[0] + (extra || ''); };
  function getText(href) {
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, CFG.timeoutMs) : null;
    return fetch(href, { cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (!res.ok) throw new Error('status');
      return res.text();
    }).then(function (t) { clearTimeout(timer); if (t.length > 2000000) throw new Error('size'); return t; }, function (e) { clearTimeout(timer); throw e; });
  }
  function allowed(reason, now) {
    if (reason === 'start' || reason === 'online' || reason === 'force') return true;
    var gap = reason === 'periodic' ? Math.max(CFG.minGapMs, failures ? Math.min(CFG.maxBackoffMs, CFG.baseBackoffMs * Math.pow(2, failures - 1)) : 0) : CFG.minGapMs;
    return now - lastStart >= gap;
  }
  function check(reason) {
    if (!RUNNING) return Promise.resolve('disabled');
    if (inflight) return inflight;
    if (navigator.onLine === false) return Promise.resolve('offline');
    var now = Date.now();
    if (!allowed(reason, now)) return Promise.resolve('throttled');
    lastStart = now;
    var cb = '?cb=' + now + Math.floor(Math.random() * 1e6).toString(36);
    inflight = getText(url('release.json', cb)).then(function (text) {
      var j; try { j = JSON.parse(text); } catch (e) { throw new Error('json'); }
      if (!j || j.schema !== 1 || typeof j.id !== 'string' || !ID_RE.test(j.id) || j.entry !== 'index.html') throw new Error('shape');
      if (j.id === RUNNING) return { id: j.id, same: true };
      /* Different release: only believe it once its own page is live and carries that id. */
      return getText(url('index.html', '?r=' + j.id + '&cb=' + now)).then(function (html) {
        var m = /<meta name="fc-release" content="([a-f0-9]{16})">/.exec(html);
        if (!m || m[1] !== j.id) throw new Error('not live');
        return { id: j.id, same: false };
      });
    }).then(function (r) {
      failures = 0; published = r.id; settle(r); return r.same ? 'same' : 'newer';
    }, function () {
      failures++; if (attempt && attempt !== RUNNING) { attempt = null; showFailure(); } return 'error';
    }).then(function (s) { inflight = null; return s; });
    return inflight;
  }
  function settle(r) {
    if (attempt) { var a = attempt; attempt = null; if (r.same) { if (hooks.toast) hooks.toast('Family Circle is up to date.'); } else if (a !== RUNNING) { showFailure(); return; } }
    if (r.same) { setMode('hidden'); announced = null; return; }
    failed = false;
    if (announced !== r.id) { announced = r.id; setMode('banner'); say('Update available. A new version of Family Circle is ready.'); }
    else render();
  }

  /* ---------- notice ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function build() {
    if (ui) return ui;
    var box = el('div', 'fc-update'); box.id = 'fc-update'; box.hidden = true; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Update available');
    var title = el('p', 'fc-update-title', 'Update available'), msg = el('p', 'fc-update-msg');
    var row = el('div', 'fc-update-actions');
    var now = el('button', 'btn small', 'Update now'); now.type = 'button'; now.id = 'fc-update-now';
    var later = el('button', 'btn small secondary', 'Later'); later.type = 'button'; later.id = 'fc-update-later';
    row.appendChild(now); row.appendChild(later); box.appendChild(title); box.appendChild(msg); box.appendChild(row);
    var pill = el('button', 'fc-update-pill btn small secondary', 'Update available'); pill.type = 'button'; pill.id = 'fc-update-pill'; pill.hidden = true; pill.setAttribute('aria-label', 'Update available. Show update options.');
    var live = el('p', 'fc-update-live'); live.id = 'fc-update-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    now.addEventListener('click', function () { accept(); });
    later.addEventListener('click', function () { var hadFocus = box.contains(document.activeElement); setMode('pill'); if (hadFocus) pill.focus(); });
    pill.addEventListener('click', function () { setMode('banner'); now.focus(); });
    document.body.appendChild(box); document.body.appendChild(pill); document.body.appendChild(live);
    ui = { box: box, title: title, msg: msg, now: now, later: later, pill: pill, live: live };
    return ui;
  }
  function say(t) { build().live.textContent = ''; setTimeout(function () { if (ui) ui.live.textContent = t; }, 50); }
  function setMode(m) { mode = m; if (m === 'hidden' && !ui) return; render(); }
  function render() {
    if (mode === 'hidden' && !ui) return;
    var u = build();
    u.box.hidden = mode !== 'banner'; u.pill.hidden = mode !== 'pill';
    u.pill.textContent = failed ? 'Update did not load' : 'Update available';
    u.title.textContent = failed ? 'The update did not load' : 'Update available';
    u.msg.textContent = failed ? 'The new version is not reachable yet, so you are still on the old one. Nothing was lost. Try again in a moment.' : 'A new version of FamilyCircle is ready. Update to get the latest changes.';
    u.now.textContent = busy ? 'Updating…' : failed ? 'Try again' : 'Update now'; u.now.disabled = busy;
    if (mode === 'hidden') { u.box.hidden = true; u.pill.hidden = true; }
  }
  function showFailure() { failed = true; announced = announced || 'x'; setMode('banner'); say('The update did not load. You are still on the old version.'); }

  /* ---------- accepting ---------- */
  function ask() {
    var title = 'Update with unsaved changes?', text = 'You have changes that are not saved yet. Updating reloads the page and they will be lost. You can press Cancel, finish what you are doing, and update later.';
    if (hooks.confirm) return Promise.resolve(hooks.confirm(title, text, 'Update anyway'));
    return Promise.resolve(window.confirm(title + '\n\n' + text));
  }
  function accept() {
    if (busy) return;
    var go = function () {
      return check('force').then(function () {
        if (!published || published === RUNNING) { setMode('hidden'); return; }    /* it was rolled back to what is running, nothing to do */
        busy = true; render();
        var u = new URL(location.href); u.searchParams.set('r', published); u.searchParams.set('n', String(Date.now()));
        location.replace(u.toString());
      });
    };
    if (hasUnsaved()) return ask().then(function (ok) { if (ok) return go(); });
    return go();
  }

  /* ---------- triggers ---------- */
  function start() {
    if (!RUNNING) return;
    if (attempt === RUNNING) { attempt = null; if (hooks.toast) setTimeout(function () { hooks.toast('Family Circle is up to date.'); }, 800); }
    check('start');
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check('visible'); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) check('visible'); });
    window.addEventListener('online', function () { check('online'); });
    setInterval(function () { if (document.visibilityState === 'visible') check('periodic'); }, CFG.periodMs);
  }
  window.FCRelease = {
    running: RUNNING,
    published: function () { return published; },
    check: check, registerUnsaved: registerUnsaved, hasUnsaved: hasUnsaved,
    attach: function (h) { hooks.confirm = h.confirm || null; hooks.toast = h.toast || null; },
    state: function () { return { running: RUNNING, published: published, mode: mode, failed: failed, failures: failures }; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
