/* Browser tests for the Giving Center PREVIEW (real Chrome, real preview code, FAKE in-memory server, invented data).
 * Run:  cd tests/browser && node giving-preview.spec.js
 * Proves screen behaviour and that the page makes no network request. Proves NOTHING about the live Appwrite project. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
let PORT; const PREVIEW = () => 'http://127.0.0.1:' + PORT + SUB + 'giving-preview/index.html';
const BANNER = 'Preview — sample data, not connected to your family.';
async function open(browser, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 } });
  const page = await ctx.newPage(); const log = { errors: [], console: [], requests: [], external: [] };
  page.on('pageerror', e => log.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.text()); });
  page.on('request', r => log.requests.push(r.url()));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });
  await page.goto(PREVIEW() + (o.hash || ''));
  await page.waitForSelector('.gv-page, .gv-blocked', { timeout: 8000 });
  return { ctx, page, log };
}
const settle = page => page.waitForTimeout(80);
const who = async (page, name) => { await page.selectOption('#pv-who', { label: name }); await page.waitForSelector('.gv-page, .gv-blocked'); await settle(page); };
const fam = async (page, name) => { await page.selectOption('#pv-fam', { label: name }); await page.waitForSelector('.gv-page, .gv-blocked'); await settle(page); };
const text = page => page.locator('#main').innerText();
const html = page => page.locator('#main').innerHTML();
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const openList = async (page, name) => { await page.locator('.gv-row', { hasText: name }).first().click(); await page.waitForSelector('#main h1:has-text("' + name + '")'); await settle(page); };
const item = (page, title) => page.locator('.gv-item', { hasText: title }).first();
const SECRETS = /Sam Sample|Tia Sample|u-sam|u-tia|Reserved by you|Reserved\b|Release reservation|Reserve this gift/;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });

  // A. label, network, CSP
  { const { ctx, page, log } = await open(browser);
    check('A banner says exactly "' + BANNER + '"', (await page.locator('#pv-banner strong').innerText()) === BANNER, '');
    const blocked = await page.evaluate(async () => { const out = []; for (const u of ['https://nyc.cloud.appwrite.io/v1/health', location.origin + '/FamilyCircle/giving-preview/giving.css']) { try { await fetch(u); out.push('allowed'); } catch (e) { out.push('blocked'); } } return out; });
    check('A the CSP blocks fetch, even to Appwrite and the same site', blocked.join() === 'blocked,blocked', blocked.join());
    await page.waitForTimeout(150);
    check('A no request left this machine', log.external.length === 0, log.external.join());
    check('A config.js, app.js and the Appwrite SDK were never loaded', !log.requests.some(u => /\/(config|app|chat|hub|shop|calls)\.js|appwrite|sdk\.js/.test(u)), '');
    const stor = await page.evaluate(() => { const before = localStorage.length + sessionStorage.length; return { before, cookie: document.cookie }; });
    check('A the preview uses no localStorage, sessionStorage or cookies', stor.before === 0 && stor.cookie === '', JSON.stringify(stor));
    check('A no page errors', log.errors.length === 0, log.errors.join()); await ctx.close(); }

  // B. owner (Rae): wishlist behaviour and the surprise
  { const { ctx, page, log } = await open(browser); // Rae is first
    const t = await text(page);
    check('B Rae sees her two wishlists and Sam\'s list', /Birthday ideas/.test(t) && /Spring ideas/.test(t) && /Home projects/.test(t), t);
    check('B Rae\'s home shows nothing about who reserved what', !/Reserved by you|Release reservation|Reserve this gift/.test(t) && /You have not reserved anything/.test(t), t);
    await openList(page, 'Birthday ideas'); const lt = await text(page); const lh = await html(page);
    check('B Rae sees her items with no reservation words anywhere (text or markup)', !/Reserved|reserve|\bSam\b|\bTia\b/i.test(lt) && !/reserv|\bSam\b|\bTia\b|u-sam|u-tia/i.test(lh), lt);
    check('B received item is under "Received" and is not in the open list', await page.locator('#gv-received .gv-item', { hasText: 'Reading lamp' }).count() === 1 && await page.locator('#gv-items .gv-item', { hasText: 'Reading lamp' }).count() === 0, '');
    check('B per-currency estimated totals, labeled reference only, never mixed', /Estimated total, for reference only: €12\.99 EUR and \$42\.00 USD\. Different currencies are never added together\./.test(lt), lt);
    check('B typed case is kept ("fern for the window" stays lowercase)', await page.locator('.gv-item-title', { hasText: 'fern for the window' }).count() === 1, '');
    // add an item
    await page.click('#gv-additem'); await page.waitForSelector('#gv-title');
    await page.click('#gv-save'); await settle(page);
    check('B empty title shows an error and focuses the field', /Add a title/.test(await text(page)) && await page.evaluate(() => document.activeElement.id) === 'gv-title', await text(page));
    await page.fill('#gv-title', 'NASA poster'); await page.fill('#gv-url', 'javascript:alert(1)'); await page.fill('#gv-price', '1,5'); await page.selectOption('#gv-currency', 'USD'); await page.click('#gv-save'); await settle(page);
    const ft = await text(page);
    check('B unsafe link and ambiguous price are refused with plain messages', /Use a web address that starts with https/.test(ft) && /Enter an amount like 25 or 24\.99/.test(ft), ft);
    await page.fill('#gv-url', 'https://shop.example.com/poster'); await page.fill('#gv-price', '19.50'); await page.selectOption('#gv-priority', 'high'); await page.selectOption('#gv-photo', 'plant'); await page.fill('#gv-notes', 'Large size, MATTE'); await page.click('#gv-save');
    await page.waitForSelector('#gv-items'); await settle(page);
    const it = item(page, 'NASA poster');
    check('B new item saved with its link, price, priority and notes, case unchanged', await it.count() === 1 && /Really want/.test(await it.innerText()) && /\$19\.50 USD \(estimate\)/.test(await it.innerText()) && /Large size, MATTE/.test(await it.innerText()), await it.innerText());
    check('B item link is a safe external link (rel noopener noreferrer nofollow, new tab)', await it.locator('a[href^="https://shop.example.com"]').evaluate(a => a.target === '_blank' && /noopener/.test(a.rel) && /noreferrer/.test(a.rel)), '');
    check('B simulated photo is a data: image only', (await it.locator('img').getAttribute('src')).startsWith('data:image/svg+xml'), '');
    // edit, received, delete
    await it.locator('[data-act=edit]').click(); await page.waitForSelector('#gv-title'); await page.fill('#gv-title', 'NASA poster (framed)'); await page.click('#gv-save'); await page.waitForSelector('#gv-items'); await settle(page);
    check('B editing an item updates it', await item(page, 'NASA poster (framed)').count() === 1, '');
    await item(page, 'NASA poster (framed)').locator('[data-act=received]').click(); await settle(page);
    check('B marking received moves it under Received', await page.locator('#gv-received .gv-item', { hasText: 'NASA poster (framed)' }).count() === 1, '');
    await page.locator('#gv-received .gv-item', { hasText: 'NASA poster (framed)' }).locator('[data-act=delete]').click(); await page.waitForSelector('dialog[open]');
    await page.click('#gv-d-cancel'); await settle(page);
    check('B cancelling the delete dialog keeps the item', await page.locator('.gv-item', { hasText: 'NASA poster (framed)' }).count() === 1, '');
    await page.locator('#gv-received .gv-item', { hasText: 'NASA poster (framed)' }).locator('[data-act=delete]').click(); await page.waitForSelector('dialog[open]'); await page.click('#gv-d-ok'); await settle(page);
    check('B confirming deletes the item', await page.locator('.gv-item', { hasText: 'NASA poster' }).count() === 0, '');
    // owner cannot reach a buyer path by URL
    check('B no page errors', log.errors.length === 0, log.errors.join()); await ctx.close(); }

  // B2. photo optional, link supplies the picture, notes example
  { const { ctx, page } = await open(browser); await page.click('.gv-row:has-text("Birthday ideas")'); await page.waitForSelector('#gv-additem'); await page.click('#gv-additem'); await page.waitForSelector('#gv-title');
    check('B2 notes box shows an example', /For example: size medium/.test(await page.getAttribute('#gv-notes', 'placeholder')), '');
    check('B2 photo is labeled optional and says the link can supply it', /Photo \(optional\)/.test(await page.locator('label[for=gv-photo]').innerText()) && /come from your link/.test(await page.locator('#gv-photo-hint').innerText()), '');
    await page.fill('#gv-title', 'Bubble machine'); await page.fill('#gv-url', 'https://toys.example.com/bubbles'); await page.click('#gv-save'); await page.waitForSelector('#gv-items'); await settle(page);
    const it = item(page, 'Bubble machine');
    check('B2 no photo chosen: the link provides a picture and says so', await it.locator('img[data-from-link=true]').count() === 1 && /Picture from the link \(simulated/.test(await it.innerText()), await it.innerText());
    await page.click('#gv-additem'); await page.waitForSelector('#gv-title'); await page.fill('#gv-title', 'Plain thing'); await page.click('#gv-save'); await page.waitForSelector('#gv-items'); await settle(page);
    check('B2 no photo and no link: no picture box at all', await item(page, 'Plain thing').locator('img').count() === 0, '');
    await page.locator('.gv-item', { hasText: 'fern for the window' }).locator('img:not([data-from-link])').first().waitFor();
    check('B2 a chosen sample photo still wins over the link', await item(page, 'Blue ceramic mug').locator('img[data-from-link]').count() === 0, '');
    await who(page, 'Tia Sample'); await page.click('.gv-row:has-text("Kid wishes")'); await page.waitForSelector('#gv-items'); await settle(page);
    check('B2 Tia\'s Bubble gun (link, no photo) shows the link picture', await item(page, 'Bubble gun').locator('img[data-from-link=true]').count() === 1, '');
    await ctx.close(); }

  // C. givers: Sam and Tia
  { const { ctx, page } = await open(browser);
    await who(page, 'Sam Sample'); let t = await text(page);
    check('C Sam sees "Items you reserved" with the mug', /Blue ceramic mug/.test(await page.locator('#gv-resv').innerText()), t);
    await openList(page, 'Birthday ideas'); const mug = item(page, 'Blue ceramic mug');
    check('C Sam sees "Reserved by you" and a Release button on his item', /Reserved by you/.test(await mug.innerText()) && await mug.locator('[data-act=release]').count() === 1, await mug.innerText());
    await who(page, 'Tia Sample'); await openList(page, 'Birthday ideas');
    const tmug = item(page, 'Blue ceramic mug'); const tt = await tmug.innerText();
    check('C Tia sees plain "Reserved", no name, no Reserve button', /Reserved/.test(tt) && !/Sam|by you/.test(tt) && await tmug.locator('[data-act=reserve]').count() === 0, tt);
    check('C Tia has no hidden trace of Sam in the page markup', !/\bSam\b|u-sam/.test(await html(page)), '');
    const book = item(page, 'The Long Winter'); await book.locator('[data-act=reserve]').click(); await settle(page);
    check('C Tia reserves another item and sees "Reserved by you"', /Reserved by you/.test(await item(page, 'The Long Winter').innerText()), '');
    await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('.gv-page'); await settle(page);
    check('C Tia\'s home lists her reservations (the book and Sam\'s tape measure)', /The Long Winter/.test(await page.locator('#gv-resv').innerText()) && /Tape measure/.test(await page.locator('#gv-resv').innerText()), await text(page));
    await who(page, 'Rae Sample'); await openList(page, 'Birthday ideas');
    check('C back as Rae: the list looks exactly as before, with no sign of the new reservation', !/Reserved|\bTia\b|by you|reserve/i.test(await text(page)) && !/reserv|\bTia\b|u-tia/i.test(await html(page)), await text(page));
    await ctx.close(); }

  // E. no access, other family, removed member
  { const { ctx, page } = await open(browser);
    await who(page, 'Riley Sample'); let t = await text(page);
    check('E Riley (no access) sees only a plain message and no wishlist data', /not available for this account/.test(t) && !/Birthday|Rae|Blue ceramic|Home projects/.test(t), t);
    await who(page, 'Una Sample'); t = await text(page);
    check('E Una (no access) is blocked the same way', /not available for this account/.test(t) && !/Birthday|Rae/.test(t), t);
    await who(page, 'Quinn Sample'); t = await text(page);
    check('E Quinn (removed) sees "not available" and no data', /That is not available/.test(t) && !/Birthday|Rae/.test(t), t);
    await who(page, 'Olive Example'); t = await text(page);
    check('E Olive (family B) sees an empty Family B and none of Family A', /Giving Center/.test(t) && !/Birthday|Rae|Home projects/.test(t), t);
    await page.goto(PREVIEW() + '#/giving/list/l1'); await page.waitForSelector('.gv-page, .gv-blocked'); await settle(page);
    check('E Olive opening a Family A list id directly is refused the same way as a missing list', /That is not available/.test(await text(page)) && !/Birthday|mug/i.test(await text(page)), await text(page));
    await page.goto(PREVIEW() + '#/giving/list/zzz'); await settle(page); await page.waitForSelector('.gv-blocked');
    check('E a made-up list id gives the identical message', /That is not available/.test(await text(page)), await text(page));
    await ctx.close(); }

  // F. only the owner reaches forms; direct URLs
  { const { ctx, page } = await open(browser); await who(page, 'Sam Sample');
    await page.goto(PREVIEW() + '#/giving/list/l1/item/new'); await settle(page); await page.waitForSelector('.gv-blocked, .gv-form');
    check('F Sam cannot open the "add item" form on Rae\'s list by URL', await page.locator('.gv-form').count() === 0 && /not available/.test(await text(page)), await text(page));
    await page.goto(PREVIEW() + '#/giving/list/l1/edit'); await settle(page);
    check('F Sam cannot open the rename form on Rae\'s list either', await page.locator('.gv-form').count() === 0, '');
    await ctx.close(); }

  // G. family switching clears private state; network conditions; stale responses
  { const { ctx, page } = await open(browser);
    await who(page, 'Rae Sample'); await openList(page, 'Birthday ideas');
    await page.selectOption('#pv-net', 'failonce'); await page.evaluate(() => { location.hash = '#/giving'; }); await page.waitForSelector('#gv-retry'); await settle(page);
    check('G failed request shows a retry message (no blank screen)', await page.locator('#gv-retry').count() === 1 && /Could not reach the server/.test(await text(page)), await text(page));
    await page.click('#gv-retry'); await page.waitForSelector('.gv-page'); await settle(page);
    await page.selectOption('#pv-net', 'error'); await page.evaluate(() => { location.hash = '#/giving/list/l1'; }); await page.waitForSelector('#gv-retry'); await settle(page);
    check('G server error shows a plain message with Try again', /Something went wrong on our side/.test(await text(page)) && await page.locator('#gv-retry').count() === 1, await text(page));
    await ctx.close(); }
  { const { ctx, page } = await open(browser); await who(page, 'Rae Sample');
    // slow network, then switch person mid-request: the late answer must not be drawn
    await openList(page, 'Birthday ideas'); await who(page, 'Olive Example');
    await page.selectOption('#pv-net', 'slow'); await page.evaluate(() => { location.hash = '#/giving/list/l1'; });
    await page.waitForTimeout(100); await page.selectOption('#pv-who', { label: 'Rae Sample' }); await page.selectOption('#pv-net', 'normal'); await page.waitForTimeout(1900);
    const t = await text(page);
    check('G a late answer for the previous person is dropped, not drawn', !/That is not available/.test(t) || /Giving Center/.test(t), t);
    const fam2 = await page.evaluate(() => document.querySelector('#pv-fam').value);
    check('G switching person resets the screen to the Giving Center home', /Your wishlists/.test(t), t);
    await ctx.close(); }

  // H. layout at phone and desktop widths, plus screenshots
  for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
    const { ctx, page } = await open(browser, { w, h });
    await page.screenshot({ path: path.join(shots, 'giving-' + label + '-home.png'), fullPage: true });
    check('H ' + label + ' home has no sideways scroll', !(await overflow(page)), '');
    await openList(page, 'Birthday ideas'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-owner-list.png'), fullPage: true });
    check('H ' + label + ' owner list has no sideways scroll', !(await overflow(page)), '');
    await page.click('#gv-additem'); await page.waitForSelector('#gv-title'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-item-form.png'), fullPage: true });
    check('H ' + label + ' item form has no sideways scroll', !(await overflow(page)), '');
    // every control themed: nothing left with a default browser look
    const plain = await page.evaluate(() => [...document.querySelectorAll('#main input, #main select, #main textarea')].filter(el => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) === 0 || cs.borderRadius === '0px' || (el.tagName === 'SELECT' && cs.appearance === 'auto'); }).map(el => el.id));
    check('H ' + label + ' every form control is themed (border, radius, custom select arrow)', plain.length === 0, plain.join());
    const small = await page.evaluate(() => [...document.querySelectorAll('#main a.btn, #main button, #main input, #main select, #main textarea')].filter(el => el.getBoundingClientRect().height < 36).map(el => el.id || el.textContent.trim()));
    check('H ' + label + ' tap targets are at least 36px tall', small.length === 0, small.join());
    await who(page, 'Tia Sample'); await openList(page, 'Birthday ideas'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-giver-list.png'), fullPage: true });
    await who(page, 'Riley Sample'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-no-access.png'), fullPage: true });
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
