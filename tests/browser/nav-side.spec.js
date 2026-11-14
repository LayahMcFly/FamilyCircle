/* Browser tests for the bottom Shop/Shorts button and the top Shop button (class B evidence: real Chrome, real app code, FAKE Appwrite backend and a fake function).
 * Run:  cd tests/browser && node nav-side.spec.js
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
  const mock = world('u-owner', 'owner');
  const { ctx, page, errors } = await open(browser, mock, '#/hub'); await page.waitForTimeout(500);
  const state = async () => page.evaluate(() => { const a = document.querySelector('.nav .nav-swap a'); const top = document.getElementById('shop-btn'); return { label: a.textContent.trim(), href: a.getAttribute('href'), cur: a.getAttribute('aria-current') === 'page', topShown: !!top && top.getClientRects().length > 0 && !top.hidden, hubCur: document.querySelector('.nav [data-route="hub"]').getAttribute('aria-current') === 'page', svg: !!a.querySelector('svg') }; });
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(500); };
  let st = await state();
  check('Hub: second bottom button is Shop', st.label === 'Shop' && st.href === '#/shop' && st.svg, JSON.stringify(st));
  check('Hub: the top Shop button is hidden (no duplicate)', !st.topShown, JSON.stringify(st));
  check('Hub: Hub button is the current one', st.hubCur && !st.cur, JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, 'nav-hub.png') });
  for (const h of ['#/tree', '#/recipes', '#/orders']) { await go(h); st = await state(); check(h + ': Shop in the bottom bar, Hub highlighted, no top Shop', st.label === 'Shop' && st.hubCur && !st.topShown, JSON.stringify(st)); }
  await go('#/shop'); st = await state();
  check('Shop page: the bottom Shop button is the current one', st.label === 'Shop' && st.cur && !st.hubCur, JSON.stringify(st));
  for (const h of ['#/home', '#/saved', '#/activity']) { await go(h); st = await state(); check(h + ': Shorts in the bottom bar, Shop at the top', st.label === 'Shorts' && st.href === '#/shorts' && st.topShown, JSON.stringify(st)); }
  await go('#/shorts'); st = await state(); check('Shorts page: bottom Shorts button is current (the full-screen player has no top bar)', st.label === 'Shorts' && st.cur, JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, 'nav-community.png') });
  await go('#/hub'); st = await state(); check('Back in the Hub: Shop again at the bottom, hidden at the top', st.label === 'Shop' && !st.topShown, JSON.stringify(st));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
