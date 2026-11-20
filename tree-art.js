/*
 * tree-art.js: draws the Family Tree as an actual tree, and owns the season / animation controls.
 *
 * How it works: family-chart still places the people and handles selecting, zooming, panning and keyboard use. Just before each draw this file stands the
 * layout up (oldest generation at the bottom, descendants above, see layout()), and after each draw it grows limbs between the cards (see tree-grow.js):
 * a trunk under the oldest people, boughs that divide at junctions, and a tapering branch up to each child. The limbs ARE the relationship lines: a limb only
 * joins a displayed parent (or two parents together) to their child. Partners get a separate gold dashed link. The chart's own thin connector lines are hidden
 * while the art is on. Leaves, blossoms, snow and twigs are decoration attached to those limbs; twigs are thin and never touch a card.
 * It does not read or change people, relationships or permissions, call the backend, ask for a location, or save anything but three small local
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

  var CW = 170, CH = 56, DROP = 110;
  var Grow = function () { return window.FamilyTreeGrow; };

  /* ---------- layout: stand the family up ---------- */
  // Called by the chart just before it draws. The library puts the oldest people at the top; here they go at the bottom, on the trunk.
  // Only the cards' screen coordinates change. People, relationships and permissions are not touched. Fit and centering use the new size.
  function layout(tree) {
    if (!tree || tree.__grown || !tree.data || !tree.data.length) return;
    tree.__grown = true;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    tree.data.forEach(function (n) {
      n.y = -n.y;
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });
    var x0 = minX - CW / 2 - 50, x1 = maxX + CW / 2 + 50, y0 = minY - CH / 2 - 64, y1 = maxY + CH / 2 + DROP + 44;
    tree.dim = { width: x1 - x0, height: y1 - y0, x_off: -x0, y_off: -y0 };
  }

  /* ---------- drawing the tree ---------- */
  function inRect(x, y, rects, pad) {
    for (var i = 0; i < rects.length; i++) { var r = rects[i]; if (x > r[0] - pad && x < r[0] + r[2] + pad && y > r[1] - pad && y < r[1] + r[3] + pad) return true; }
    return false;
  }
  function leafAt(parent, x, y, ang, sc, cls) {
    var g = el('g', { transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + ang.toFixed(0) + ') scale(' + sc.toFixed(2) + ')' }, parent);
    return el('use', { href: '#ta-lf', class: 'ta-lf ' + cls }, g);
  }
  function blossomAt(parent, x, y, sc, bd, still) {
    var g = el('g', { transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + sc.toFixed(2) + ')' }, parent);
    var u = el('use', { href: '#ta-bl', class: 'ta-bl' + (still ? ' done' : '') }, g);
    u.style.setProperty('--bd', bd.toFixed(2) + 's');
    return u;
  }
  function pathOf(pts) { return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L'); }

  // Draws everything for the cards the chart is showing. Returns the points leaves can fall from.
  function drawTree(view, tree, state) {
    var G = Grow(), old = view.querySelector('g.ta-tree');
    if (old) old.parentNode.removeChild(old);
    var root = el('g', { class: 'ta-tree', 'aria-hidden': 'true' });
    view.insertBefore(root, view.firstChild);
    var nodes = tree.data.filter(function (n) { return n.data && n.data.id; });
    var people = nodes.map(function (n) { var rl = n.data.rels || {}; return { id: n.data.id, x: n.x, y: n.y, parents: rl.parents || [], partners: rl.spouses || [] }; });
    var pl = G.plan(people, { cardW: CW, cardH: CH, groundDrop: DROP });
    if (!pl.ground) return { anchors: [], plan: pl, ground: null };
    var rects = nodes.map(function (n) { return [n.x - CW / 2, n.y - CH / 2, CW, CH]; });
    var r = G.rng(G.hash('tree' + nodes.length + (nodes[0] ? nodes[0].data.id : '')));

    // ground
    var gr = el('g', { class: 'ta-ground' }, root), gy = pl.ground.y, gx0 = pl.ground.x0, gx1 = pl.ground.x1, gmid = (gx0 + gx1) / 2;
    el('ellipse', { class: 'ta-gshadow', cx: gmid.toFixed(1), cy: (gy + 8).toFixed(1), rx: ((gx1 - gx0) / 2 + 10).toFixed(1), ry: 16 }, gr);
    el('path', { class: 'ta-mound', d: 'M' + (gx0 - 10) + ',' + (gy + 14) + ' Q' + gmid.toFixed(1) + ',' + (gy - 12) + ' ' + (gx1 + 10) + ',' + (gy + 14) + ' Z' }, gr);
    var tufts = Math.min(26, Math.max(8, Math.round((gx1 - gx0) / 40)));
    for (var gi = 0; gi < tufts; gi++) {
      var tx = gx0 + (gx1 - gx0) * (gi + r()) / tufts, ty = gy + 6 + r() * 6, th = 7 + r() * 8;
      el('path', { class: 'ta-grass', d: 'M' + tx.toFixed(1) + ',' + ty.toFixed(1) + ' q' + (r() * 4 - 2).toFixed(1) + ',-' + (th * 0.6).toFixed(1) + ' ' + (r() * 8 - 4).toFixed(1) + ',-' + th.toFixed(1) + ' M' + (tx + 3).toFixed(1) + ',' + ty.toFixed(1) + ' q' + (r() * 3).toFixed(1) + ',-' + (th * 0.5).toFixed(1) + ' ' + (r() * 7 - 1).toFixed(1) + ',-' + (th * 0.8).toFixed(1) }, gr);
    }
    el('ellipse', { class: 'ta-groundsnow', cx: gmid.toFixed(1), cy: (gy + 2).toFixed(1), rx: ((gx1 - gx0) / 2 - 8).toFixed(1), ry: 9 }, gr);
    for (var fi = 0; fi < 12; fi++) leafAt(gr, gx0 + 20 + r() * (gx1 - gx0 - 40), gy + 2 + r() * 16, r() * 360, 0.7 + r() * 0.4, 'ta-fallen l' + (1 + Math.floor(r() * 3)));

    // limbs: a soft shadow copy, the bark, then texture
    var polys = pl.limbs.map(function (l) { return { l: l, p: G.polygon(l) }; });
    var shadows = el('g', { class: 'ta-shadows' }, root), limbsG = el('g', { class: 'ta-limbs' }, root), bark = el('g', { class: 'ta-bark' }, root);
    polys.forEach(function (o) { el('path', { class: 'ta-limbshadow', d: G.pathD(o.p), transform: 'translate(3 4)' }, shadows); });
    polys.forEach(function (o) { el('path', { class: 'ta-limb ta-limb-' + o.l.kind, 'data-union': o.l.union || '', 'data-child': o.l.child || '', d: G.pathD(o.p) }, limbsG); });
    pl.hubs.forEach(function (h) { el('circle', { class: 'ta-hub', cx: h.x.toFixed(1), cy: h.y.toFixed(1), r: (h.w * 0.52).toFixed(1) }, limbsG); });
    pl.knots.forEach(function (k) { if (k.w > 6) el('circle', { class: 'ta-hub', cx: k.x.toFixed(1), cy: k.y.toFixed(1), r: (k.w * 0.5).toFixed(1) }, limbsG); });
    polys.forEach(function (o) {
      var c = o.p.center;
      if (o.l.kind === 'feeder' || c.length < 6) return;
      var thick = Math.max(c[0].w, c[c.length - 1].w);
      if (thick < 6.5) return;
      var side = o.l.flare ? -1 : -1, hi = [], k;
      for (k = 1; k < c.length - 1; k++) hi.push([c[k].x + c[k].nx * c[k].w * 0.22 * side, c[k].y + c[k].ny * c[k].w * 0.22 * side]);
      el('path', { class: 'ta-barkhi', d: pathOf(hi) }, bark).style.setProperty('stroke-width', Math.max(1.1, thick * 0.12).toFixed(1));
      if (thick >= 11) {
        for (k = 0; k < 4; k++) {
          var i0 = 2 + Math.floor(r() * (c.length - 8)), seg = [];
          for (var q = 0; q < 5; q++) { var cc = c[Math.min(c.length - 1, i0 + q)], off = (r() - 0.5) * cc.w * 0.6; seg.push([cc.x + cc.nx * off, cc.y + cc.ny * off]); }
          el('path', { class: 'ta-scratch', d: pathOf(seg) }, bark);
        }
      }
    });

    // partner links: a separate gold dashed link between the two cards, with a small ring where a couple's knot is
    var pr = el('g', { class: 'ta-partners' }, root);
    pl.partnerLinks.forEach(function (p) {
      var dx = p.bx - p.ax, dy = p.by - p.ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, e = CW / 2 - 2;
      var inside = Math.abs(dy) < 6 ? 1 : 0;
      var x1 = p.ax + (inside ? ux * e : 0), y1 = p.ay + (inside ? 0 : uy * CH / 2), x2 = p.bx - (inside ? ux * e : 0), y2 = p.by - (inside ? 0 : uy * CH / 2);
      el('path', { class: 'ta-partner', 'data-a': p.a, 'data-b': p.b, d: 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ',' + y2.toFixed(1) }, pr);
      el('circle', { class: 'ta-ring', cx: ((p.ax + p.bx) / 2).toFixed(1), cy: ((p.ay + p.by) / 2).toFixed(1), r: 5 }, pr);
    });

    // decoration attached to the limbs
    var twigs = el('g', { class: 'ta-twigs' }, root), leaves = el('g', { class: 'ta-leaves' }, root), anchors = [], blossoms = 0, nLeaves = 0;
    var thin = polys.filter(function (o) { return o.l.kind === 'branch' || o.l.kind === 'bough'; }).sort(function (a, b) { return a.l.w1 - b.l.w1; });
    var still = state.bloomed;
    thin.forEach(function (o) {
      var c = o.p.center, n = Math.max(2, Math.min(7, Math.round(c.len / 30)));
      for (var i = 0; i < n && nLeaves < 130; i++) {
        var pt = c[Math.round((0.28 + 0.68 * ((i + r()) / n)) * (c.length - 1))], side = nLeaves % 2 ? 1 : -1;
        var x = pt.x + pt.nx * (pt.w / 2 + 1) * side, y = pt.y + pt.ny * (pt.w / 2 + 1) * side;
        if (inRect(x, y, rects, 6)) continue;
        var ang = Math.atan2(pt.ty, pt.tx) * 180 / Math.PI + side * (40 + r() * 32);
        var u = leafAt(leaves, x, y, ang, 0.72 + r() * 0.5, 'l' + (1 + Math.floor(r() * 3)) + (nLeaves % 2 ? ' late' : '') + (nLeaves % 3 === 1 ? ' mid' : '') + (nLeaves % 7 === 0 ? ' keep' : ''));
        if (nLeaves % 4 === 0) { u.classList.add('sw'); u.style.setProperty('--sd', (4 + r() * 4).toFixed(1) + 's'); u.style.setProperty('--sl', (-r() * 8).toFixed(1) + 's'); }
        anchors.push([x, y]); nLeaves++;
        if (nLeaves % 3 === 0 && blossoms < 40) { blossoms++; blossomAt(leaves, x + 4, y - 3, 0.7, 0.2 + r() * 2.2, still); }
      }
    });
    var twigCount = 0;
    thin.forEach(function (o, idx) {
      if (twigCount >= 34 || idx % 2) return;
      var c = o.p.center, pt = c[Math.round((0.35 + r() * 0.4) * (c.length - 1))], side = r() > 0.5 ? 1 : -1;
      var base = Math.atan2(pt.ty, pt.tx) + side * (0.7 + r() * 0.5), len = 26 + r() * 20, x0 = pt.x + pt.nx * pt.w / 2 * side, y0 = pt.y + pt.ny * pt.w / 2 * side;
      var dxv = Math.cos(base), dyv = Math.sin(base), curl = (r() - 0.5) * 12, x3 = x0 + dxv * len, y3 = y0 + dyv * len;
      if (inRect(x3, y3, rects, 10) || inRect(x0 + dxv * len * 0.5, y0 + dyv * len * 0.5, rects, 4)) return;
      var c1 = [x0 + dxv * len * 0.35 - dyv * curl, y0 + dyv * len * 0.35 + dxv * curl], c2 = [x0 + dxv * len * 0.7 + dyv * curl, y0 + dyv * len * 0.7 - dxv * curl];
      el('path', { class: 'ta-twig', d: 'M' + x0.toFixed(1) + ',' + y0.toFixed(1) + ' C' + c1[0].toFixed(1) + ',' + c1[1].toFixed(1) + ' ' + c2[0].toFixed(1) + ',' + c2[1].toFixed(1) + ' ' + x3.toFixed(1) + ',' + y3.toFixed(1) }, twigs);
      [0.34, 0.58, 0.8, 1].forEach(function (tt, k) {
        var bp = G.bez([x0, y0, c1[0], c1[1], c2[0], c2[1], x3, y3], tt), a = base * 180 / Math.PI + (k % 2 ? 48 : -48) + (r() * 20 - 10);
        leafAt(leaves, bp[0], bp[1], a, 0.6 + r() * 0.35, 'l' + (1 + Math.floor(r() * 3)) + (k === 1 ? ' late' : '') + (k === 0 ? ' mid' : ''));
        anchors.push([bp[0], bp[1]]);
      });
      if (blossoms < 40) { blossoms++; blossomAt(leaves, x3, y3, 0.85, 0.1 + r() * 2.4, still); }
      twigCount++;
    });
    // cards nestle in foliage: leaves tucked behind the cards (the cards sit in front of them). The outermost people, who have no children shown, get a full cluster.
    var parentIds = {};
    pl.unions.forEach(function (u) { u.parents.forEach(function (id) { parentIds[id] = true; }); });
    var nested = 0;
    nodes.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (n, i) {
      var tip = !parentIds[n.data.id];
      if (nested >= 26 || (!tip && i > 5)) return;
      nested++;
      var set = tip
        ? [[-1, -135, 12, 'c'], [1, -45, 12, 'c'], [-1, -165, 0, 's'], [1, -15, 0, 's'], [0, -100, 44, 't'], [0, -80, 0, 't'], [0, -60, -44, 't'], [-1, 160, 0, 'b'], [1, 20, 0, 'b']]
        : [[-1, -135, 12, 'c'], [1, -45, 12, 'c']];
      set.forEach(function (cn, k) {
        var x, y;
        if (cn[3] === 'c') { x = n.x + cn[0] * (CW / 2 - cn[2]); y = n.y - CH / 2 + 4; }
        else if (cn[3] === 's') { x = n.x + cn[0] * (CW / 2 - 2); y = n.y - 8; }
        else if (cn[3] === 'b') { x = n.x + cn[0] * (CW / 2 - 14); y = n.y + CH / 2 - 6; }
        else { x = n.x + cn[2]; y = n.y - CH / 2 + 3; }
        leafAt(leaves, x, y, cn[1] + (r() * 26 - 13), 0.95 + r() * 0.5, 'l' + (1 + Math.floor(r() * 3)) + ((i + k) % 2 ? ' late' : '') + ((i + k) % 3 === 0 ? ' mid' : '') + ((i + k) % 6 === 0 ? ' keep' : ''));
        if (k < 2) anchors.push([x + cn[0] * 8, y - 8]);
      });
    });

    // winter: snow resting along the upper edge of the thicker, mostly horizontal limbs
    var snow = el('g', { class: 'ta-snows' }, root), sn = 0;
    polys.forEach(function (o) {
      if (sn >= 16 || o.l.kind === 'feeder') return;
      var c = o.p.center, mid = c[Math.floor(c.length / 2)];
      if (Math.abs(mid.ty) > 0.82 || mid.w < 4.5) return;
      var s = mid.ny < 0 ? 1 : -1, pts = [];
      for (var k = Math.floor(c.length * 0.12); k < c.length * 0.88; k++) pts.push([c[k].x + c[k].nx * c[k].w * 0.5 * s, c[k].y + c[k].ny * c[k].w * 0.5 * s - 0.6]);
      if (pts.length > 3) { el('path', { class: 'ta-snow', d: pathOf(pts) }, snow); sn++; }
    });
    return { anchors: anchors, plan: pl, ground: pl.ground, extent: { x0: gx0, x1: gx1, y0: Math.min.apply(null, nodes.map(function (n) { return n.y; })) - 60 } };
  }

  /* ---------- falling leaves, petals and snow (a few, from the tree itself) ---------- */
  var FALL = { winter: { flake: 12, leaf: 3 }, spring: { petal: 5 }, summer: { leaf: 4 }, autumn: { leaf: 9 } };
  function buildFall(view, season, info) {
    var old = view.querySelector('g.ta-fall');
    if (old) old.parentNode.removeChild(old);
    if (!info || !info.ground) return 0;
    var g = el('g', { class: 'ta-fall', 'aria-hidden': 'true' });
    var tree = view.querySelector('g.ta-tree');
    tree.appendChild(g);
    var spec = FALL[season], r = Grow().rng(Grow().hash('fall' + season + info.anchors.length)), n = 0, gy = info.ground.y;
    Object.keys(spec).forEach(function (kind) {
      for (var i = 0; i < spec[kind]; i++) {
        var o, x, y, dy, sc;
        if (kind === 'flake') { x = info.extent.x0 + r() * (info.extent.x1 - info.extent.x0); y = info.extent.y0 + r() * 50; dy = (gy - y) * 0.92; sc = 0.9 + r() * 0.8; }
        else {
          if (!info.anchors.length) continue;
          o = info.anchors[Math.floor(r() * info.anchors.length)]; x = o[0]; y = o[1]; dy = Math.min(gy - y - 6, 130 + r() * 230); sc = 0.8 + r() * 0.5;
          if (!(dy > 40)) continue;
        }
        var w = el('g', { transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + sc.toFixed(2) + ')' }, g);
        var u = el('use', { href: kind === 'flake' ? '#ta-fk' : kind === 'petal' ? '#ta-pt' : '#ta-lf', class: (kind === 'leaf' ? 'ta-lf ' : '') + 'ta-fl k-' + kind + ' l' + (1 + Math.floor(r() * 3)) }, w);
        u.style.setProperty('--dx', ((r() - 0.5) * 150).toFixed(0) + 'px');
        u.style.setProperty('--dy', dy.toFixed(0) + 'px');
        u.style.setProperty('--r0', (r() * 90 - 45).toFixed(0) + 'deg');
        u.style.setProperty('--r1', (150 + r() * 260).toFixed(0) + 'deg');
        u.style.setProperty('--dur', (kind === 'flake' ? 16 + r() * 14 : 15 + r() * 14).toFixed(1) + 's');
        u.style.setProperty('--del', (-r() * 24).toFixed(1) + 's');
        n++;
      }
    });
    return n;
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
    stage.insertBefore(root, stage.firstChild);
    stage.classList.add('ta-stage');
    var visible = true, io = null, dead = false, season = 'spring', info = null, bloomed = false;

    function reduced() { return !!(mq && mq.matches); }
    function animating() { return prefs.anim && !reduced(); }
    function current() { return prefs.season === 'auto' ? autoSeason(new Date(), prefs.hemi) : prefs.season; }
    function apply() {
      season = current();
      stage.setAttribute('data-season', season);
      stage.classList.toggle('ta-on', animating());
      stage.classList.toggle('ta-still', !animating());
      var vw = chartEl.querySelector('svg.main_svg g.view');
      if (vw && info) buildFall(vw, season, info);
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
      btn.textContent = 'Seasonal animation: ' + (reduced() ? 'Off (reduced motion)' : on ? 'On' : 'Off');
      var months = (prefs.hemi === 'south' ? MONTHS_SOUTH : MONTHS_NORTH)[season];
      note.textContent = prefs.season === 'auto'
        ? 'Auto shows ' + SEASON_LABEL[season] + ' (' + months + ' in the ' + (prefs.hemi === 'south' ? 'Southern' : 'Northern') + ' Hemisphere), using this device’s date. Nothing is sent anywhere.'
        : 'Showing ' + SEASON_LABEL[season] + '. Choose Auto to follow the date.';
    }

    // the chart calls this after every redraw, with the tree it just drew
    function refresh(container, tree) {
      if (dead || !chartEl.isConnected || !tree) return;
      var vw = chartEl.querySelector('svg.main_svg g.view');
      if (!vw) return;
      try {
        info = drawTree(vw, tree, { bloomed: bloomed });
        bloomed = true;
        buildFall(vw, season, info);
        stage.classList.remove('ta-fallback');
      } catch (e) { stage.classList.add('ta-fallback'); }   // the art is optional: if it fails the chart's own connectors show again
    }
    function destroy() {
      if (dead) return; dead = true;       document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect(); if (ro) ro.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      if (root.parentNode) root.parentNode.removeChild(root);
      stage.classList.remove('ta-stage', 'ta-on', 'ta-still', 'ta-paused', 'ta-fallback'); stage.removeAttribute('data-season');
      var k = instances.indexOf(api); if (k !== -1) instances.splice(k, 1);
    }
    var api = { controls: ctlBox, refresh: refresh, layout: layout, destroy: destroy, stage: stage, season: function () { return season; }, state: function () { return { season: season, prefs: { season: prefs.season, hemi: prefs.hemi, anim: prefs.anim }, animating: animating() }; } };
    instances.push(api);
    apply();
    return api;
  }

  window.FamilyTreeArt = { mount: mount, autoSeason: autoSeason, SEASONS: SEASONS, live: function () { return instances.length; }, MONTHS_NORTH: MONTHS_NORTH, MONTHS_SOUTH: MONTHS_SOUTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.FamilyTreeArt;
}());
