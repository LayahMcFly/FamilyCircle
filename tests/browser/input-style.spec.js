/* House rule check (DESIGN-RULES.md rule 1): no visible form control may look like the browser default.
 * Run: cd tests/browser && node input-style.spec.js   (fake backend, real Chrome, real app code) */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const user = { $id: 'uA', name: 'Alex Tester', email: 'a@example.com', emailVerification: true, prefs: {} };
const world = { signedIn: true, user, families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }], canCreateFamily: true,
  tables: { profiles: [{ $id: 'pA', userId: 'uA', familyId: 'famA', displayName: 'Alex Tester', bio: '', about: '[]', $createdAt: '2026-01-01' }], people: [], posts: [] },
  members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'Alex Tester' }] };
const ROUTES = ['#/recipes', '#/recipes/new', '#/recipes/edit/grandmas-banana-bread', '#/settings', '#/settings/family', '#/settings/profile', '#/settings/tree', '#/create', '#/chat', '#/shop', '#/home', '#/tree', '#/calendar'];
let pass = 0, fail = 0; const out = [];
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, world);
  await page.goto('http://127.0.0.1:' + PORT + SUB + '#/hub'); await page.waitForSelector('main[data-view]');
  let controls = 0;
  for (const r of ROUTES) {
    await page.evaluate(h => { location.hash = h; }, r); await page.waitForTimeout(500);
    const bad = await page.evaluate(() => {
      const res = []; let n = 0;
      document.querySelectorAll('input, select, textarea').forEach(el => {
        const rect = el.getBoundingClientRect(); const cs = getComputedStyle(el); const t = (el.type || el.tagName).toLowerCase();
        if (el.hidden || cs.visibility === 'hidden' || cs.display === 'none' || rect.width < 4 || rect.height < 4 || t === 'hidden') return;
        n++;
        const id = (el.id || el.name || t) + ' [' + t + ']';
        if (t === 'checkbox' || t === 'radio') { if (cs.appearance !== 'none') res.push(id + ' still has the browser look'); return; }
        if (t === 'range') return;
        if (t === 'file') { const fb = getComputedStyle(el, '::file-selector-button'); if (parseFloat(fb.borderTopLeftRadius) < 8) res.push(id + ' file button is default'); return; }
        if (parseFloat(cs.borderTopWidth) < 1 || cs.borderTopStyle !== 'solid' || parseFloat(cs.borderTopLeftRadius) < 8) res.push(id + ' has a default border/shape (' + cs.borderTopWidth + ' ' + cs.borderTopStyle + ' r' + cs.borderTopLeftRadius + ')');
        if (el.tagName === 'SELECT' && (cs.appearance !== 'none' || cs.backgroundImage === 'none')) res.push(id + ' dropdown has the browser arrow');
      });
      return { res, n };
    });
    controls += bad.n;
    if (bad.n > 3) { fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(__dirname, 'screenshots', 'inputs-' + r.replace(/[^a-z]+/gi, '-') + '.png') }); }
    if (bad.res.length) { fail++; out.push('FAIL ' + r + ': ' + bad.res.join('; ')); } else { pass++; out.push('PASS ' + r + ' (' + bad.n + ' controls)'); }
  }
  await browser.close(); server.close();
  console.log(out.join('\n')); console.log(`\n${pass} routes clean, ${fail} with problems, ${controls} controls checked`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
