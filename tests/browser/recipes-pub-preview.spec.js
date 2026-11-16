/* Browser tests for the Recipes publishing PREVIEW: the REAL recipes.js screen in real Chrome, FAKE in-memory server, invented data.
 * Run:  cd tests/browser && node recipes-pub-preview.spec.js   Proves screen behaviour and no network use. Proves NOTHING about live Appwrite. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
let pass = 0, fail = 0; const results = []; const check = (n, ok, d) => { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); };
let PORT; const URL_ = () => 'http://127.0.0.1:' + PORT + SUB + 'recipes-publishing-preview/index.html';
async function open(browser, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 390, height: 844 } }); const page = await ctx.newPage(); const log = { errors: [], external: [] };
  page.on('pageerror', e => log.errors.push(String(e)));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });
  await page.goto(URL_()); await page.waitForSelector('.rc-card .rc-pub', { timeout: 8000 }); return { ctx, page, log };
}
const text = p => p.locator('#main').innerText(), pause = p => p.waitForTimeout(250);
const who = async (p, n) => { await p.selectOption('#pv-who', { label: n }); await p.waitForSelector('#rc-sharing, .rc-card'); await pause(p); };
const sec = async (p, s) => { await p.click('[data-section="' + s + '"]'); await pause(p); };
const card = (p, name) => p.locator('.rc-card', { hasText: name }).first();
const openCard = async (p, name) => { await card(p, name).click(); await p.waitForSelector('.rc-recipe'); await pause(p); };
const dlg = p => p.locator('dialog[open]').innerText();
const dlgBtn = (p, name) => p.locator('dialog[open] button', { hasText: name });
const M = p => p.locator('#main');
const panel = p => p.locator('.rc-pubpanel');
const back = async p => { await p.goto(URL_() + '#/recipes'); await pause(p); };
const toList = async p => { await p.evaluate(() => { location.hash = '#/recipes'; }); await p.waitForSelector('.rc-card'); await pause(p); };
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });

  { const { ctx, page, log } = await open(browser);   // A. looks like the real Recipes screen, plus the new parts
    check('A banner says preview, sample data', /Preview — sample data, not connected to your family\./.test(await page.locator('#pv-banner').innerText()), '');
    const blocked = await page.evaluate(async () => { try { await fetch('https://nyc.cloud.appwrite.io/v1/health'); return false; } catch (e) { return true; } });
    check('A no network request can leave the page', blocked && log.external.length === 0, JSON.stringify(log.external));
    check('A it is the real Recipes screen: search, Add a recipe, printable book button, filters, backup and restore', (await page.locator('#rc-q').count()) === 1 && (await page.locator('a[href="#/recipes/new"]').count()) === 1 && (await page.locator('a[href="#/recipes/cookbook"]').count()) === 1 && (await page.locator('.rc-chips').count()) >= 2 && (await page.locator('.rc-backup').count()) === 1, '');
    const chips = await page.locator('.rc-sections button').allInnerTexts();
    check('A new sections: My Recipes, My Cookbooks, Family Library', JSON.stringify(chips) === JSON.stringify(['My Recipes', 'My Cookbooks', 'Family Library']), JSON.stringify(chips));
    check('A everything new says "Private to you"', /Private to you/.test(await card(page, 'Sunday Pancakes').innerText()), '');
    check('A a published one says "Published to Happy Family"', /Published to Happy Family/.test(await card(page, "Gran's Sourdough").innerText()), '');
    check('A never the bare word "Public"', !/\bPublic\b/.test(await text(page)), '');
    check('A no horizontal scroll at 390 px', !(await overflow(page)), '');
    await page.screenshot({ path: path.join(shots, 'recipes-pub-mine.png') });
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // B. publish from the recipe page; readers get the same page, read-only
    await openCard(page, 'Sunday Pancakes');
    check('B the recipe page keeps Cook mode, Timer, Print, Edit, Remove and adds a Sharing panel', (await page.getByRole('button', { name: 'Cook mode' }).count()) === 1 && (await page.getByRole('button', { name: 'Timer' }).count()) === 1 && (await page.getByRole('button', { name: 'Print' }).count()) === 1 && (await page.getByRole('link', { name: /Edit/ }).count()) === 1 && (await M(page).getByRole('button', { name: 'Remove', exact: true }).count()) === 1 && /Sharing/.test(await panel(page).innerText()), '');
    await panel(page).getByRole('button', { name: 'Publish to family' }).click();
    const t = await dlg(page);
    check('B confirmation names the family and uses the required wording', t.includes('This recipe will be visible to members of Happy Family. They can print it or save a copy using their device.'), t);
    await dlgBtn(page, 'Cancel').click(); await pause(page);
    check('B cancelling leaves it private', /Private to you/.test(await panel(page).innerText()), '');
    await panel(page).getByRole('button', { name: 'Publish to family' }).click(); await dlgBtn(page, 'Publish to family').click(); await pause(page); await pause(page);
    check('B after confirming the panel says Published to Happy Family', /Published to Happy Family/.test(await panel(page).innerText()), await panel(page).innerText());
    await who(page, 'Tia Sample'); await sec(page, 'library');
    check('B Tia sees it in the Family Library with the author label', /By Rae Sample/.test(await card(page, 'Sunday Pancakes').innerText()), await text(page));
    await openCard(page, 'Sunday Pancakes');
    check('B the shared page shows the byline and a back link to the library', /By Rae Sample · Published to Happy Family/.test(await page.locator('#rc-byline').innerText()) && /Family Library/.test(await page.locator('.rc-crumb').innerText()), '');
    check('B a reader can use Cook mode, Timer and Print', (await page.getByRole('button', { name: 'Cook mode' }).count()) === 1 && (await page.getByRole('button', { name: 'Timer' }).count()) === 1 && (await page.getByRole('button', { name: 'Print' }).count()) === 1, '');
    check('B a reader gets no Edit, Remove, Heart, Sharing or publish buttons', (await page.getByRole('link', { name: /Edit/ }).count()) === 0 && (await M(page).getByRole('button', { name: /Remove|Heart|Publish|Unpublish|Update|Copy/ }).count()) === 0 && (await panel(page).count()) === 0, '');
    await page.screenshot({ path: path.join(shots, 'recipes-pub-shared.png') });
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // C. edit stays private until Update; unpublish
    await openCard(page, "Gran's Sourdough");
    await page.getByRole('link', { name: /Edit/ }).click(); await page.waitForSelector('#rc-f-name'); await page.fill('#rc-f-name', "Gran's Sourdough v2"); await page.getByRole('button', { name: 'Save to my book' }).click(); await page.waitForSelector('.rc-recipe'); await pause(page); await pause(page);
    const c = await panel(page).innerText();
    check('C after editing, the panel says "Changes not published yet" and offers Update published version', /Changes not published yet/.test(c) && /Update published version/.test(c), c);
    await who(page, 'Sam Sample'); await sec(page, 'library');
    check('C the family still sees the OLD title', /Gran's Sourdough/.test(await text(page)) && !/v2/.test(await text(page)), await text(page));
    await who(page, 'Rae Sample'); await openCard(page, "Gran's Sourdough v2");
    await panel(page).getByRole('button', { name: 'Update published version' }).click(); await dlgBtn(page, 'Update published version').click(); await pause(page); await pause(page);
    check('C after Update the panel is back to "Published"', !/Changes not published yet/.test(await panel(page).innerText()), '');
    await who(page, 'Sam Sample'); await sec(page, 'library');
    check('C after Update the family sees the new title', /v2/.test(await text(page)), '');
    await who(page, 'Rae Sample'); await openCard(page, "Gran's Sourdough v2");
    await panel(page).getByRole('button', { name: 'Unpublish' }).click();
    check('C unpublish says it cannot recall prints, downloads, screenshots or copies', /cannot recall pages already printed, files already downloaded, screenshots or copies/.test(await dlg(page)), await dlg(page));
    await dlgBtn(page, 'Unpublish').click(); await pause(page); await pause(page);
    check('C back to private after unpublishing', /Private to you/.test(await panel(page).innerText()), '');
    await who(page, 'Tia Sample'); await sec(page, 'library');
    check('C it is gone from the library', !/Sourdough/.test(await text(page)), '');
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // D. removing a published recipe explains
    await openCard(page, "Gran's Sourdough"); await M(page).getByRole('button', { name: 'Remove', exact: true }).click();
    const t = await dlg(page);
    check('D removing a published recipe explains the published copy stays and offers both choices', /published copy|published copy stays|stays until you unpublish/.test(t) && /Remove and unpublish/.test(t) && /Remove from my book only/.test(t) && /cookbook that uses it keeps its own copy/.test(t), t);
    await dlgBtn(page, 'Remove from my book only').click(); await pause(page); await pause(page);
    await who(page, 'Sam Sample'); await sec(page, 'library');
    check('D "Remove from my book only" leaves the published copy in the library', /Gran's Sourdough/.test(await text(page)), '');
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // E. family switching never flashes
    await sec(page, 'library');
    check('E Happy Family library has Happy recipes only', /Lemon Bars/.test(await text(page)) && !/Beta Family Chili/.test(await text(page)), '');
    await page.selectOption('#pv-fam', { label: 'Beta Family' });
    const seen = await page.evaluate(() => document.getElementById('main').innerText);
    check('E right after switching, nothing from the Happy Family library is on screen (Rae\'s own private recipes are still hers)', !/Lemon Bars/.test(seen) && /Sharing with: Beta Family/.test(seen), seen);
    await pause(page); await pause(page);
    await sec(page, 'library');
    check('E Beta library shows Beta recipes only', /Beta Family Chili/.test(await text(page)) && !/Lemon Bars/.test(await text(page)), await text(page));
    check('E "Sharing with" names the current family', /Sharing with: Beta Family/.test(await text(page)), '');
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // F. roles, removal
    await who(page, 'Sam Sample'); await sec(page, 'library');
    check('F an admin sees only published recipes, never Rae\'s private ones', !/Secret Spice Rub|Sunday Pancakes/.test(await text(page)), '');
    await page.click('.pv-sim button:has-text("Remove Tia")'); await pause(page); await pause(page);
    check('F after Tia is removed her recipe is hidden at once', !/Lemon Bars/.test(await text(page)), '');
    await page.click('.pv-sim button:has-text("Re-invite Tia")'); await pause(page); await pause(page);
    check('F re-inviting her does not bring it back', !/Lemon Bars/.test(await text(page)), '');
    await who(page, 'Tia Sample'); await toList(page);
    check('F Tia\'s own recipe shows Private to you again (the old publication is not hers any more)', /Private to you/.test(await card(page, 'Lemon Bars').innerText()), await card(page, 'Lemon Bars').innerText());
    await ctx.close(); }

  { const { ctx, page } = await open(browser);
    await who(page, 'Tia Sample'); await page.click('.pv-sim button:has-text("Remove Tia")'); await pause(page); await pause(page);
    await sec(page, 'library');
    check('G a removed person is told they are not in a family and sees no shared recipes', /You are not in a family/.test(await text(page)) && !/Sourdough/.test(await text(page)) && (await page.locator('.rc-card').count()) === 0, await text(page));
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // H. search, empty states, photo rule
    await who(page, 'Sam Sample'); await sec(page, 'library');
    await page.fill('#rc-q', 'lemon'); await pause(page); await pause(page); await pause(page);
    check('H title search narrows the list', (await page.locator('.rc-card').count()) === 1 && /Lemon Bars/.test(await text(page)), await text(page));
    await page.fill('#rc-q', 'zzz'); await pause(page); await pause(page); await pause(page);
    check('H empty search has its own message', /No shared recipe has that title/.test(await text(page)), '');
    await page.click('[data-sub="cookbooks"]'); await pause(page);
    check('H Shared Cookbooks shows an empty state for now', /No shared cookbooks yet/.test(await text(page)), '');
    await sec(page, 'cookbooks');
    check('H My Cookbooks shows an empty state and keeps the printable book maker link', /No cookbooks yet/.test(await text(page)) && (await page.locator('a[href="#/recipes/cookbook"]').count()) === 1, '');
    await sec(page, 'mine'); await openCard(page, 'Wide Photo Toast');
    await panel(page).getByRole('button', { name: 'Publish to family' }).click(); await dlgBtn(page, 'Publish to family').click(); await pause(page);
    check('H a photo that is not square is refused with a plain message', /square JPEG/.test(await page.locator('#toasts').innerText()), await page.locator('#toasts').innerText());
    check('H it stayed private after the refusal', /Private to you/.test(await panel(page).innerText()), '');
    await ctx.close(); }

  { for (const w of [390, 1200]) { const { ctx, page, log } = await open(browser, w);
      await sec(page, 'library'); await sec(page, 'mine'); await openCard(page, "Gran's Sourdough");
      check('I @' + w + ' no horizontal scroll and no page errors', !(await overflow(page)) && log.errors.length === 0, JSON.stringify(log.errors));
      await ctx.close(); } }

  { const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } }), page = await ctx.newPage();   // J. sharing off for the family (the default): the Recipe Book looks as it did before
    await page.goto(URL_() + '?sharing=off'); await page.waitForSelector('.rc-card'); await pause(page); await pause(page);
    check('J off: no badges, no section tabs, no sharing panel text', (await page.locator('.rc-pub').count()) === 0 && (await page.locator('.rc-sections').count()) === 0 && !/Private to you/.test(await text(page)), await text(page));
    check('J off: the owner sees one card offering to turn sharing on', (await page.locator('#rc-turnon').count()) === 1, '');
    await openCard(page, "Gran's Sourdough");
    check('J off: a recipe page has no Sharing panel', (await page.locator('.rc-pubpanel').count()) === 0, '');
    await page.goto(URL_() + '?sharing=off#/recipes'); await page.waitForSelector('.rc-card'); await who(page, 'Sam Sample'); await page.waitForSelector('.rc-card'); await pause(page);
    check('J off: an admin who is not the owner sees no turn-on card', (await page.locator('#rc-turnon').count()) === 0 && (await page.locator('.rc-sections').count()) === 0, '');
    await who(page, 'Rae Sample'); await page.waitForSelector('#rc-turnon'); await page.click('#rc-turnon button'); await dlgBtn(page, 'Turn on').click(); await pause(page); await pause(page);
    check('J turning it on shows the sections and badges', (await page.locator('.rc-sections').count()) === 1 && (await page.locator('.rc-pub').count()) > 0, await text(page));
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
