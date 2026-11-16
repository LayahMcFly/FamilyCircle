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
test('a snapshot never carries ids, favourites, sources, photos or private fields', () => {
  const s = C.snapshotOf({ name: 'A', ingredients: ['x'], steps: ['y'], id: 'book-1', fav: true, source: 'http://x', slug: 's', image: SQ });
  assert.deepEqual(Object.keys(s).filter(k => ['id', 'fav', 'source', 'slug', 'image'].includes(k)), []);
});
const SQ = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivGPaCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=', WIDE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivGPaCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==';
test('validation: name, an ingredient and a step are required; the photo must be a real square JPEG within the size limit', () => {
  assert.equal(C.validate({ name: '', ingredients: [], steps: [] }).ok, false);
  assert.deepEqual(C.jpegDims(SQ), { w: 64, h: 64 }); assert.deepEqual(C.jpegDims(WIDE), { w: 96, h: 64 });
  const d = { name: 'A', ingredients: ['x'], steps: ['y'], image: SQ };
  assert.equal(C.validate(d).ok, false);                                                     // a photo with no processed copy is refused
  assert.equal(C.validate(d, { photo: WIDE, thumb: SQ }).ok, false);                         // not square
  assert.equal(C.validate(d, { photo: SQ, thumb: WIDE }).ok, false);
  assert.equal(C.validate(d, { photo: 'data:image/jpeg;base64,AAAA', thumb: SQ }).ok, false);  // not a readable JPEG
  assert.equal(C.validate(d, { photo: 'data:text/html;base64,AAAA', thumb: SQ }).ok, false);
  const ok = C.validate(d, { photo: SQ, thumb: SQ }); assert.equal(ok.ok, true); assert.equal(ok.hasPhoto, true);
  assert.equal(C.validate({ name: 'A', ingredients: ['x'], steps: ['y'] }).hasPhoto, false);
});
test('the hash changes with the text, the photo or a sub-recipe, and not with private fields', () => {
  const base = { name: 'A', ingredients: ['x'], steps: ['y'], fav: false };
  const h = d => C.hashOf(C.snapshotOf(d), C.imageKeyOf(d));
  assert.equal(h(base), h(Object.assign({}, base, { fav: true, source: 'http://x', id: 'z' })));
  assert.notEqual(h(base), h(Object.assign({}, base, { steps: ['y2'] })));
  assert.notEqual(h(base), h(Object.assign({}, base, { image: SQ })));
  assert.notEqual(h(base), h(Object.assign({}, base, { parts: [{ name: 'Sauce', ingredients: ['a'], steps: ['b'] }] })));
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
