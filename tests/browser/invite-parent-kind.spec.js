/* Browser tests for parent kind when inviting (class B evidence: real Chrome, real app code, FAKE Appwrite backend and a fake function).
 * Run:  cd tests/browser && node invite-parent-kind.spec.js
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
  const mock = world('u-owner', 'owner', { log: [], members: [{ $id: 'm-owner', userId: 'u-owner', confirm: true, roles: ['owner'], userName: 'Alice' }], api: { treeAddPerson: b => { (window.__sent = window.__sent || []); return { personId: 'p-new', linked: true }; } } });
  const { ctx, page, errors } = await open(browser, mock, '#/settings/family', 420, 1400); await page.waitForTimeout(1000);
  const vis = () => page.evaluate(() => { const s = document.getElementById('inviteParentKind'); return s && !s.closest('div').hidden; });
  const opts = () => page.evaluate(() => Array.from(document.querySelectorAll('#inviteParentKind option')).map(o => o.textContent));
  check('The kind of parent choice is hidden until "Parent" is chosen', (await vis()) === false, '');
  await page.selectOption('#inviteRelation', 'parent'); await page.waitForTimeout(150);
  check('It appears for Parent', (await vis()) === true, '');
  const plain = await opts();
  check('Not set gender: the same five kinds in plain wording', JSON.stringify(plain) === JSON.stringify(['Birth parent', 'Adoptive parent', 'Step-parent', 'Foster parent', 'Guardian']), JSON.stringify(plain));
  await page.selectOption('#inviteGender', 'Female'); await page.waitForTimeout(100);
  const f = await opts();
  await page.selectOption('#inviteGender', 'Male'); await page.waitForTimeout(100);
  const m = await opts();
  check('Female: Mother wording, five kinds', JSON.stringify(f) === JSON.stringify(['Mother', 'Adoptive mother', 'Step-mother', 'Foster mother', 'Guardian']), JSON.stringify(f));
  check('Male: Father wording, the same five kinds', JSON.stringify(m) === JSON.stringify(['Father', 'Adoptive father', 'Step-father', 'Foster father', 'Guardian']), JSON.stringify(m));
  check('Both lists have the same number of choices in the same order', f.length === m.length && m.length === 5, '');
  await page.screenshot({ path: path.join(OUT, 'invite-parent-kind.png'), clip: { x: 0, y: 150, width: 420, height: 700 } });
  await page.selectOption('#inviteRelation', 'child'); await page.waitForTimeout(100);
  check('Hidden again for other relations', (await vis()) === false, '');
  check('No page errors', errors.length === 0, JSON.stringify(errors));
  await ctx.close(); await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
