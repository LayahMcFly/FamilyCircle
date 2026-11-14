/* Browser tests for roles and age groups (class B evidence: real Chrome, real app code, FAKE Appwrite backend and a fake function).
 * Run:  cd tests/browser && node roles-groups.spec.js
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
  const sent = [];
  const mem = (u, roles) => ({ $id: 'm-' + u, userId: u, confirm: true, roles, userName: u });
  const mock = world('u-owner', 'owner', { log: [], members: [mem('u-owner', ['owner']), mem('u-cara', ['member']), mem('u-teen', ['member']), mem('u-noprof', ['member'])],
    api: { setAgeGroup: b => { return { ageGroup: b.ageGroup }; }, setOwner: b => ({ owner: b.owner !== false }), setTreeAdmin: b => ({ admin: b.admin !== false }), chatSetAdmin: b => ({ admin: b.admin !== false }) } });
  const { ctx, page, errors } = await open(browser, mock, '#/settings/family', 420, 1400); await page.waitForTimeout(1200);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.rg-member')).map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('Roles and age groups card lists every member', rows.length === 4, JSON.stringify(rows));
  check('Owner row shows Owner badge', /Alice Owner.*Owner/.test(rows[0] || '') || rows.some(r => /Owner/.test(r) && /\(you\)/.test(r)), JSON.stringify(rows));
  // owner with only one owner: cannot remove
  const dis = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.rg-member button')).find(x => /Remove owner/.test(x.textContent)); return b && b.disabled; });
  check('The only owner cannot be removed (button disabled)', dis === true, String(dis));
  // age group select: themed (not default) and sends the right request
  const cara = page.locator('#ag-u-cara'); await cara.selectOption('teen'); await page.waitForTimeout(500);
  const log = await page.evaluate(() => window.__MOCK.log.filter(l => l.indexOf('api setAgeGroup') === 0));
  check('Choosing Teen sends setAgeGroup', log.length === 1, JSON.stringify(log));
  const badge = await page.evaluate(() => Array.from(document.querySelectorAll('.rg-member')).map(r => r.textContent).join('|'));
  check('A Teen badge appears', /Teen/.test(badge), badge);
  // make owner / tree admin / chat admin buttons exist for a member
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('.rg-member')[1].querySelectorAll('button')).map(b => b.textContent.trim()));
  check('Member row offers Make owner, Make tree admin and Make chat admin', ['Make owner', 'Make tree admin', 'Make chat admin'].every(t => btns.includes(t)), JSON.stringify(btns));
  const noprof = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.rg-member')).find(x => /u-noprof/.test(x.innerHTML) || /u-noprof/.test(x.textContent)); return r ? { dis: r.querySelector('select').disabled, owner: !r.querySelector('button').disabled } : null; });
  check('A member with no profile is still listed; owner button works, age group waits for their profile', noprof && noprof.dis && noprof.owner, JSON.stringify(noprof));
  const box = await page.evaluate(() => { const r = document.querySelectorAll('.rg-member')[1]; const bs = Array.from(r.querySelectorAll('.rg-controls .btn')).map(b => b.getBoundingClientRect()); const sel = r.querySelector('select').getBoundingClientRect(); return { lefts: bs.map(b => Math.round(b.left)), widths: bs.map(b => Math.round(b.width)), selRight: Math.round(sel.right), btnRight: Math.round(Math.max(...bs.map(b => b.right))) }; });
  check('Buttons sit in an even grid and the age group select matches their width', box.widths.every(w => Math.abs(w - box.widths[0]) < 3) && Math.abs(box.selRight - box.btnRight) < 4, JSON.stringify(box));
  await page.screenshot({ path: path.join(OUT, 'roles-groups.png'), fullPage: true });
  await page.locator('.rg-member').nth(1).getByRole('button', { name: /^Make chat admin/ }).click(); await page.waitForTimeout(600);
  const chatCalls = await page.evaluate(() => window.__MOCK.log.filter(l => l.indexOf('api chatSetAdmin') === 0).length);
  check('Make chat admin calls the server', chatCalls === 1, String(chatCalls));
  const oldOwnerBtns = await page.evaluate(() => Array.from(document.querySelectorAll('.mem-row button')).filter(b => /owner/i.test(b.textContent)).length);
  check('The member list above no longer has Make owner buttons (roles are managed in the Roles card)', oldOwnerBtns === 0, String(oldOwnerBtns));
  check('No page errors', errors.length === 0, JSON.stringify(errors));
  await ctx.close(); await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
