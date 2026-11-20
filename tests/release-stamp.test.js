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
const build = require('../tools/build-site');
test('the source tree is deliberately unstamped; the build stamps and validates it', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'release.json')));
  assert.ok(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('<meta name="fc-release" content="">'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-site-')), r = build.build(out);
  assert.ok(r.ok, r.problems.join('; ')); assert.match(r.id, /^[a-f0-9]{16}$/);
  assert.ok(!fs.existsSync(path.join(out, '.github')) && !fs.existsSync(path.join(out, '.git')));
  assert.ok(fs.existsSync(path.join(out, 'function', 'src', 'logic.js')), 'everything else is published as before');
  assert.equal(build.build(out).id, r.id, 'same source, same id');
});
test('the build is refused (and so is publishing) when the stamp or the page is inconsistent', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-site-')); const ok = build.build(out); assert.ok(ok.ok);
  const idx = path.join(out, 'index.html'), orig = fs.readFileSync(idx, 'utf8');
  fs.writeFileSync(idx, orig.replace(/content="[a-f0-9]{16}"/, 'content="0000000000000000"')); assert.equal(build.validate(out).ok, false);
  fs.writeFileSync(idx, orig); fs.writeFileSync(path.join(out, 'release.json'), '{"schema":1,"id":"0000000000000000","entry":"index.html"}'); assert.equal(build.validate(out).ok, false);
  fs.writeFileSync(path.join(out, 'release.json'), '{broken'); assert.equal(build.validate(out).ok, false);
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify({ schema: 1, id: ok.id, entry: 'index.html' }, null, 2) + '\n'); fs.unlinkSync(path.join(out, 'app.js')); assert.equal(build.validate(out).ok, false);
  assert.throws(() => build.build(ROOT), /refusing/);
});
test('the workflow uses no secrets, pins every action to a full SHA and gates deploy on build', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/publish-site.yml'), 'utf8');
  assert.ok(!/secrets\.|APPWRITE/i.test(y.replace(/^\s*#.*$/gm, '')));
  for (const m of y.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[a-f0-9]{40}$/);
  assert.match(y, /needs: build/); assert.match(y, /node tools\/build-site\.js _site/); assert.match(y, /path: _site/);
  assert.doesNotMatch(y, /pull_request|schedule/);
});
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
