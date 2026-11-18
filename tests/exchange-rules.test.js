/* Unit tests for the Family Exchange PREVIEW rules (sample limits; not approved production policy). Run: node --test tests/exchange-rules.test.js */
const test = require('node:test'), assert = require('node:assert'); const R = require('../exchange-preview/exchange-rules.js');
const base = { title: 'Oak bookshelf', category: 'Furniture', condition: 'Good', description: 'Three shelves.', area: 'Near the library', photos: ['a', 'b'] };
const mc = o => R.materialChanges(base, Object.assign({}, base, o));
test('no change is not material', () => assert.deepStrictEqual(mc({}), []));
test('extra spaces and line breaks are not material', () => assert.deepStrictEqual(mc({ description: '  Three   shelves.\n', title: 'Oak   bookshelf ', area: ' Near the  library' }), []));
test('any letter change in the title is material, including capitals', () => { assert.deepStrictEqual(mc({ title: 'oak bookshelf' }), ['title']); assert.deepStrictEqual(mc({ title: 'Oak bookcase' }), ['title']); });
test('category, condition, description and pickup area are material', () => { assert.deepStrictEqual(mc({ category: 'Other' }), ['category']); assert.deepStrictEqual(mc({ condition: 'Like new' }), ['condition']); assert.deepStrictEqual(mc({ description: 'Four shelves.' }), ['description']); assert.deepStrictEqual(mc({ area: 'Downtown' }), ['pickup area']); });
test('photos: add, remove and reorder are all material', () => { assert.deepStrictEqual(mc({ photos: ['a', 'b', 'c'] }), ['photos']); assert.deepStrictEqual(mc({ photos: ['a'] }), ['photos']); assert.deepStrictEqual(mc({ photos: ['b', 'a'] }), ['photos']); });
test('several changes are all reported', () => assert.deepStrictEqual(mc({ title: 'X', photos: [] }), ['title', 'photos']));
test('missing fields do not crash', () => assert.deepStrictEqual(R.materialChanges({}, {}), []));
test('anyChanges sees spacing-only differences even though they are not material', () => {
  const sp = Object.assign({}, base, { description: 'Three  shelves.' });
  assert.deepStrictEqual(R.materialChanges(base, sp), []); assert.strictEqual(R.anyChanges(base, sp), true); assert.strictEqual(R.anyChanges(base, Object.assign({}, base)), false);
  assert.strictEqual(R.anyChanges(base, Object.assign({}, base, { photos: ['b', 'a'] })), true);
});
