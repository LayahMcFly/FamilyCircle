/* Phone-width check: no page may be wider than the screen (a wide hidden element makes phones show empty space on the right).
 * Run: cd tests/browser && node overflow.spec.js   (fake backend; proves layout in Chrome only, not real phones) */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const ROUTES = ['#/recipes', '#/recipes/new', '#/recipes/edit/grandmas-banana-bread', '#/recipes/cookbook', '#/settings/family', '#/home', '#/hub', '#/tree', '#/chat'];
let pass = 0, fail = 0;
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const hash of ROUTES) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await page.addInitScript(() => { window.__MOCK = { signedIn: true, user: { $id: 'uA', name: 'A', email: 'a@e.com', emailVerification: true, prefs: {} }, families: [{ id: 'famA', name: 'Alpha', role: 'owner' }], members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'A' }], tables: { profiles: [{ $id: 'p', userId: 'uA', familyId: 'famA', displayName: 'A', about: '[]' }], people: [], posts: [] }, log: [] }; });
    await page.goto('http://127.0.0.1:' + port + SUB + hash); await page.waitForSelector('main[data-view]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(900);
    const r = await page.evaluate(() => { const vw = document.documentElement.clientWidth; const bad = []; document.querySelectorAll('main *').forEach(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (b.width > 0 && b.right > vw + 1 && cs.position !== 'fixed') bad.push(e.tagName + '.' + (typeof e.className === 'string' ? e.className : '') + ' right=' + Math.round(b.right)); }); return { vw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 4) }; });
    const ok = r.sw <= r.vw + 1; ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + hash + (ok ? '' : '  -> ' + JSON.stringify(r)));
    await ctx.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
