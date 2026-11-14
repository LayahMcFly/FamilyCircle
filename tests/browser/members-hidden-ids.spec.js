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
  await page.addInitScript(m => { window.__MOCK = m; window.__MOCK.api = m.apiKind === 'ok' ? { familyMembers: () => ({ members: m.fullList }) } : { familyMembers: () => ({ __deny: 'Unknown action.', __error: 'bad_request', __code: 400 }) }; }, mock);
  await page.goto('http://127.0.0.1:' + PORT + SUB + hash); await page.waitForSelector('main[data-view]', { timeout: 8000 });
  return { ctx, page, errors };
}
/* The project hides other members' ids, names and emails from the browser. This is the real shape of the family that showed every row as "Shem". */
const hidden = (id, uid, name, confirm, roles) => ({ $id: id, userId: '', userName: '', userEmail: '', confirm, roles: roles || ['member'], _uid: uid, _name: name });
const full = (id, uid, name, confirm, roles) => ({ id, userId: uid, userName: name, userEmail: '', confirm, joined: confirm ? '2026-11-10' : '', roles: roles || ['member'] });
const P = (uid, name) => ({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, about: '[]' });
const tp = (id, name, o) => Object.assign({ $id: id, familyId: 'famA', name, parentIds: [], partnerIds: [], $createdAt: '2026-01-01' }, o || {});
const wld = (apiKind, fullList) => ({ apiKind, fullList, signedIn: true, user: { $id: 'uA', name: 'Alexa', email: 'a@e.com', emailVerification: true, prefs: {} }, families: [{ id: 'famA', name: 'Alpha', role: 'owner' }], canCreateFamily: false, log: [],
  members: [{ $id: 'mA', userId: 'uA', userName: 'Alexa', userEmail: 'a@e.com', confirm: true, roles: ['owner'] }, hidden('mB', 'uB', 'Ari', true), hidden('mC', 'uC', 'Shamayah', true), hidden('mD', 'uD', 'Parent', true), hidden('mE', 'uE', 'Shem', false)],
  tables: { profiles: [P('uA', 'Alexa'), P('uB', 'Ari'), P('uC', 'Shamayah'), P('uD', 'Parent of Leia')], posts: [], nameRequests: [],
    people: [tp('t1', 'Alexa', { userId: 'uA', confirmed: true }), tp('t2', 'Ari', { userId: 'uB', confirmed: true }), tp('t3', 'Sophia', { userId: 'uD', confirmed: true, inviteMembershipId: 'mD' }), tp('t4', 'Shamayah', { userId: 'uC', confirmed: true, inviteMembershipId: 'mC' }), tp('t5', 'Shem', { userId: '', confirmed: false, inviteMembershipId: 'mE' })] },
  });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  // 1. The family service answers: every row gets the right name
  let { ctx, page, errors } = await open(browser, wld('ok', [full('mA', 'uA', 'Alexa', true, ['owner']), full('mB', 'uB', 'Ari', true), full('mC', 'uC', 'Shamayah', true), full('mD', 'uD', 'Parent', true), full('mE', 'uE', 'Shem', false)]), '#/settings/family', 420, 2600); await page.waitForTimeout(1500);
  let inv = await page.$$eval('.mem-row strong', els => els.map(e => e.textContent)), rg = await page.$$eval('.rg-member strong', els => els.map(e => e.textContent));
  check('Invitations and members: each person has their own name', JSON.stringify(inv) === JSON.stringify(['Alexa', 'Ari', 'Shamayah', 'Sophia', 'Shem']), JSON.stringify(inv));
  check('Roles and age groups: every joined member is listed with their own name', JSON.stringify(rg) === JSON.stringify(['Alexa (you)', 'Ari', 'Shamayah', 'Sophia']), JSON.stringify(rg));
  const dis = await page.$$eval('.rg-member', els => els.map(e => Array.from(e.querySelectorAll('button, select')).filter(x => x.disabled).length));
  check('Roles controls are usable for every member who has a profile (the only owner cannot step down)', dis.slice(1).every(n => n === 0), JSON.stringify(dis));
  const sent = await page.evaluate(() => window.__MOCK.log.filter(l => l.indexOf('api familyMembers') === 0).length);
  check('The app asked the family service for the ids', sent >= 1, String(sent));
  await page.screenshot({ path: path.join(OUT, 'members-ids-fixed-420.png'), fullPage: false });
  await ctx.close();
  // 2. An older service that does not know the action: the names must not all become the unlinked person's name
  ({ ctx, page, errors } = await open(browser, wld('old'), '#/settings/family', 420, 2600)); await page.waitForTimeout(1500);
  inv = await page.$$eval('.mem-row strong', els => els.map(e => e.textContent));
  check('Without the new service, nobody else is shown as Shem', inv.filter(n => n === 'Shem').length === 1 && inv[inv.length - 1] === 'Shem', JSON.stringify(inv));
  check('Without the new service, members linked by invitation still get the right name', inv.includes('Sophia') && inv.includes('Shamayah'), JSON.stringify(inv));
  check('No script errors', errors.length === 0, errors.join('; '));
  await ctx.close();
  console.log(results.join("\n")); console.log("\n" + pass + ' passed, ' + fail + ' failed'); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
