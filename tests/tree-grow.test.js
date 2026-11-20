/* Unit tests for tree-grow.js: the geometry that grows limbs between family cards. Pure data in, data out. Synthetic people only. */
const test = require('node:test');
const assert = require('node:assert');
const G = require('../tree-grow.js');

const P = (id, x, y, parents, partners) => ({ id, x, y, parents: parents || [], partners: partners || [] });
const branches = pl => pl.limbs.filter(l => l.kind === 'branch');
const trunks = pl => pl.limbs.filter(l => l.kind === 'trunk');

// a couple at the bottom, two children above
const family = () => [P('a', -115, 0, [], ['b']), P('b', 115, 0, [], ['a']), P('c1', -115, -150, ['a', 'b']), P('c2', 115, -150, ['a', 'b'])];

test('a couple with two children: one trunk, one bough, one branch per child, knot between the parents', () => {
  const pl = G.plan(family());
  assert.strictEqual(trunks(pl).length, 1);
  assert.strictEqual(pl.limbs.filter(l => l.kind === 'bough').length, 1);
  assert.strictEqual(branches(pl).length, 2);
  assert.deepStrictEqual(pl.knots.map(k => [k.x, k.y]), [[0, 0]]);
  assert.deepStrictEqual(branches(pl).map(l => l.child).sort(), ['c1', 'c2']);
});

test('limbs run from parents up to the child and only the child they lead to (no invented connections)', () => {
  const people = [...family(), P('x', 400, 0), P('y', 400, -150, ['x'])];
  const pl = G.plan(people);
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  branches(pl).forEach(l => assert.deepStrictEqual(l.parents.slice().sort(), byId[l.child].parents.slice().sort()));
  assert.strictEqual(branches(pl).length, people.filter(p => p.parents.length).length);
  // x and the couple are different families: no limb mentions both
  pl.limbs.filter(l => l.parents).forEach(l => assert.ok(!(l.parents.includes('x') && l.parents.includes('a'))));
});

test('partners are joined by a partner link, never by a limb', () => {
  const pl = G.plan([P('a', 0, 0, [], ['b']), P('b', 230, 0, [], ['a'])]);
  assert.strictEqual(pl.partnerLinks.length, 1);
  assert.strictEqual(branches(pl).length, 0);
  assert.strictEqual(pl.limbs.filter(l => l.kind !== 'trunk').length, 0);
});

test('partner links are made once, even when only one side lists the partner', () => {
  const pl = G.plan([P('a', 0, 0, [], ['b']), P('b', 230, 0, [], [])]);
  assert.strictEqual(pl.partnerLinks.length, 1);
});

test('several roots grow several trunks; a person with nobody shown still gets a trunk and no limbs', () => {
  const people = [...family(), P('r2a', 600, 0, [], ['r2b']), P('r2b', 830, 0, [], ['r2a']), P('lone', 1200, 0)];
  const pl = G.plan(people);
  assert.strictEqual(trunks(pl).length, 3);
  assert.strictEqual(branches(pl).length, 2);
});

test('a person who is a partner of someone with parents is not a root', () => {
  const people = [P('g1', 0, 100), P('g2', 230, 100, [], ['g1']), P('m', 0, 0, ['g1', 'g2'], ['t']), P('t', 230, 0, [], ['m']), P('k', 0, -150, ['m', 't'])];
  const pl = G.plan(people);
  assert.strictEqual(trunks(pl).length, 1);
  assert.deepStrictEqual(trunks(pl)[0].root.sort(), ['g1', 'g2']);
});

test('one parent with a partner who is not the other parent: each child limb starts where its own parents are', () => {
  // g1 has partner g2 (child m with both) and another child j with g1 alone
  const people = [P('g1', 0, 0, [], ['g2']), P('g2', 230, 0, [], ['g1']), P('m', 115, -150, ['g1', 'g2']), P('j', -150, -150, ['g1'])];
  const pl = G.plan(people);
  const bm = branches(pl).find(l => l.child === 'm'), bj = branches(pl).find(l => l.child === 'j');
  assert.deepStrictEqual(bm.parents, ['g1', 'g2']);
  assert.deepStrictEqual(bj.parents, ['g1']);
  assert.ok(Math.abs(bm.c[0] - 115) < 1, 'the couple limb starts at the knot between them');
  assert.ok(Math.abs(bj.c[0] - 0) < 1, 'the single-parent limb starts at g1, not at the couple knot');
});

test('limbs are thicker where they carry more people and thin out toward each person', () => {
  const people = [...family(), P('g1', -115, -300, ['c1']), P('g2', 115, -300, ['c2'])];
  const pl = G.plan(people);
  const trunk = trunks(pl)[0], bough = pl.limbs.find(l => l.kind === 'bough');
  assert.ok(trunk.w1 >= bough.w0 - 1, 'trunk is at least as thick as the bough it feeds');
  branches(pl).forEach(l => assert.ok(l.w1 <= l.w0 + 0.01, 'a branch never widens toward its child'));
  assert.ok(trunk.w0 > trunk.w1, 'the trunk flares at the ground');
  pl.limbs.forEach(l => { assert.ok(l.w0 <= G.WMAX * 1.9 + 14); assert.ok(l.w1 >= 1); });
});

test('the trunk starts below the lowest card (the ground) and children grow upward', () => {
  const pl = G.plan(family());
  const t = trunks(pl)[0];
  assert.ok(t.c[1] > 28, 'ground is below the bottom edge of the lowest cards');
  branches(pl).forEach(l => assert.ok(l.c[7] < l.c[1], 'a branch ends higher than it starts'));
});

test('bad data does not hang or throw: a parent loop, a missing parent, a self-parent', () => {
  const people = [P('a', 0, 0, ['b']), P('b', 230, 0, ['a']), P('c', 0, -150, ['ghost', 'c']), P('d', 460, 0, [], ['d', 'nobody'])];
  const t0 = Date.now(), pl = G.plan(people);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(Array.isArray(pl.limbs));
  assert.strictEqual(pl.partnerLinks.length, 0);
});

test('an empty tree is fine', () => {
  const pl = G.plan([]);
  assert.deepStrictEqual(pl.limbs, []);
  assert.strictEqual(pl.ground, null);
});

test('shapes: a polygon has two sides, finite numbers and the requested taper', () => {
  const pl = G.plan(family());
  pl.limbs.forEach(l => {
    const poly = G.polygon(l);
    assert.ok(poly.left.length >= 11 && poly.left.length === poly.right.length);
    poly.left.concat(poly.right).forEach(p => { assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1])); });
    assert.match(G.pathD(poly), /^M[\d.,\-L]+Z$/);
  });
});

test('a big synthetic family is planned quickly and every child has exactly one branch', () => {
  const people = []; let n = 0;
  function couple(x, y) { const a = 'p' + (++n), b = 'p' + (++n); people.push(P(a, x, y, [], [b]), P(b, x + 230, y, [], [a])); return [a, b]; }
  const root = couple(0, 600); let layer = [root];
  for (let g = 1; g < 4; g++) { const next = []; layer.forEach((pr, i) => { for (let k = 0; k < 3; k++) { const c = 'c' + (++n); people.push(P(c, i * 700 + k * 230, 600 - g * 150, pr.slice())); const sp = 's' + (++n); people.push(P(sp, i * 700 + k * 230 + 115, 600 - g * 150, [], [c])); next.push([c, sp]); } }); layer = next; }
  const t0 = Date.now(), pl = G.plan(people);
  assert.ok(Date.now() - t0 < 1000);
  assert.strictEqual(branches(pl).length, people.filter(p => p.parents.length).length);
});
