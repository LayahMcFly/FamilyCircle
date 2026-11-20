/* End-to-end test of the update notice with TWO real builds (A and B) produced by tools/stamp-release.js from the real app files.
 * The server publishes one build at a time and can simulate a failing, invalid, half-published or stale-cached release.
 * Run:  NODE_PATH=<dir with playwright-core> node tests/browser/update-notice.spec.js */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const stampLib = require('../../tools/stamp-release');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/* ---- two controlled builds ---- */
const buildSite = require('../../tools/build-site');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-builds-'));
/* Each build is the real publish artifact (tools/build-site.js). Build B is a later release: one more line in config.js, stamped again exactly as the workflow would. */
function makeBuild(name, extra) {
  const dir = path.join(TMP, name), r = buildSite.build(dir);
  if (!r.ok) throw new Error('build refused: ' + r.problems.join('; '));
  if (extra) { fs.appendFileSync(path.join(dir, 'config.js'), extra); stampLib.stamp(dir); const v = buildSite.validate(dir); if (!v.ok) throw new Error(v.problems.join('; ')); return { dir, id: v.id }; }
  return { dir, id: r.id };
}
const A = makeBuild('A', '\nwindow.__BUILD_MARK = "A";\n'), B = makeBuild('B', '\nwindow.__BUILD_MARK = "B";\n');

/* ---- the "published site" ---- */
const site = { current: A, releaseMode: 'ok', staleNav: false, hits: { release: 0, index: 0 }, headers: [], navs: 0 };
const publish = (b) => { site.current = b; };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), u = decodeURIComponent(url.pathname);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let rel = u.slice(SUB.length) || 'index.html'; if (rel.endsWith('/')) rel += 'index.html';
  let dir = site.current.dir;
  const vq = url.searchParams.get('v'); if (vq === A.id) dir = A.dir; else if (vq === B.id) dir = B.dir;   /* a versioned URL keeps serving the build it names, like an already-cached copy */
  if (rel === 'release.json') {
    site.hits.release++; site.headers.push({ cc: req.headers['cache-control'] || '', pragma: req.headers['pragma'] || '', q: url.search });
    if (site.releaseMode === '500') { res.writeHead(500); return res.end('boom'); }
    if (site.releaseMode === '404') { res.writeHead(404); return res.end(); }
    if (site.releaseMode === 'invalid') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{not json'); }
    if (site.releaseMode === 'shape') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"schema":1,"id":"NOT-AN-ID","entry":"index.html"}'); }
    if (site.releaseMode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>maintenance</html>'); }
    if (site.releaseMode === 'partial') { /* release.json already says B, but index.html is still A's */ res.writeHead(200, { 'content-type': 'application/json' }); return res.end(fs.readFileSync(path.join(B.dir, 'release.json'))); }
  }
  if (rel === 'index.html') {
    site.hits.index++;
    if (site.releaseMode === 'partial') dir = A.dir;
    if (site.staleNav && url.searchParams.has('n')) { dir = A.dir; site.navs++; }
    else if (url.searchParams.has('n')) site.navs++;
  }
  fs.readFile(path.join(dir, rel), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); res.end(d); });
});

const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const mkUser = (id, name) => ({ $id: id, name, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name) => ({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const world = (user, role) => ({ signedIn: true, user, families: [{ id: 'famA', name: 'Alpha Family', role }], canCreateFamily: false, tables: { profiles: [prof('uA', 'Alex Tester')], people: [], posts: [] }, members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'Alex Tester' }] });
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
const errors = [];
async function newPage(ctx, cfg) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e));
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) errors.push('console ' + m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, world(mkUser('uA', 'Alex Tester'), 'owner'));
  await page.addInitScript(c => { window.__FC_RELEASE_CFG = c; }, cfg || { periodMs: 3600000, minGapMs: 0 });
  return page;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rel = (page) => page.evaluate(() => window.FCRelease && window.FCRelease.state());
const bannerVisible = (page) => page.evaluate(() => { const b = document.getElementById('fc-update'); return !!b && !b.hidden; });
const pillVisible = (page) => page.evaluate(() => { const b = document.getElementById('fc-update-pill'); return !!b && !b.hidden; });
const noticeCount = (page) => page.evaluate(() => document.querySelectorAll('#fc-update').length + document.querySelectorAll('#fc-update-pill').length);
async function open(ctx, build, cfg, hash) {
  publish(build); site.releaseMode = 'ok'; site.staleNav = false;
  const page = await newPage(ctx, cfg); await page.goto(URL0 + (hash || '#/hub')); await page.waitForSelector('#foot-about-btn'); await sleep(250); return page;
}
let URL0;
async function visibility(page, state) { await page.evaluate(s => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); }, state); }

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); URL0 = 'http://127.0.0.1:' + server.address().port + SUB;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const mk = () => browser.newContext({ viewport: { width: 390, height: 844 } });
  let ctx = await mk();

  check('0 The two builds really differ and have different ids', A.id !== B.id && /^[a-f0-9]{16}$/.test(A.id) && /^[a-f0-9]{16}$/.test(B.id), A.id + ' ' + B.id);

  /* 1 same release */
  let p = await open(ctx, A);
  check('1 The page reports the id of the build it was served from', (await rel(p)).running === A.id && (await p.evaluate(() => window.__BUILD_MARK)) === 'A', JSON.stringify(await rel(p)));
  await p.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
  await p.evaluate(() => window.FCRelease.check('force')); await sleep(200);
  check('1 Same release: no notice and no pill', (await noticeCount(p)) === 0 && !(await bannerVisible(p)) && !(await pillVisible(p)) && (await rel(p)).published === A.id, JSON.stringify(await rel(p)));
  const h0 = site.headers[site.headers.length - 1];
  check('1 The metadata request bypasses caches explicitly (no-store, throwaway query, credentials omitted)', /no-cache/.test(h0.cc) && /cb=/.test(h0.q), JSON.stringify(h0));

  /* 2 new release detected without reload */
  await p.evaluate(() => { window.__NOT_RELOADED = true; });
  publish(B);
  await p.evaluate(() => window.FCRelease.check('force'));
  await p.waitForSelector('#fc-update:not([hidden])');
  const txt = await p.locator('#fc-update').innerText();
  check('2 New release detected with no manual reload; the page was not reloaded', (await p.evaluate(() => window.__NOT_RELOADED === true && window.__BUILD_MARK)) === 'A', '');
  check('2 Notice copy and buttons', /Update available/.test(txt) && /A new version of FamilyCircle is ready\. Update to get the latest changes\./.test(txt) && /Update now/.test(txt) && /Later/.test(txt), txt);
  check('2 The notice is a labeled region, did not take focus, and is not a modal dialog', (await p.locator('#fc-update').getAttribute('role')) === 'region' && !(await p.evaluate(() => !!document.activeElement.closest('#fc-update'))) && (await p.locator('dialog[open]').count()) === 0, '');
  await p.waitForFunction(() => /Update available/.test(document.getElementById('fc-update-live').textContent), null, { timeout: 3000 }).catch(() => {});
  check('2 Live region announced it', /Update available/.test(await p.locator('#fc-update-live').textContent()), '');

  /* 7 repeated checks, no duplicates */
  const before = site.hits.release;
  await Promise.all([1, 2, 3, 4].map(() => p.evaluate(() => window.FCRelease.check('force'))));
  for (let i = 0; i < 4; i++) await p.evaluate(() => window.FCRelease.check('force'));
  check('7 Repeated and overlapping checks never stack notices; overlapping ones share one request', (await noticeCount(p)) === 2 && (await p.locator('#fc-update').count()) === 1 && site.hits.release - before <= 5, 'requests ' + (site.hits.release - before));

  /* 8 Later */
  await p.locator('#fc-update-now').focus(); await p.locator('#fc-update-later').click();
  check('8 Later hides the banner and leaves a visible update pill; focus moves to the pill, not lost', !(await bannerVisible(p)) && (await pillVisible(p)) && (await p.evaluate(() => document.activeElement.id)) === 'fc-update-pill', '');
  await p.evaluate(() => window.FCRelease.check('force')); await p.evaluate(() => window.FCRelease.check('force'));
  check('8 Later checks do not bring the banner back by themselves', !(await bannerVisible(p)) && (await pillVisible(p)), '');
  await p.locator('#fc-update-pill').click();
  check('8 The pill reopens the notice and puts focus on Update now', (await bannerVisible(p)) && (await p.evaluate(() => document.activeElement.id)) === 'fc-update-now', '');

  /* 9 unsaved work protection (trusted keystrokes into a real field) */
  await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'draft'; t.setAttribute('aria-label', 'draft'); document.querySelector('main, #app').appendChild(t); });
  await p.locator('#draft').click(); await p.keyboard.type('half written note');
  await p.locator('#fc-update-now').click();
  await p.waitForSelector('dialog[open]');
  const warn = await p.locator('dialog[open]').innerText();
  check('9 Unsaved typing: Update now warns first and does not reload', /not saved yet/.test(warn) && /Update anyway/.test(warn) && (await p.evaluate(() => window.__NOT_RELOADED === true)), warn);
  await p.getByRole('button', { name: 'Cancel' }).click(); await sleep(300);
  check('9 Cancel keeps the page, the build and the typed text', (await p.evaluate(() => window.__NOT_RELOADED === true && document.getElementById('draft').value)) === 'half written note' && (await p.evaluate(() => window.__BUILD_MARK)) === 'A', '');
  await p.evaluate(() => { document.getElementById('draft').value = ''; });
  check('9 Programmatic or emptied fields are not treated as unsaved work', !(await p.evaluate(() => window.FCRelease.hasUnsaved())), '');
  await p.evaluate(() => window.FCRelease.registerUnsaved('t', () => true));
  check('9 A registered view guard (like About me or Appearance) also counts as unsaved', await p.evaluate(() => window.FCRelease.hasUnsaved()), '');
  await p.evaluate(() => window.FCRelease.registerUnsaved('t', () => false));

  /* 13 storage, caches, service workers: set markers, then update */
  await p.evaluate(async () => { localStorage.setItem('fc-keep', 'yes'); sessionStorage.setItem('fc-keep-s', 'yes'); document.cookie = 'fc_keep=1; path=/'; await caches.open('fc-test-cache'); location.hash = '#/profile'; });
  const swBefore = await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);

  /* 10 successful update */
  site.navs = 0;
  await p.locator('#fc-update-now').click();
  await p.waitForFunction(() => window.__BUILD_MARK === 'B', null, { timeout: 15000 });
  await p.waitForSelector('#foot-about-btn'); await sleep(300);
  const after = await rel(p), href = await p.evaluate(() => location.href);
  check('10 Accepting loads the published build (B), reports its id and shows no notice', after.running === B.id && after.published === B.id && !(await bannerVisible(p)) && !(await pillVisible(p)), JSON.stringify(after));
  check('10 The cache-busting ?r= is removed from the address bar and the page (hash) is kept', !/[?&](r|n)=/.test(href) && /#\/profile$/.test(href), href);
  await p.waitForFunction(() => /up to date/.test(document.getElementById('toasts').innerText), null, { timeout: 5000 }).catch(() => {});
  check('10 It confirms the update', /up to date/.test(await p.locator('#toasts').innerText()), await p.locator('#toasts').innerText());
  const kept = await p.evaluate(async () => ({ l: localStorage.getItem('fc-keep'), s: sessionStorage.getItem('fc-keep-s'), c: document.cookie.includes('fc_keep=1'), cache: await caches.has('fc-test-cache'), sw: (await navigator.serviceWorker.getRegistrations()).length }));
  check('13 Updating clears no storage, cookies or caches and registers no service worker (still signed in)', kept.l === 'yes' && kept.s === 'yes' && kept.c && kept.cache && kept.sw === swBefore && (await p.locator('#foot-about-btn').count()) === 1, JSON.stringify(kept));
  await p.close();

  /* 3 returning to an old background tab */
  p = await open(ctx, A, { periodMs: 200, minGapMs: 0 });
  await visibility(p, 'hidden'); publish(B);
  const hiddenBefore = site.hits.release; await sleep(900);
  check('3 While hidden, the periodic check stays quiet and no notice appears', site.hits.release === hiddenBefore && !(await bannerVisible(p)), 'hits ' + (site.hits.release - hiddenBefore));
  await visibility(p, 'visible'); await p.waitForSelector('#fc-update:not([hidden])', { timeout: 5000 });
  check('3 Returning to the old tab finds the new release', (await rel(p)).published === B.id, JSON.stringify(await rel(p)));
  await p.close();

  /* periodic while visible: roughly on schedule, never overlapping */
  p = await open(ctx, A, { periodMs: 250, minGapMs: 0 }); const c0 = site.hits.release; await sleep(1200);
  check('3 While visible it re-checks on its schedule', site.hits.release - c0 >= 3 && site.hits.release - c0 <= 6, 'hits ' + (site.hits.release - c0));
  await p.close();

  /* 4 offline then back online */
  p = await open(ctx, A); publish(B);
  await ctx.setOffline(true); await sleep(150);
  const offBefore = site.hits.release; await p.evaluate(() => window.FCRelease.check('force')); await sleep(200);
  check('4 Offline: no request, no notice, app still shown', site.hits.release === offBefore && !(await bannerVisible(p)) && (await p.locator('#foot-about-btn').count()) === 1, '');
  await ctx.setOffline(false); await p.waitForSelector('#fc-update:not([hidden])', { timeout: 6000 });
  check('4 Reconnecting triggers a check and shows the notice', (await rel(p)).published === B.id, '');
  await p.close();

  /* 5 invalid metadata and failures; and partial deploys */
  for (const mode of ['500', '404', 'invalid', 'shape', 'html', 'partial']) {
    p = await open(ctx, A); site.releaseMode = mode; if (mode !== 'partial') publish(B);
    const r = await p.evaluate(() => window.FCRelease.check('force')); await sleep(150);
    check('5 ' + mode + ': no false notice, no crash, failure counted for backoff', r === 'error' && !(await bannerVisible(p)) && !(await pillVisible(p)) && (await rel(p)).failures >= 1 && (await p.locator('#foot-about-btn').count()) === 1, r + ' ' + JSON.stringify(await rel(p)));
    if (mode === 'partial') { site.releaseMode = 'ok'; publish(B); const r2 = await p.evaluate(() => window.FCRelease.check('force')); await p.waitForSelector('#fc-update:not([hidden])'); check('5 Once the deploy finishes, the notice appears and failures reset', r2 === 'newer' && (await rel(p)).failures === 0, r2); }
    await p.close();
  }
  p = await open(ctx, A, { periodMs: 120, minGapMs: 0, baseBackoffMs: 400, maxBackoffMs: 800 }); site.releaseMode = '500'; await sleep(200); const bo = site.hits.release; await sleep(1500);
  check('5 Failing periodic checks back off instead of hammering', site.hits.release - bo <= 5, 'hits ' + (site.hits.release - bo));
  await p.close();

  /* 6 rollback: a published release that is a different id, even an older one, is an update; and back again clears it */
  p = await open(ctx, B); publish(A);
  await p.evaluate(() => window.FCRelease.check('force')); await p.waitForSelector('#fc-update:not([hidden])');
  check('6 Rolling back to the previous release (A) shows the notice on a tab running B', (await rel(p)).published === A.id && (await rel(p)).running === B.id, JSON.stringify(await rel(p)));
  publish(B); await p.evaluate(() => window.FCRelease.check('force')); await sleep(150);
  check('6 If the published release becomes the running one again, the notice goes away', !(await bannerVisible(p)) && !(await pillVisible(p)), '');
  publish(A); await p.evaluate(() => window.FCRelease.check('force')); await p.waitForSelector('#fc-update:not([hidden])');
  await p.locator('#fc-update-now').click(); await p.waitForFunction(() => window.__BUILD_MARK === 'A', null, { timeout: 15000 }); await p.waitForSelector('#foot-about-btn'); await sleep(300);
  check('6 Accepting a rollback loads the rolled-back build', (await rel(p)).running === A.id, JSON.stringify(await rel(p)));
  await p.close();

  /* 11 update that fails to load the new release */
  p = await open(ctx, A); publish(B); site.staleNav = true; site.navs = 0;
  await p.evaluate(() => window.FCRelease.check('force')); await p.waitForSelector('#fc-update:not([hidden])');
  await p.locator('#fc-update-now').click();
  await p.waitForFunction(() => window.FCRelease && /did not load/.test((document.getElementById('fc-update') || {}).innerText || ''), null, { timeout: 15000 });
  const failTxt = await p.locator('#fc-update').innerText(); const navs1 = site.navs; await sleep(1500);
  check('11 A stale host: the page says the update did not load, still on the old build, and offers Try again', /did not load/.test(failTxt) && /Try again/.test(failTxt) && (await p.evaluate(() => window.__BUILD_MARK)) === 'A' && !/up to date/.test(await p.locator('#toasts').innerText()), failTxt);
  check('11 No reload loop: exactly one navigation was made', navs1 === 1 && site.navs === 1, 'navs ' + site.navs);
  site.staleNav = false; await p.locator('#fc-update-now').click();
  await p.waitForFunction(() => window.__BUILD_MARK === 'B', null, { timeout: 15000 }); await p.waitForSelector('#foot-about-btn'); await sleep(300);
  check('11 Try again succeeds once the host serves the new release', (await rel(p)).running === B.id && site.navs === 2, 'navs ' + site.navs);
  await p.close();

  /* 12 multi-tab: one tab updates, the other keeps its unsaved work and its own notice */
  const p1 = await open(ctx, A); const p2 = await newPage(ctx); await p2.goto(URL0 + '#/hub'); await p2.waitForSelector('#foot-about-btn');
  await p2.evaluate(() => { window.__TAB2 = true; const t = document.createElement('textarea'); t.id = 'draft'; document.querySelector('main, #app').appendChild(t); });
  await p2.locator('#draft').click(); await p2.keyboard.type('tab two work');
  publish(B);
  await p1.evaluate(() => window.FCRelease.check('force')); await p2.evaluate(() => window.FCRelease.check('force'));
  await p1.waitForSelector('#fc-update:not([hidden])'); await p2.waitForSelector('#fc-update:not([hidden])');
  await p1.locator('#fc-update-now').click(); await p1.waitForFunction(() => window.__BUILD_MARK === 'B', null, { timeout: 15000 }); await sleep(500);
  check('12 Updating one tab leaves the other tab, its page and its unsaved text untouched', (await p2.evaluate(() => window.__TAB2 === true && document.getElementById('draft').value)) === 'tab two work' && (await p2.evaluate(() => window.__BUILD_MARK)) === 'A', '');
  check('12 The other tab still offers its own update, and warns before using it', (await bannerVisible(p2)) && (await (async () => { await p2.locator('#fc-update-now').click(); await p2.waitForSelector('dialog[open]'); const t = await p2.locator('dialog[open]').innerText(); await p2.getByRole('button', { name: 'Cancel' }).click(); return /not saved yet/.test(t); })()), '');
  await p1.close(); await p2.close();

  /* nothing registers a service worker or touches storage destructively */
  const src = fs.readFileSync(path.join(ROOT, 'release-check.js'), 'utf8');
  check('13 release-check.js contains no storage/cache clearing, service-worker or notification-permission calls', !/localStorage|sessionStorage|\.clear\(|caches\.|serviceWorker|unregister|deleteDatabase|Notification|indexedDB|sendBeacon|XMLHttpRequest|WebSocket/.test(src), '');
  check('14 No page errors or CSP violations', errors.length === 0, errors.join(' | '));

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
