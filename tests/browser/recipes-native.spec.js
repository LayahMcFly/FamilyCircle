/* Browser tests for Recipes built into Family Circle (class B evidence: real Chrome, real app code, FAKE Appwrite backend, synthetic recipes).
 * Run:  cd tests/browser && node recipes-native.spec.js
 * Proves the screens, storage rules and behaviour. It proves nothing about the live site or real devices. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/markdown' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const mkUser = (id, name) => ({ $id: id, name, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name) => ({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const world = user => ({ signedIn: true, user, families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }], canCreateFamily: false, tables: { profiles: [prof(user.$id, user.name)], people: [], posts: [] } });
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
let PORT; const URL0 = () => 'http://127.0.0.1:' + PORT + SUB;
async function newPage(ctx, mock, hash, errors, offsite) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push('console ' + m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { offsite.push(r.request().url()); r.abort(); });
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.goto(URL0() + (hash || ''));
  return page;
}
const go = async (p, hash) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForSelector('main[data-view="recipes"]'); await p.waitForTimeout(150); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const A = mkUser('uA', 'Alex Tester'), B = mkUser('uB', 'Bea Tester');
  const errors = [], offsite = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const page = await newPage(ctx, world(A), '#/hub', errors, offsite);
  await page.waitForSelector('a[data-hub="recipes"]');
  const hubFont = await page.evaluate(() => getComputedStyle(document.querySelector('h1, h2, .hub-title')).fontFamily);
  await page.evaluate(() => { localStorage.setItem('rb_recipes', JSON.stringify([{ name: 'ORIGINAL APP SENTINEL', slug: 'sentinel', ingredients: [], steps: [], categories: [], tags: [] }])); });

  // 1. in the app, no frame
  const pagesBefore = ctx.pages().length;
  await page.click('a[data-hub="recipes"]'); await page.waitForSelector('main[data-view="recipes"] .rc-grid');
  check('1 opens inside the app (#/recipes), same tab', page.url().endsWith('#/recipes') && ctx.pages().length === pagesBefore, page.url());
  check('1 it is a real page of the site: no iframe, frame or embed anywhere', (await page.locator('iframe, frame, embed, object').count()) === 0, '');
  check('1 Back to Hub link above the book', (await page.locator('main .hub-back a[href="#/hub"]').count()) === 1, '');
  check('1 four starter recipes', (await page.locator('.rc-grid li').count()) === 4, String(await page.locator('.rc-grid li').count()));
  check('1 original app sentinel not shown', !(await page.locator('main').innerText()).includes('SENTINEL'), '');
  await page.mouse.move(0, 0);
  const look = await page.evaluate(() => {
    const cs = (el, p) => getComputedStyle(el)[p];
    const btn = document.querySelector('main a.btn'), card = document.querySelector('.rc-card'), h1 = document.querySelector('main h1');
    const ref = document.createElement('button'); ref.className = 'btn'; document.body.appendChild(ref);
    const ref2 = document.createElement('div'); ref2.className = 'card'; document.body.appendChild(ref2);
    const o = { btnBg: cs(btn, 'backgroundColor') === cs(ref, 'backgroundColor'), btnRadius: cs(btn, 'borderRadius') === cs(ref, 'borderRadius'), cardBg: cs(card, 'backgroundColor') === cs(ref2, 'backgroundColor'), cardBorder: cs(card, 'borderTopColor') === cs(ref2, 'borderTopColor'), _cb: cs(card, 'borderTopColor') + ' / ' + cs(ref2, 'borderTopColor') + ' ' + cs(card,'transitionDuration'), font: cs(h1, 'fontFamily') };
    ref.remove(); ref2.remove(); return o;
  });
  check('1 uses the app theme: same button color and shape as the rest of Family Circle', look.btnBg && look.btnRadius, JSON.stringify(look));
  check('1 uses the app theme: cards match the app’s cards', look.cardBg && look.cardBorder, JSON.stringify(look));
  check('1 uses the app font', look.font === hubFont || /Nunito|Lora|system|sans/i.test(look.font), look.font + ' vs ' + hubFont);
  await page.screenshot({ path: path.join(shots, 'recipes-native-mobile-list.png') });

  // 2. open a recipe: scale, tick, timer, cook mode
  await page.locator('.rc-card').first().click(); await page.waitForSelector('.rc-recipe');
  const before = await page.locator('.rc-ings li').first().innerText();
  await page.locator('button[aria-label="Make more"]').click();
  const after = await page.locator('.rc-ings li').first().innerText();
  check('2 scaling changes the amounts', before !== after, before + ' | ' + after);
  const box = page.locator('input[data-ing]').first(); await box.check();
  check('2 an ingredient can be ticked', await box.isChecked(), '');
  const durBtn = page.locator('.rc-steps .rc-dur').first();
  check('2 times in the method are tappable', (await durBtn.count()) > 0, '');
  await durBtn.click(); await page.waitForSelector('#rc-tray .rc-tmr');
  check('2 tapping a time starts a timer in the tray', (await page.locator('#rc-tray .rc-tmr').count()) === 1, '');
  await page.screenshot({ path: path.join(shots, 'recipes-native-mobile-recipe.png') });
  await page.getByRole('button', { name: 'Pause' }).first().click();
  check('2 a timer can be paused', (await page.getByRole('button', { name: 'Resume' }).count()) === 1, '');
  await page.getByRole('button', { name: 'Stop' }).first().click();
  check('2 a timer can be stopped', (await page.locator('#rc-tray').count()) === 0, '');
  await page.getByRole('button', { name: 'Timer', exact: true }).click(); await page.locator('dialog[open] #rc-tmin').fill('2'); await page.locator('dialog[open] button[type=submit]').click();
  check('2 the Timer button starts a custom timer', (await page.locator('#rc-tray .rc-tmr').count()) === 1, '');
  await page.getByRole('button', { name: 'Stop' }).first().click();
  await page.getByRole('button', { name: 'Cook mode' }).click(); await page.waitForSelector('#rc-cook');
  check('2 cook mode opens and starts at the ingredients', /Gather your ingredients/.test(await page.locator('#rc-cook').innerText()), '');
  await page.screenshot({ path: path.join(shots, 'recipes-native-mobile-cook.png') });
  await page.getByRole('button', { name: 'Start cooking' }).click();
  check('2 cook mode shows step 1', /Step 1 of/.test(await page.locator('#rc-cook').innerText()), '');
  await page.screenshot({ path: path.join(shots, 'recipes-native-mobile-cook-step.png') });
  await page.getByRole('button', { name: 'Exit' }).click();
  check('2 cook mode closes', (await page.locator('#rc-cook').count()) === 0 && !(await page.evaluate(() => document.body.classList.contains('rc-lock'))), '');

  // 3. print shows only the recipe
  await page.evaluate(() => { window.print = () => {}; });
  await page.getByRole('button', { name: 'Print' }).click();
  check('3 Print marks the page for printing', await page.evaluate(() => document.documentElement.classList.contains('rc-print')), '');
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => ({ nav: getComputedStyle(document.querySelector('.nav') || document.body).display, rec: getComputedStyle(document.querySelector('.rc-recipe')).display, actions: getComputedStyle(document.querySelector('.rc-actions')).display, ings: document.querySelector('.rc-ings').offsetHeight }));
  check('3 in print the app bars and buttons are hidden and the recipe stays', pr.nav === 'none' && pr.actions === 'none' && pr.rec !== 'none' && pr.ings > 0, JSON.stringify(pr));
  await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  check('3 after printing the page returns to normal', !(await page.evaluate(() => document.documentElement.classList.contains('rc-print'))), '');

  // 4. add a recipe with a photo, survives reload, private per member
  await go(page, '#/recipes/new');
  const png = path.join(shots, 'rb-photo-test.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.fill('#rc-f-name', 'Test Lemon Cake'); await page.fill('#rc-f-yield', '8 servings'); await page.fill('#rc-f-ing', '2 cups flour\n1 lemon'); await page.fill('#rc-f-steps', 'Mix.\nBake 30 minutes.');
  await page.setInputFiles('#rc-f-img', png);
  await page.screenshot({ path: path.join(shots, 'recipes-native-mobile-edit.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save to my book' }).click(); await page.waitForSelector('.rc-recipe h1');
  check('4 saving shows the new recipe', (await page.locator('.rc-recipe h1').innerText()) === 'Test Lemon Cake', '');
  check('4 the photo was saved with it', (await page.locator('.rc-hero img').count()) === 1, '');
  await page.reload(); await page.waitForSelector('.rc-recipe h1');
  check('4 it is still there after a full reload', (await page.locator('.rc-recipe h1').innerText()) === 'Test Lemon Cake', '');
  const keysA = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fcrb:')));
  check('4 stored only under this member id', keysA.length > 0 && keysA.every(k => k.startsWith('fcrb:uA:')), keysA.join(','));
  check('4 original app keys (rb_*) untouched', /ORIGINAL APP SENTINEL/.test(await page.evaluate(() => localStorage.getItem('rb_recipes'))), '');
  // edit
  await page.getByRole('link', { name: 'Edit' }).click(); await page.fill('#rc-f-name', 'Test Lemon Loaf'); await page.getByRole('button', { name: 'Save to my book' }).click(); await page.waitForSelector('.rc-recipe h1');
  check('4 editing changes the recipe in place', (await page.locator('.rc-recipe h1').innerText()) === 'Test Lemon Loaf', '');
  // search + heart + filters
  await go(page, '#/recipes');
  await page.fill('#rc-q', '1 lemon'); await page.waitForTimeout(500);
  check('4 search finds it by ingredient', (await page.locator('.rc-grid li').count()) === 1, String(await page.locator('.rc-grid li').count()));
  await page.fill('#rc-q', ''); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Hearted', exact: true }).click();
  check('4 Hearted filter shows the hearted starter recipe', (await page.locator('.rc-grid li').count()) === 1, '');
  await page.getByRole('button', { name: 'Hearted', exact: true }).click();
  await page.getByRole('button', { name: 'Soups' }).click();
  check('4 category chip filters', (await page.locator('.rc-grid li').count()) === 1, '');
  await page.getByRole('button', { name: 'All', exact: true }).first().click();

  // 5. a second member on the same device
  const pageB = await newPage(ctx, world(B), '#/hub', errors, offsite);
  await pageB.waitForSelector('a[data-hub="recipes"]'); await go(pageB, '#/recipes');
  const textB = await pageB.locator('.rc-grid').innerText();
  check('5 second member sees only the starter recipes', !textB.includes('Lemon') && (await pageB.locator('.rc-grid li').count()) === 4, textB.slice(0, 60));
  await pageB.close();

  // 6. backup, restore, bad file
  await go(page, '#/recipes');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a backup file' }).click(); const d = await dl;
  const file = path.join(shots, 'rb-backup-test.json'); await d.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('6 backup is the original backup shape, photos included', bk.app === 'family-recipe-book' && bk.version === 1 && bk.recipes.some(r => r.name === 'Test Lemon Loaf' && /^data:image\//.test(r.image)), JSON.stringify(Object.keys(bk)));
  const png2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const rf = path.join(shots, 'rb-restore-test.json');
  fs.writeFileSync(rf, JSON.stringify({ app: 'family-recipe-book', version: 1, recipes: [{ name: 'Restored Soup', ingredients: ['1 cup water'], steps: ['Boil.'], image: png2, categories: ['Soups'], tags: [] }] }));
  await page.setInputFiles('#rc-restore', rf); await page.locator('.toast').first().waitFor();
  check('6 restore adds the recipe', /Restored 1 recipe/.test(await page.locator('.toast').last().innerText()) && (await page.locator('.rc-grid').innerText()).includes('Restored Soup'), '');
  const badf = path.join(shots, 'rb-bad-test.json'); fs.writeFileSync(badf, 'not json at all');
  await page.setInputFiles('#rc-restore', badf); await page.waitForTimeout(400);
  check('6 a bad file is refused with a message', /does not look like/.test(await page.locator('.toasts').innerText()), '');

  // 7. what's for dinner, and what was left out
  await page.getByRole('button', { name: "What's for dinner?" }).click();
  const nd = await page.locator('dialog[open]').innerText();
  check('7 dinner picker offers only your own recipes', /from your book/i.test(nd) && !/something new|themealdb/i.test(nd), nd.slice(0, 100));
  await page.getByRole('button', { name: 'Another one' }).click(); await page.getByRole('button', { name: 'Close' }).first().click();
  const all = await page.locator('main').innerText();
  check('7 no login, AI, sync or outside-feed text anywhere on the page', !/supabase|sign in|groq|gemini|openrouter|api key|themealdb|google drive/i.test(all), '');

  // 8. made from other recipes
  await go(page, '#/recipes/new'); await page.fill('#rc-f-name', 'Soup Night'); await page.fill('#rc-f-partq', 'banana'); await page.locator('.rc-partadd').first().click();
  await page.getByRole('button', { name: 'Save to my book' }).click(); await page.waitForSelector('.rc-recipe h1');
  check('8 a meal made from another recipe shows it', (await page.locator('.rc-parts a').count()) === 1 && /Meal/.test(await page.locator('.rc-recipe header').innerText()), '');
  check('8 the meal pulls in that recipe’s ingredients', (await page.locator('.rc-ings li').count()) > 5, '');

  // 9. remove
  await page.getByRole('button', { name: 'Remove', exact: true }).click(); await page.locator('dialog[open] .btn.danger').click(); await page.waitForSelector('.rc-grid');
  check('9 removing a recipe takes it off the list', !(await page.locator('.rc-grid').innerText()).includes('Soup Night'), '');

  // 10. nothing left the machine; no errors
  check('10 no request to any other website', offsite.length === 0, offsite.join(' '));
  check('10 no page, console or security errors', errors.length === 0, errors.join(' | '));

  // 11. dark theme + desktop
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await page.screenshot({ path: path.join(shots, 'recipes-native-mobile-dark.png') });
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const dp = await newPage(dctx, world(A), '#/hub', [], []);
  await dp.waitForSelector('a[data-hub="recipes"]'); await go(dp, '#/recipes'); await dp.screenshot({ path: path.join(shots, 'recipes-native-desktop-list.png') });
  await dp.locator('.rc-card').first().click(); await dp.waitForSelector('.rc-recipe'); await dp.screenshot({ path: path.join(shots, 'recipes-native-desktop-recipe.png') });
  await browser.close(); server.close();
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
