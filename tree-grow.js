/*
 * tree-grow.js: turns the family chart's card positions into the limbs of a tree. Pure geometry: no DOM, no network, no storage.
 *
 * Input: the people the chart is showing, each { id, x, y, parents: [ids], partners: [ids] } (x and y are the card centres).
 * Older generations are lower on the screen and younger ones higher, so the oldest people sit on the trunk and descendants grow upward.
 *
 * What gets drawn, and what each piece means:
 *   - A limb only ever runs from the people who ARE parents (the "union": one parent, or two parents together) up to the child it leads to.
 *     No limb joins two people unless one is a displayed parent of the other. Nothing is added to make the picture look fuller.
 *   - A union of two parents starts at a knot between their cards. A single parent's limb starts at that parent's card.
 *   - Where one union has several children, a bough rises from the knot and divides at a junction into one branch per child.
 *   - Limb thickness follows how many people it carries (area rule: a limb is as thick as the limbs above it put together), so limbs are
 *     substantial near shared junctions and taper to a thin end at each person.
 *   - People with no displayed parents are roots: a trunk rises from the ground to them. Several roots give several trunks in one scene.
 *   - Partners are NOT joined by a limb. They get a separate gold dashed link between their cards.
 */
(function (root) {
  'use strict';

  var WLEAF = 6.6, WMAX = 36;

  function hash(str) { var h = 2166136261; str = String(str); for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function uniq(a) { var o = [], s = {}; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function avg(a) { var s = 0; a.forEach(function (v) { s += v; }); return a.length ? s / a.length : 0; }
  function key(p) { return Math.round(p.x) + ',' + Math.round(p.y); }

  function plan(people, cfg) {
    cfg = cfg || {};
    var CW = cfg.cardW || 170, CH = cfg.cardH || 56, DROP = cfg.groundDrop == null ? 110 : cfg.groundDrop;
    var by = {}, src = {}, list = [];
    (people || []).forEach(function (p) {
      if (!p || by[p.id]) return;
      src[p.id] = p;
      var n = { id: p.id, x: p.x, y: p.y, par: [], pt: [], cp: [] };
      by[p.id] = n; list.push(n);
    });
    if (!list.length) return { limbs: [], hubs: [], knots: [], partnerLinks: [], ground: null, unions: [], roots: [] };

    list.forEach(function (n) {
      n.par = uniq((src[n.id].parents || []).filter(function (i) { return by[i] && i !== n.id; }));
      n.pt = uniq((src[n.id].partners || []).filter(function (i) { return by[i] && i !== n.id; }));
    });
    list.forEach(function (n) { n.pt.forEach(function (q) { if (by[q].pt.indexOf(n.id) < 0) by[q].pt.push(n.id); }); });

    // "couples": partners, plus two people who are the displayed parents of the same displayed child
    list.forEach(function (n) { n.cp = n.pt.slice(); });
    list.forEach(function (c) {
      if (c.par.length === 2) {
        var a = by[c.par[0]], b = by[c.par[1]];
        if (a.cp.indexOf(b.id) < 0) a.cp.push(b.id);
        if (b.cp.indexOf(a.id) < 0) b.cp.push(a.id);
      }
    });
    // an exclusive pair: each is the other's only couple, side by side on one row. Their knot sits between the two cards.
    list.forEach(function (n) {
      if (n.cp.length !== 1) return;
      var q = by[n.cp[0]];
      if (q.cp.length === 1 && Math.abs(q.y - n.y) < 6) n.pair = q.id;
    });
    list.forEach(function (n) {
      n.anchor = n.pair ? { x: (n.x + by[n.pair].x) / 2, y: (n.y + by[n.pair].y) / 2 } : { x: n.x, y: n.y + CH / 2 };
      n.ak = key(n.anchor);
    });

    // unions: the people who are parents of the same child(ren)
    var unions = {}, ulist = [];
    list.forEach(function (c) {
      if (!c.par.length) return;
      var k = c.par.slice().sort().join('|'), u = unions[k];
      if (!u) { u = unions[k] = { key: k, parents: c.par.slice().sort(), kids: [] }; ulist.push(u); }
      u.kids.push(c.id);
    });
    ulist.forEach(function (u) {
      var ps = u.parents.map(function (i) { return by[i]; });
      if (ps.length === 1) u.origin = { x: ps[0].x, y: ps[0].y };
      else if (ps.length === 2 && ps[0].pair === ps[1].id) u.origin = { x: ps[0].anchor.x, y: ps[0].anchor.y };
      else u.origin = { x: avg(ps.map(function (p) { return p.x; })), y: avg(ps.map(function (p) { return p.y; })) };
    });

    var unionsAt = {}, feeders = [];
    ulist.forEach(function (u) {
      u.parents.forEach(function (pid) {
        var p = by[pid]; unionsAt[p.ak] = unionsAt[p.ak] || [];
        if (unionsAt[p.ak].indexOf(u) < 0) unionsAt[p.ak].push(u);
        var dx = u.origin.x - p.anchor.x, dy = u.origin.y - p.anchor.y;
        if (Math.sqrt(dx * dx + dy * dy) > 3) feeders.push({ person: pid, union: u.key, a: p.anchor, b: u.origin });
      });
    });
    var inCount = {};
    list.forEach(function (n) { if (n.par.length) inCount[n.ak] = (inCount[n.ak] || 0) + 1; });

    // thickness: the area rule
    var memoU = {}, memoA = {}, busy = {};
    function wOutU(u) {
      if (memoU[u.key] != null) return memoU[u.key];
      if (busy[u.key]) return WLEAF; busy[u.key] = 1;
      var s = 0; u.kids.forEach(function (k) { var e = wEnd(by[k]); s += e * e; });
      delete busy[u.key];
      return (memoU[u.key] = Math.min(WMAX, Math.sqrt(s) * 1.1));
    }
    function wNeed(ak) {
      if (memoA[ak] != null) return memoA[ak];
      var s = 0; (unionsAt[ak] || []).forEach(function (u) { var w = wOutU(u); s += w * w; });
      return (memoA[ak] = Math.max(WLEAF, Math.min(WMAX, Math.sqrt(s))));
    }
    function wEnd(n) { return Math.max(WLEAF, wNeed(n.ak) / Math.sqrt(Math.max(1, inCount[n.ak] || 1))); }

    var limbs = [], hubs = [], knots = [];
    ulist.forEach(function (u) {
      var o = u.origin, wU = wOutU(u), r = rng(hash(u.key));
      var kids = u.kids.map(function (k) { return by[k]; }).sort(function (a, b) { return a.x - b.x; });
      var ends = kids.map(function (k) { return { id: k.id, p: k.anchor, w: wEnd(k) }; });
      var gap = o.y - avg(ends.map(function (e) { return e.p.y; }));
      knots.push({ x: o.x, y: o.y, w: wU, union: u.key, pair: u.parents.length === 2 });
      if (ends.length === 1 || !(gap > 24)) {
        ends.forEach(function (e) {
          var g = Math.max(24, o.y - e.p.y), sway = (r() - 0.5) * 16;
          limbs.push({ kind: 'branch', union: u.key, parents: u.parents, child: e.id, c: [o.x, o.y, o.x + sway, o.y - g * 0.45, e.p.x, e.p.y + g * 0.45, e.p.x, e.p.y], w0: Math.min(WMAX, wU * 1.04), w1: e.w });
        });
        return;
      }
      var mx = avg(ends.map(function (e) { return e.p.x; }));
      var hub = { x: o.x + (mx - o.x) * 0.3 + (r() - 0.5) * 10, y: o.y - gap * 0.40 };
      limbs.push({ kind: 'bough', union: u.key, parents: u.parents, c: [o.x, o.y, o.x, o.y - gap * 0.2, hub.x, hub.y + gap * 0.18, hub.x, hub.y], w0: Math.min(WMAX, wU * 1.04), w1: wU * 0.9 });
      hubs.push({ x: hub.x, y: hub.y, w: wU * 0.9, union: u.key });
      ends.forEach(function (e) {
        var dy = hub.y - e.p.y;
        limbs.push({ kind: 'branch', union: u.key, parents: u.parents, child: e.id, c: [hub.x, hub.y, hub.x + (e.p.x - hub.x) * 0.25, hub.y - dy * 0.28, e.p.x, e.p.y + dy * 0.5, e.p.x, e.p.y], w0: Math.min(wU * 0.9, e.w * 1.18 + 0.8), w1: e.w });
      });
    });
    feeders.forEach(function (f) {
      var u = unions[f.union], w = Math.max(WLEAF, wOutU(u) * 0.9), dx = f.b.x - f.a.x;
      limbs.push({ kind: 'feeder', union: f.union, parents: u.parents, person: f.person, c: [f.a.x, f.a.y, f.a.x + dx * 0.4, f.a.y - 10, f.b.x - dx * 0.4, f.b.y + 10, f.b.x, f.b.y], w0: w, w1: w });
    });

    // roots and trunks
    var maxBottom = Math.max.apply(null, list.map(function (n) { return n.y + CH / 2; }));
    var minX = Math.min.apply(null, list.map(function (n) { return n.x; })) - CW / 2, maxX = Math.max.apply(null, list.map(function (n) { return n.x; })) + CW / 2;
    var groundY = maxBottom + DROP, roots = {};
    list.forEach(function (n) { if (n.par.length || inCount[n.ak]) return; if (roots[n.ak]) roots[n.ak].ids.push(n.id); else roots[n.ak] = { anchor: n.anchor, ids: [n.id] }; });
    Object.keys(roots).forEach(function (k) {
      var a = roots[k].anchor, r = rng(hash('root' + k)), top = Math.min(30, Math.max(15, wNeed(k) * 1.2 + 3)), lean = (r() - 0.5) * 20, rise = groundY - a.y;
      limbs.push({ kind: 'trunk', root: roots[k].ids, c: [a.x + lean, groundY, a.x + lean * 0.2, groundY - rise * 0.35, a.x - lean * 0.3, a.y + rise * 0.3, a.x, a.y], w0: top * 1.9 + 14, w1: top, flare: true });
    });

    var partnerLinks = [];
    list.forEach(function (n) {
      n.pt.forEach(function (q) { if (n.id < q) partnerLinks.push({ a: n.id, b: q, ax: n.x, ay: n.y, bx: by[q].x, by: by[q].y, pair: n.pair === q }); });
    });
    return { limbs: limbs, hubs: hubs, knots: knots, partnerLinks: partnerLinks, unions: ulist, roots: Object.keys(roots).map(function (k) { return roots[k]; }),
      ground: { y: groundY, x0: minX - 30, x1: maxX + 30 }, widthOf: function (id) { return wEnd(by[id]); } };
  }

  /* ---------- shapes ---------- */
  function bez(c, t) {
    var u = 1 - t;
    return [u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6], u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7]];
  }
  function tan(c, t) {
    var u = 1 - t;
    var dx = 3 * u * u * (c[2] - c[0]) + 6 * u * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]);
    var dy = 3 * u * u * (c[3] - c[1]) + 6 * u * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]);
    var l = Math.sqrt(dx * dx + dy * dy) || 1; return [dx / l, dy / l];
  }
  function widthAt(l, t) {
    var w = l.flare ? l.w1 + (l.w0 - l.w1) * Math.pow(1 - t, 2.4) : l.w0 + (l.w1 - l.w0) * Math.pow(t, 0.85);
    return w;
  }
  function sample(l, n) {
    var c = l.c, len = 0, i, a = bez(c, 0);
    for (i = 1; i <= 12; i++) { var b = bez(c, i / 12); len += Math.hypot(b[0] - a[0], b[1] - a[1]); a = b; }
    n = n || Math.max(10, Math.min(44, Math.round(len / 8)));
    var out = [], ph = (hash(l.union || l.root || 'x') % 100) / 16;
    for (i = 0; i <= n; i++) {
      var t = i / n, p = bez(c, t), d = tan(c, t), w = widthAt(l, t) * (1 + Math.sin(t * 8 + ph) * 0.045);
      out.push({ x: p[0], y: p[1], tx: d[0], ty: d[1], nx: -d[1], ny: d[0], w: w, t: t });
    }
    out.len = len;
    return out;
  }
  function polygon(l) {
    var s = sample(l), left = [], right = [];
    s.forEach(function (p) { left.push([p.x + p.nx * p.w / 2, p.y + p.ny * p.w / 2]); right.push([p.x - p.nx * p.w / 2, p.y - p.ny * p.w / 2]); });
    return { left: left, right: right, center: s };
  }
  function pathD(poly) {
    function f(p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }
    return 'M' + poly.left.map(f).join('L') + 'L' + poly.right.slice().reverse().map(f).join('L') + 'Z';
  }

  var api = { plan: plan, sample: sample, polygon: polygon, pathD: pathD, bez: bez, tan: tan, hash: hash, rng: rng, WLEAF: WLEAF, WMAX: WMAX };
  root.FamilyTreeGrow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : this));
