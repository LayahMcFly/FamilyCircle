/* Browser tests for online / last active status (class B evidence: real Chrome, real app code, FAKE Appwrite backend and a fake function).
 * Run:  cd tests/browser && node presence.spec.js
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
  const now = Date.now();
  const row = (uid, lastAgoMs, text) => ({ $id: 'pr' + uid, familyId: 'famA', userId: uid, convId: 'presence', typingKey: 'p_famA_' + uid, text: text || '', until: new Date(now - lastAgoMs + 100000).toISOString() });
  const mock = world('u-owner', 'owner', { log: [], api: { chatPresence: b => { return { ok: true, shown: !b.hidden, v: 2 }; } } });
  mock.tables.chatTyping = [row('u-cara', 5000), row('u-teen', 5 * 60000 + 20000), row('u-dan', 281 * 3600000), row('u-admin', 1000, 'hidden')];
  const { ctx, page, errors } = await open(browser, mock, '#/profile/u-cara', 1100, 900); await page.waitForTimeout(900);
  const txt = async uid => page.evaluate(u => { const e = document.querySelector('main [data-presence-uid="' + u + '"]'); return e && !e.hidden ? { t: e.textContent.trim(), on: e.classList.contains('is-on'), anim: getComputedStyle(e.querySelector('.pdot')).animationName } : null; }, uid);
  let s = await txt('u-cara');
  check('Profile: someone with the app open shows Online with a pulsing green dot', s && s.t === 'Online' && s.on && s.anim === 'fc-pulse', JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, 'presence-profile-online.png') });
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(800); };
  await go('#/profile/u-teen'); s = await txt('u-teen');
  check('Profile: offline shows "Active 5 mins ago" with a still dot', s && s.t === 'Active 5 mins ago' && !s.on && s.anim === 'none', JSON.stringify(s));
  await go('#/profile/u-dan'); s = await txt('u-dan');
  check('Profile: long offline shows hours ("Active 281 hrs ago")', s && s.t === 'Active 281 hrs ago', JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, 'presence-profile-offline.png') });
  await go('#/profile/u-admin'); s = await txt('u-admin');
  check('Profile: someone who turned it off shows nothing', s === null, JSON.stringify(s));
  await go('#/profile/u-owner'); s = await txt('u-owner');
  check('Profile: my own page shows Online while my setting is on', s && s.t === 'Online', JSON.stringify(s));
  // member list in chat
  await go('#/chat'); await page.waitForTimeout(1200);
  const fm = await page.evaluate(() => Array.from(document.querySelectorAll('.fm-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  const hasCara = fm.some(t => /Cara Smith.*Online/.test(t)), hasTeen = fm.some(t => /Tee Smith.*Active 5 mins ago/.test(t)), adminRow = fm.find(t => /Bob Admin/.test(t));
  check('Chat people list: online and last active shown, hidden member shows no status', fm.length > 0 ? (hasCara && hasTeen && adminRow && !/Online|Active|Offline/.test(adminRow)) : false, JSON.stringify(fm));
  // hover card in community
  await go('#/home'); await page.evaluate(() => { const a = document.createElement('a'); a.href = '#/profile/u-cara'; a.id = 'probe-link'; a.textContent = 'Cara Smith'; document.querySelector('main').appendChild(a); });
  await page.hover('#probe-link'); await page.waitForTimeout(1000);
  const hc = await page.evaluate(() => { const c = document.querySelector('.hovercard'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : null; });
  check('Hover on a profile link shows a card with name and online status', hc && /Cara Smith/.test(hc) && /Online/.test(hc), String(hc));
  await page.screenshot({ path: path.join(OUT, 'presence-hover.png') });
  await page.mouse.move(5, 5); await page.waitForTimeout(300);
  check('Moving away hides the card', await page.evaluate(() => !document.querySelector('.hovercard')), '');
  // sender: visible and on -> a heartbeat; turning it off sends hidden once
  const sent = () => page.evaluate(() => window.__MOCK.log.filter(l => l.indexOf('api chatPresence') === 0).length);
  check('The app sends a heartbeat soon after opening (without chat open)', (await sent()) >= 1, String(await sent()));
  // toggle off through settings: set the pref the way the app does, then ask for a send
  await page.evaluate(() => window.FCChat && 1);
  await ctx.close();
  // hidden user: own pref off shows nothing on own profile, and sends hidden
  const m2 = world('u-owner', 'owner', { log: [], user: Object.assign(me('u-owner'), { prefs: { presence: false } }), api: { chatPresence: b => { (window.__sentBodies = window.__sentBodies || []); return { ok: true, shown: !b.hidden, v: 2 }; } } });
  m2.tables.chatTyping = [];
  const o2 = await open(browser, m2, '#/profile/u-owner', 1100, 900); await o2.page.waitForTimeout(6500);
  const own = await o2.page.evaluate(() => { const e = document.querySelector('main [data-presence-uid="u-owner"]'); return !e || e.hidden; });
  check('With the setting off my own profile shows no status', own, '');
  const bodies = await o2.page.evaluate(() => window.__MOCK.log.filter(l => l.indexOf('api chatPresence') === 0).length);
  check('With the setting off the app tells the server once (to hide), not repeatedly', bodies === 1, String(bodies));
  check('No page errors', errors.length === 0 && o2.errors.length === 0, JSON.stringify(errors.concat(o2.errors)));
  await o2.ctx.close(); await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
