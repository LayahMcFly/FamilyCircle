#!/usr/bin/env node
'use strict';
/* Gives the frontend a release identity that comes from its own content, so nobody types a version number.
 *
 *   node tools/stamp-release.js           writes release.json, the <meta name="fc-release"> tag and the ?v= cache-busting values in index.html
 *   node tools/stamp-release.js --check   changes nothing; exits 1 if the stamp is out of date (used by the tests)
 *
 * The id is the first 16 hex characters of a SHA-256 over every shipped file (path and content). index.html is hashed with its own stamp blanked,
 * so the id never depends on itself. The same content always gives the same id, so putting an older release back gives the older id again
 * (a rollback is just "a different id"). release.json and maintenance.json are not part of the id: switching maintenance mode is not a release.
 * Pages publishes one commit as one site, so release.json and the files it describes always go live together. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const SHIPPED_TOP = /\.(js|css|html|svg|ico|png|woff2?)$/i;
const SKIP_TOP = new Set(['release.json', 'maintenance.json', 'preview.png', 'family-circle-preview.png']);
const SHIPPED_DIRS = ['fonts', 'vendor'];
const META_RE = /<meta name="fc-release" content="[^"]*">/;
const VQ_RE = /((?:href|src)="[^"?:]+)\?v=[^"]*"/g;

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(dir, r, out); else if (e.isFile()) out.push(r);
  }
}
function shippedFiles(root) {
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isFile() && SHIPPED_TOP.test(e.name) && !SKIP_TOP.has(e.name)) out.push(e.name);
  for (const d of SHIPPED_DIRS) if (fs.existsSync(path.join(root, d))) walk(root, d, out);
  return out.sort();
}
const blank = (html) => html.replace(/ *<meta name="fc-release" content="[^"]*">\n?/, '').replace(VQ_RE, '$1?v="');
function computeId(root) {
  const h = crypto.createHash('sha256');
  for (const f of shippedFiles(root)) {
    const buf = f === 'index.html' ? Buffer.from(blank(fs.readFileSync(path.join(root, f), 'utf8'))) : fs.readFileSync(path.join(root, f));
    h.update(f + '\0' + crypto.createHash('sha256').update(buf).digest('hex') + '\n');
  }
  return h.digest('hex').slice(0, 16);
}
function stamped(html, id) {
  let out = html.replace(VQ_RE, '$1?v=' + id + '"');
  if (META_RE.test(out)) out = out.replace(META_RE, '<meta name="fc-release" content="' + id + '">');
  else out = out.replace(/(<meta name="viewport"[^>]*>\n)/, '$1  <meta name="fc-release" content="' + id + '">\n');
  return out;
}
const releaseJson = (id) => JSON.stringify({ schema: 1, id, entry: 'index.html' }, null, 2) + '\n';
function check(root) {
  const id = computeId(root), problems = [];
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (html !== stamped(html, id)) problems.push('index.html is not stamped with ' + id);
  let rel = ''; try { rel = fs.readFileSync(path.join(root, 'release.json'), 'utf8'); } catch (e) { /* missing */ }
  if (rel !== releaseJson(id)) problems.push('release.json is missing or out of date');
  return { id, ok: !problems.length, problems };
}
function stamp(root) {
  const id = computeId(root), p = path.join(root, 'index.html');
  fs.writeFileSync(p, stamped(fs.readFileSync(p, 'utf8'), id));
  fs.writeFileSync(path.join(root, 'release.json'), releaseJson(id));
  return id;
}
module.exports = { computeId, stamp, check, shippedFiles };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (process.argv.includes('--check')) { const r = check(root); console.log(r.ok ? 'stamp current ' + r.id : r.problems.join('\n')); process.exit(r.ok ? 0 : 1); }
  console.log('stamped ' + stamp(root));
}
