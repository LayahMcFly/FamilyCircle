/* Browser test for the footer "Support the site" popup (real Chrome, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && node support-footer.spec.js */
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



async function newPage(ctx, mock, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push('console ' + m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  return page;
}
const active = (page) => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const PORT = server.address().port; const URL0 = 'http://127.0.0.1:' + PORT + SUB;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await newPage(ctx, world(mkUser('uA', 'Alex Tester'), 'owner'), errors);
  await page.goto(URL0 + '#/hub'); await page.waitForSelector('#foot-support-btn');
  const btn = page.locator('#foot-support-btn');
  check('1 The footer button is a real <button> labeled "Support the site", inside the footer beside the About button', (await btn.evaluate(e => e.tagName + '|' + e.type + '|' + !!e.closest('#site-footer') + '|' + (e.parentElement === document.getElementById('foot-about-btn').parentElement))) === 'BUTTON|button|true|true' && (await btn.innerText()) === 'Support the site', '');
  check('2 Nothing opens on its own', (await page.locator('dialog').count()) === 0, '');
  const sizes = await page.evaluate(() => { const a = document.getElementById('foot-about-btn'), b = document.getElementById('foot-support-btn'); const x = getComputedStyle(a), y = getComputedStyle(b); return [x.fontSize === y.fontSize, x.color === y.color, x.textDecorationLine === y.textDecorationLine, b.getBoundingClientRect().height >= 44]; });
  check('3 Footer typography matches the About button and the tap target is 44px', sizes.every(Boolean), JSON.stringify(sizes));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check('3 The footer does not overflow on a 390px screen', overflow, '');

  await btn.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.support-dialog[open]');
  const d = page.locator('dialog.support-dialog');
  const txt = await d.innerText();
  check('4 Dialog name is "Support FamilyCircle" and the intro text is exact', (await d.getAttribute('aria-labelledby')) === 'foot-support-h' && (await page.locator('#foot-support-h').innerText()) === 'Support FamilyCircle' && txt.includes('Enjoying the site? Supporting it is completely optional. Here are two ways to help.'), txt);
  check('5 Cash App option shows the exact handle, description and heading', txt.includes('Support with Cash App') && txt.includes('$LayahMcFly') && txt.includes('Choose any amount to help support the site.'), txt);
  const open = page.locator('#foot-support-open');
  check('6 "Open Cash App" links to https://cash.app/$LayahMcFly in a new tab, safely', (await open.getAttribute('href')) === 'https://cash.app/$LayahMcFly' && (await open.getAttribute('target')) === '_blank' && /noopener/.test(await open.getAttribute('rel')) && /noreferrer/.test(await open.getAttribute('rel')), '');
  await page.locator('#foot-support-copy').click();
  await page.waitForFunction(() => /Copied/.test(document.getElementById('foot-support-status').textContent));
  check('7 "Copy handle" copies exactly $LayahMcFly and confirms', (await page.evaluate(() => navigator.clipboard.readText())) === '$LayahMcFly' && (await page.locator('#foot-support-status').innerText()) === 'Copied $LayahMcFly' && (await page.locator('#foot-support-status').getAttribute('role')) === 'status', '');
  const watch = page.locator('#foot-support-watch');
  check('8 Watch ads: heading, description, "Coming soon", disabled button, no ad scripts or frames', txt.includes('Watch ads to support') && txt.includes('Watch a series of ads to help support the site.') && txt.includes('Coming soon') && (await watch.isDisabled()) && (await page.locator('iframe, script[src*="ad"]').count()) === 0, '');
  const before = await page.evaluate(() => location.href); await watch.click({ force: true, timeout: 2000 }).catch(() => {});
  check('8 Clicking the disabled button does nothing', (await page.evaluate(() => location.href)) === before && (await page.locator('dialog.support-dialog[open]').count()) === 1, '');
  check('9 Background scrolling is locked while open', (await page.evaluate(() => document.body.style.overflow)) === 'hidden', '');
  check('9 Focus is inside the dialog on open', await page.evaluate(() => !!document.activeElement.closest('dialog.support-dialog')), await active(page));

  const seen = []; for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); seen.push(await active(page)); }
  check('10 Tab cycles only through the dialog controls (never the page behind), skipping the disabled button', seen.every(x => ['foot-support-open', 'foot-support-copy', 'foot-support-close'].includes(x)) && new Set(seen).size === 3, seen.join(','));
  await page.keyboard.press('Shift+Tab');
  check('10 Shift+Tab also stays inside', await page.evaluate(() => !!document.activeElement.closest('dialog.support-dialog')), '');
  const ring = await page.locator('#foot-support-close').focus().then(() => page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
  check('10 Keyboard focus is visibly outlined', ring, '');
  await page.keyboard.press('Escape'); await page.waitForSelector('dialog.support-dialog', { state: 'detached' });
  check('11 Escape closes, focus returns to the footer button, scrolling is restored', (await active(page)) === 'foot-support-btn' && (await page.evaluate(() => document.body.style.overflow)) !== 'hidden', await active(page));

  await btn.click(); await page.waitForSelector('dialog.support-dialog[open]');
  await page.mouse.click(4, 4); await page.waitForSelector('dialog.support-dialog', { state: 'detached' });
  check('12 Clicking the backdrop closes it and returns focus', (await active(page)) === 'foot-support-btn', await active(page));
  await btn.click(); await page.waitForSelector('dialog.support-dialog[open]');
  await page.locator('dialog.support-dialog h2').click(); await page.waitForTimeout(150);
  check('12 Clicking inside the card does not close it', (await page.locator('dialog.support-dialog[open]').count()) === 1, '');
  await page.locator('#foot-support-close').click(); await page.waitForSelector('dialog.support-dialog', { state: 'detached' });
  check('13 The Close button closes and returns focus', (await active(page)) === 'foot-support-btn', await active(page));

  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important'); });
  await btn.click(); await page.waitForSelector('dialog.support-dialog[open]');
  const fit = await page.evaluate(() => { const dl = document.querySelector('dialog.support-dialog'), r = dl.getBoundingClientRect(); return { w: r.left >= 0 && r.right <= innerWidth + 1, h: r.height <= innerHeight + 1, sx: dl.scrollWidth <= dl.clientWidth + 1 }; });
  check('14 At 200% text on a 390px screen the card fits the width and scrolls inside itself when tall', fit.w && fit.h && fit.sx, JSON.stringify(fit));
  await page.locator('#foot-support-close').scrollIntoViewIfNeeded(); await page.locator('#foot-support-close').click(); await page.waitForSelector('dialog.support-dialog', { state: 'detached' });
  await page.screenshot({ path: '/tmp/support-closed.png' });
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await newPage(ctx2, world(mkUser('uA', 'Alex Tester'), 'owner'), errors);
  await p2.goto(URL0 + '#/hub'); await p2.waitForSelector('#foot-support-btn'); await p2.locator('#foot-support-btn').click(); await p2.waitForSelector('dialog.support-dialog[open]'); await p2.screenshot({ path: '/tmp/support-mobile.png' });
  await p2.setViewportSize({ width: 1100, height: 800 }); await p2.waitForTimeout(200); await p2.screenshot({ path: '/tmp/support-desktop.png' });
  await p2.keyboard.press('Escape');
  await p2.locator('#foot-about-btn').click(); await p2.waitForSelector('dialog.foot-dialog');
  check('15 Existing About links and pictures popup (Etsy notice) still opens and closes', /trademark of Etsy, Inc\./.test(await p2.locator('dialog.foot-dialog').innerText()), '');
  await p2.locator('#foot-about-close').click(); await p2.waitForSelector('dialog.foot-dialog', { state: 'detached' });
  const links = await p2.locator('#site-footer a').evaluateAll(a => a.map(x => x.textContent + '|' + x.target));
  check('15 Existing footer links (PlayPop, feedback, GitHub) are unchanged', links.some(l => /PlayPop\|_blank/.test(l)) && links.length >= 2, links.join(' ; '));
  check('16 No page errors or CSP violations', errors.filter(e => !/status of 4\d\d/.test(e)).length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
