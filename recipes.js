/*
  Recipes for Family Circle
  Copyright (C) 2026 Leia

  Adapted from The Family Recipe Book in the ZenfulOutput project (also by Leia).
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  The license text is in LICENSE-GPL-3.0.txt next to this file.

  What this is: the recipe book, built into Family Circle's own pages and look (no frame, no second sign-in).
  It uses the member who is already signed in. Recipes are kept in this browser on this device, under that member's
  id, and are never sent anywhere. The original book's own login, online sync, AI helper and outside recipe feed are not part of this.
  The scaling, timer and backup logic comes from the original book.
*/
(function () {
  'use strict';

  function install(X) {
    var h = X.h, icon = X.icon, toast = X.toast;
    var VERSION = 'v2.2.0';
    var PAGE = 24;

    /* ---------- storage: this device, this member ---------- */
    var NS = '';
    var store = {
      get: function (k) { try { return NS ? localStorage.getItem(NS + k) : null; } catch (e) { return null; } },
      set: function (k, v) { try { if (!NS) return false; localStorage.setItem(NS + k, v); return true; } catch (e) { return false; } }
    };
    var R = { uid: '', demo: [], deleted: {}, query: '', cat: '', type: '', onlyFavs: false, page: 1, cur: null, base: 0, target: 0, label: '', f: 1, checked: new Set() };
    var CK = { on: false, i: 0, sheet: false, wl: null, x: 0, y: 0 };
    var TM = { list: [], loop: 0, alarm: 0, AC: null, title: document.title, sig: '' };

    var uuid = function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); };
    var slugify = function (s) { return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe'; };

    /* ---------- starter recipes (made-up family classics, shown only until you add your own) ---------- */
    function seed() {
      return [
        { name: "Grandma's Banana Bread", description: 'The loaf that always sat on the counter under a dish towel. It slices best the next day.', yield: '1 loaf', prep: '10 minutes', cook: '1 hour', total: '1 hour 10 minutes',
          ingredients: ['3 very ripe bananas, mashed', '1/3 cup melted butter', '3/4 cup sugar', '1 egg, beaten', '1 teaspoon vanilla', '1 teaspoon baking soda', '1 pinch of salt', '1 1/2 cups all-purpose flour'],
          steps: ['Heat the oven to 350°F (175°C) and butter a 4x8 inch loaf pan.', 'Mash the bananas in a large bowl, then stir in the melted butter.', 'Mix in the sugar, egg and vanilla.', 'Sprinkle the baking soda and salt over the batter and stir. Add the flour and mix until just combined.', 'Pour into the pan and bake for 55 to 60 minutes, until a toothpick comes out clean.', 'Cool in the pan for 10 minutes, then turn out onto a rack.'],
          categories: ['Baking'], tags: ['Family favorite'], notes: 'Use the spottiest bananas you can find. Wrap the cooled loaf in foil overnight and it cuts without crumbling.' },
        { name: 'Sunday Chicken and Rice Soup', description: 'A big pot for a cold afternoon. It tastes even better the second day.', yield: '6 bowls', prep: '15 minutes', cook: '40 minutes', total: '55 minutes',
          ingredients: ['1 tablespoon olive oil', '1 onion, diced', '2 carrots, sliced', '2 celery stalks, sliced', '3 garlic cloves, minced', '8 cups chicken broth', '1 pound boneless chicken thighs', '3/4 cup long-grain rice', '2 bay leaves', '1 teaspoon salt, plus more to taste', 'Black pepper', 'Juice of half a lemon', 'Chopped parsley'],
          steps: ['Warm the oil in a large pot over medium heat. Cook the onion, carrots and celery for 6 minutes.', 'Stir in the garlic and cook for 1 minute.', 'Add the broth, chicken and bay leaves. Bring to a boil, then lower the heat and simmer for 15 minutes.', 'Stir in the rice and simmer for 15 minutes more, until the rice is tender.', 'Lift out the chicken, shred it, and return it to the pot. Add the lemon juice, salt and pepper, and serve with parsley.'],
          categories: ['Soups'], tags: ['Comfort food'], notes: 'The rice keeps soaking up broth as it sits. Add a splash of water when you reheat it.' },
        { name: 'Buttermilk Pancakes', description: 'Thick, tender pancakes for slow weekend mornings.', yield: '12 pancakes', prep: '10 minutes', cook: '15 minutes', total: '25 minutes',
          ingredients: ['2 cups all-purpose flour', '2 tablespoons sugar', '2 teaspoons baking powder', '1 teaspoon baking soda', '1/2 teaspoon salt', '2 cups buttermilk', '2 eggs', '4 tablespoons melted butter, plus more for the pan', '1 teaspoon vanilla'],
          steps: ['Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.', 'In another bowl, whisk the buttermilk, eggs, melted butter and vanilla.', 'Pour the wet mixture into the dry and stir until just combined. A few lumps are fine.', 'Let the batter rest for 5 minutes while the griddle heats over medium.', 'Butter the griddle and cook 1/4 cup of batter per pancake for 2 to 3 minutes a side, until golden.'],
          categories: ['Breakfast'], tags: [], notes: '' },
        { name: 'Apple Crumble', description: 'Warm apples under a buttery oat topping.', yield: '8 servings', prep: '20 minutes', cook: '45 minutes', total: '1 hour 5 minutes',
          ingredients: ['6 apples, peeled and sliced (about 2 pounds)', '1/4 cup sugar', '1 tablespoon lemon juice', '1 teaspoon cinnamon', '1 cup all-purpose flour', '3/4 cup rolled oats', '1/2 cup brown sugar', '1/2 teaspoon cinnamon', '1/2 cup cold butter, cubed', '1 pinch of salt'],
          steps: ['Heat the oven to 350°F (175°C).', 'Toss the apples with the sugar, lemon juice and cinnamon, then spread them in a 9 inch baking dish.', 'Mix the flour, oats, brown sugar, cinnamon and salt. Rub in the butter with your fingers until the mixture clumps.', 'Scatter the topping over the apples.', 'Bake for 40 to 45 minutes, until the top is golden and the apples are bubbling.'],
          categories: ['Dessert'], tags: ['Fall'], notes: 'A mix of tart and sweet apples gives the best flavor.' }
      ].map(function (r, i) { return Object.assign({}, r, { slug: slugify(r.name), id: 'book-' + i, image: '', source: '', fav: i === 0 }); });
    }

    function persist() {
      var ok = store.set('rb_recipes', JSON.stringify(R.demo)) & store.set('rb_deleted', JSON.stringify(R.deleted));
      if (!ok) toast('This browser would not save that change. It will be gone when you close the page.');
    }
    function boot(uid) {
      if (R.uid === uid && R.booted) return;
      R.uid = uid; NS = 'fcrb:' + uid + ':'; R.booted = true;
      var d = null;
      ['rb_recipes', 'rb_demo'].some(function (k) { try { var x = JSON.parse(store.get(k)); if (Array.isArray(x)) { d = x; return true; } } catch (e) { /* next */ } return false; });
      R.demo = d || seed();
      R.deleted = {};
      try { var x = JSON.parse(store.get('rb_deleted')); if (x && typeof x === 'object') R.deleted = x; } catch (e) { /* none */ }
      if (!d) persist();
      R.query = ''; R.cat = ''; R.type = ''; R.onlyFavs = false; R.page = 1;
      tmLoad();
    }
    function cleanRecipe(r, stamp) {
      var arr = function (x) { return Array.isArray(x) ? x.map(String) : []; };
      return { slug: String(r.slug || slugify(r.name)), id: String(r.id || 'book-' + uuid()), name: String(r.name), description: String(r.description || ''), yield: String(r.yield || ''), prep: String(r.prep || ''), cook: String(r.cook || ''), total: String(r.total || ''),
        ingredients: arr(r.ingredients), steps: arr(r.steps), parts: arr(r.parts), categories: arr(r.categories), tags: arr(r.tags), notes: String(r.notes || ''), source: String(r.source || ''),
        image: /^data:image\//.test(r.image || '') ? r.image : '', fav: !!r.fav, updated: Number(r.updated) || stamp };
    }
    var find = function (slug) { return R.demo.filter(function (x) { return x.slug === slug; })[0] || null; };

    /* ---------- photos ---------- */
    function shrink(file, max) {
      return new Promise(function (res, rej) {
        var img = new Image(), u = URL.createObjectURL(file);
        img.onload = function () {
          var side = Math.min(img.width, img.height), out = Math.min(side, max);   // always a centered square
          var c = document.createElement('canvas'); c.width = out; c.height = out;
          c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out); URL.revokeObjectURL(u);
          c.toBlob(function (b) { b ? res(b) : rej(new Error('image')); }, 'image/jpeg', 0.86);
        };
        img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); };
        img.src = u;
      });
    }
    var toDataURL = function (b) { return new Promise(function (r) { var f = new FileReader(); f.onload = function () { r(f.result); }; f.readAsDataURL(b); }); };
    function photoEl(url, alt) {
      var box = h('div', { class: 'rc-photo' });
      if (url) { var im = h('img', { src: url, alt: alt || '' }); im.addEventListener('error', function () { box.replaceChildren(placeholder()); }); box.appendChild(im); }
      else box.appendChild(placeholder());
      return box;
    }
    function placeholder() { var s = h('span', { class: 'rc-ph', 'aria-hidden': 'true' }, icon('book')); return s; }

    /* ---------- scaling (from the original book) ---------- */
    var FRAC = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
    var NUMSRC = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+[½⅓⅔¼¾⅛⅜⅝⅞]?|[½⅓⅔¼¾⅛⅜⅝⅞])`;
    function parseQty(t) {
      t = t.trim(); var m;
      if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
      if ((m = t.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
      if ((m = t.match(/^(\d*)([½⅓⅔¼¾⅛⅜⅝⅞])$/))) return (+m[1] || 0) + FRAC[m[2]];
      return parseFloat(t);
    }
    var NICE = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'], [1, '']];
    function fmtQty(x) {
      var whole = Math.floor(x + 1e-9), fr = x - whole, best = NICE[0], d = 9;
      NICE.forEach(function (n) { var k = Math.abs(n[0] - fr); if (k < d) { d = k; best = n; } });
      if (best[0] === 1) { whole++; best = NICE[0]; }
      if (!whole && !best[1]) return '1/8';
      return [whole || '', best[1]].filter(Boolean).join(' ');
    }
    function scaleLine(t, f) {
      if (Math.abs(f - 1) < 1e-9) return t;
      var lead = new RegExp(String.raw`^(${NUMSRC})(?:(\s*(?:-|–|to)\s*)(${NUMSRC}))?`);
      var out = t.replace(lead, function (m, a, sep, b) { return fmtQty(parseQty(a) * f) + (b ? sep + fmtQty(parseQty(b) * f) : ''); });
      return out.replace(/\((about|approx\.?|roughly|around)\s+([^)]*)\)/gi, function (m, w, inner) { return '(' + w + ' ' + inner.replace(new RegExp(NUMSRC, 'g'), function (n) { return fmtQty(parseQty(n) * f); }) + ')'; });
    }
    function scaleInit(r) {
      R.checked = new Set(); R.f = 1;
      var y = String(r.yield || ''), m = y.match(/^\s*(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(.*)$/i);
      if (m) { R.base = +m[1]; R.label = m[2].trim() || 'servings'; }
      else if ((m = y.match(/(\d+(?:\.\d+)?)/))) { R.base = +m[1]; R.label = 'servings'; }
      else { R.base = 0; R.label = ''; }
      R.target = R.base;
    }

    /* ---------- meals made of other recipes ---------- */
    var partsOf = function (r) { return (r.parts || []).map(find).filter(Boolean); };
    var isMeal = function (r) { return partsOf(r).length > 0; };
    function allParts(r, seen, out) {
      seen = seen || new Set([r.slug]); out = out || [];
      (r.parts || []).forEach(function (sl) { if (seen.has(sl)) return; var p = find(sl); if (!p) return; seen.add(sl); allParts(p, seen, out); out.push(p); });
      return out;
    }
    var usedIn = function (r) { return R.demo.filter(function (x) { return x.slug !== r.slug && (x.parts || []).indexOf(r.slug) >= 0; }); };
    function ingItems(r) {
      var o = r.ingredients.map(function (t, i) { return { k: 'o' + i, t: t, g: '' }; });
      allParts(r).forEach(function (p, pi) { p.ingredients.forEach(function (t, i) { o.push({ k: 'p' + pi + '-' + i, t: t, g: p.name }); }); });
      return o;
    }
    function stepItems(r) {
      var o = [];
      allParts(r).forEach(function (p) { p.steps.forEach(function (t) { o.push({ t: t, from: p.name }); }); });
      r.steps.forEach(function (t) { o.push({ t: t, from: '' }); });
      return o;
    }

    /* ---------- timers in steps ---------- */
    var UNITRE = '(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)';
    var DURRE = new RegExp('(\\d+(?:\\.\\d+)?)(?:\\s*(?:to|-|–)\\s*(\\d+(?:\\.\\d+)?))?\\s*(' + UNITRE + ')\\b(?:(?:\\s*(?:and|,)?\\s*)(\\d+(?:\\.\\d+)?)\\s*(' + UNITRE + ')\\b)?', 'gi');
    var unitMul = function (u) { return /^h/i.test(u) ? 3600 : /^m/i.test(u) ? 60 : 1; };
    var durSec = function (n, u, n2, u2) { return Math.round(n * unitMul(u) + (n2 ? n2 * unitMul(u2) : 0)); };
    // A step as DOM: plain text with a tappable button on every time it mentions ("15 minutes").
    function stepNode(t) {
      var frag = document.createDocumentFragment(), last = 0, m;
      DURRE.lastIndex = 0;
      while ((m = DURRE.exec(t))) {
        if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
        (function (txt, sec) {
          frag.appendChild(h('button', { type: 'button', class: 'rc-dur', title: 'Start a timer', 'aria-label': 'Start a timer for ' + txt, onclick: function () { tmStart(sec, txt); } }, txt));
        })(m[0], durSec(+m[1], m[3], m[4] && +m[4], m[5]));
        last = m.index + m[0].length;
      }
      if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
      return frag;
    }
    var fmtClock = function (s) { s = Math.max(0, Math.ceil(s)); var hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), x = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(x).padStart(2, '0'); };
    var fmtDur = function (sec) { return sec >= 3600 ? (Math.round(sec / 360) / 10) + ' hr' : (Math.round(sec / 6) / 10) + ' min'; };
    function tmSave() { store.set('rb_timers', JSON.stringify(TM.list.filter(function (t) { return t.state !== 'done'; }))); }
    function tmLoad() {
      TM.list = [];
      try {
        var a = JSON.parse(store.get('rb_timers'));
        if (Array.isArray(a)) TM.list = a.filter(function (t) { return t && t.id && ((t.state === 'run' && Number(t.end) > 0) || (t.state === 'pause' && Number(t.left) >= 0)); });
      } catch (e) { /* none */ }
      if (TM.list.length) { tmRender(); ensureLoop(); }
    }
    function ensureLoop() { if (!TM.loop) TM.loop = setInterval(tmTick, 250); }
    function beep() {
      try {
        TM.AC = TM.AC || new (window.AudioContext || window.webkitAudioContext)();
        var ac = TM.AC; if (ac.resume) ac.resume();
        var t = ac.currentTime;
        [0, 0.35, 0.7].forEach(function (d) {
          var o = ac.createOscillator(), g = ac.createGain();
          o.type = 'sine'; o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
          o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 0.32);
        });
      } catch (e) { /* no sound on this device */ }
    }
    function alarmStart() {
      if (TM.alarm) return;
      var n = 0;
      var go = function () { beep(); try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) { /* none */ } if (++n >= 20) alarmStop(); };
      go(); TM.alarm = setInterval(go, 3000);
      document.title = 'Timer done · ' + TM.title;
    }
    function alarmStop() { clearInterval(TM.alarm); TM.alarm = 0; document.title = TM.title; }
    function tmStart(sec, label) {
      if (!(sec > 0)) return;
      try { TM.AC = TM.AC || new (window.AudioContext || window.webkitAudioContext)(); if (TM.AC.resume) TM.AC.resume(); } catch (e) { /* none */ }
      TM.list.push({ id: uuid(), label: label || fmtDur(sec), total: sec, end: Date.now() + sec * 1000, state: 'run' });
      tmSave(); ensureLoop(); tmRender();
      toast('Timer started: ' + (label || fmtDur(sec)));
    }
    function tmTick() {
      var now = Date.now(), fired = false;
      TM.list.forEach(function (t) { if (t.state === 'run' && now >= t.end) { t.state = 'done'; fired = true; } });
      if (fired) { tmSave(); alarmStart(); }
      tmRender();
      if (!TM.list.some(function (t) { return t.state === 'run'; })) { clearInterval(TM.loop); TM.loop = 0; }
    }
    function tmTray() {
      var tray = document.getElementById('rc-tray');
      if (!tray && TM.list.length) { tray = h('div', { id: 'rc-tray', class: 'rc-tray', role: 'region', 'aria-label': 'Timers' }); document.body.appendChild(tray); }
      return tray;
    }
    function tmRender() {
      var tray = tmTray(); if (!tray) return;
      var sig = TM.list.map(function (t) { return t.id + t.state; }).join('|');
      if (sig !== TM.sig || !tray.firstChild) {
        TM.sig = sig; tray.replaceChildren();
        TM.list.forEach(function (t) {
          var btns = t.state === 'done'
            ? [h('button', { type: 'button', class: 'btn small', onclick: function () { tmAct('tstop', t.id); } }, 'Dismiss')]
            : [h('button', { type: 'button', class: 'btn secondary small', onclick: function () { tmAct(t.state === 'run' ? 'tpause' : 'tresume', t.id); } }, t.state === 'run' ? 'Pause' : 'Resume'),
               h('button', { type: 'button', class: 'btn secondary small', onclick: function () { tmAct('tstop', t.id); } }, 'Stop')];
          tray.appendChild(h('div', { class: 'rc-tmr ' + t.state, 'data-id': t.id }, h('span', { class: 'rc-tt', 'data-t': '1' }), h('span', { class: 'rc-tl', text: t.label }), h('span', { class: 'rc-tb' }, btns)));
        });
      }
      TM.list.forEach(function (t) {
        var el = tray.querySelector('[data-id="' + t.id + '"] [data-t]');
        if (el) el.textContent = t.state === 'done' ? 'Done!' : fmtClock(t.state === 'run' ? (t.end - Date.now()) / 1000 : t.left);
      });
      if (!TM.list.length) tray.remove();
    }
    function tmAct(a, id) {
      var t = TM.list.filter(function (x) { return x.id === id; })[0]; if (!t) return;
      if (a === 'tpause') { t.left = Math.ceil((t.end - Date.now()) / 1000); t.state = 'pause'; }
      else if (a === 'tresume') { t.end = Date.now() + t.left * 1000; t.state = 'run'; ensureLoop(); }
      else if (a === 'tstop') { TM.list = TM.list.filter(function (x) { return x !== t; }); if (!TM.list.some(function (x) { return x.state === 'done'; })) alarmStop(); }
      tmSave(); tmRender();
    }
    function openTimerDialog() {
      var min = h('input', { id: 'rc-tmin', type: 'number', min: '0.5', step: '0.5', inputmode: 'decimal', value: '10' });
      var lab = h('input', { id: 'rc-tlab', type: 'text', maxlength: '40', placeholder: 'Rice, oven, rest…' });
      var dlg = h('dialog', { 'aria-labelledby': 'rc-tdt' });
      function close() { dlg.close(); dlg.remove(); }
      var form = h('form', { method: 'dialog', onsubmit: function (e) {
        e.preventDefault();
        var m = parseFloat(min.value);
        if (m > 0) { tmStart(Math.round(m * 60), lab.value.trim() || fmtDur(m * 60)); close(); } else toast('Enter how many minutes.');
      } },
      h('h2', { id: 'rc-tdt', text: 'Start a timer' }),
      h('div', { class: 'rc-presets' }, [5, 10, 15, 30, 45, 60].map(function (n) { return h('button', { type: 'button', class: 'chip', onclick: function () { min.value = n; } }, n + ' min'); })),
      h('label', { for: 'rc-tmin', text: 'Minutes' }), min,
      h('label', { for: 'rc-tlab', text: 'What is it for? (optional)' }), lab,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: close }, 'Cancel'), h('button', { type: 'submit', class: 'btn' }, 'Start')));
      dlg.appendChild(form); dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      document.body.appendChild(dlg); dlg.showModal(); min.focus(); min.select();
    }

    /* ---------- cook mode ---------- */
    function wakeOn() { try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (l) { CK.wl = l; }, function () {}); } catch (e) { /* none */ } }
    function wakeOff() { try { if (CK.wl) CK.wl.release(); } catch (e) { /* none */ } CK.wl = null; }
    function cookOpen() {
      var r = R.cur;
      if (!r || !stepItems(r).length) { toast('This recipe has no steps yet.'); return; }
      CK.on = true; CK.i = 0; CK.sheet = false;
      var el = document.getElementById('rc-cook');
      if (!el) { el = h('div', { id: 'rc-cook', class: 'rc-cook', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cook mode' }); document.body.appendChild(el); }
      document.body.classList.add('rc-lock');
      cookRender(true); wakeOn();
    }
    function cookClose() {
      if (!CK.on) return;
      CK.on = false; var el = document.getElementById('rc-cook'); if (el) el.remove();
      document.body.classList.remove('rc-lock'); wakeOff();
    }
    function cookRender(focus) {
      var el = document.getElementById('rc-cook'), r = R.cur; if (!el || !r) return;
      var SI = stepItems(r), n = SI.length, i = CK.i, showIngs = (i === 0 || CK.sheet), cs = SI[i - 1];
      var bar = h('span', { class: 'rc-bar-fill' }); bar.style.width = Math.round(i / n * 100) + '%';
      var main = showIngs
        ? h('section', { class: 'rc-cook-ings' }, h('h2', { text: 'Ingredients' + (R.base > 0 && R.f !== 1 ? ' (for ' + R.target + ' ' + R.label + ')' : '') }), ingList('ck'))
        : h('p', { class: 'rc-cook-step' }, cs && cs.from ? h('span', { class: 'rc-from', text: cs.from }) : null, stepNode(cs ? cs.t : ''));
      var next = h('button', { type: 'button', class: 'btn', onclick: function () { cookGo(1); } }, i === n ? 'Finished' : (i === 0 ? 'Start cooking' : 'Next step'));
      el.replaceChildren(h('div', { class: 'rc-cook-wrap' },
        h('div', { class: 'rc-cook-top' }, h('div', null, h('p', { class: 'small muted', text: r.name }), h('p', { class: 'rc-cook-count', text: i === 0 ? 'Gather your ingredients' : 'Step ' + i + ' of ' + n })),
          h('button', { type: 'button', class: 'btn secondary', onclick: cookClose }, 'Exit')),
        h('div', { class: 'rc-bar', 'aria-hidden': 'true' }, bar),
        h('div', { class: 'rc-cook-main' }, main),
        h('div', { class: 'rc-cook-nav' },
          h('button', { type: 'button', class: 'btn secondary', disabled: i === 0, onclick: function () { cookGo(-1); } }, 'Back'),
          i > 0 ? h('button', { type: 'button', class: 'btn secondary', onclick: function () { CK.sheet = !CK.sheet; cookRender(); } }, CK.sheet ? 'Back to the step' : 'Ingredients') : null,
          next)));
      el.scrollTop = 0; if (focus) next.focus();
    }
    function cookGo(d) {
      var n = stepItems(R.cur).length, j = CK.i + d;
      if (j > n) { cookClose(); toast('Enjoy your meal!'); return; }
      if (j < 0) return;
      CK.i = j; CK.sheet = false; cookRender();
    }
    document.addEventListener('visibilitychange', function () { if (CK.on && document.visibilityState === 'visible') wakeOn(); });
    document.addEventListener('keydown', function (e) {
      if (!CK.on) return;
      if (e.key === 'ArrowRight') cookGo(1);
      else if (e.key === 'ArrowLeft') cookGo(-1);
      else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); cookClose(); }
    });
    document.addEventListener('touchstart', function (e) { if (CK.on && e.touches[0]) { CK.x = e.touches[0].clientX; CK.y = e.touches[0].clientY; } }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!CK.on || !e.changedTouches[0] || (e.target.closest && e.target.closest('button'))) return;
      var dx = e.changedTouches[0].clientX - CK.x, dy = e.changedTouches[0].clientY - CK.y;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 60) cookGo(dx < 0 ? 1 : -1);
    }, { passive: true });
    window.addEventListener('hashchange', cookClose);

    /* ---------- ingredient list (ticks, scaling) ---------- */
    function ingList(pre) {
      var items = ingItems(R.cur);
      if (!items.length) return h('p', { class: 'muted', text: 'No ingredients written down yet.' });
      var ul = h('ul', { class: 'rc-ings' }), last = '';
      items.forEach(function (it) {
        if (it.g !== last) { last = it.g; if (it.g) ul.appendChild(h('li', { class: 'rc-grp', text: it.g })); }
        var id = pre + '-' + it.k;
        var cb = h('input', { type: 'checkbox', id: id, 'data-ing': it.k }); cb.checked = R.checked.has(it.k);
        cb.addEventListener('change', function () {
          if (cb.checked) R.checked.add(it.k); else R.checked.delete(it.k);
          Array.prototype.forEach.call(document.querySelectorAll('input[data-ing="' + it.k + '"]'), function (x) { x.checked = cb.checked; });
        });
        ul.appendChild(h('li', null, h('label', { for: id, class: 'rc-chk' }, cb, h('span', { text: scaleLine(it.t, R.f) }))));
      });
      return ul;
    }
    function applyScale() {
      R.f = R.base > 0 ? R.target / R.base : 1;
      var sv = document.getElementById('rc-sval'); if (sv) sv.textContent = R.target;
      var w = document.getElementById('rc-ing-wrap'); if (w) w.replaceChildren(ingList('ing'));
      var fy = document.getElementById('rc-fact-yield'); if (fy) fy.textContent = R.target + ' ' + R.label;
      if (CK.on) cookRender();
    }

    /* ---------- backup and restore ---------- */
    function backup() {
      var blob = new Blob([JSON.stringify({ app: 'family-recipe-book', version: 1, saved: new Date().toISOString(), recipes: R.demo }, null, 1)], { type: 'application/json' });
      var u = URL.createObjectURL(blob), l = document.createElement('a');
      l.href = u; l.download = 'recipe-book-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
      toast('Backup saved to your downloads.');
    }
    async function restore(file, again) {
      try {
        var d = JSON.parse(await file.text());
        var list = Array.isArray(d) ? d : d.recipes;
        if (!Array.isArray(list) || !list.length || !list.every(function (r) { return r && typeof r.name === 'string'; })) throw new Error('bad');
        var n = 0;
        list.forEach(function (r) {
          var rec = cleanRecipe(r, Date.now()), i = -1;
          R.demo.forEach(function (x, k) { if (x.slug === rec.slug) i = k; });
          if (i >= 0) R.demo[i] = rec; else R.demo.push(rec);
          delete R.deleted[rec.slug]; n++;
        });
        persist(); toast('Restored ' + n + ' recipe' + (n === 1 ? '' : 's') + '.'); again();
      } catch (e) { toast('That file does not look like a recipe book backup.'); }
    }

    /* ---------- pieces used by several screens ---------- */
    var metaLine = function (r) { return [r.total, r.yield, (!r.total && !r.yield) ? r.categories[0] : ''].filter(Boolean).join(' · '); };
    function backLink() { return h('p', { class: 'rc-crumb' }, h('a', { class: 'link-btn', href: '#/recipes' }, '← All recipes')); }
    function heartIcon() { return icon('heart'); }
    function card(r) {
      return h('li', null, h('a', { class: 'card rc-card', href: '#/recipes/recipe/' + encodeURIComponent(r.slug) },
        photoEl(r.image, ''),
        h('h3', null, r.name, r.fav ? h('span', { class: 'rc-fav', 'aria-label': 'hearted' }, heartIcon()) : null),
        h('p', { class: 'small muted', text: (isMeal(r) ? 'Meal · ' : '') + metaLine(r) })));
    }
    function filtered() {
      var a = R.demo.slice();
      if (R.type === 'meal') a = a.filter(isMeal); else if (R.type === 'dish') a = a.filter(function (r) { return !isMeal(r); });
      if (R.query) { var q = R.query.toLowerCase(); a = a.filter(function (r) { return (r.name + ' ' + r.ingredients.join(' ') + ' ' + r.categories.join(' ') + ' ' + r.tags.join(' ')).toLowerCase().indexOf(q) >= 0; }); }
      if (R.cat) a = a.filter(function (r) { return r.categories.some(function (c) { return slugify(c) === R.cat; }); });
      if (R.onlyFavs) a = a.filter(function (r) { return r.fav; });
      return a;
    }
    function categories() { var m = new Map(); R.demo.forEach(function (r) { r.categories.forEach(function (c) { m.set(slugify(c), c); }); }); return Array.from(m); }

    /* ---------- list ---------- */
    function viewList(main) {
      main.appendChild(h('h1', { text: 'Recipes' }));
      main.appendChild(h('p', { class: 'muted', text: 'Our recipes, meals, cook mode and timers. Kept on this device, for your account only.' }));
      var q = h('input', { id: 'rc-q', type: 'search', autocomplete: 'off', enterkeyhint: 'search', placeholder: 'Search by name or ingredient', 'aria-label': 'Search recipes', value: R.query });
      var grid = h('ul', { class: 'rc-grid', id: 'rc-grid' }), more = h('div', { id: 'rc-more' });
      var chipsBox = h('div', { class: 'rc-chips', role: 'group', 'aria-label': 'Categories' });
      var heartBtn = h('button', { type: 'button', class: 'chip rc-heartchip', 'aria-pressed': String(R.onlyFavs), onclick: function () { R.onlyFavs = !R.onlyFavs; heartBtn.setAttribute('aria-pressed', String(R.onlyFavs)); paint(false); } }, icon('heart'), h('span', { text: 'Hearted' }));
      var typeBtns = [['', 'All'], ['dish', 'Dishes'], ['meal', 'Meals']].map(function (t) {
        var b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(R.type === t[0]), onclick: function () { R.type = t[0]; typeBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); paint(false); } }, t[1]);
        return b;
      });
      main.appendChild(h('div', { class: 'rc-controls' }, q,
        h('div', { class: 'row' }, heartBtn, h('a', { class: 'btn small', href: '#/recipes/new' }, icon('plus'), h('span', { text: 'Add a recipe' }))),
        h('a', { class: 'btn secondary rc-bookbtn', href: '#/recipes/cookbook' }, icon('book'), h('span', { text: 'Make printable recipe book' }))));
      main.appendChild(h('div', { class: 'rc-chips', role: 'group', 'aria-label': 'Show' }, typeBtns));
      var cats = [['', 'All']].concat(categories());
      cats.forEach(function (c) { var b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(R.cat === c[0]), onclick: function () { R.cat = c[0]; Array.prototype.forEach.call(chipsBox.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); }); paint(false); } }, c[1]); chipsBox.appendChild(b); });
      if (cats.length > 1) main.appendChild(chipsBox);
      main.appendChild(grid); main.appendChild(more);
      var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { R.query = q.value.trim(); paint(false); }, 250); });
      function paint(append) {
        if (!append) { R.page = 1; grid.replaceChildren(); }
        var a = filtered(), pages = Math.max(1, Math.ceil(a.length / PAGE));
        a.slice((R.page - 1) * PAGE, R.page * PAGE).forEach(function (r) { grid.appendChild(card(r)); });
        more.replaceChildren();
        if (!a.length) {
          var filt = R.query || R.cat || R.onlyFavs || R.type;
          more.appendChild(h('div', { class: 'card rc-empty' }, h('h2', { text: filt ? 'No recipes match' : 'No recipes yet' }), h('p', { class: 'muted', text: filt ? 'Try a different search or clear the filters.' : 'Add the first recipe to start your book.' }), filt ? null : h('a', { class: 'btn', href: '#/recipes/new' }, 'Add a recipe')));
        } else if (R.page < pages) more.appendChild(h('button', { type: 'button', class: 'btn secondary', onclick: function () { R.page++; paint(true); } }, 'Show more recipes'));
      }
      paint(false);
      // backup and restore, at the bottom of the list
      var file = h('input', { type: 'file', accept: 'application/json,.json', class: 'rc-file', id: 'rc-restore', 'aria-label': 'Choose a backup file to restore' });
      file.addEventListener('change', function () { var f = file.files[0]; file.value = ''; if (f) restore(f, function () { X.reroute(); }); });
      main.appendChild(h('section', { class: 'card rc-backup' }, h('h2', { text: 'Backup and restore' }),
        h('p', { class: 'muted', text: 'Your recipes live in this browser on this device. To keep them safe or move them to another device, save a backup file, then restore it there.' }),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: backup }, 'Save a backup file'), h('button', { type: 'button', class: 'btn secondary', onclick: function () { file.click(); } }, 'Restore from a backup file'), file),
        h('p', { class: 'small muted', text: 'Recipe Book ' + VERSION + '. Backups use the original recipe book’s file format, photos included.' })));
    }

    /* ---------- one recipe ---------- */
    function partCard(p) { return h('li', null, h('a', { class: 'rc-pcard', href: '#/recipes/recipe/' + encodeURIComponent(p.slug) }, photoEl(p.image, ''), h('span', { text: p.name }))); }
    function viewRecipe(main, slug) {
      var r = find(slug);
      if (!r) { main.appendChild(backLink()); main.appendChild(h('div', { class: 'alert error', role: 'alert', text: 'I could not find that recipe. It may have been removed.' })); return; }
      R.cur = r; scaleInit(r);
      var facts = [['Prep', r.prep], ['Cook', r.cook], ['Total', r.total], ['Makes', r.yield]].filter(function (f) { return f[1]; });
      var heartB = h('button', { type: 'button', class: 'btn secondary', 'aria-pressed': String(!!r.fav) }, heartIcon(), h('span', { text: r.fav ? 'Hearted' : 'Heart it' }));
      heartB.addEventListener('click', function () { r.fav = !r.fav; r.updated = Date.now(); persist(); heartB.setAttribute('aria-pressed', String(r.fav)); heartB.lastChild.textContent = r.fav ? 'Hearted' : 'Heart it'; });
      var art = h('article', { class: 'rc-recipe' });
      main.appendChild(h('div', { class: 'rc-noprint' }, backLink()));
      var cats = (isMeal(r) ? ['Meal'] : []).concat(r.categories);
      art.appendChild(h('header', null,
        cats.length ? h('p', { class: 'small muted', text: cats.join(' · ') }) : null,
        h('h1', { text: r.name }),
        r.description ? h('p', { class: 'rc-desc', text: r.description }) : null,
        facts.length ? h('dl', { class: 'rc-facts' }, facts.map(function (f) { return h('div', null, h('dt', { text: f[0] }), h('dd', f[0] === 'Makes' ? { id: 'rc-fact-yield' } : null, f[1])); })) : null,
        h('div', { class: 'row rc-noprint rc-actions' },
          h('button', { type: 'button', class: 'btn', onclick: cookOpen }, 'Cook mode'),
          h('button', { type: 'button', class: 'btn secondary', onclick: openTimerDialog }, 'Timer'),
          h('a', { class: 'btn secondary', href: '#/recipes/edit/' + encodeURIComponent(r.slug) }, icon('pencil'), ' Edit'),
          heartB,
          h('button', { type: 'button', class: 'btn secondary', onclick: printIt }, 'Print'),
          h('button', { type: 'button', class: 'btn ghost', onclick: function () { remove(r); } }, 'Remove'))));
      if (r.image) art.appendChild(h('figure', { class: 'rc-hero' }, photoEl(r.image, r.name)));
      var ps = partsOf(r), ui = usedIn(r);
      if (ps.length) art.appendChild(h('section', { class: 'rc-parts' }, h('h2', { text: 'Made from' }), h('ul', null, ps.map(partCard))));
      if (ui.length) art.appendChild(h('section', { class: 'rc-parts' }, h('h2', { text: 'Part of' }), h('ul', null, ui.map(partCard))));
      var scaler = R.base > 0 ? h('div', { class: 'rc-scaler rc-noprint' },
        h('span', { class: 'small muted', text: 'Makes' }),
        h('button', { type: 'button', class: 'btn secondary small', 'aria-label': 'Make less', onclick: function () { if (R.target > 1) R.target--; applyScale(); } }, '−'),
        h('output', { id: 'rc-sval', 'aria-live': 'polite' }, String(R.target)),
        h('button', { type: 'button', class: 'btn secondary small', 'aria-label': 'Make more', onclick: function () { R.target = Math.min(99, R.target + 1); applyScale(); } }, '+'),
        h('span', { text: R.label }),
        h('button', { type: 'button', class: 'btn ghost small', onclick: function () { R.target = R.base; applyScale(); } }, 'Reset')) : null;
      var wrap = h('div', { id: 'rc-ing-wrap' }, ingList('ing'));
      var steps = h('section', { class: 'rc-steps' }, h('h2', { text: 'Method' }));
      if (r.steps.length) { var ol = h('ol'); r.steps.forEach(function (t) { ol.appendChild(h('li', null, h('p', null, stepNode(t)))); }); steps.appendChild(ol); }
      else steps.appendChild(h('p', { class: 'muted', text: isMeal(r) ? 'Open each dish above for its method, or tap Cook mode to go through them in order.' : 'No steps written down yet.' }));
      art.appendChild(h('div', { class: 'rc-cols' }, h('section', { class: 'rc-ing-sec' }, h('h2', { text: 'Ingredients' }), scaler, wrap), steps));
      if (r.notes) art.appendChild(h('aside', { class: 'rc-note' }, h('strong', { text: 'A note in the margin' }), h('p', { text: r.notes })));
      if (r.source) {
        var safe = /^https?:\/\//i.test(r.source);
        art.appendChild(h('p', { class: 'small muted' }, 'Adapted from ', safe ? h('a', { href: r.source, target: '_blank', rel: 'noopener noreferrer' }, r.source) : r.source));
      }
      main.appendChild(art);
    }
    // Printing uses a plain copy of just the recipe, placed straight under <body> while everything else is hidden, so no app layout (tall minimum heights, fixed bars, footers) can spill onto an extra page.
    function preparePrint() {
      var src = document.querySelector('.rc-recipe'); if (!src) return function () {};
      var doc = document.createElement('div'); doc.id = 'rc-printdoc'; doc.appendChild(src.cloneNode(true));
      Array.prototype.forEach.call(doc.querySelectorAll('.rc-noprint, .rc-actions, button, dialog'), function (n) { n.remove(); });
      document.body.appendChild(doc); document.documentElement.classList.add('rc-print');
      return function () { document.documentElement.classList.remove('rc-print'); doc.remove(); };
    }
    function printIt() {
      var undo = preparePrint(), done = function () { undo(); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done); window.print();
    }
    window.__rcPreparePrint = preparePrint;
    async function remove(r) {
      var ok = await X.confirmDialog('Remove “' + r.name + '”?', 'It leaves your book on this device. This cannot be undone, but a backup file you saved earlier still has it.', 'Remove it');
      if (!ok) return;
      R.demo = R.demo.filter(function (x) { return x.slug !== r.slug; }); R.deleted[r.slug] = Date.now(); persist();
      toast('Recipe removed.'); location.hash = '#/recipes';
    }

    /* ---------- add and edit ---------- */
    var lines = function (s, bullets) { return s.split(/\n+/).map(function (x) { return x.trim().replace(bullets ? /^([-*•]\s+)/ : /^(\d+[.)]\s+|[-*•]\s+)/, ''); }).filter(Boolean); };
    var csv = function (s) { return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
    function viewEditor(main, slug) {
      var r = { name: '', description: '', yield: '', prep: '', cook: '', total: '', ingredients: [], steps: [], categories: [], tags: [], notes: '', source: '', image: '' };
      if (slug) { var f = find(slug); if (!f) { main.appendChild(backLink()); main.appendChild(h('div', { class: 'alert error', role: 'alert', text: 'I could not find that recipe.' })); return; } r = f; }
      R.cur = slug ? r : null;
      var FP = (r.parts || []).filter(function (sl) { return find(sl); });
      var err = h('div', { class: 'alert error', role: 'alert', hidden: true });
      var fld = function (id, label, ctrl, hint) { return h('div', { class: 'rc-field' }, h('label', { for: id, text: label }), ctrl, hint ? h('div', { class: 'hint', text: hint }) : null); };
      var inp = function (id, val, ph, extra) { return h('input', Object.assign({ id: id, type: 'text', value: val, placeholder: ph || '' }, extra || {})); };
      var ta = function (id, val, ph, rows) { var t = h('textarea', { id: id, rows: rows || 4, placeholder: ph || '' }); t.value = val; return t; };
      var name = inp('rc-f-name', r.name, '', { required: true, maxlength: '120' });
      var desc = ta('rc-f-desc', r.description, '', 3), prep = inp('rc-f-prep', r.prep, '15 minutes'), cook = inp('rc-f-cook', r.cook, '1 hour'), total = inp('rc-f-total', r.total, '1 hour 15 minutes'), yld = inp('rc-f-yield', r.yield, '6 servings');
      var ing = ta('rc-f-ing', r.ingredients.join('\n'), '2 cups flour\n1 egg', 7), steps = ta('rc-f-steps', r.steps.join('\n\n'), 'Heat the oven to 350°F.', 9);
      var cats = inp('rc-f-cats', r.categories.join(', '), 'Dessert, Baking'), tags = inp('rc-f-tags', r.tags.join(', '), 'Holiday, Family favorite');
      var notes = ta('rc-f-notes', r.notes, 'What to remember next time', 3), src = inp('rc-f-src', r.source, '', { inputmode: 'url' });
      var prev = photoEl(r.image, ''), pick = h('input', { type: 'file', id: 'rc-f-img', accept: 'image/*', class: 'rc-file' });
      var pickLabel = h('label', { for: 'rc-f-img', class: 'btn secondary rc-pick' }, r.image ? 'Change the photo' : 'Add a photo');
      pick.addEventListener('change', function () { var fl = pick.files[0]; if (!fl) return; prev.replaceChildren(h('img', { src: URL.createObjectURL(fl), alt: 'Preview of the chosen photo' })); });
      // "made from other recipes"
      var chipsBox = h('div', { class: 'rc-pchips' }), resBox = h('ul', { class: 'rc-partres', id: 'rc-partres', 'aria-label': 'Recipes you can add' });
      var pq = h('input', { id: 'rc-f-partq', type: 'search', autocomplete: 'off', placeholder: 'Search your recipes to add', 'aria-controls': 'rc-partres' });
      function partsPaint() {
        var me = r.slug, q = pq.value.trim().toLowerCase();
        var cand = R.demo.filter(function (x) { return x.slug !== me && FP.indexOf(x.slug) < 0 && !(me && allParts(x).some(function (y) { return y.slug === me; })); });
        var hit = cand.filter(function (x) { return !q || (x.name + ' ' + x.categories.join(' ')).toLowerCase().indexOf(q) >= 0; });
        resBox.replaceChildren();
        if (!hit.length) resBox.appendChild(h('li', { class: 'muted small', text: cand.length ? 'Nothing matches that search.' : 'No other recipes to add yet.' }));
        hit.forEach(function (x) { resBox.appendChild(h('li', null, h('button', { type: 'button', class: 'rc-partadd', onclick: function () { FP.push(x.slug); pq.value = ''; partsPaint(); } }, h('span', { text: x.name }), h('span', { 'aria-hidden': 'true', text: '+ Add' })))); });
        chipsBox.replaceChildren();
        FP.forEach(function (sl) { var p = find(sl); if (p) chipsBox.appendChild(h('span', { class: 'badge rc-pchip' }, p.name, h('button', { type: 'button', 'aria-label': 'Remove ' + p.name, onclick: function () { FP = FP.filter(function (x) { return x !== sl; }); partsPaint(); } }, '×'))); });
      }
      pq.addEventListener('input', partsPaint);
      pq.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var b = resBox.querySelector('.rc-partadd'); if (b) b.click(); } });
      var save = h('button', { type: 'submit', class: 'btn' }, 'Save to my book');
      var form = h('form', { class: 'card rc-form', autocomplete: 'off', novalidate: true });
      form.append(err, fld('rc-f-name', 'Recipe name', name), fld('rc-f-desc', 'A few words about it', desc),
        h('div', { class: 'rc-field' }, h('span', { class: 'rc-lab', text: 'Photo' }), prev, pick, pickLabel),
        h('div', { class: 'rc-two' }, fld('rc-f-prep', 'Prep time', prep), fld('rc-f-cook', 'Cook time', cook), fld('rc-f-total', 'Total time', total), fld('rc-f-yield', 'Makes', yld)),
        h('div', { class: 'rc-field' }, h('label', { for: 'rc-f-partq', text: 'Made from other recipes (optional)' }), chipsBox, pq, resBox, h('div', { class: 'hint', text: 'Pick recipes you already have. A recipe made from other recipes becomes a Meal. Each one on its own stays a Dish.' })),
        fld('rc-f-ing', 'Ingredients (one per line)', ing), fld('rc-f-steps', 'Method (one step per line)', steps),
        h('div', { class: 'rc-two' }, fld('rc-f-cats', 'Categories (commas between)', cats), fld('rc-f-tags', 'Tags (commas between)', tags)),
        fld('rc-f-notes', 'A note in the margin', notes), fld('rc-f-src', 'Where it came from (a web address, if any)', src),
        h('div', { class: 'row' }, save, h('a', { class: 'btn secondary', href: slug ? '#/recipes/recipe/' + encodeURIComponent(slug) : '#/recipes' }, 'Cancel')));
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var nm = name.value.trim();
        if (!nm) { err.textContent = 'Give the recipe a name first.'; err.hidden = false; name.focus(); return; }
        var v = { name: nm, description: desc.value.trim(), yield: yld.value.trim(), prep: prep.value.trim(), cook: cook.value.trim(), total: total.value.trim(), ingredients: lines(ing.value, true), steps: lines(steps.value, false), parts: FP.slice(), categories: csv(cats.value), tags: csv(tags.value), notes: notes.value.trim(), source: src.value.trim() };
        save.disabled = true; save.textContent = 'Saving…'; err.hidden = true;
        try {
          var rec = slug ? find(slug) : null;
          if (!rec) {
            var base = slugify(v.name), s = base, n = 2; while (find(s)) s = base + '-' + n++;
            rec = { slug: s, id: 'book-' + uuid(), image: '', fav: false }; R.demo.unshift(rec);
          }
          Object.assign(rec, v, { updated: Date.now() });
          var fl = pick.files[0];
          if (fl) { try { rec.image = await toDataURL(await shrink(fl, 800)); } catch (ex) { toast('I could not read that photo.'); } }
          persist(); toast('Saved to your book.'); location.hash = '#/recipes/recipe/' + encodeURIComponent(rec.slug);
        } catch (ex) { err.textContent = 'I could not save that. Try again.'; err.hidden = false; save.disabled = false; save.textContent = 'Save to my book'; }
      });
      main.appendChild(h('div', { class: 'rc-noprint' }, backLink()));
      main.appendChild(h('h1', { text: slug ? 'Edit this recipe' : 'A new recipe' }));
      main.appendChild(form); partsPaint();
    }

    /* ---------- printable recipe book (the original cookbook maker, loaded only when opened) ---------- */
    var cbLoading = null;
    function loadCookbook() {
      if (window.RBCookbook) return Promise.resolve();
      if (!cbLoading) cbLoading = new Promise(function (res, rej) {
        var sc = document.createElement('script'); sc.src = 'cookbook.js?v=' + encodeURIComponent((window.FAMILY_CONFIG && window.FAMILY_CONFIG.version) || VERSION);
        sc.onload = function () { res(); }; sc.onerror = function () { cbLoading = null; sc.remove(); rej(new Error('LOAD')); };
        document.head.appendChild(sc);
      });
      return cbLoading;
    }
    // The maker writes small style hints as data-st (inline style attributes are not allowed on this site); apply them as they appear.
    function applyStyleHints(root) {
      if (root.nodeType !== 1) return;
      var list = root.matches && root.matches('[data-st]') ? [root] : [];
      list = list.concat(Array.prototype.slice.call(root.querySelectorAll('[data-st]')));
      list.forEach(function (el) { el.style.cssText = el.getAttribute('data-st'); el.removeAttribute('data-st'); });
    }
    var cbObserver = null;
    function cookbookOff() {
      if (cbObserver) { cbObserver.disconnect(); cbObserver = null; }
      if (window.RBCookbook) window.RBCookbook.unmount();
    }
    window.addEventListener('hashchange', function () { if (!/^#\/recipes\/cookbook/.test(location.hash)) cookbookOff(); });
    function viewCookbook(main, uid, token) {
      main.appendChild(h('div', { class: 'rc-noprint' }, backLink()));
      var host = h('div', { class: 'rc-cbhost' }, h('p', { class: 'info', text: 'Opening the recipe book maker…' }));
      main.appendChild(host);
      loadCookbook().then(function () {
        if (!/^#\/recipes\/cookbook/.test(location.hash) || !host.isConnected) return;
        window.__RB_IDB = 'fcrb_cookbooks_' + uid;
        cbObserver = new MutationObserver(function (muts) { muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, applyStyleHints); }); });
        cbObserver.observe(host, { childList: true, subtree: true });
        window.RBCookbook.mount(host, { header: function () { return ''; }, recipes: function () { return R.demo; }, toast: X.toast, exit: function () { location.hash = '#/recipes'; }, author: '' });
      }).catch(function () {
        host.replaceChildren(h('div', { class: 'alert error', role: 'alert', text: 'I could not load the recipe book maker. Check your connection and try again.' }));
      });
    }

    /* ---------- the view ---------- */
    X.VIEWS.recipes = function (main, token, a, b) {
      var uid = X.S.user && X.S.user.$id;
      if (!uid) { main.appendChild(h('p', { class: 'muted', text: 'Sign in to open the recipe book.' })); return; }
      cookClose(); cookbookOff(); boot(String(uid));
      var arg = b ? decodeURIComponent(b) : '';
      if (a === 'recipe' && arg) return viewRecipe(main, arg);
      if (a === 'cookbook') return viewCookbook(main, String(uid), token);
      if (a === 'new') return viewEditor(main, null);
      if (a === 'edit' && arg) return viewEditor(main, arg);
      return viewList(main);
    };
  }

  window.FCRecipes = { install: install };
})();
