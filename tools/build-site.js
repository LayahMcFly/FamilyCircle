#!/usr/bin/env node
'use strict';
/* Builds the folder that gets published: a copy of the repository files, stamped and validated.
 *   node tools/build-site.js <outDir>
 * Exit 0 only if the stamp matches the files in <outDir> and the page is internally consistent. The publish workflow uploads <outDir> as one artifact,
 * so release.json and the frontend files it describes always come from the same build. Uses no network and no credentials. */
const fs = require('fs'), path = require('path');
const lib = require('./stamp-release');

const ROOT = path.resolve(__dirname, '..');
/* What gets published. Everything not named here is left out: backend functions (function/, shop/, setup/), tests, tools, workflows, dependency manifests and planning documents.
 * Inventory (checked against the code, not guessed): index.html loads the top-level scripts and styles; app code lazy-loads other top-level files, fonts/ and vendor/ (libraries,
 * wasm and models); the three preview routes load their own folder plus shared top-level files (../styles.css and so on); source headers point at the licence files and
 * call-effects.js at THIRD-PARTY-NOTICES.md. No page links to any other .md guide (they are only named in comments and owner-facing messages), so those stay out. */
const PUBLISH = {
  topLevelTypes: /\.(js|css|html|svg|ico|png|woff2?)$/i,
  topLevelNot: new Set(['preview.png', 'family-circle-preview.png']),   /* README pictures, referenced by no page */
  topLevelExact: ['maintenance.json', 'LICENSE', 'LICENSE-GPL-3.0.txt', 'THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES-cookbook.txt'],
  dirs: ['fonts', 'vendor', 'exchange-preview', 'giving-preview', 'recipes-publishing-preview']
};
const FORBIDDEN_TOP = ['function', 'shop', 'setup', 'tests', 'tools', 'exchange-probe', '.github', '.git', 'node_modules'];
const isTopPublished = (name) => (PUBLISH.topLevelTypes.test(name) && !PUBLISH.topLevelNot.has(name)) || PUBLISH.topLevelExact.includes(name);
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(src, e.name), path.join(dst, e.name)); else if (e.isFile()) fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
  }
}
function copySite(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) if (e.isFile() && isTopPublished(e.name)) fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
  for (const d of PUBLISH.dirs) { if (!fs.existsSync(path.join(src, d))) throw new Error('missing website folder ' + d); copyDir(path.join(src, d), path.join(dst, d)); }
}
function allFiles(dir, rel = '', out = []) { for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) allFiles(dir, r, out); else out.push(r); } return out; }
function validate(dir) {
  const problems = [], id = lib.check(dir).id;
  const c = lib.check(dir); if (!c.ok) problems.push(...c.problems);
  let rel; try { rel = JSON.parse(fs.readFileSync(path.join(dir, 'release.json'), 'utf8')); } catch (e) { problems.push('release.json is not valid JSON'); }
  if (rel && (rel.schema !== 1 || rel.id !== id || rel.entry !== 'index.html')) problems.push('release.json does not describe this build');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const m = /<meta name="fc-release" content="([a-f0-9]{16})">/.exec(html);
  if (!m || m[1] !== id) problems.push('index.html does not carry the build id');
  const refs = [...html.matchAll(/(?:href|src)="([^":?#]+)\?v=([^"]*)"/g)];
  if (!refs.length) problems.push('index.html references no versioned files');
  for (const [, file, v] of refs) { if (v !== id) problems.push('stale ?v= on ' + file); if (!fs.existsSync(path.join(dir, file))) problems.push('missing file ' + file); }
  if (!refs.some((r) => r[1] === 'release-check.js')) problems.push('release-check.js is not loaded by index.html');
  /* only published material is present, and every local file any published page points at exists */
  const files = allFiles(dir);
  for (const f of files) { const top = f.split('/')[0]; if (FORBIDDEN_TOP.includes(top) || /(^|\/)package(-lock)?\.json$/.test(f)) problems.push('not for publishing: ' + f); if (!f.includes('/') && !isTopPublished(f) && f !== 'release.json') problems.push('unexpected top-level file ' + f); if (!f.includes('/') && /\.md$/.test(f) && f !== 'THIRD-PARTY-NOTICES.md') problems.push('planning document published: ' + f); }
  for (const f of files.filter((x) => /\.html$/.test(x))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/(?:href|src)="([^":#]+?)(?:[?#][^"]*)?"/g)) {
      if (/^(?:https?:|data:|blob:|mailto:|\/\/)/.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (!files.includes(target) && !files.some((x) => x.startsWith(target.replace(/\/$/, '') + '/index.html'))) problems.push(f + ' points at a missing file ' + m[1]);
    }
  }
  return { id, ok: !problems.length, problems };
}
function build(outDir) {
  const out = path.resolve(outDir);
  if (out === ROOT || ROOT.startsWith(out + path.sep)) throw new Error('refusing to build over the source tree');
  fs.rmSync(out, { recursive: true, force: true });
  copySite(ROOT, out);
  lib.stamp(out);
  return validate(out);
}
module.exports = { build, validate, PUBLISH, isTopPublished, FORBIDDEN_TOP };
if (require.main === module) {
  if (!process.argv[2]) { console.error('usage: node tools/build-site.js <outDir>'); process.exit(2); }
  const r = build(process.argv[2]);
  if (!r.ok) { console.error('build refused:\n' + r.problems.join('\n')); fs.rmSync(path.resolve(process.argv[2]), { recursive: true, force: true }); process.exit(1); }
  console.log('built and validated release ' + r.id);
}
