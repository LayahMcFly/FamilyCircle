/* Offline checks of the release stamp. Run: node --test tests/release-stamp.test.js */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const lib = require('../tools/stamp-release');
const ROOT = path.resolve(__dirname, '..');
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-stamp-'));
  for (const f of lib.shippedFiles(ROOT)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); }
  fs.writeFileSync(path.join(dir, 'maintenance.json'), '{"on":false}');
  return dir;
}
test('the committed stamp is current (run: node tools/stamp-release.js)', () => { const r = lib.check(ROOT); assert.ok(r.ok, r.problems.join('; ')); });
test('stamping is idempotent and the id is 16 hex characters', () => { const d = copy(); const a = lib.stamp(d), b = lib.stamp(d); assert.equal(a, b); assert.match(a, /^[a-f0-9]{16}$/); assert.ok(lib.check(d).ok); });
test('any change to a shipped file changes the id; undoing it restores the same id (rollback = a different id, then the old one again)', () => {
  const d = copy(), a = lib.stamp(d), f = path.join(d, 'app.js'), orig = fs.readFileSync(f);
  fs.appendFileSync(f, '\n// change\n'); assert.equal(lib.check(d).ok, false); const b = lib.stamp(d); assert.notEqual(a, b);
  fs.writeFileSync(f, orig); assert.equal(lib.stamp(d), a);
});
test('maintenance.json and release.json are not part of the release identity', () => {
  const d = copy(), a = lib.stamp(d); fs.writeFileSync(path.join(d, 'maintenance.json'), '{"on":true}'); assert.equal(lib.computeId(d), a);
  fs.writeFileSync(path.join(d, 'release.json'), 'x'); assert.equal(lib.computeId(d), a);
});
test('index.html carries the id in the meta tag and in every local ?v= value, and release.json matches', () => {
  const d = copy(), id = lib.stamp(d), html = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  assert.ok(html.includes('<meta name="fc-release" content="' + id + '">'));
  const vs = [...html.matchAll(/\?v=([^"]*)"/g)].map((m) => m[1]); assert.ok(vs.length > 10); assert.ok(vs.every((v) => v === id));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'release.json'), 'utf8')), { schema: 1, id, entry: 'index.html' });
});
test('the release checker is loaded by index.html before app.js and uses no storage or service worker', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.ok(html.indexOf('release-check.js') > 0 && html.indexOf('release-check.js') < html.indexOf('app.js?v='));
  assert.ok(!/serviceWorker\.register/.test(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')));
});
