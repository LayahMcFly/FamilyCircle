/* Header name fits: "Family Circle", then "Circle", then "FC". Fake backend; proves layout in desktop Chrome at phone widths only. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots'); let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 420, height: 700 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(() => { window.__MOCK = { signedIn: true, user: { $id: 'uA', name: 'A', email: 'a@e.com', emailVerification: true, prefs: {} }, families: [{ id: 'famA', name: 'Alpha', role: 'owner' }], members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'A' }], tables: { profiles: [{ $id: 'p', userId: 'uA', familyId: 'famA', displayName: 'A', about: '[]' }], people: [], posts: [] }, log: [] }; });
  await page.goto('http://127.0.0.1:' + port + SUB + '#/home'); await page.waitForSelector('.topbar .brand span'); await page.waitForTimeout(800);
  const read = () => page.evaluate(() => { const sp = document.querySelector('.topbar .brand span'); const inner = document.querySelector('.topbar-inner'); const last = Array.from(inner.children).filter(c => getComputedStyle(c).display !== 'none').pop().getBoundingClientRect(); return { t: sp.textContent, clipped: sp.scrollWidth > sp.clientWidth + 1, overflow: inner.scrollWidth > inner.clientWidth + 1, lastRight: Math.round(last.right), vw: document.documentElement.clientWidth }; });
  const seen = {};
  for (const w of [1100, 600, 480, 420, 390, 360, 340, 320, 300, 260, 230]) {
    await page.setViewportSize({ width: w, height: 700 }); await page.waitForTimeout(400); const r = await read(); seen[w] = r.t;
    check(w + 'px: shows "' + r.t + '" with nothing cut off', w < 300 || !r.clipped && (w < 300 || (!r.overflow && r.lastRight <= r.vw + 1)), JSON.stringify(r));
    if (w === 390 || w === 320) await page.screenshot({ path: path.join(OUT, 'brand-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 110 } });
  }
  check('Narrow enough: Circle, then FC when even Circle does not fit', seen[300] === 'Circle' && seen[230] === 'FC', JSON.stringify(seen));
  check('The name is one of the three allowed forms at every width', Object.values(seen).every(t => ['Family Circle', 'Circle', 'FC'].includes(t)), JSON.stringify(seen));
  check('Wide screens show the full name', seen[1100] === 'Family Circle', JSON.stringify(seen));
  check('The link keeps its full accessible name', (await page.getAttribute('.topbar .brand', 'aria-label')).indexOf('Family Circle') === 0, '');
  console.log(JSON.stringify(seen)); console.log('\n' + pass + ' passed, ' + fail + ' failed'); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
