/*
  @mentions for Family Circle
  Copyright (C) 2026 Leia
  GNU General Public License v3 or later (see LICENSE-GPL-3.0.txt).

  Typing @ in a comment or a chat message opens a list of the people in this family. Picking one writes @Name into the
  text. In comments and messages, a name that matches someone in the family is shown highlighted, and the people named are
  listed in Activity. Nothing is stored beyond the text itself: the mention IS the text, so no database change is needed.
  Installed by app.js with FCMentions.install({ S, h, avatarEl }).
*/
(function () {
  'use strict';
  var X = null;

  function install(x) { X = x; }

  // Everyone in the family I am looking at: { userId, name } with the full name, plus each first name that is unique.
  function people() {
    var out = [];
    if (!X || !X.S || !X.S.profiles) return out;
    X.S.profiles.forEach(function (p, id) { if (p && p.displayName) out.push({ userId: p.userId || id, name: String(p.displayName).trim(), profile: p }); });
    return out;
  }
  function keys() {
    var ppl = people(), keys = [], firsts = {};
    ppl.forEach(function (p) { var f = p.name.split(/\s+/)[0].toLowerCase(); firsts[f] = (firsts[f] || 0) + 1; });
    ppl.forEach(function (p) {
      keys.push({ k: p.name.toLowerCase(), userId: p.userId });
      var f = p.name.split(/\s+/)[0].toLowerCase();
      if (f !== p.name.toLowerCase() && firsts[f] === 1) keys.push({ k: f, userId: p.userId });   // "@Sam" is enough when only one Sam is in the family
    });
    keys.sort(function (a, b) { return b.k.length - a.k.length; });   // longest first, so "@Ann Marie" wins over "@Ann"
    return keys;
  }
  var WORD = /[\p{L}\p{N}_]/u;

  /** Splits text into [{ t: 'plain text' } | { m: 'matched @text', userId }] */
  function parse(text) {
    text = String(text || '');
    var out = [], ks = null, last = 0, i = text.indexOf('@');
    while (i !== -1) {
      var before = i === 0 ? ' ' : text.charAt(i - 1);
      if (!WORD.test(before)) {
        if (!ks) ks = keys();
        var rest = text.slice(i + 1).toLowerCase(), hit = null;
        for (var j = 0; j < ks.length; j++) {
          var k = ks[j].k;
          if (rest.indexOf(k) === 0 && !WORD.test(rest.charAt(k.length) || ' ')) { hit = ks[j]; break; }
        }
        if (hit) {
          if (i > last) out.push({ t: text.slice(last, i) });
          out.push({ m: text.slice(i, i + 1 + hit.k.length), userId: hit.userId });
          last = i + 1 + hit.k.length;
        }
      }
      i = text.indexOf('@', i + 1);
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }
  /** The userIds named in a text. */
  function ids(text) { var s = {}; parse(text).forEach(function (p) { if (p.userId) s[p.userId] = 1; }); return Object.keys(s); }
  function mentionsMe(text) { var me = X && X.S && X.S.user && X.S.user.$id; return !!me && ids(text).indexOf(me) !== -1; }

  /** A fragment for the plain (non-link) part of a text, with people's names highlighted. */
  function nodes(text) {
    var frag = document.createDocumentFragment(), me = X && X.S && X.S.user && X.S.user.$id;
    parse(text).forEach(function (p) {
      if (p.m) {
        var s = document.createElement('span');
        s.className = 'mention' + (p.userId === me ? ' mention-me' : '');
        s.textContent = p.m; s.setAttribute('data-uid', p.userId);
        frag.appendChild(s);
      } else frag.appendChild(document.createTextNode(p.t));
    });
    return frag;
  }

  /** Adds the pick-a-person list to a text box. */
  function attach(ta) {
    if (!ta || ta.__mentions) return;
    ta.__mentions = true;
    var list = document.createElement('ul'), shown = [], sel = 0, open = false, at = -1;
    list.className = 'mention-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'People in this family'); list.hidden = true;
    ta.setAttribute('aria-autocomplete', 'list');
    // A text box cannot colour part of its own text, so people already named show as highlighted chips just above it.
    var chips = document.createElement('div'); chips.className = 'mention-chips'; chips.setAttribute('aria-hidden', 'true'); chips.hidden = true;

    function chipsOff() { chips.hidden = true; if (chips.parentNode) chips.parentNode.removeChild(chips); }
    function chipsUpdate() {
      if (open) return chipsOff();
      var seen = {}, found = parse(ta.value).filter(function (p) { if (!p.m || seen[p.userId]) return false; seen[p.userId] = 1; return true; });
      if (!found.length) return chipsOff();
      while (chips.firstChild) chips.removeChild(chips.firstChild);
      var lab = document.createElement('span'); lab.className = 'mention-chips-lab'; lab.textContent = 'Mentioning'; chips.appendChild(lab);
      found.forEach(function (p) { var c = document.createElement('span'); c.className = 'mention'; c.textContent = p.m; chips.appendChild(c); });
      if (!chips.parentNode) document.body.appendChild(chips);
      chips.hidden = false;
      var r = ta.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      chips.style.left = Math.max(8, Math.min(r.left, vw - 120)) + 'px';
      chips.style.maxWidth = Math.min(360, vw - 16) + 'px';
      chips.style.top = Math.max(8, r.top - chips.offsetHeight - 6) + 'px';
    }
    function close() { open = false; list.hidden = true; if (list.parentNode) list.parentNode.removeChild(list); ta.removeAttribute('aria-activedescendant'); chipsUpdate(); }
    function place() {
      var r = ta.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      var w = Math.min(320, vw - 16);
      list.style.width = w + 'px';
      list.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
      var hgt = list.offsetHeight, top = r.top - hgt - 6;
      if (top < 8) top = Math.min(r.bottom + 6, window.innerHeight - hgt - 8);   // no room above: go below
      list.style.top = Math.max(8, top) + 'px';
    }
    function paint() {
      while (list.firstChild) list.removeChild(list.firstChild);
      shown.forEach(function (p, n) {
        var li = document.createElement('li');
        li.className = 'mention-opt' + (n === sel ? ' on' : ''); li.setAttribute('role', 'option'); li.id = 'mo-' + n; li.setAttribute('aria-selected', n === sel ? 'true' : 'false');
        if (X && X.avatarEl) { var av = X.avatarEl(p.profile); if (av) li.appendChild(av); }
        var nm = document.createElement('span'); nm.className = 'mention-name'; nm.textContent = p.name; li.appendChild(nm);
        li.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });   // keep the keyboard open
        li.addEventListener('click', function (ev) { ev.preventDefault(); pick(n); });
        list.appendChild(li);
      });
      ta.setAttribute('aria-activedescendant', 'mo-' + sel);
      var on = list.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    function query() {
      var pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
      var before = ta.value.slice(0, pos), m = /(^|[^\p{L}\p{N}_])@([^@\n]{0,40})$/u.exec(before);
      if (!m) return null;
      return { q: m[2].toLowerCase(), start: pos - m[2].length - 1, end: pos };
    }
    function update() {
      var q = query();
      if (!q) return close();
      var me = X && X.S && X.S.user && X.S.user.$id;
      shown = people().filter(function (p) { return p.userId !== me && p.name.toLowerCase().indexOf(q.q) === 0; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, 6);
      if (!shown.length) return close();
      at = q.start; sel = Math.min(sel, shown.length - 1);
      if (!open) { open = true; chipsOff(); document.body.appendChild(list); list.hidden = false; }
      paint(); place();
    }
    function pick(n) {
      var p = shown[n], q = query(); if (!p || !q) return close();
      var ins = '@' + p.name + ' ';
      if (ta.maxLength > 0 && ta.value.length - (q.end - q.start) + ins.length > ta.maxLength) { close(); return; }
      ta.value = ta.value.slice(0, q.start) + ins + ta.value.slice(q.end);
      var c = q.start + ins.length; ta.focus(); try { ta.setSelectionRange(c, c); } catch (e) { /* ignore */ }
      sel = 0; close();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.addEventListener('input', function () { sel = 0; update(); chipsUpdate(); });
    ta.addEventListener('click', update);
    ta.addEventListener('keyup', function (ev) { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home' || ev.key === 'End') update(); });
    ta.addEventListener('blur', function () { setTimeout(function () { close(); chipsOff(); }, 150); });
    ta.addEventListener('focus', chipsUpdate);
    ta.addEventListener('keydown', function (ev) {
      if (!open) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopImmediatePropagation(); sel = (sel + 1) % shown.length; paint(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopImmediatePropagation(); sel = (sel - 1 + shown.length) % shown.length; paint(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopImmediatePropagation(); pick(sel); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); }
    }, true);
    window.addEventListener('resize', function () { if (open) place(); else if (!chips.hidden) chipsUpdate(); });
    window.addEventListener('scroll', function () { if (open) place(); else if (!chips.hidden) chipsUpdate(); }, true);
  }

  window.FCMentions = { install: install, attach: attach, nodes: nodes, parse: parse, ids: ids, mentionsMe: mentionsMe };
})();
