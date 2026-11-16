/* Rules and fake-server tests for Recipes family publishing. These prove the RULES and the preview; they do NOT prove live Appwrite permissions. */
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../../recipes-pub-core.js'), F = require('../../recipes-publishing-preview/recipes-pub-fake-server.js');
const drafts = F.sampleDrafts();
const dr = (u, slug) => drafts[u].filter(r => r.slug === slug)[0];
const lib = (s, u, f, q) => s.call(u, 'library', { familyId: f, q });
const names = r => r.recipes.map(x => x.name);

test('labels and the confirmation text match the spec exactly', () => {
  assert.equal(C.TEXT.privateLabel, 'Private to you'); assert.equal(C.TEXT.publishedLabel('Happy Family'), 'Published to Happy Family');
  assert.equal(C.TEXT.publishBtn, 'Publish to family'); assert.equal(C.TEXT.unpublishBtn, 'Unpublish'); assert.equal(C.TEXT.updateBtn, 'Update published version');
  assert.equal(C.TEXT.publishConfirm('Happy Family'), 'This recipe will be visible to members of Happy Family. They can print it or save a copy using their device.');
  assert.match(C.TEXT.unpublishNote, /cannot recall pages already printed, files already downloaded, screenshots or copies/);
});
test('a snapshot never carries ids, favourites, sources or private fields', () => {
  const s = C.snapshotOf({ name: 'A', ingredients: ['x'], steps: ['y'], id: 'book-1', fav: true, source: 'http://x', slug: 's' });
  assert.deepEqual(Object.keys(s).filter(k => ['id', 'fav', 'source', 'slug'].includes(k)), []);
});
test('validation: name, an ingredient and a step are required; the photo must be a square JPEG', () => {
  assert.equal(C.validate({ name: '', ingredients: [], steps: [] }).ok, false);
  assert.equal(C.validate({ name: 'A', ingredients: ['x'], steps: ['y'], image: 'data:image/jpeg;base64,AAAA', imageW: 800, imageH: 600 }).fields.image.length > 0, true);
  const ok = C.validate({ name: 'A', ingredients: ['x'], steps: ['y'], image: 'data:image/jpeg;base64,AAAA', imageW: 800, imageH: 800 });
  assert.equal(ok.ok, true); assert.equal(ok.snapshot.image, 'data:image/jpeg;base64,AAAA');
  assert.equal(C.validate({ name: 'A', ingredients: ['x'], steps: ['y'], image: 'data:text/html;base64,AAAA', imageW: 5, imageH: 5 }).ok, false);
});
test('the library shows only this family\'s published recipes, never drafts or another family', () => {
  const s = F.create();
  assert.deepEqual(names(lib(s, 'u-sam', 'fHappy')), ["Gran's Sourdough", 'Lemon Bars']);
  assert.ok(!names(lib(s, 'u-sam', 'fHappy')).includes('Secret Spice Rub') && !names(lib(s, 'u-sam', 'fHappy')).includes('Sunday Pancakes'));
  assert.deepEqual(names(lib(s, 'u-rae', 'fBeta')), ['Beta Family Chili']);
  assert.equal(lib(s, 'u-una', 'fHappy').error, 'not_available');
});
test('private by default: a new draft is invisible until published, even to the owner and admin', () => {
  const s = F.create();
  for (const u of ['u-rae', 'u-sam', 'u-tia']) assert.ok(!names(lib(s, u, 'fHappy')).includes('Sunday Pancakes'));
  assert.equal(s.admin.roleOf('u-rae', 'fHappy'), 'owner');
});
test('owner and admin get no reading or editing rights over someone else\'s recipe', () => {
  const s = F.create();
  const tia = lib(s, 'u-tia', 'fHappy').recipes.filter(r => r.name === 'Lemon Bars')[0];
  for (const u of ['u-rae', 'u-sam']) {
    assert.equal(s.call(u, 'update', { familyId: 'fHappy', id: tia.id, draft: dr('u-tia', 'lemon-bars') }).error, 'not_available');
    assert.equal(s.call(u, 'unpublish', { familyId: 'fHappy', id: tia.id }).error, 'not_available');
    assert.equal(s.call(u, 'copyBack', { familyId: 'fHappy', id: tia.id }).error, 'not_available');
  }
  assert.equal(s.call('u-tia', 'copyBack', { familyId: 'fHappy', id: tia.id }).ok, true);
});
test('publish, edit stays private until "Update published version", then unpublish blocks every route', () => {
  const s = F.create(); const d = dr('u-sam', 'sams-chili');
  const p = s.call('u-sam', 'publish', { familyId: 'fHappy', draft: d }); assert.equal(p.ok, true); assert.equal(p.version, 1);
  assert.equal(s.call('u-sam', 'publish', { familyId: 'fHappy', draft: d }).error, 'exists');
  const edited = Object.assign({}, d, { steps: ['Brown the beef.', 'Simmer 2 hours.'] });
  assert.equal(C.stateOf(edited, { hash: p.hash }), 'changed'); assert.equal(C.stateOf(d, { hash: p.hash }), 'published'); assert.equal(C.stateOf(d, null), 'private');
  assert.deepEqual(s.call('u-tia', 'get', { familyId: 'fHappy', id: p.id }).recipe.steps, ['Brown the beef.', 'Add the rest and simmer 1 hour.']);
  const u = s.call('u-sam', 'update', { familyId: 'fHappy', id: p.id, draft: edited }); assert.equal(u.version, 2);
  assert.deepEqual(s.call('u-tia', 'get', { familyId: 'fHappy', id: p.id }).recipe.steps, ['Brown the beef.', 'Simmer 2 hours.']);
  assert.equal(s.call('u-sam', 'unpublish', { familyId: 'fHappy', id: p.id }).ok, true);
  assert.equal(s.call('u-tia', 'get', { familyId: 'fHappy', id: p.id }).error, 'not_available');
  assert.ok(!names(lib(s, 'u-tia', 'fHappy', 'chili')).includes("Sam's Chili"));
});
test('direct id from another family or a non-member gets the same answer as an id that does not exist', () => {
  const s = F.create(); const rae = lib(s, 'u-rae', 'fHappy').recipes[0];
  const a = s.call('u-una', 'get', { familyId: 'fHappy', id: rae.id }), b = s.call('u-una', 'get', { familyId: 'fHappy', id: 'rp-nope' }), c = s.call('u-una', 'get', { familyId: 'fBeta', id: rae.id });
  assert.deepEqual(a, b); assert.deepEqual(c, b);
});
test('title search finds by title only', () => {
  const s = F.create();
  assert.deepEqual(names(lib(s, 'u-sam', 'fHappy', 'lemon')), ['Lemon Bars']);
  assert.deepEqual(names(lib(s, 'u-sam', 'fHappy', 'flour')), []);   // an ingredient is not searched
});
test('a reader who is removed loses access at once', () => {
  const s = F.create(); s.admin.removeMember('u-tia', 'fHappy');
  assert.equal(lib(s, 'u-tia', 'fHappy').error, 'not_available');
});
test('author removed: items hidden at once, deleted after 30 days, never restored by re-inviting', () => {
  const s = F.create(); s.admin.removeMember('u-tia', 'fHappy');
  assert.ok(!names(lib(s, 'u-sam', 'fHappy')).includes('Lemon Bars')); assert.equal(s.admin.hiddenCount('fHappy'), 1);
  s.admin.reinvite('u-tia', 'fHappy');
  assert.ok(!names(lib(s, 'u-sam', 'fHappy')).includes('Lemon Bars'));
  assert.deepEqual(s.call('u-tia', 'mine', { familyId: 'fHappy' }).pubs, []);   // the new membership does not own the old row
  s.admin.advanceDays(29); assert.equal(s.admin.hiddenCount('fHappy'), 1);
  s.admin.advanceDays(1); assert.equal(s.admin.hiddenCount('fHappy'), 0);
  assert.equal(s.call('u-tia', 'publish', { familyId: 'fHappy', draft: dr('u-tia', 'lemon-bars') }).ok, true);   // can republish from the device draft
});
test('author account deleted: their publications are gone; family deleted: all its publications are gone', () => {
  const s = F.create(); const before = s.admin.rowCount();
  s.admin.deleteAccount('u-tia'); assert.equal(s.admin.rowCount(), before - 1);
  s.admin.deleteFamily('fHappy'); assert.equal(s.admin.rowCount(), 1);
});
test('publishing to one family never reaches the other', () => {
  const s = F.create(); s.call('u-rae', 'publish', { familyId: 'fBeta', draft: dr('u-rae', 'sunday-pancakes') });
  assert.ok(names(lib(s, 'u-una', 'fBeta')).includes('Sunday Pancakes')); assert.ok(!names(lib(s, 'u-sam', 'fHappy')).includes('Sunday Pancakes'));
});
