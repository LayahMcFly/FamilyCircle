/* What the publish workflow builds. Run: node --test tests/build-site.test.js */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const build = require('../tools/build-site'), lib = require('../tools/stamp-release');
const ROOT = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-art-')), result = build.build(out);
const has = (f) => fs.existsSync(path.join(out, f));
const walk = (d, rel = '', acc = []) => { for (const e of fs.readdirSync(path.join(d, rel), { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; e.isDirectory() ? walk(d, r, acc) : acc.push(r); } return acc; };

test('the artifact builds and validates', () => { assert.ok(result.ok, result.problems.join('; ')); assert.match(result.id, /^[a-f0-9]{16}$/); });

test('required website files, shared assets, licences and the three preview routes are present', () => {
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^":?#]+)(?:\?[^"]*)?"/g)].map((m) => m[1]).filter((f) => !/^https?:/.test(f));
  assert.ok(refs.length > 20); for (const f of refs) assert.ok(has(f), 'index.html needs ' + f);
  for (const f of ['index.html', 'release.json', 'release-check.js', 'maintenance.json', 'fonts.css', 'styles.css', 'themes.css', 'face-frame.html', 'cookbook.js', 'call-effects.js', 'emoji-data.js',
    'LICENSE', 'LICENSE-GPL-3.0.txt', 'THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES-cookbook.txt', 'vendor/d3.min.js', 'vendor/family-chart.min.js', 'vendor/livekit-client.umd.js',
    'vendor/mediapipe/selfie_segmentation.tflite', 'vendor/transformers/transformers.min.js', 'exchange-preview/index.html', 'giving-preview/index.html', 'recipes-publishing-preview/index.html']) assert.ok(has(f), f);
  assert.ok(walk(out, 'fonts').length > 0 && walk(out, 'exchange-preview').length >= 6);
  /* every local file a preview page points at (including ../shared files) exists */
  for (const d of ['exchange-preview', 'giving-preview', 'recipes-publishing-preview']) {
    const p = fs.readFileSync(path.join(out, d, 'index.html'), 'utf8');
    for (const m of p.matchAll(/(?:href|src)="([^":#]+?)(?:[?#][^"]*)?"/g)) if (!/^https?:/.test(m[1])) assert.ok(has(path.posix.normalize(d + '/' + m[1])), d + ' needs ' + m[1]);
  }
});

test('backend, tests, tools, workflows, probe material, dependency manifests and planning documents are absent', () => {
  const files = walk(out);
  for (const top of ['function', 'shop', 'setup', 'tests', 'tools', 'exchange-probe', '.github', '.git', 'node_modules']) assert.ok(!files.some((f) => f.split('/')[0] === top), top + ' must not be published');
  assert.deepEqual(files.filter((f) => /(^|\/)package(-lock)?\.json$/.test(f)), []);
  assert.deepEqual(files.filter((f) => /\.md$/.test(f) && f !== 'THIRD-PARTY-NOTICES.md'), []);
  assert.deepEqual(files.filter((f) => !f.includes('/') && /^\./.test(f)), []);
  assert.ok(!build.PUBLISH.dirs.includes('exchange-probe') && !build.PUBLISH.dirs.includes('function'));
});

test('a new top-level file must be a deliberate choice: it is either published or on this list of known exclusions', () => {
  const known = (f) => /\.md$/.test(f) || ['.gitignore', '.git'].includes(f) || build.PUBLISH.topLevelNot.has(f) || /^package(-lock)?\.json$/.test(f) || /\.tar\.gz$/.test(f);
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) if (e.isFile() && !build.isTopPublished(e.name)) assert.ok(known(e.name), 'decide whether ' + e.name + ' is published: add it to PUBLISH in tools/build-site.js or to this list');
});

test('the validator refuses an artifact that contains forbidden material or a broken page link', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-art2-')); assert.ok(build.build(dir).ok);
  fs.mkdirSync(path.join(dir, 'function')); fs.writeFileSync(path.join(dir, 'function', 'x.js'), '1'); assert.equal(build.validate(dir).ok, false); fs.rmSync(path.join(dir, 'function'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SETUP-GUIDE.md'), 'x'); assert.equal(build.validate(dir).ok, false); fs.unlinkSync(path.join(dir, 'SETUP-GUIDE.md'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}'); assert.equal(build.validate(dir).ok, false); fs.unlinkSync(path.join(dir, 'package.json'));
  fs.unlinkSync(path.join(dir, 'giving-core.js')); assert.equal(build.validate(dir).ok, false, 'a preview page points at a missing shared file');
});

test('stamping and update detection data hold on the final artifact', () => {
  assert.ok(lib.check(out).ok); assert.equal(lib.check(out).id, result.id);
  const rel = JSON.parse(fs.readFileSync(path.join(out, 'release.json'), 'utf8')); assert.deepEqual(rel, { schema: 1, id: result.id, entry: 'index.html' });
  assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('<meta name="fc-release" content="' + result.id + '">'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-art3-')); build.build(b); fs.appendFileSync(path.join(b, 'config.js'), '\n// a later release\n'); assert.equal(lib.check(b).ok, false);
  const idB = lib.stamp(b); assert.notEqual(idB, result.id); assert.ok(build.validate(b).ok);
  assert.equal(JSON.parse(fs.readFileSync(path.join(b, 'release.json'), 'utf8')).id, idB);
});
