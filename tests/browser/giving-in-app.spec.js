/* Browser test that the Giving screens are wired into the real app (real Chrome, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && node giving-in-app.spec.js */
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
const mkUser = (id, name) => ({ $id: id, name, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name) => ({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const world = (user, role) => ({ signedIn: true, user, families: [{ id: 'famA', name: 'Alpha Family', role }], canCreateFamily: false, tables: { profiles: [prof('uA', 'Alex Tester'), prof('uB', 'Bea Tester')], people: [], posts: [] },
  members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'Alex Tester' }, { $id: 'm2', userId: 'uB', confirm: true, roles: ['member'], userName: 'Bea Tester' }] });
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }


/* A tiny in-page stand-in for the giving actions. The real rules are tested in function/test/giving.test.js and giving-real.spec.js;
 * this file only proves the app wiring: the route, the Back to Hub link, the Hub card link, and the off/on flow. */
function installBackend() {
  const M = window.__MOCK, S = { on: false, calls: [] };
  M.api = {
    givingStatus: () => ({ enabled: S.on, canTurnOn: true }),
    givingSetEnabled: b => { S.on = b.enabled === true; return { enabled: S.on }; },
    givingHome: () => S.on ? { lists: [], reservations: [], notices: [], canCreateList: true, me: { adult: true }, canManageAges: false, canModerate: false } : { __deny: 'That is not available.', __code: 404, __error: 'not_available' }
  };
  window.__GV = S;
}
async function newPage(ctx, mock, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push('console ' + m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.addInitScript(`(${installBackend.toString()})()`);
  return page;
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const PORT = server.address().port; const URL0 = 'http://127.0.0.1:' + PORT + SUB;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const A = mkUser('uA', 'Alex Tester');
  const page = await newPage(ctx, world(A, 'owner'), errors);
  await page.goto(URL0 + '#/hub'); await page.waitForSelector('[data-hub="giving"]');
  const card = page.locator('[data-hub="giving"]');
  check('1 The Hub card for Giving Center is a real link to #/giving with no "Planned" label', (await card.evaluate(e => e.tagName)) === 'A' && (await card.getAttribute('href')) === '#/giving' && !/Planned/.test(await card.textContent()), await card.textContent());
  await card.click(); await page.waitForSelector('main[data-view="giving"] .gv-off');
  check('1 Tapping the card opens Giving Center', (await page.evaluate(() => location.hash)) === '#/giving', '');
  check('2 Opening #/giving shows the off screen with a Back to Hub link', /not turned on/.test(await page.locator('main').innerText()) && (await page.locator('main .hub-back a[href="#/hub"]').count()) === 1, await page.locator('main').innerText());
  check('2 The tab title says Giving Center', /^Giving Center/.test(await page.title()), await page.title());
  await page.locator('#gv-turnon').click(); await page.locator('#gv-d-ok').click(); await page.waitForSelector('main h2:has-text("Your wishlists")');
  check('3 The owner turns it on and the home screen appears', await page.evaluate(() => window.__GV.on === true), '');
  await page.evaluate(() => { location.hash = '#/giving/list/new'; }); await page.waitForSelector('#gv-name');
  check('4 A deep link inside Giving Center (new wishlist form) opens', (await page.locator('main h1').innerText()) === 'New wishlist', await page.locator('main h1').innerText());
  await page.evaluate(() => { location.hash = '#/hub'; }); await page.waitForSelector('[data-hub="giving"]');
  check('5 Back on the Hub the card is still a link', (await page.locator('[data-hub="giving"]').evaluate(e => e.tagName)) === 'A', '');
  check('6 No page errors or CSP violations in the app', errors.filter(e => !/status of 4\d\d/.test(e)).length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
