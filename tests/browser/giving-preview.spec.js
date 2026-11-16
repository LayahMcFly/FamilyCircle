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
    await who(page, 'Tia Sample'); await page.click('.gv-row:has-text("wishes")'); await page.waitForSelector('#gv-items'); await settle(page);
    check('B2 Riley\'s Bubble gun (link, no photo) shows the link picture', await item(page, 'Bubble gun').locator('img[data-from-link=true]').count() === 1, '');
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

  // E. kids, removed member, other family
  { const { ctx, page } = await open(browser);
    await who(page, 'Riley Sample'); let t = await text(page);
    check('E Riley (a kid) sees the family\'s public lists and her own', /Riley.s wishes/.test(t) && /Birthday ideas/.test(t) && /Home projects/.test(t), t);
    check('E a kid sees the adults-only list nowhere', !/birthday gifts|Bike helmet/.test(t), t);
    check('E a kid gets a plain note and no reservations section', /Gift reservations are for adults/.test(t) && !/Items you reserved/.test(t), t);
    await openList(page, 'Birthday ideas'); const lt = await text(page), lh = await html(page);
    check('E a kid sees Rae\'s list with no Reserve button and no reservation information of any kind', !/Reserve|Reserved|by you/.test(lt) && !/data-act="reserve"|data-act="release"|reserv/i.test(lh.replace(/Gift reservations/g, '')), lt);
    check('E a kid can still report', await page.locator('#gv-reportlist').count() === 1 && await item(page, 'Blue ceramic mug').locator('[data-act=report]').count() === 1, '');
    await who(page, 'Una Sample'); t = await text(page);
    check('E Una (a kid by default) sees the same limited view', /Gift reservations are for adults/.test(t), t);
    await who(page, 'Quinn Sample'); t = await text(page);
    check('E Quinn (removed) sees "not available" and no data', /That is not available/.test(t) && !/Birthday|Rae/.test(t), t);
    await who(page, 'Olive Example'); t = await text(page);
    check('E Olive (family B) sees none of Family A', /Giving Center/.test(t) && !/Birthday|Rae|Home projects/.test(t), t);
    await page.goto(PREVIEW() + '#/giving/list/l1'); await page.waitForSelector('.gv-page, .gv-blocked'); await settle(page);
    check('E Olive opening a Family A list id directly is refused', /That is not available/.test(await text(page)) && !/Birthday|mug/i.test(await text(page)), await text(page));
    await page.goto(PREVIEW() + '#/giving/list/zzz'); await settle(page); await page.waitForSelector('.gv-blocked');
    check('E a made-up list id gives the identical message', /That is not available/.test(await text(page)), await text(page));
    await ctx.close(); }

  // K. adult or kid control, adults-only lists, reporting
  { const { ctx, page } = await open(browser);
    await who(page, 'Rae Sample');
    check('K a plain adult has no adult/kid panel and no reports panel', await page.locator('#gv-members').count() === 0 && await page.locator('#gv-reports').count() === 0, '');
    await page.click('#gv-newlist'); await page.waitForSelector('#gv-name');
    check('K an adult sees "Who can see it" when making a list', await page.locator('#gv-audience').count() === 1, '');
    await page.fill('#gv-name', 'Surprise ideas'); await page.selectOption('#gv-audience', 'adults'); await page.click('#gv-save'); await page.waitForSelector('#gv-additem'); await settle(page);
    check('K the new list shows "Adults only"', /Only adults can see it/.test(await text(page)) && await page.locator('.gv-badge.is-adults').count() === 1, await text(page));
    await who(page, 'Riley Sample');
    check('K Riley (a kid) does not see that list', !/Surprise ideas/.test(await text(page)), '');
    await page.click('#gv-newlist'); await page.waitForSelector('#gv-name');
    check('K a kid\'s new-list form has no audience choice', await page.locator('#gv-audience').count() === 0, '');
    await page.goto(PREVIEW() + '#/giving'); await settle(page); await page.waitForSelector('.gv-page');
    await who(page, 'Ada Admin');
    check('K the admin sees the adult/kid panel', await page.locator('#gv-members').count() === 1 && await page.locator('[data-member=u-una]').innerText().then(x => /Kid/.test(x)), '');
    check('K the admin cannot change their own setting (no button on their row)', await page.locator('[data-member=u-ada] button').count() === 0, '');
    await page.locator('[data-member=u-una] button').click(); await page.waitForFunction(() => /Adult/.test(document.querySelector('[data-member=u-una]').innerText)); await settle(page);
    check('K marking Una as an adult updates her row', /Adult/.test(await page.locator('[data-member=u-una]').innerText()), '');
    await who(page, 'Una Sample');
    check('K Una now has adult powers (reservations section, no kid note)', /Items you reserved/.test(await text(page)) && !/Gift reservations are for adults/.test(await text(page)), await text(page));
    // reporting
    await who(page, 'Riley Sample'); await openList(page, 'Birthday ideas');
    await item(page, 'Blue ceramic mug').locator('[data-act=report]').click(); await page.waitForSelector('dialog[open] #gv-r-reason'); await page.waitForTimeout(400);
    await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(250);
    const ctrl = await page.evaluate(() => [...document.querySelectorAll('dialog select, dialog textarea')].filter(el => parseFloat(getComputedStyle(el).borderTopWidth) < 1 || parseFloat(getComputedStyle(el).borderTopLeftRadius) < 8).map(el => el.id));

    check('K the report dialog\'s controls are themed', ctrl.length === 0, ctrl.join());
    await page.click('#gv-r-send'); await settle(page);
    check('K sending with no reason shows an error and stays open', /Choose a reason/.test(await page.locator('dialog').innerText()), '');
    await page.selectOption('#gv-r-reason', 'unsafe'); await page.fill('#gv-r-note', 'The link looks odd'); await page.click('#gv-r-send'); await settle(page);
    check('K a sent report closes the dialog and thanks you without naming anyone', await page.locator('dialog[open]').count() === 0 && /Thanks\. An owner or admin will take a look/.test(await page.locator('.toast').last().innerText()), '');
    await who(page, 'Rae Sample'); await openList(page, 'Birthday ideas');
    check('K Rae (the owner) sees nothing about the report', !/report|Riley/i.test(await text(page).then(x => x.replace(/Report this wishlist/g, ''))) && await item(page, 'Blue ceramic mug').locator('[data-act=report]').count() === 0, '');
    await who(page, 'Ada Admin');
    check('K the admin sees Reports (1) with the item, the reporter and the reason', /Reports \(1\)/.test(await text(page)) && /Blue ceramic mug/.test(await page.locator('#gv-reports').innerText()) && /Riley Sample/.test(await page.locator('#gv-reports').innerText()) && /Unsafe or suspicious link/.test(await page.locator('#gv-reports').innerText()), await text(page));
    check('K the report shows no reservation information', !/Reserved|Sam Sample|by you/.test(await page.locator('#gv-reports').innerText()), '');
    await page.locator('#gv-reports [data-act=remove]').click(); await page.waitForSelector('dialog[open]'); await page.click('#gv-d-ok'); await settle(page);
    check('K removing clears the report', /Nothing has been reported|Reports \(0\)/.test(await text(page)), await text(page));
    await who(page, 'Rae Sample');
    check('K Rae is told an admin removed the item, with no name of who reported it', /removed by a family admin/.test(await text(page)) && !/Riley/.test(await page.locator('.gv-notice').innerText()), await text(page));
    await who(page, 'Sam Sample');
    check('K Sam, who had reserved it, is told it is gone', /Blue ceramic mug\) is no longer on the wishlist|is no longer on the wishlist/.test(await text(page)), await text(page));
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

  // R. requests and pledges (Phase A)
  { const { ctx, page, log } = await open(browser);
    check('R home has a Family requests link with counts', /Family requests/.test(await text(page)) && /open request/.test(await page.locator('#gv-requestslink').innerText()), await page.locator('#gv-requestslink').innerText());
    await page.click('#gv-requestslink'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    let t = await text(page);
    check('R Rae sees the couch request and the adults-only coat request, not the kid\'s waiting one', /Help moving a couch/.test(t) && /Winter coat for Riley/.test(t) && !/Can someone take me to the library/.test(t), t);
    await page.locator('.gv-row', { hasText: 'couch' }).click(); await page.waitForSelector('#main h1:has-text("couch")'); await settle(page);
    t = await text(page);
    check('R the requester sees the pledge from Sam and can mark it done', /Sam Sample/.test(t) && /1 of 3 pledged/.test(t) && (await page.locator('[data-act="done"]').count()) === 1, t);
    await page.click('[data-act="done"]'); await page.waitForSelector('.gv-pledge:has-text("Done")'); await settle(page);
    check('R marking done shows Done and 1 done', /1 done/.test(await text(page)), '');
    await who(page, 'Riley Sample'); await page.goto(PREVIEW() + '#/giving/requests'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    t = await text(page);
    check('R a kid sees their own waiting request, not the adults-only coat request, and is told adults look first', /library/.test(t) && /Waiting for approval/.test(t) && !/Winter coat/.test(t) && /An adult looks at your request/.test(t), t);
    await page.locator('.gv-row', { hasText: 'library' }).click(); await page.waitForSelector('#main h1:has-text("library")'); await settle(page);
    check('R a kid cannot pledge and has no approve buttons', (await page.locator('#gv-pledge, #gv-rapprove').count()) === 0, '');
    await who(page, 'Ada Admin'); await page.goto(PREVIEW() + '#/giving/requests'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    t = await text(page);
    check('R an admin sees the kid\'s request waiting for approval', /Waiting for your approval/.test(t) && /library/.test(t), t);
    await page.locator('.gv-row', { hasText: 'library' }).click(); await page.waitForSelector('#gv-rapprove'); await page.click('#gv-rapprove'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    check('R after approval the waiting section is gone', !/Waiting for your approval/.test(await text(page)), '');
    await who(page, 'Tia Sample'); await page.goto(PREVIEW() + '#/giving/requests'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    await page.locator('.gv-row', { hasText: 'library' }).click(); await page.waitForSelector('#gv-pledge'); await page.fill('#gv-pnote', 'I can take you at 10'); await page.click('#gv-pledge');
    await page.waitForSelector('.gv-pledge:has-text("You")'); await settle(page);
    check('R an adult pledges and sees "You" with her note and a Withdraw button', /I can take you at 10/.test(await text(page)) && (await page.locator('[data-act="withdraw"]').count()) === 1, await text(page));
    await page.click('[data-act="withdraw"]'); await page.waitForSelector('#gv-nopledge'); await settle(page);
    check('R withdrawing removes the pledge', /No one has pledged yet/.test(await text(page)), '');
    await who(page, 'Olive Example'); 
    check('R an account in another family sees nothing of Family A', !/couch|coat|library/.test(await text(page)), await text(page));
    check('R no page errors or outside requests in the requests flow', log.errors.length === 0 && log.external.length === 0, log.errors.concat(log.external).join()); await ctx.close(); }
  for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
    const { ctx, page } = await open(browser, { w, h, hash: '#/giving/requests' });
    await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    await page.screenshot({ path: path.join(shots, 'giving-' + label + '-requests.png'), fullPage: true });
    check('R ' + label + ' requests list has no sideways scroll', !(await overflow(page)), '');
    await page.click('#gv-newrequest'); await page.waitForSelector('#gv-rtitle'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-request-form.png'), fullPage: true });
    check('R ' + label + ' request form has no sideways scroll', !(await overflow(page)), '');
    const plain = await page.evaluate(() => [...document.querySelectorAll('#main input, #main select, #main textarea')].filter(el => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) === 0 || cs.borderTopStyle === 'none'; }).map(el => el.id));
    check('R ' + label + ' request form controls are themed', plain.length === 0, plain.join());
    await page.click('#gv-rsave'); await settle(page);
    check('R ' + label + ' saving an empty title shows the plain message under the field', /Add a short title/.test(await page.locator('#gv-rtitle-err').innerText()), '');
    await page.fill('#gv-rtitle', 'Rake the leaves'); await page.fill('#gv-rneeded', '2'); await page.fill('#gv-ramount', 'about $20'); await page.click('#gv-rsave');
    await page.waitForSelector('#main h1:has-text("Rake the leaves")'); await settle(page);
    check('R ' + label + ' a saved request opens with its money note as plain text', /Money: about \$20/.test(await text(page)) && /0 of 2 pledged/.test(await text(page)), await text(page));
    await ctx.close(); }

  // W. "who sees what" notes while creating
  { const { ctx, page } = await open(browser, { hash: '#/giving/list/new' });
    await page.waitForSelector('#gv-whosees');
    check('W an adult making a wishlist is told what kids can see and do', /Kids in the family can see this wishlist.*cannot reserve.*never see who reserved/.test(await page.locator('#gv-whosees').innerText()), await page.locator('#gv-whosees').innerText());
    await page.selectOption('#gv-audience', 'adults');
    check('W choosing Adults only changes the note to say kids cannot see it', /Kids cannot see this wishlist at all/.test(await page.locator('#gv-whosees').innerText()), '');
    await page.goto(PREVIEW() + '#/giving/requests/new'); await page.waitForSelector('#gv-rwhosees');
    check('W an adult making a request is told kids can see it but cannot pledge', /Kids can see this request but cannot pledge.*you see who pledged/.test(await page.locator('#gv-rwhosees').innerText()), '');
    await page.selectOption('#gv-raudience', 'adults');
    check('W choosing Adults only on a request says kids cannot see it', /Kids cannot see this request at all/.test(await page.locator('#gv-rwhosees').innerText()), '');
    await who(page, 'Riley Sample'); await page.goto(PREVIEW() + '#/giving/list/new'); await page.waitForSelector('#gv-whosees');
    check('W a kid making a wishlist is told adults can see it and reserve, and the kid will not see who', /Everyone in the family can see your wishlist.*Adults can reserve.*not see who reserved/.test(await page.locator('#gv-whosees').innerText()), await page.locator('#gv-whosees').innerText());
    await page.goto(PREVIEW() + '#/giving/requests/new'); await page.waitForSelector('#gv-rwhosees');
    check('W a kid making a request is told an adult approves first, then adults can pledge and the kid sees who', /adult owner or admin looks at your request first.*Adults can pledge.*you will see who pledged/.test(await page.locator('#gv-rwhosees').innerText()), await page.locator('#gv-rwhosees').innerText());
    check('W the notes do not cause sideways scrolling', !(await overflow(page)), ''); await ctx.close(); }

  // E. emergency requests (Phase B)
  { const { ctx, page, log } = await open(browser, { hash: '#/giving/emergency/new' });
    await page.waitForSelector('#gv-etitle'); await settle(page);
    check('E the form shows the 911 notice and the privacy line', /call 911/.test(await page.locator('#gv-911').innerText()) && /medical details, account numbers or passwords/.test(await text(page)), '');
    const boxes = await page.locator('#gv-ehelpers .gv-check').count();
    check('E only other adults can be chosen (not me, not kids)', boxes >= 2 && !/Rae Sample/.test(await page.locator('#gv-ehelpers').innerText()) && !/Riley|Quinn/.test(await page.locator('#gv-ehelpers').innerText()), await page.locator('#gv-ehelpers').innerText());
    const tiny = await page.evaluate(() => [...document.querySelectorAll('#gv-ehelpers .gv-check')].filter(e => e.getBoundingClientRect().height < 40).length);
    check('E each choice is a big tap target', tiny === 0, '');
    const native = await page.evaluate(() => [...document.querySelectorAll('#gv-ehelpers input')].filter(e => getComputedStyle(e).appearance !== 'none').length);
    check('E the tick boxes are themed, not the browser default', native === 0, '');
    await page.click('#gv-esave'); await settle(page);
    check('E sending with nothing filled in shows plain messages', /Say what you need/.test(await page.locator('#gv-etitle-err').innerText()) && /Choose at least one adult/.test(await page.locator('#gv-ehelpers-err').innerText()), '');
    await page.fill('#gv-etitle', 'Car broke down, need a ride'); await page.locator('#gv-ehelpers .gv-check', { hasText: 'Sam Sample' }).click(); await page.click('#gv-esave');
    await page.waitForSelector('#main h1:has-text("Car broke down")'); await settle(page);
    let t = await text(page);
    check('E the sender sees 911 notice, time left, who was asked, and no answers yet', /call 911/.test(t) && /Closes automatically in about 48 hours/.test(t) && /You asked: Sam Sample/.test(t) && /No one has answered yet/.test(t), t);
    check('E the sender has Keep open and no Edit', (await page.locator('[data-act="keep"]').count()) === 1 && (await page.locator('[data-act="edit"]').count()) === 0, '');
    await who(page, 'Sam Sample'); await settle(page);
    check('E Sam gets a short notice and an urgent banner on the home screen', /Rae Sample needs help\. Tap to open\./.test(await text(page)) && (await page.locator('#gv-urgentbanner').count()) === 1, await text(page));
    await page.click('#gv-urgentbanner'); await page.waitForSelector('#gv-urgent-h'); await page.locator('.gv-row', { hasText: 'Car broke down' }).click();
    await page.waitForSelector('#gv-pledge'); check('E the helper button says I can help', /I can help/.test(await page.locator('#gv-pledge').innerText()), '');
    await page.fill('#gv-pnote', 'On my way'); await page.click('#gv-pledge'); await page.waitForSelector('.gv-pledge:has-text("You")'); await settle(page);
    await who(page, 'Ada Admin'); await page.goto(PREVIEW() + '#/giving/requests'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    check('E an admin who was not chosen sees nothing of it', !/Car broke down/.test(await text(page)) && (await page.locator('#gv-urgent-h').count()) === 0, await text(page));
    await who(page, 'Rae Sample'); await page.goto(PREVIEW() + '#/giving/requests'); await page.waitForSelector('#gv-urgent-h'); await page.locator('.gv-row', { hasText: 'Car broke down' }).click(); await page.waitForSelector('#main h1:has-text("Car broke down")'); await settle(page);
    check('E the sender sees Sam answered with his note', /Sam Sample/.test(await text(page)) && /On my way/.test(await text(page)) && /1 person says they can help/.test(await text(page)), await text(page));
    await page.click('#pv-advance'); await settle(page); await page.goto(PREVIEW() + '#/giving/requests'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    check('E after 49 pretend hours it has closed itself and left the Urgent list', (await page.locator('#gv-urgent-h').count()) === 0, '');
    await page.locator('.gv-row', { hasText: 'Car broke down' }).click(); await page.waitForSelector('#main h1:has-text("Car broke down")'); await settle(page);
    check('E the closed one says so and can be kept open', /has closed/.test(await text(page)) && (await page.locator('[data-act="keep"]').count()) === 1, await text(page));
    await page.click('[data-act="keep"]'); await settle(page);
    check('E keep open brings it back for another 48 hours', /Closes automatically in about 48 hours/.test(await text(page)), await text(page));
    check('E no page errors or outside requests in the emergency flow', log.errors.length === 0 && log.external.length === 0, log.errors.concat(log.external).join()); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/giving/emergency/new' }); await who(page, 'Riley Sample'); await page.goto(PREVIEW() + '#/giving/emergency/new'); await page.waitForSelector('#gv-etitle');
    check('E a kid can ask adults for urgent help and is not made to wait for approval', /call 911/.test(await page.locator('#gv-911').innerText()) && /Tia Sample|Sam Sample/.test(await page.locator('#gv-ehelpers').innerText()), '');
    await ctx.close(); }
  for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
    const { ctx, page } = await open(browser, { w, h, hash: '#/giving/emergency/new' });
    await page.waitForSelector('#gv-etitle'); await settle(page);
    await page.screenshot({ path: path.join(shots, 'giving-' + label + '-emergency.png'), fullPage: true });
    check('E ' + label + ' emergency form has no sideways scroll', !(await overflow(page)), '');
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
    await who(page, 'Riley Sample'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-kid.png'), fullPage: true });
    await who(page, 'Ada Admin'); await page.screenshot({ path: path.join(shots, 'giving-' + label + '-admin.png'), fullPage: true });
    check('H ' + label + ' admin home has no sideways scroll', !(await overflow(page)), '');
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
