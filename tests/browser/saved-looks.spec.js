/* Browser tests for saved look tiles show Aa (class B evidence: real Chrome, real app code, FAKE Appwrite backend and a fake function).
 * Run:  cd tests/browser && node saved-looks.spec.js
 * Proves screens and the requests the app sends. It does NOT prove anything about the live Appwrite project or the deployed function. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots');
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
const me = id => ({ $id: id, name: id, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name, extra) => Object.assign({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' }, extra || {});
const person = (id, name, o) => Object.assign({ $id: id, familyId: 'famA', name, parentIds: [], partnerIds: [], $createdAt: '2026-01-01' }, o || {});
const year = new Date().getUTCFullYear();
function world(who, role, extra) {   // who: the signed-in user id; role: owner or member
  return Object.assign({ signedIn: true, user: me(who), families: [{ id: 'famA', name: 'Alpha Family', role }], canCreateFamily: false,
    tables: {
      profiles: [prof('u-admin', 'Bob Admin', { treeAdmin: true }), prof('u-owner', 'Alice Owner'), prof('u-cara', 'Cara Smith'), prof('u-teen', 'Tee Smith'), prof('u-dan', 'Dan Smith')],
      people: [
        person('pc', 'Cara Smith', { userId: 'u-cara', confirmed: true, birthday: '1985-04-02' }),         // adult, confirmed
        person('pt', 'Tee Smith', { userId: 'u-teen', confirmed: true, birthday: (year - 10) + '-06-30' }), // child, confirmed
        person('pd', 'Dan Smith', { userId: 'u-dan', confirmed: true }),                                    // no birthday
        person('pg', 'Grandma Rose', { birthday: '1950-01-01' })                                            // no account
      ], posts: [], nameRequests: [] } }, extra || {});
}
let PORT;
async function open(browser, mock, hash, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 900 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.goto('http://127.0.0.1:' + PORT + SUB + hash); await page.waitForSelector('main[data-view]', { timeout: 8000 });
  return { ctx, page, errors };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port; fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const mock = world('u-owner', 'owner', { log: [] });
  mock.user.prefs = { pageLib: [{ id: 'a1', name: 'Serif look', st: { font: 'serif', btn: 'bold' } }, { id: 'a2', name: 'Script look', st: { font: 'script' } }, { id: 'a3', name: 'Plain look', st: {} }] };
  const { ctx, page, errors } = await open(browser, mock, '#/profile/u-owner', 420, 1100); await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Customize/i }).first().click(); await page.waitForTimeout(700);
  const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('.pd-tile')).map(t => { const m = t.querySelector('.pd-mini'); const btn = m.querySelector('.btn'), aa = m.querySelector('.pd-aa'); const bb = btn.getBoundingClientRect(), ab = aa ? aa.getBoundingClientRect() : null; return { name: t.textContent.trim(), aa: aa ? aa.textContent : null, right: ab ? ab.left >= bb.right - 1 : false, sameRow: ab ? Math.abs((ab.top + ab.height / 2) - (bb.top + bb.height / 2)) < 12 : false, font: aa ? getComputedStyle(aa).fontFamily : '', inside: ab ? ab.right <= m.getBoundingClientRect().right + 1 : false }; }));
  check('Three saved looks are shown', tiles.length === 3, JSON.stringify(tiles));
  check('Every tile has Aa to the right of the button, on the same row, inside the tile', tiles.length === 3 && tiles.every(t => t.aa === 'Aa' && t.right && t.sameRow && t.inside), JSON.stringify(tiles));
  check('Aa wears each look\'s font (serif and handwritten differ from plain)', tiles.length === 3 && tiles[0].font !== tiles[2].font && tiles[1].font !== tiles[2].font && tiles[0].font !== tiles[1].font, JSON.stringify(tiles.map(t => t.font)));
  await page.locator('.pd-lib').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(OUT, 'saved-looks-aa.png') });
  check('No page errors', errors.length === 0, JSON.stringify(errors));
  await ctx.close(); await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
