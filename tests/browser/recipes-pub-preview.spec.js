/* Browser tests for the Recipes publishing PREVIEW (real Chrome, real preview code, FAKE in-memory server, invented data).
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
  const ctx = await browser.newContext({ viewport: { width: w || 390, height: 844 } }); const page = await ctx.newPage(); const log = { errors: [], external: [], requests: [] };
  page.on('pageerror', e => log.errors.push(String(e))); page.on('request', r => log.requests.push(r.url()));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });
  await page.goto(URL_()); await page.waitForSelector('.rp-card, .empty'); return { ctx, page, log };
}
const text = p => p.locator('#main').innerText(), pause = p => p.waitForTimeout(120);
const who = async (p, n) => { await p.selectOption('#pv-who', { label: n }); await p.waitForSelector('.rp-card, .empty'); await pause(p); };
const fam = async (p, n) => { await p.selectOption('#pv-fam', { label: n }); await pause(p); };
const tab = async (p, t) => { await p.click('[data-tab="' + t + '"]'); await pause(p); };
const card = (p, name) => p.locator('.rp-card', { hasText: name }).first();
const dlgText = p => p.locator('dialog[open]').innerText();
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });

  { const { ctx, page, log } = await open(browser);
    check('A banner says preview, sample data', /Preview — sample data, not connected to your family\./.test(await page.locator('#pv-banner').innerText()), '');
    const blocked = await page.evaluate(async () => { try { await fetch('https://nyc.cloud.appwrite.io/v1/health'); return false; } catch (e) { return true; } });
    check('A no network request can leave the page', blocked && log.external.length === 0, JSON.stringify(log.external));
    const tabs = await page.locator('.rp-tabs [role=tab]').allInnerTexts();
    check('A tab names', JSON.stringify(tabs) === JSON.stringify(['My Recipes', 'My Cookbooks', 'Family Library']), JSON.stringify(tabs));
    check('A everything new is private: unpublished drafts say "Private to you"', /Private to you/.test(await card(page, 'Sunday Pancakes').innerText()), '');
    check('A published one says "Published to Happy Family"', /Published to Happy Family/.test(await card(page, "Gran's Sourdough").innerText()), '');
    check('A never the bare word "Public"', !/\bPublic\b/.test(await text(page)), '');
    check('A no horizontal scroll at 390 px', !(await overflow(page)), '');
    await page.screenshot({ path: path.join(shots, 'recipes-pub-mine.png') });
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // B. publish flow
    await card(page, 'Sunday Pancakes').getByRole('button', { name: 'Publish to family' }).click();
    const t = await dlgText(page);
    check('B confirmation names the family and uses the required wording', t.includes('This recipe will be visible to members of Happy Family. They can print it or save a copy using their device.'), t);
    await page.getByRole('button', { name: 'Cancel' }).click(); await pause(page);
    check('B cancelling leaves it private', /Private to you/.test(await card(page, 'Sunday Pancakes').innerText()), '');
    await card(page, 'Sunday Pancakes').getByRole('button', { name: 'Publish to family' }).click();
    await page.locator('dialog[open] button', { hasText: 'Publish to family' }).click(); await pause(page);
    check('B after confirming it says Published to Happy Family', /Published to Happy Family/.test(await card(page, 'Sunday Pancakes').innerText()), '');
    await who(page, 'Tia Sample'); await tab(page, 'library');
    check('B Tia sees it in the Family Library with the author label', /Sunday Pancakes/.test(await text(page)) && /By Rae Sample/.test(await card(page, 'Sunday Pancakes').innerText()), await text(page));
    check('B the library has no Edit, Delete, Publish or Unpublish for someone else\'s recipe', (await card(page, 'Sunday Pancakes').getByRole('button', { name: /Edit|Delete|Publish|Unpublish|Update|Copy/ }).count()) === 0, '');
    await card(page, 'Sunday Pancakes').getByRole('button', { name: 'View' }).click(); await pause(page);
    check('B a reader can view and print', /Ingredients/.test(await dlgText(page)) && (await page.locator('dialog[open] button', { hasText: 'Print' }).count()) === 1, '');
    await page.getByRole('button', { name: 'Close' }).click();
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // C. edit stays private until Update; unpublish
    await card(page, "Gran's Sourdough").getByRole('button', { name: 'Edit' }).click();
    await page.fill('#rp-name', "Gran's Sourdough v2"); await page.getByRole('button', { name: 'Save draft' }).click(); await pause(page);
    const c = await card(page, "Gran's Sourdough v2").innerText();
    check('C editing the draft shows "Changes not published yet" and offers Update', /Changes not published yet/.test(c) && /Update published version/.test(c), c);
    await who(page, 'Sam Sample'); await tab(page, 'library');
    check('C the family still sees the OLD version', /Gran's Sourdough\b/.test(await text(page)) && !/v2/.test(await text(page)), await text(page));
    await who(page, 'Rae Sample'); await tab(page, 'mine');
    await card(page, "Gran's Sourdough v2").getByRole('button', { name: 'Update published version' }).click(); await page.locator('dialog[open] button', { hasText: 'Update published version' }).click(); await pause(page);
    await who(page, 'Sam Sample'); await tab(page, 'library');
    check('C after Update the family sees the new version', /v2/.test(await text(page)), '');
    await who(page, 'Rae Sample'); await tab(page, 'mine');
    await card(page, "Gran's Sourdough v2").getByRole('button', { name: 'Unpublish' }).click();
    check('C unpublish says it cannot recall prints, downloads, screenshots or copies', /cannot recall pages already printed, files already downloaded, screenshots or copies/.test(await dlgText(page)), await dlgText(page));
    await page.locator('dialog[open] button', { hasText: 'Unpublish' }).click(); await pause(page);
    check('C back to private after unpublishing', /Private to you/.test(await card(page, "Gran's Sourdough v2").innerText()), '');
    await who(page, 'Tia Sample'); await tab(page, 'library');
    check('C it is gone from the library', !/Sourdough/.test(await text(page)), '');
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // D. delete a published draft explains
    await card(page, "Gran's Sourdough").getByRole('button', { name: 'Delete' }).click();
    const t = await dlgText(page);
    check('D deleting a published recipe explains the published copy stays and offers both choices', /published copy stays until you unpublish/.test(t) && /Delete and unpublish/.test(t) && /Delete draft only/.test(t) && /cookbook that uses it keeps its own copy/.test(t), t);
    await page.getByRole('button', { name: 'Delete draft only' }).click(); await pause(page);
    await who(page, 'Sam Sample'); await tab(page, 'library');
    check('D "Delete draft only" leaves the published copy in the library', /Gran's Sourdough/.test(await text(page)), '');
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // E. family switching never flashes
    await who(page, 'Rae Sample'); await tab(page, 'library');
    check('E Happy Family library has Happy recipes only', /Lemon Bars/.test(await text(page)) && !/Beta Family Chili/.test(await text(page)), '');
    await page.selectOption('#pv-fam', { label: 'Beta Family' });
    const seen = await page.evaluate(() => document.getElementById('main').innerText);
    check('E right after switching, no Happy Family recipe is on screen', !/Lemon Bars|Sourdough/.test(seen), seen);
    await pause(page);
    check('E Beta library shows Beta recipes only', /Beta Family Chili/.test(await text(page)) && !/Lemon Bars/.test(await text(page)), '');
    check('E "Sharing with" names the current family', /Sharing with: Beta Family/.test(await text(page)), '');
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // F. roles, removal, deletion
    await who(page, 'Sam Sample'); await tab(page, 'library');
    check('F an admin sees only published recipes, never Rae\'s private ones', !/Secret Spice Rub|Sunday Pancakes/.test(await text(page)), '');
    await page.click('.rp-sim button:has-text("Remove Tia")'); await pause(page);
    check('F after Tia is removed her recipe is hidden at once', !/Lemon Bars/.test(await text(page)), '');
    await page.click('.rp-sim button:has-text("Re-invite Tia")'); await pause(page);
    check('F re-inviting her does not bring it back', !/Lemon Bars/.test(await text(page)), '');
    await who(page, 'Tia Sample');
    check('F Tia\'s draft shows Private to you again (the old publication is not hers any more)', /Private to you/.test(await card(page, 'Lemon Bars').innerText()), await card(page, 'Lemon Bars').innerText());
    await page.click('.rp-sim button:has-text("Pass 31 days")'); await pause(page);
    await ctx.close(); }

  { const { ctx, page } = await open(browser);
    await who(page, 'Tia Sample'); await page.click('.rp-sim button:has-text("Remove Tia")'); await pause(page);
    check('G a removed reader gets a blocked screen, not content', /not available|Sharing with: no family/.test(await text(page)) || (await page.locator('#pv-fam option').first().innerText()) === 'No family', await text(page));
    await ctx.close(); }

  { const { ctx, page } = await open(browser);   // H. search, empty state, photo rule, cookbooks placeholder
    await who(page, 'Sam Sample'); await tab(page, 'library');
    await page.fill('#rp-search', 'lemon'); await pause(page); await pause(page);
    check('H title search narrows the list', (await page.locator('.rp-card').count()) === 1 && /Lemon Bars/.test(await text(page)), await text(page));
    await page.fill('#rp-search', 'zzz'); await pause(page); await pause(page);
    check('H empty search has its own message', /No shared recipe has that title/.test(await text(page)), '');
    await page.click('[data-sub="cookbooks"]'); await pause(page);
    check('H Shared Cookbooks shows an empty state for now', /No shared cookbooks yet/.test(await text(page)), '');
    await tab(page, 'mine'); await page.click('#rp-new'); await page.fill('#rp-name', 'Photo test'); await page.fill('#rp-ing', '1 egg'); await page.fill('#rp-steps', 'Cook it.');
    await page.selectOption('#rp-photo', 'wide'); await page.getByRole('button', { name: 'Save draft' }).click(); await pause(page);
    await card(page, 'Photo test').getByRole('button', { name: 'Publish to family' }).click(); await page.locator('dialog[open] button', { hasText: 'Publish to family' }).click(); await pause(page);
    check('H a non-square photo is refused with a plain message', /square JPEG/.test(await page.locator('.toasts').innerText()), await page.locator('.toasts').innerText());
    check('H it stayed private after the refusal', /Private to you/.test(await card(page, 'Photo test').innerText()), '');
    await ctx.close(); }

  { for (const w of [390, 1200]) { const { ctx, page, log } = await open(browser, w);
      await tab(page, 'library'); await tab(page, 'mine');
      check('I @' + w + ' no horizontal scroll and no page errors', !(await overflow(page)) && log.errors.length === 0, JSON.stringify(log.errors));
      await ctx.close(); } }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
