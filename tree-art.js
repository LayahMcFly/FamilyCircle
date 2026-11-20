/*
 * tree-art.js: the seasonal illustration around the Family Tree page.
 *
 * What it is: original SVG and CSS artwork (no images, no network, no library). It sits BEHIND the family-chart drawing and never takes part in it.
 *   - Frame art: tapered branches in the top corners with foliage, blossom or snow, drawn once per season.
 *   - Bark under the real parent-child connectors: each connector the chart draws gets a tapered bark shape beneath it. The real connector stays on top as a thin dark line,
 *     so the relationship line is still the thing that says who is connected to whom. Partner connectors are NOT given bark: they stay a dashed gold line.
 *   - A few leaf, petal or snow particles falling in the empty space behind the people.
 * What it does not do: read or change people, relationships or permissions, call the backend, ask for a location, or save anything but three small local
 * preferences (season, hemisphere, animation on or off) in this browser's localStorage. All art is aria-hidden and has pointer-events: none.
 *
 * Auto season uses the device date only (no location, no IP lookup). Meteorological months, Northern Hemisphere:
 *   spring March to May, summer June to August, autumn September to November, winter December to February.
 *   Southern Hemisphere: the same months shifted by six months (spring September to November, and so on).
 */
(function () {
  'use strict';

  var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  var SEASON_LABEL = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
  var MONTHS_NORTH = { spring: 'March to May', summer: 'June to August', autumn: 'September to November', winter: 'December to February' };
  var MONTHS_SOUTH = { spring: 'September to November', summer: 'December to February', autumn: 'March to May', winter: 'June to August' };
  var KEYS = { season: 'fc-tree-season', hemi: 'fc-tree-hemi', anim: 'fc-tree-anim' };
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- season choice (pure, tested without a browser) ---------- */
  function autoSeason(date, hemi) {
    var m = date.getMonth();                       // 0 = January, from the device clock
    if (hemi === 'south') m = (m + 6) % 12;
    if (m === 11 || m <= 1) return 'winter';
    if (m <= 4) return 'spring';
    if (m <= 7) return 'summer';
    return 'autumn';
  }

  /* ---------- small local preferences (non-sensitive; never sent anywhere) ---------- */
  function load(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, val) { try { window.localStorage.setItem(key, val); } catch (e) { /* private mode: the choice just lasts until the page closes */ } }
  function readPrefs() {
    var s = load(KEYS.season), h = load(KEYS.hemi), a = load(KEYS.anim);
    return { season: (s === 'auto' || SEASONS.indexOf(s) !== -1) ? s : 'auto', hemi: h === 'south' ? 'south' : 'north', anim: a !== '0' };
  }

  /* ---------- tiny deterministic random numbers, so a season always draws the same picture ---------- */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function div(cls, parent) { var d = document.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; }

  /* ---------- shared drawing symbols (one hidden <svg>, referenced with <use>) ---------- */
  function symbols() {
    var s = el('svg', { class: 'ta-defs', width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' });
    var d = el('defs', null, s);
    var leaf = el('symbol', { id: 'ta-lf', overflow: 'visible' }, d);
    el('path', { d: 'M0,0 C3,-7 14,-8 21,0 C14,8 3,7 0,0 Z', class: 'ta-leafbody' }, leaf);
    el('path', { d: 'M1,0 L17,0', class: 'ta-rib' }, leaf);
    var bl = el('symbol', { id: 'ta-bl', overflow: 'visible' }, d);
    for (var i = 0; i < 5; i++) el('path', { d: 'M0,0 C-3,-5 -2.5,-9.5 0,-10.5 C2.5,-9.5 3,-5 0,0 Z', transform: 'rotate(' + (i * 72) + ')', class: 'ta-petal' }, bl);
    el('circle', { r: '1.7', class: 'ta-heart' }, bl);
    var pt = el('symbol', { id: 'ta-pt', overflow: 'visible' }, d);
    el('path', { d: 'M0,0 C2,-5 8,-5 10,0 C8,5 2,5 0,0 Z', class: 'ta-petalbody' }, pt);
    var fk = el('symbol', { id: 'ta-fk', overflow: 'visible' }, d);
    el('circle', { r: '2.2', class: 'ta-flakebody' }, fk);
    return s;
  }

  /* ---------- cubic bezier helpers for placing foliage along the frame twigs ---------- */
  function bez(p, t) { var u = 1 - t; return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6], u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]]; }
  function ang(p, t) { var a = bez(p, Math.max(0, t - 0.02)), b = bez(p, Math.min(1, t + 0.02)); return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }

  // Frame art for one top corner. viewBox 320 x 180; the limb enters from the top-left corner and tapers toward the middle.
  var TWIGS = [
    [146, 56, 170, 40, 196, 34, 226, 38], [200, 76, 214, 98, 238, 116, 266, 124], [96, 34, 112, 14, 140, 6, 172, 8],
    [74, 120, 90, 130, 108, 132, 128, 126], [30, 40, 60, 70, 78, 108, 74, 150], [236, 94, 250, 80, 266, 76, 288, 80]
  ];
  function branchSvg(side) {
    var s = el('svg', { class: 'ta-branch ta-' + side, viewBox: '0 0 320 180', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMinYMin meet' });
    var r = rng(hash('frame' + side));
    // limbs: filled and tapered
    el('path', { class: 'ta-bark', d: 'M-12,-8 L-12,42 C44,48 96,42 146,58 C190,72 226,100 270,102 L272,96 C234,94 198,66 150,46 C98,26 48,20 -12,-8 Z' }, s);
    el('path', { class: 'ta-bark', d: 'M28,32 C58,64 82,106 76,152 L70,152 C72,110 52,74 18,44 Z' }, s);
    el('path', { class: 'ta-barkhi', d: 'M-6,10 C44,26 96,28 146,46 C190,60 224,86 262,94' }, s);
    el('path', { class: 'ta-barkhi', d: 'M24,48 C50,74 70,108 68,144' }, s);
    TWIGS.forEach(function (t) { el('path', { class: 'ta-twig', d: 'M' + t[0] + ',' + t[1] + ' C' + t[2] + ',' + t[3] + ' ' + t[4] + ',' + t[5] + ' ' + t[6] + ',' + t[7] }, s); });
    // snow resting on the upper edges (winter only, shown by CSS)
    el('path', { class: 'ta-snow', d: 'M-4,-3 C46,20 98,24 148,41 C192,55 226,84 266,92' }, s);
    el('path', { class: 'ta-snow', d: 'M146,52 C170,36 196,30 226,34' }, s);
    el('path', { class: 'ta-snow', d: 'M96,30 C112,10 140,2 172,4' }, s);
    // foliage: leaves, and blossoms for spring, placed along each twig
    var sway = 0;
    TWIGS.forEach(function (t, ti) {
      var g = el('g', { class: 'ta-sway sw' + (sway++ % 3) }, s);
      g.style.setProperty('--sl', (-r() * 6).toFixed(2) + 's');
      var ts = [0.28, 0.44, 0.6, 0.76, 0.92];
      ts.forEach(function (tt, i) {
        var p = bez(t, tt), a = ang(t, tt) + (i % 2 ? 42 : -42) + (r() * 16 - 8), sc = (0.7 + r() * 0.55) * (tt > 0.8 ? 0.8 : 1);
        var cls = 'ta-lf l' + (1 + Math.floor(r() * 3)) + (i % 2 ? ' late' : '') + (i === 2 ? ' mid' : '') + (ti < 2 && i === 1 ? ' keep' : '');
        var u = el('use', { href: '#ta-lf', class: cls, transform: 'translate(' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ') rotate(' + a.toFixed(0) + ') scale(' + sc.toFixed(2) + ')' }, g);
        if (i === 1 || i === 3) {
          var b = bez(t, tt + 0.03);
          var bu = el('use', { href: '#ta-bl', class: 'ta-bl', transform: 'translate(' + b[0].toFixed(1) + ' ' + (b[1] - 3).toFixed(1) + ') scale(' + (0.9 + r() * 0.5).toFixed(2) + ')' }, g);
          bu.style.setProperty('--bd', (0.15 * (ti * 5 + i) + r() * 0.5).toFixed(2) + 's');
        }
        void u;
      });
    });
    return s;
  }

  /* ---------- falling particles (a few per season, behind the people) ---------- */
  var PARTICLES = { winter: { flake: 12, leaf: 3 }, spring: { petal: 5 }, summer: { leaf: 4 }, autumn: { leaf: 9 } };
  function buildParticles(layer, season) {
    layer.textContent = '';
    var spec = PARTICLES[season], r = rng(hash('fall' + season)), n = 0;
    Object.keys(spec).forEach(function (kind) {
      for (var i = 0; i < spec[kind]; i++) {
        var p = div('ta-p k-' + kind + ' c' + (1 + Math.floor(r() * 3)), layer);
        var inner = div('ta-pi', p);
        var sz = kind === 'flake' ? 4 + r() * 5 : 12 + r() * 12;
        p.style.setProperty('--x', (4 + r() * 92).toFixed(1) + '%');
        p.style.setProperty('--dur', (kind === 'flake' ? 15 + r() * 14 : 18 + r() * 16).toFixed(1) + 's');
        p.style.setProperty('--del', (-r() * 26).toFixed(1) + 's');
        p.style.setProperty('--dx', ((r() - 0.5) * 120).toFixed(0) + 'px');
        inner.style.setProperty('--sd', (3.5 + r() * 4).toFixed(1) + 's');
        inner.style.setProperty('--r0', (-30 + r() * 60).toFixed(0) + 'deg');
        inner.style.setProperty('--r1', (-80 + r() * 160).toFixed(0) + 'deg');
        var sv = el('svg', { viewBox: '-12 -12 36 24', width: sz.toFixed(0), height: (sz * 0.67).toFixed(0), 'aria-hidden': 'true', focusable: 'false' }, inner);
        el('use', { href: kind === 'flake' ? '#ta-fk' : kind === 'petal' ? '#ta-pt' : '#ta-lf' }, sv);
        n++;
      }
    });
    return n;
  }

  /* ---------- bark under the real connectors ---------- */
  function barkFor(path, seed) {
    var len = path.getTotalLength();
    if (!(len > 8)) return null;
    var n = Math.max(8, Math.min(34, Math.round(len / 10))), pts = [], i;
    for (i = 0; i <= n; i++) { var q = path.getPointAtLength(len * i / n); pts.push([q.x, q.y]); }
    // the parent is the end that sits higher on screen (the chart is drawn top to bottom); the bark is thickest there
    if (pts[0][1] < pts[n][1]) pts.reverse();
    var wThin = 2.6, wThick = 7.4, left = [], right = [], rr = rng(seed);
    var phase = rr() * 6;
    for (i = 0; i <= n; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
      var t = i / n, w = (wThin + (wThick - wThin) * Math.pow(t, 1.5) + Math.sin(t * 9 + phase) * 0.35) / 2;
      left.push([pts[i][0] - dy / d * w, pts[i][1] + dx / d * w]); right.push([pts[i][0] + dy / d * w, pts[i][1] - dx / d * w]);
    }
    var dstr = 'M' + left.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L') + 'L' + right.reverse().map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L') + 'Z';
    return { d: dstr, mid: pts[Math.floor(n * 0.5)], dir: [pts[Math.floor(n * 0.5) + 1][0] - pts[Math.floor(n * 0.5)][0], pts[Math.floor(n * 0.5) + 1][1] - pts[Math.floor(n * 0.5)][1]] };
  }
  var MAX_ACCENTS = 36;
  function refreshLinks(chartEl) {
    var view = chartEl.querySelector('svg.main_svg g.view');
    var linksView = view && view.querySelector('g.links_view');
    if (!linksView) return;
    var layer = view.querySelector('g.ta-bark-layer');
    if (!layer) { layer = el('g', { class: 'ta-bark-layer', 'aria-hidden': 'true' }); view.insertBefore(layer, linksView); }
    layer.textContent = '';
    var paths = [].slice.call(linksView.querySelectorAll('path.link')), parentLinks = [];
    paths.forEach(function (p) {
      var dat = p.__data__, spouse = !!(dat && dat.spouse);
      p.classList.toggle('f3-partner', spouse);
      if (!spouse) parentLinks.push(p);
    });
    var step = Math.max(1, Math.ceil(parentLinks.length / MAX_ACCENTS)), accents = 0;
    parentLinks.forEach(function (p, idx) {
      var seed = hash((p.__data__ && p.__data__.id) || ('l' + idx)), b = barkFor(p, seed);
      if (!b) return;
      el('path', { class: 'ta-linkbark', d: b.d }, layer);
      if (idx % step === 0 && accents < MAX_ACCENTS) {
        accents++;
        var rr = rng(seed + 1), dl = Math.sqrt(b.dir[0] * b.dir[0] + b.dir[1] * b.dir[1]) || 1, side = rr() > 0.5 ? 1 : -1;
        var x = b.mid[0] - b.dir[1] / dl * 8 * side, y = b.mid[1] + b.dir[0] / dl * 8 * side, a = Math.atan2(b.dir[1], b.dir[0]) * 180 / Math.PI + 55 * side + (rr() * 20 - 10);
        el('use', { href: '#ta-lf', class: 'ta-lf ta-accent l' + (1 + Math.floor(rr() * 3)), transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + a.toFixed(0) + ') scale(' + (0.55 + rr() * 0.3).toFixed(2) + ')' }, layer);
        if (idx % (step * 2) === 0) el('use', { href: '#ta-bl', class: 'ta-bl ta-accent', transform: 'translate(' + (x + 5).toFixed(1) + ' ' + (y - 2).toFixed(1) + ') scale(.6)' }, layer);
        el('path', { class: 'ta-snow ta-linksnow', d: p.getAttribute('d'), transform: 'translate(0 -2.6)' }, layer);
      }
    });
  }

  /* ---------- the controller for one tree page ---------- */
  var instances = [];
  function sweep() { instances.slice().forEach(function (i) { if (!i.stage.isConnected) i.destroy(); }); }
  window.addEventListener('hashchange', function () { sweep(); setTimeout(sweep, 300); setTimeout(sweep, 1500); });

  // opts: { stage: the .tree-stage element, chart: the .tree-chart element }
  function mount(opts) {
    var stage = opts.stage, chartEl = opts.chart, prefs = readPrefs();
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var root = div('ta', null); root.setAttribute('aria-hidden', 'true');
    root.appendChild(symbols());
    div('ta-wash', root);
    root.appendChild(branchSvg('left')); root.appendChild(branchSvg('right')); root.appendChild(branchSvg('left')).classList.add('ta-low');
    var fall = div('ta-fall', root);
    stage.insertBefore(root, stage.firstChild);
    stage.classList.add('ta-stage');
    var visible = true, settle = null, io = null, dead = false, season = 'spring';

    function reduced() { return !!(mq && mq.matches); }
    function animating() { return prefs.anim && !reduced(); }
    function current() { return prefs.season === 'auto' ? autoSeason(new Date(), prefs.hemi) : prefs.season; }
    function apply() {
      season = current();
      stage.setAttribute('data-season', season);
      stage.classList.toggle('ta-on', animating());
      stage.classList.toggle('ta-still', !animating());
      buildParticles(fall, season);
      syncControls();
    }
    function pause() { stage.classList.toggle('ta-paused', !visible || document.hidden); }
    function onVis() { if (!stage.isConnected) { destroy(); return; } pause(); }
    document.addEventListener('visibilitychange', onVis);
    if ('IntersectionObserver' in window) { io = new IntersectionObserver(function (e) { visible = e[e.length - 1].isIntersecting; pause(); }); io.observe(stage); }
    var onMq = function () { apply(); };
    if (mq && mq.addEventListener) mq.addEventListener('change', onMq);
    var ro = null;
    if ('ResizeObserver' in window) { ro = new ResizeObserver(function () { stage.style.setProperty('--ta-h', stage.clientHeight + 'px'); }); ro.observe(stage); }
    stage.style.setProperty('--ta-h', (stage.clientHeight || 600) + 'px');

    // appearance controls (plain DOM, no inline styles)
    var ctlBox = document.createElement('div'); ctlBox.className = 'tree-look';
    var selS = document.createElement('select'); selS.id = 'tree-season'; selS.setAttribute('aria-label', 'Season');
    [['auto', 'Auto'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; selS.appendChild(op); });
    var selH = document.createElement('select'); selH.id = 'tree-hemi'; selH.setAttribute('aria-label', 'Hemisphere used by Auto');
    [['north', 'Northern Hemisphere'], ['south', 'Southern Hemisphere']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; selH.appendChild(op); });
    var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'tree-anim'; btn.className = 'btn secondary small';
    var note = document.createElement('p'); note.className = 'small muted tree-look-note'; note.id = 'tree-season-note'; note.setAttribute('aria-live', 'polite');
    function lab(forId, text, child) { var w = document.createElement('div'); var l = document.createElement('label'); l.className = 'small muted'; l.setAttribute('for', forId); l.textContent = text; w.appendChild(l); w.appendChild(child); return w; }
    var hemiWrap = lab('tree-hemi', 'Hemisphere for Auto', selH);
    ctlBox.appendChild(lab('tree-season', 'Season', selS)); ctlBox.appendChild(hemiWrap);
    var animWrap = document.createElement('div'); animWrap.appendChild(btn); ctlBox.appendChild(animWrap); ctlBox.appendChild(note);
    selS.addEventListener('change', function () { prefs.season = selS.value; save(KEYS.season, prefs.season); apply(); });
    selH.addEventListener('change', function () { prefs.hemi = selH.value; save(KEYS.hemi, prefs.hemi); apply(); });
    btn.addEventListener('click', function () { if (reduced()) return; prefs.anim = !prefs.anim; save(KEYS.anim, prefs.anim ? '1' : '0'); apply(); });
    function syncControls() {
      selS.value = prefs.season; selH.value = prefs.hemi; hemiWrap.hidden = prefs.season !== 'auto';
      var on = animating();
      btn.setAttribute('aria-pressed', String(on)); btn.disabled = reduced();
      btn.textContent = 'Seasonal animation: ' + (reduced() ? 'Off (your device asks for reduced motion)' : on ? 'On' : 'Off');
      var months = (prefs.hemi === 'south' ? MONTHS_SOUTH : MONTHS_NORTH)[season];
      note.textContent = prefs.season === 'auto'
        ? 'Auto shows ' + SEASON_LABEL[season] + ' (' + months + ' in the ' + (prefs.hemi === 'south' ? 'Southern' : 'Northern') + ' Hemisphere), using this device’s date. Nothing is sent anywhere.'
        : 'Showing ' + SEASON_LABEL[season] + '. Choose Auto to follow the date.';
    }

    // the chart calls this after every redraw; the bark waits for the connectors to finish moving
    function refresh() {
      if (dead || !chartEl.isConnected) return;
      stage.classList.add('ta-settling');
      clearTimeout(settle);
      settle = setTimeout(function () { if (dead) return; try { refreshLinks(chartEl); } catch (e) { /* the art is optional: the tree still works */ } stage.classList.remove('ta-settling'); }, reduced() ? 30 : 640);
    }
    function destroy() {
      if (dead) return; dead = true; clearTimeout(settle);
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect(); if (ro) ro.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      if (root.parentNode) root.parentNode.removeChild(root);
      stage.classList.remove('ta-stage', 'ta-on', 'ta-still', 'ta-paused', 'ta-settling'); stage.removeAttribute('data-season');
      var k = instances.indexOf(api); if (k !== -1) instances.splice(k, 1);
    }
    var api = { controls: ctlBox, refresh: refresh, destroy: destroy, stage: stage, season: function () { return season; }, state: function () { return { season: season, prefs: { season: prefs.season, hemi: prefs.hemi, anim: prefs.anim }, animating: animating() }; } };
    instances.push(api);
    apply();
    return api;
  }

  window.FamilyTreeArt = { mount: mount, autoSeason: autoSeason, SEASONS: SEASONS, live: function () { return instances.length; }, MONTHS_NORTH: MONTHS_NORTH, MONTHS_SOUTH: MONTHS_SOUTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.FamilyTreeArt;
}());
