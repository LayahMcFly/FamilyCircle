#!/usr/bin/env node
'use strict';
/* Builds the folder that gets published: a copy of the repository files, stamped and validated.
 *   node tools/build-site.js <outDir>
 * Exit 0 only if the stamp matches the files in <outDir> and the page is internally consistent. The publish workflow uploads <outDir> as one artifact,
 * so release.json and the frontend files it describes always come from the same build. Uses no network and no credentials. */
const fs = require('fs'), path = require('path');
const lib = require('./stamp-release');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', '.github', 'node_modules']);
function copyTree(src, dst, skipAbs) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    if (SKIP.has(e.name) || (src === ROOT && e.name.startsWith('.')) || path.resolve(s) === skipAbs) continue;
    if (e.isDirectory()) copyTree(s, path.join(dst, e.name), skipAbs); else if (e.isFile()) fs.copyFileSync(s, path.join(dst, e.name));
  }
}
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
  return { id, ok: !problems.length, problems };
}
function build(outDir) {
  const out = path.resolve(outDir);
  if (out === ROOT || ROOT.startsWith(out + path.sep)) throw new Error('refusing to build over the source tree');
  fs.rmSync(out, { recursive: true, force: true });
  copyTree(ROOT, out, out);
  lib.stamp(out);
  return validate(out);
}
module.exports = { build, validate };
if (require.main === module) {
  if (!process.argv[2]) { console.error('usage: node tools/build-site.js <outDir>'); process.exit(2); }
  const r = build(process.argv[2]);
  if (!r.ok) { console.error('build refused:\n' + r.problems.join('\n')); fs.rmSync(path.resolve(process.argv[2]), { recursive: true, force: true }); process.exit(1); }
  console.log('built and validated release ' + r.id);
}
