/* Browser tests for share and repost counts (real Chrome at a phone size, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && node share-counts.spec.js
 * Proves the numbers show, update, and that only a number is sent. It does NOT prove anything on the live project. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const OUT = path.join(__dirname, 'screenshots'); let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); };
const now = new Date().toISOString();
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript((now) => {
    const P = (id, extra) => Object.assign({ $id: id, familyId: 'famA', authorId: 'uB', kind: 'text', body: 'Post ' + id, $createdAt: now, $updatedAt: now }, extra || {});
    window.__BODIES = [];
    window.__MOCK = {
      signedIn: true, user: { $id: 'uA', name: 'Alex Me', email: 'a@e.com', emailVerification: true, prefs: {} },
      families: [{ id: 'famA', name: 'Alpha', role: 'owner' }],
      members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'Alex Me' }],
      tables: {
        profiles: [['uA', 'Alex Me'], ['uB', 'Sam Rivera']].map(a => ({ $id: 'p' + a[0], userId: a[0], familyId: 'famA', displayName: a[1], about: '[]' })), people: [], reactions: [], comments: [],
        posts: [P('p1'), P('p2', { shareCount: 3 }), P('p3'), P('r1', { kind: 'repost', repostOfId: 'p1', body: 'Remember this day?' }), P('r2', { kind: 'repost', repostOfId: 'p1', body: 'again' })]
      },
      api: { sharePost: (body) => { window.__BODIES.push(body); return { counted: true, shareCount: 4 }; }, repostPost: (b) => { window.__MOCK.tables.posts.unshift(P('rNew', { kind: 'repost', repostOfId: b.postId, body: 'Remember this day?', authorId: 'uA' })); return { postId: 'rNew' }; } }, log: []
    };
    navigator.share = () => Promise.resolve();
  }, now);
  await page.goto('http://127.0.0.1:' + port + SUB + '#/home'); await page.waitForSelector('article.card'); await page.waitForTimeout(800);
  const counts = () => page.$$eval('article', as => as.map(a => ({ label: a.getAttribute('aria-label'), body: (a.querySelector('.post-body, .body, p') || {}).textContent || '', rep: (a.querySelector('.act[aria-label^="Repost"] .count') || {}).textContent || '', shr: (a.querySelector('.act[aria-label^="Share"] .count') || {}).textContent || '', txt: a.textContent.slice(0, 40) })));
  const c0 = await counts();
  const byBody = (c, id) => c.find(x => x.txt.includes('Post ' + id));
  check('The original reposted twice shows 2 on its repost button', (byBody(c0, 'p1') || {}).rep === '2', JSON.stringify(c0));
  check('A post nobody reposted shows no number', (byBody(c0, 'p3') || {}).rep === '', JSON.stringify(c0));
  check('A shared post shows its share number', (byBody(c0, 'p2') || {}).shr === '3', JSON.stringify(c0));
  check('A post nobody shared shows no number', (byBody(c0, 'p3') || {}).shr === '', '');
  await page.screenshot({ path: path.join(OUT, 'share-counts-390.png') });

  // share through another app: counts once, sends only ids
  const card = page.locator('article', { hasText: 'Post p3' });
  await card.locator('.act[aria-label^="Share"]').click(); await page.waitForSelector('dialog[open]');
  await page.click('dialog button:has-text("Send with another app")'); await page.waitForTimeout(400);
  check('The share button now shows the new number', (await card.locator('.act[aria-label^="Share"] .count').innerText()) === '4', '');
  check('Only the family and post id are sent: no names, no recipient', JSON.stringify(Object.keys(await page.evaluate(() => window.__BODIES[0])).sort()) === JSON.stringify(['action', 'familyId', 'jwt', 'postId']), JSON.stringify(await page.evaluate(() => window.__BODIES[0])));
  await page.click('dialog button:has-text("Send with another app")'); await page.waitForTimeout(300);
  check('Sharing the same post again in one visit is not counted twice', (await page.evaluate(() => window.__BODIES.length)) === 1, '');
  await page.click('dialog button:has-text("Close")');

  // repost bumps the number
  const c1 = page.locator('article', { hasText: 'Post p3' });
  await c1.locator('.act[aria-label^="Repost"]').click(); await page.waitForSelector('dialog[open]');
  await page.click('dialog button:has-text("Repost")'); await page.waitForTimeout(500);
  await page.waitForTimeout(500);
  const after = await page.locator('article', { hasText: 'Post p3' }).first().locator('.act[aria-label^="Repost"] .count').innerText().catch(() => '');
  check('Reposting makes the number go up by one', after === '1', after);
  check('No page errors', errors.length === 0, errors.join('|'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
