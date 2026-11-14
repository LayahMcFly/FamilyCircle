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
  const pr = await page.evaluate(() => { const copy = document.querySelector('#rc-printdoc .rc-recipe'); return { nav: (document.querySelector('.nav') || document.body).getClientRects().length ? 'shown' : 'none', app: getComputedStyle(document.querySelector('#app')).display, rec: copy ? getComputedStyle(copy).display : 'missing', buttons: document.querySelectorAll('#rc-printdoc button').length, ings: copy ? copy.querySelector('.rc-ings').offsetHeight : 0 }; });
  check('3 in print the app bars and buttons are hidden and only the recipe copy shows', pr.nav === 'none' && pr.app === 'none' && pr.buttons === 0 && pr.rec !== 'none' && pr.ings > 0, JSON.stringify(pr));
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

  // 7. the dinner picker is gone; what was left out
  check('7 no What\'s for dinner button', (await page.getByRole('button', { name: "What's for dinner?" }).count()) === 0 && !/for dinner/i.test(await page.locator('main').innerText()), '');
  const all = await page.locator('main').innerText();
  check('7 no login, AI, sync or outside-feed text anywhere on the page', !/supabase|sign in|groq|gemini|openrouter|api key|themealdb|google drive/i.test(all), '');

  // 8. made from other recipes
  await go(page, '#/recipes/new'); await page.fill('#rc-f-name', 'Soup Night'); await page.fill('#rc-f-partq', 'banana'); await page.locator('.rc-partadd').first().click();
  await page.getByRole('button', { name: 'Save to my book' }).click(); await page.waitForSelector('.rc-recipe h1');
  check('8 a meal made from another recipe shows it', (await page.locator('.rc-parts a').count()) === 1 && /Meal/.test(await page.locator('.rc-recipe header').innerText()), '');
  check('8 the meal pulls in that recipe’s ingredients', (await page.locator('.rc-ings li').count()) > 5, '');

  // 8b. buttons keep their icons (in several themes) and the new book button is there
  await go(page, '#/recipes');
  const iconBoxes = async () => page.evaluate(() => ['.rc-heartchip', 'a[href="#/recipes/new"]', '.rc-bookbtn'].map(sel => { const el = document.querySelector('.rc-controls ' + sel); const svg = el && el.querySelector('svg'); if (!svg) return sel + ': no svg'; const r = svg.getBoundingClientRect(); const paint = getComputedStyle(svg); const hasPath = svg.querySelectorAll('path').length > 0; return (r.width >= 14 && r.height >= 14 && hasPath && (paint.stroke !== 'none' || paint.fill !== 'none')) ? '' : sel + ': ' + Math.round(r.width) + 'x' + Math.round(r.height); }).filter(Boolean));
  check('8b Hearted, Add a recipe and the book button all show an icon', (await iconBoxes()).length === 0, (await iconBoxes()).join(' '));
  const origStyle = await page.evaluate(() => document.documentElement.getAttribute('data-style'));
  let badThemes = [];
  for (const st of ['default', 'bubbly', 'cartoon', 'classic', 'cozy']) {
    await page.evaluate(v => document.documentElement.setAttribute('data-style', v), st); await page.waitForTimeout(60);
    const bad = await iconBoxes(); if (bad.length) badThemes.push(st + ' ' + bad.join(',')); await page.screenshot({ path: path.join(shots, 'recipes-native-controls-' + st + '.png'), clip: { x: 0, y: 100, width: 390, height: 330 } });
  }
  await page.evaluate(v => { if (v === null) document.documentElement.removeAttribute('data-style'); else document.documentElement.setAttribute('data-style', v); }, origStyle);
  check('8b icons stay visible in each theme style tried', badThemes.length === 0, badThemes.join(' | '));
  check('8b "Make printable recipe book" button is on the Recipes page', (await page.getByRole('link', { name: 'Make printable recipe book' }).count()) === 1, '');
  await page.screenshot({ path: path.join(shots, 'recipes-native-controls.png') });

  // 8c. print one recipe: exactly one page, no blank extra page
  await page.locator('.rc-card').first().click(); await page.waitForSelector('.rc-recipe');
  await page.evaluate(() => { window.__undoPrint = window.__rcPreparePrint(); }); await page.emulateMedia({ media: 'print' });
  const shownInPrint = await page.evaluate(() => Array.from(document.body.children).filter(e => getComputedStyle(e).display !== 'none' && e.tagName !== 'SCRIPT').map(e => e.tagName + '#' + e.id));
  check('8c while printing, nothing but the recipe copy is on the page', shownInPrint.length === 1 && shownInPrint[0] === 'DIV#rc-printdoc', shownInPrint.join(','));
  const pdf = await page.pdf({ format: 'Letter', margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' } });
  const ptxt = await page.evaluate(() => document.querySelector('#rc-printdoc').innerText);
  const ttl = await page.locator('.rc-recipe h1').first().innerText();
  check('8c the printed copy has the title, ingredients and method, and no buttons', ptxt.includes(ttl) && /Ingredients/.test(ptxt) && /Method/.test(ptxt) && !/\b(Remove|Edit|Print)\b/.test(ptxt), ptxt.slice(0, 80));
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('8c printing one recipe gives one page (no blank page after it)', pageCount === 1, 'pages=' + pageCount);
  await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => window.__undoPrint());
  check('8c after printing the page is back to normal', (await page.locator('#rc-printdoc').count()) === 0 && !(await page.evaluate(() => document.documentElement.classList.contains('rc-print'))), '');

  // 8d. printable recipe book maker, inside the app
  await go(page, '#/recipes');
  await page.getByRole('link', { name: 'Make printable recipe book' }).click(); await page.waitForSelector('.rc-cbhost .cb h2', { timeout: 15000 });
  check('8d opens at #/recipes/cookbook inside the app, no frame', /#\/recipes\/cookbook$/.test(page.url()) && (await page.locator('iframe, frame, embed, object').count()) === 0, page.url());
  check('8d shows the maker home with a way to start a book', /Create a recipe book/i.test(await page.locator('.cb').innerText()), (await page.locator('.cb').innerText()).slice(0, 100));
  const startBtn = page.locator('.cb button[data-cb="new"], .cb button:has-text("Start")').first();
  await startBtn.click(); await page.waitForSelector('.cb .steps');
  check('8d the recipes from the book are offered to pick', (await page.locator('.cb .rows .row').count()) >= 4, String(await page.locator('.cb .rows .row').count()));
  for (let i = 0; i < 3; i++) { await page.locator('.cb .row input[type="checkbox"]').nth(i).check(); await page.waitForTimeout(120); }
  await page.screenshot({ path: path.join(shots, 'recipes-cookbook-step1.png') });
  const styleAttrs = await page.evaluate(() => document.querySelectorAll('.rc-cbhost [style]').length);
  const hintsLeft = await page.evaluate(() => document.querySelectorAll('.rc-cbhost [data-st]').length);
  check('8d no leftover style hints, none blocked', hintsLeft === 0, String(hintsLeft));
  // walk the steps and make a PDF
  const stepBtns = await page.locator('.cb .steps button').count();
  check('8d the maker has its steps', stepBtns >= 4, String(stepBtns));
  for (let i = 1; i < stepBtns; i++) { await page.locator('.cb .steps button').nth(i).click(); await page.waitForTimeout(250); if (i === 2) await page.screenshot({ path: path.join(shots, 'recipes-cookbook-step3.png') }); if (i === 3) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shots, 'recipes-cookbook-step4.png'), fullPage: true }); } }
  const forms = await page.evaluate(() => Array.from(document.querySelectorAll('.cb input, .cb select, .cb textarea')).filter(el => !['checkbox', 'radio', 'color', 'hidden', 'file'].includes(el.type)).map(el => { const c = getComputedStyle(el); return (c.borderTopWidth === '0px' && c.backgroundColor === 'rgba(0, 0, 0, 0)') ? el.tagName + '.' + el.type + '#' + el.id + '[' + (el.getAttribute('data-set') || el.getAttribute('data-name') || '') + ']' + ' ' + c.borderTopStyle : ''; }).filter(Boolean));
  check('8d every box in the maker is decorated', forms.length === 0, forms.join(','));
  await page.screenshot({ path: path.join(shots, 'recipes-cookbook-last.png') });
  await page.waitForFunction(() => { const b = document.querySelector('.cb button[data-cb="mkpdf"]'); return b && !b.disabled; }, null, { timeout: 30000 }).catch(() => {});
  const mk = page.locator('.cb button[data-cb="mkpdf"]');
  check('8d there is a Make PDF button on the last step', (await mk.count()) === 1, '');
  if (await mk.count()) {
    await mk.click(); await page.waitForSelector('.cb a[download], .cb .ok, .cb .bad', { timeout: 90000 });
    const res = await page.evaluate(() => { const a = document.querySelector('.cb a[download]'); return { ok: !!a, name: a && a.getAttribute('download'), bad: (document.querySelector('.cb .bad') || {}).textContent || '' }; });
    check('8d the PDF is made on this device', res.ok && /\.pdf$/i.test(res.name || ''), JSON.stringify(res));
    if (res.ok) { const dl = page.waitForEvent('download'); await page.locator('.cb a[download]').first().click(); const d = await dl; const buf = fs.readFileSync(await d.path()); check('8d the file is a real PDF with pages', buf.slice(0, 5).toString() === '%PDF-' && buf.length > 15000, 'bytes=' + buf.length); fs.writeFileSync(path.join(shots, 'recipes-cookbook-sample.pdf'), buf); }
  }
  const idbNames = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
  check('8d drafts are saved per member on this device', idbNames.some(n => n === 'fcrb_cookbooks_uA'), idbNames.join(','));
  await go(page, '#/recipes');

  // 9. remove
  await go(page, '#/recipes/recipe/soup-night'); await page.waitForSelector('.rc-recipe h1');
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
