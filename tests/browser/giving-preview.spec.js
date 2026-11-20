/* Browser tests for the Giving Center PREVIEW (real Chrome, real preview code, FAKE in-memory server, invented data).
 * Run:  cd tests/browser && node giving-preview.spec.js
 * Proves screen behaviour and that the page makes no network request. Proves NOTHING about the live Appwrite project. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.SITE_ROOT || path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
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
const goto = async (page, route) => { await page.goto(PREVIEW() + '#/giving' + route); await page.waitForSelector('.gv-page, .gv-blocked'); await settle(page); };
/** The home is a hub of icons now; this reads every list screen (mine, family, reserved) the person has, then comes back home. */
const allText = async (page) => { let t = await text(page); const adult = (await page.locator('#gv-reservedbtn').count()) > 0; for (const r of ['mine', 'family', 'reserved']) { if (r === 'reserved' && !adult) continue; await goto(page, '/' + r); t += '\n' + await text(page); } await goto(page, ''); return t; };
const openList = async (page, name) => { for (const r of ['/mine', '/family']) { await goto(page, r); if (await page.locator('.gv-row', { hasText: name }).count()) break; } await page.locator('.gv-row', { hasText: name }).first().click(); await page.waitForSelector('#main h1:has-text("' + name + '")'); await settle(page); };
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
    const t = await allText(page);
    check('B Rae sees her two wishlists and Sam\'s list', /Birthday ideas/.test(t) && /Spring ideas/.test(t) && /Home projects/.test(t), t);
    const ta = await allText(page); check('B Rae\'s screens show nothing about who reserved what', !/Reserved by you|Release reservation|Reserve this gift/.test(ta) && /You have not reserved anything/.test(ta), JSON.stringify(ta));
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
  { const { ctx, page } = await open(browser); await openList(page, 'Birthday ideas'); await page.waitForSelector('#gv-additem'); await page.click('#gv-additem'); await page.waitForSelector('#gv-title');
    check('B2 notes box shows an example', /For example: size medium/.test(await page.getAttribute('#gv-notes', 'placeholder')), '');
    check('B2 photo is labeled optional and says the link can supply it', /Photo \(optional\)/.test(await page.locator('label[for=gv-photo]').innerText()) && /come from your link/.test(await page.locator('#gv-photo-hint').innerText()), '');
    await page.fill('#gv-title', 'Bubble machine'); await page.fill('#gv-url', 'https://toys.example.com/bubbles'); await page.click('#gv-save'); await page.waitForSelector('#gv-items'); await settle(page);
    const it = item(page, 'Bubble machine');
    check('B2 no photo chosen: the link provides a picture and says so', await it.locator('img[data-from-link=true]').count() === 1 && /Picture from the link \(simulated/.test(await it.innerText()), await it.innerText());
    await page.click('#gv-additem'); await page.waitForSelector('#gv-title'); await page.fill('#gv-title', 'Plain thing'); await page.click('#gv-save'); await page.waitForSelector('#gv-items'); await settle(page);
    check('B2 no photo and no link: no picture box at all', await item(page, 'Plain thing').locator('img').count() === 0, '');
    await page.locator('.gv-item', { hasText: 'fern for the window' }).locator('img:not([data-from-link])').first().waitFor();
    check('B2 a chosen sample photo still wins over the link', await item(page, 'Blue ceramic mug').locator('img[data-from-link]').count() === 0, '');
    await who(page, 'Tia Sample'); await openList(page, 'wishes'); await page.waitForSelector('#gv-items'); await settle(page);
    check('B2 Riley\'s Bubble gun (link, no photo) shows the link picture', await item(page, 'Bubble gun').locator('img[data-from-link=true]').count() === 1, '');
    await ctx.close(); }

  // C. givers: Sam and Tia
  { const { ctx, page } = await open(browser);
    await who(page, 'Sam Sample'); await goto(page, '/reserved'); let t = await text(page);
    check('C Sam sees "Items you reserved" with the mug', /Blue ceramic mug/.test(await page.locator('#gv-resv').innerText()), t);
    await openList(page, 'Birthday ideas'); const mug = item(page, 'Blue ceramic mug');
    check('C Sam sees "Reserved by you" and a Release button on his item', /Reserved by you/.test(await mug.innerText()) && await mug.locator('[data-act=release]').count() === 1, await mug.innerText());
    await who(page, 'Tia Sample'); await openList(page, 'Birthday ideas');
    const tmug = item(page, 'Blue ceramic mug'); const tt = await tmug.innerText();
    check('C Tia sees plain "Reserved", no name, no Reserve button', /Reserved/.test(tt) && !/Sam|by you/.test(tt) && await tmug.locator('[data-act=reserve]').count() === 0, tt);
    check('C Tia has no hidden trace of Sam in the page markup', !/\bSam\b|u-sam/.test(await html(page)), '');
    const book = item(page, 'The Long Winter'); await book.locator('[data-act=reserve]').click(); await settle(page);
    check('C Tia reserves another item and sees "Reserved by you"', /Reserved by you/.test(await item(page, 'The Long Winter').innerText()), '');
    await goto(page, '/reserved');
    check('C Tia\'s reserved screen lists her reservations (the book and Sam\'s tape measure)', /The Long Winter/.test(await page.locator('#gv-resv').innerText()) && /Tape measure/.test(await page.locator('#gv-resv').innerText()), await text(page));
    await who(page, 'Rae Sample'); await openList(page, 'Birthday ideas');
    check('C back as Rae: the list looks exactly as before, with no sign of the new reservation', !/Reserved|\bTia\b|by you|reserve/i.test(await text(page)) && !/reserv|\bTia\b|u-tia/i.test(await html(page)), await text(page));
    await ctx.close(); }

  // E. kids, removed member, other family
  { const { ctx, page } = await open(browser);
    await who(page, 'Riley Sample'); let t = await allText(page);
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
    check('K a plain adult has no Adults icon, no adult/kid panel and no reports panel', await page.locator('#gv-peoplebtn').count() === 0 && await page.locator('#gv-members').count() === 0 && await page.locator('#gv-reports').count() === 0, '');
    await page.click('#gv-newlist'); await page.waitForSelector('#gv-name');
    check('K an adult sees "Who can see it" when making a list', await page.locator('#gv-audience').count() === 1, '');
    await page.fill('#gv-name', 'Surprise ideas'); await page.selectOption('#gv-audience', 'adults'); await page.click('#gv-save'); await page.waitForSelector('#gv-additem'); await settle(page);
    check('K the new list shows "Adults only"', /Only adults can see it/.test(await text(page)) && await page.locator('.gv-badge.is-adults').count() === 1, await text(page));
    await who(page, 'Riley Sample');
    check('K Riley (a kid) does not see that list', !/Surprise ideas/.test(await allText(page)), '');
    await page.click('#gv-newlist'); await page.waitForSelector('#gv-name');
    check('K a kid\'s new-list form has no audience choice', await page.locator('#gv-audience').count() === 0, '');
    await page.goto(PREVIEW() + '#/giving'); await settle(page); await page.waitForSelector('.gv-page');
    await who(page, 'Ada Admin');
    await goto(page, '/people'); check('K the admin sees the adult/kid panel', await page.locator('#gv-members').count() === 1 && await page.locator('[data-member=u-una]').innerText().then(x => /Kid/.test(x)), '');
    check('K the admin cannot change their own setting (no button on their row)', await page.locator('[data-member=u-ada] button').count() === 0, '');
    await page.locator('[data-member=u-una] button').click(); await page.waitForFunction(() => /Adult/.test(document.querySelector('[data-member=u-una]').innerText)); await settle(page);
    check('K marking Una as an adult updates her row', /Adult/.test(await page.locator('[data-member=u-una]').innerText()), '');
    await who(page, 'Una Sample');
    check('K Una now has adult powers (reserved icon, no kid note)', (await page.locator('#gv-reservedbtn').count()) === 1 && !/Gift reservations are for adults/.test(await text(page)), await text(page));
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
    check('G switching person resets the screen to the Giving Center home', (await page.locator('#gv-minebtn').count()) === 1, t);
    await ctx.close(); }

  // R. requests and pledges (Phase A)
  { const { ctx, page, log } = await open(browser);
    check('R home has a Requests icon with a count and a full accessible name', /open request/.test(await page.locator('#gv-requestslink').getAttribute('aria-label')) && /^\d+$/.test((await page.locator('#gv-requestslink .gv-circle-count').innerText()).trim()), await page.locator('#gv-requestslink').getAttribute('aria-label'));
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
    await who(page, 'Rae Sample'); await page.goto(PREVIEW() + '#/giving/emergency'); await page.waitForSelector('#gv-urgent-h'); await page.locator('.gv-row', { hasText: 'Car broke down' }).click(); await page.waitForSelector('#main h1:has-text("Car broke down")'); await settle(page);
    check('E the sender sees Sam answered with his note', /Sam Sample/.test(await text(page)) && /On my way/.test(await text(page)) && /1 person says they can help/.test(await text(page)), await text(page));
    await page.click('#pv-advance'); await settle(page); await page.goto(PREVIEW() + '#/giving/emergency'); await page.waitForSelector('#gv-urgent-h'); await settle(page);
    check('E after 49 pretend hours it has closed itself and left Needs help now', (await page.locator('#gv-nourgent').count()) === 1, '');
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

  // G. circular icon buttons and the glow
  { const { ctx, page } = await open(browser); await settle(page);
    const b = await page.locator('#gv-urgentbtn .gv-circle-dot').boundingBox();
    check('G the urgent button is a small circle with an icon', Math.abs(b.width - b.height) < 1 && b.width >= 44 && b.width <= 64 && (await page.locator('#gv-urgentbtn svg').count()) === 1, JSON.stringify(b));
    check('G it has a short text label and a full accessible name', /Urgent/.test(await page.locator('#gv-urgentbtn').innerText()) && (await page.locator('#gv-urgentbtn').getAttribute('aria-label')) === 'Urgent help', '');
    check('G it does not glow when nobody needs help', !(await page.locator('#gv-urgentbtn').getAttribute('class')).includes('is-pulsing') && (await page.locator('#gv-urgentbanner').count()) === 0, '');
    await page.goto(PREVIEW() + '#/giving/emergency/new'); await page.waitForSelector('#gv-etitle'); await page.fill('#gv-etitle', 'Need help now'); await page.locator('#gv-ehelpers .gv-check', { hasText: 'Sam Sample' }).click(); await page.click('#gv-esave'); await page.waitForSelector('#main h1:has-text("Need help now")');
    await who(page, 'Sam Sample'); await settle(page);
    check('G when someone needs help the button and the banner glow', (await page.locator('#gv-urgentbtn').getAttribute('class')).includes('is-pulsing') && (await page.locator('#gv-urgentbanner').count()) === 1, '');
    const anim = await page.evaluate(() => [getComputedStyle(document.querySelector('#gv-urgentbtn .gv-circle-dot')).animationName, getComputedStyle(document.querySelector('#gv-urgentbanner')).animationName]);
    check('G the glow is an animation that loops', anim[0] === 'gv-glow' && anim[1] === 'gv-glow', anim.join());
    await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); const page = await ctx.newPage(); await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('.gv-page');
    await page.evaluate(() => { document.querySelector('#gv-urgentbtn').classList.add('is-pulsing'); });
    check('G with reduced motion the glow does not animate', (await page.evaluate(() => getComputedStyle(document.querySelector('#gv-urgentbtn .gv-circle-dot')).animationName)) === 'none', ''); await ctx.close(); }

  // X. emergency extras: kinds, where, pickup, one-time location, on my way, all set
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 30.8327, longitude: -83.2785 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(PREVIEW() + '#/giving/emergency/new'); await page.waitForSelector('#gv-etitle'); await settle(page);
    check('X the form offers quick kinds of help', (await page.locator('#gv-etypes .gv-chip').count()) === 5, '');
    const chipH = await page.evaluate(() => [...document.querySelectorAll('.gv-chip')].filter(e => e.getBoundingClientRect().height < 40).length);
    check('X the kind buttons are big enough to tap', chipH === 0, '');
    check('X pickup and drop-off are hidden until Ride is chosen', !(await page.locator('#gv-epickup').isVisible()), '');
    await page.click('[data-type="ride"]'); await settle(page);
    check('X choosing Ride fills in the title and shows pickup and drop-off', (await page.inputValue('#gv-etitle')) === 'I need a ride' && (await page.locator('#gv-epickup').isVisible()), '');
    await page.fill('#gv-ewhere', 'Walmart on Ashley St'); await page.fill('#gv-epickup', '12 Oak St'); await page.fill('#gv-edropoff', 'Home');
    await page.click('#gv-eloc'); await page.waitForFunction(() => /Location added once/.test(document.getElementById('gv-eloc-note').textContent));
    check('X sharing the location is one time, says so, and can be removed', /not tracked/.test(await page.locator('#gv-eloc-note').innerText()) && (await page.locator('#gv-eloc-clear').isVisible()), '');
    const plain = await page.evaluate(() => [...document.querySelectorAll('#main input[type=text], #main textarea')].filter(el => parseFloat(getComputedStyle(el).borderTopWidth) === 0).map(e => e.id));
    check('X the new fields are themed', plain.length === 0, plain.join());
    await page.locator('#gv-ehelpers .gv-check', { hasText: 'Sam Sample' }).click(); await page.click('#gv-esave'); await page.waitForSelector('#main h1:has-text("I need a ride")'); await settle(page);
    check('X the sender sees the place with an Open in maps link', /Walmart on Ashley St/.test(await text(page)) && (await page.locator('#gv-ewhere .gv-maplink').count()) === 1, '');
    await page.selectOption('#pv-who', { label: 'Sam Sample' }); await settle(page);
    await page.goto(PREVIEW() + '#/giving/emergency'); await page.waitForSelector('#gv-urgent-h'); await page.locator('.gv-row', { hasText: 'I need a ride' }).click(); await page.waitForSelector('#gv-pledge'); await settle(page);
    const href = await page.locator('#gv-ewhere .gv-maplink').getAttribute('href'), loc = await page.locator('#gv-eloc-shared .gv-maplink').getAttribute('href');
    check('X the helper gets safe maps links for the place and the shared spot', href === 'https://www.google.com/maps/search/?api=1&query=Walmart%20on%20Ashley%20St' && /query=30\.8327%2C-83\.2785/.test(loc) && (await page.locator('.gv-maplink').first().getAttribute('rel')) === 'noopener noreferrer', href + ' ' + loc);
    check('X the helper sees pickup and drop-off', /Pick up at: 12 Oak St/.test(await text(page)) && /Take to: Home/.test(await text(page)), '');
    await page.selectOption('#gv-peta', '10'); await page.fill('#gv-pnote', 'Leaving now'); await page.click('#gv-pledge'); await page.waitForSelector('.gv-pledge:has-text("You")'); await settle(page);
    check('X the helper\'s time shows on their answer', /About 10 minutes/.test(await page.locator('#gv-pledges').innerText()), '');
    await page.selectOption('#pv-who', { label: 'Rae Sample' }); await settle(page);
    await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('.gv-notice'); 
    check('X the sender is told when the helper can come', /Sam Sample can help \(about 10 minutes\)/.test(await text(page)), await text(page));
    await page.goto(PREVIEW() + '#/giving/emergency'); await page.waitForSelector('#gv-urgent-h'); await page.locator('.gv-row', { hasText: 'I need a ride' }).click(); await page.waitForSelector('[data-act="close"]'); await settle(page);
    check('X the sender\'s close button says All set', (await page.locator('[data-act="close"]').innerText()) === 'All set', '');
    await page.click('[data-act="close"]'); await settle(page);
    check('X after All set the request is closed', /has closed/.test(await text(page)), '');
    await page.selectOption('#pv-who', { label: 'Sam Sample' }); await settle(page);
    check('X the helper is told it is no longer needed', /No longer needed: "I need a ride"\. Thank you\./.test(await text(page)), await text(page));
    check('X no page errors in the extras flow', errs.length === 0, errs.join()); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: [] }); const page = await ctx.newPage();
    await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (ok, bad) => bad({ code: 1 }); });
    await page.goto(PREVIEW() + '#/giving/emergency/new'); await page.waitForSelector('#gv-eloc'); await page.click('#gv-eloc'); await settle(page);
    check('X when the phone says no, the message is plain and the form still works', /did not allow location.*type the place/.test(await page.locator('#gv-eloc-note').innerText()), await page.locator('#gv-eloc-note').innerText()); await ctx.close(); }

  // N. the home navigation is a row of small circular icon buttons, and only urgent help glows
  { const { ctx, page } = await open(browser); await settle(page);
    const ids = ['gv-minebtn', 'gv-familybtn', 'gv-requestslink', 'gv-newlist', 'gv-urgentbtn'];
    for (const id of ids) { const b = await page.locator('#' + id + ' .gv-circle-dot').boundingBox(); check('N ' + id + ' is a small circle with an icon and a label', Math.abs(b.width - b.height) < 1 && b.width >= 44 && b.width <= 64 && (await page.locator('#' + id + ' svg').count()) === 1 && (await page.locator('#' + id + ' .gv-circle-label').innerText()).length > 0, id); }
    check('N the old text buttons are gone from the home header', (await page.locator('.gv-head .btn').count()) === 0 && !(await page.locator('#gv-requestslink').evaluate(e => e.classList.contains('gv-row'))), '');
    const hubCols = await page.evaluate(() => getComputedStyle(document.querySelector('.gv-hub')).gridTemplateColumns.split(' ').length);
    check('N the icons sit three to a row', hubCols === 3, String(hubCols));
    const glow = await page.evaluate(() => [...document.querySelectorAll('.gv-circle-dot, .gv-row, .gv-circle')].filter(e => getComputedStyle(e).animationName !== 'none').length);
    check('N nothing glows when nobody needs help', glow === 0, String(glow));
    check('N the home shows icons only, with no wishlists listed on it', (await page.locator('#main .gv-rows').count()) === 0 && (await page.locator('#gv-reservedbtn').count()) === 1, '');
    await page.click('#gv-familybtn'); await page.waitForSelector('#gv-sec-family'); await settle(page);
    check('N the Family icon opens the family wishlists on their own screen', /Home projects/.test(await text(page)) && !/Your wishlists/.test(await text(page)) && (await page.locator('.gv-circle-dot').count()) === 0, await text(page));
    await page.click('text=Back to Giving Center'); await page.waitForSelector('#gv-minebtn'); await page.click('#gv-minebtn'); await page.waitForSelector('#gv-sec-mine'); await settle(page);
    check('N the Mine icon opens only your wishlists, with a New list icon', /Birthday ideas/.test(await text(page)) && !/Home projects/.test(await text(page)) && (await page.locator('#gv-newlist2 svg').count()) === 1, await text(page));
    await page.click('text=Back to Giving Center'); await page.waitForSelector('#gv-reservedbtn'); await page.click('#gv-reservedbtn'); await page.waitForSelector('#gv-sec-reserved'); await settle(page);
    check('N the Reserved icon opens the reserved items screen', /Items you reserved/.test(await text(page)), await text(page));
    await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('#gv-minebtn');
    await page.click('#gv-requestslink'); await page.waitForSelector('#main h1:has-text("Family requests")'); await settle(page);
    check('N the requests screen has New request and no urgent section; the Urgent icon opens its own screen', (await page.locator('#gv-newrequest svg').count()) === 1 && (await page.locator('#gv-urgent-h').count()) === 0 && (await page.locator('#gv-urgentnew').count()) === 0 && (await page.locator('.gv-head .btn').count()) === 0, '');
    await page.click('text=Back to Giving Center'); await page.waitForSelector('#gv-urgentbtn'); await page.click('#gv-urgentbtn'); await page.waitForSelector('#gv-emerg-h'); await settle(page);
    check('N the Urgent icon opens Urgent help, where you can ask for help and see who needs it', (await page.locator('#gv-urgentnew svg').count()) === 1 && (await page.locator('#gv-urgent-h').count()) === 1 && !/Family requests/.test(await text(page)), await text(page));
    await page.click('#gv-urgentnew'); await page.waitForSelector('#gv-etitle');
    await who(page, 'Una Sample'); await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('#gv-urgentbtn');
    check('N a kid sees the same icons', (await page.locator('#gv-minebtn').count()) === 1 && (await page.locator('#gv-requestslink').count()) === 1, '');
    await ctx.close(); }
  for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
    const { ctx, page } = await open(browser, { w, h, hash: '#/giving' }); await settle(page);
    await page.screenshot({ path: path.join(shots, 'giving-' + label + '-icons.png') });
    check('N ' + label + ' icon row has no sideways scroll', !(await overflow(page)), '');
    check('N ' + label + ' icons are all visible without scrolling the row sideways', await page.evaluate(() => [...document.querySelectorAll('.gv-hub .gv-circle')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })), ''); await ctx.close(); }

  // X2. gift exchanges: the draw is private to each person, including from the organiser
  { const { ctx, page } = await open(browser); await settle(page);
    check('X2 an adult sees the Exchange icon with a count of exchanges they are in', (await page.locator('#gv-exchangesbtn .gv-circle-count').innerText()).trim() === '1', '');
    await who(page, 'Riley Sample'); await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('#gv-minebtn');
    check('X2 a kid has no Exchange icon', (await page.locator('#gv-exchangesbtn').count()) === 0, '');
    await page.goto(PREVIEW() + '#/giving/exchanges'); await page.waitForSelector('.gv-blocked, .gv-page'); await settle(page);
    check('X2 a kid who types the address gets "not available"', /not available/i.test(await text(page)) && !/Holiday gift exchange/.test(await text(page)), await text(page));
    await who(page, 'Rae Sample'); await goto(page, '/exchanges');
    check('X2 the list shows the seeded exchange, not drawn, with the organiser badge', /Holiday gift exchange/.test(await text(page)) && /Not drawn yet · 3 people/.test(await text(page)) && /You organise/.test(await text(page)), await text(page));
    await page.click('.gv-row:has-text("Holiday gift exchange")'); await page.waitForSelector('#gv-xtitle'); await settle(page);
    check('X2 before the draw there is no match and Draw names is on', (await page.locator('#gv-match').count()) === 0 && await page.locator('#gv-xdraw').isEnabled(), '');
    await page.selectOption('#gv-xaddsel', { label: 'Ada Admin' }); await page.click('#gv-xaddbtn'); await settle(page);
    check('X2 the organiser added Ada before the draw', (await page.locator('#gv-xmembers li').count()) === 4, '');
    await page.click('#gv-xedit'); await page.waitForSelector('#gv-xa'); await settle(page);
    await page.selectOption('#gv-xa', { label: 'Sam Sample' }); await page.selectOption('#gv-xb', { label: 'Tia Sample' }); await page.click('#gv-xadd');
    check('X2 an exclusion can be added and is listed', /Sam Sample and Tia Sample cannot draw each other/.test(await page.locator('#gv-xlist').innerText()), '');
    await page.click('#gv-xsave'); await page.waitForSelector('#gv-xtitle'); await settle(page);
    check('X2 the organiser sees the exclusion count but nothing about the draw', /1 exclusion is set/.test(await text(page)), await text(page));
    await page.click('#gv-xdraw'); await page.click('#gv-d-ok'); await page.waitForSelector('#gv-xhidden'); await settle(page);
    check('X2 after drawing, the organiser sees she cannot see who drew whom, and no match card for anyone else', (await page.locator('#gv-xhidden').count()) === 1 && (await page.locator('#gv-xredraw').count()) === 1, '');
    const raeMatch = await page.locator('#gv-matchname').innerText();
    check('X2 the organiser sees exactly one match: her own', ['Sam Sample', 'Tia Sample'].includes(raeMatch) && (await page.locator('#gv-matchname').count()) === 1, raeMatch);
    check('X2 the page never shows two people paired', !/drew|is giving to/i.test((await text(page)).replace('You are giving a gift to', '').replace(/You cannot see who drew whom\./, '')), await text(page));
    await who(page, 'Sam Sample'); await goto(page, '/exchanges'); await page.click('.gv-row:has-text("Holiday gift exchange")'); await page.waitForSelector('#gv-xtitle'); await settle(page);
    const samMatch = await page.locator('#gv-matchname').innerText();
    check('X2 Sam sees one match, never himself, and not the person he is excluded from', samMatch !== 'Sam Sample' && samMatch !== 'Tia Sample', samMatch);
    check('X2 Sam has no organiser buttons', (await page.locator('#gv-xdraw, #gv-xredraw, #gv-xdelete, #gv-xedit').count()) === 0, '');
    if (samMatch === 'Rae Sample') check('X2 Sam can open the match\'s wishlist', await page.locator('#gv-matchlists a').count() >= 1, '');
    await page.click('#gv-xleave'); await page.click('#gv-d-ok'); await settle(page);
    await who(page, 'Rae Sample'); await goto(page, '/');
    check('X2 the organiser is told Sam left, in plain words with no pairing', /Sam Sample left Holiday gift exchange/.test(await text(page)) && !/drew/.test(await text(page)), await text(page));
    await goto(page, '/exchanges'); await page.click('.gv-row:has-text("Holiday gift exchange")'); await page.waitForSelector('#gv-xtitle'); await settle(page);
    check('X2 with three people left, a redraw is offered and works', (await page.locator('#gv-xredraw').count()) === 1, '');
    await page.click('#gv-xredraw'); await page.click('#gv-d-ok'); await page.waitForSelector('#gv-matchname'); await settle(page);
    check('X2 after the redraw the organiser has a fresh match and still cannot see anyone else\'s', ['Tia Sample', 'Ada Admin'].includes(await page.locator('#gv-matchname').innerText()), '');
    await who(page, 'Tia Sample'); await goto(page, '/'); await settle(page);
    check('X2 Tia was told it was drawn again', /drawn again/.test(await text(page)), await text(page));
    await who(page, 'Rae Sample'); await goto(page, '/exchanges/new'); await page.fill('#gv-xname', ''); await page.click('#gv-xsave'); await settle(page);
    check('X2 a name is required, with a message under the field', /Give the exchange a name/.test(await page.locator('#gv-xname-err').innerText()), '');
    await page.fill('#gv-xname', 'Cousins swap'); await page.click('#gv-xsave'); await page.waitForSelector('#gv-xtitle'); await settle(page);
    check('X2 a new exchange starts with just the organiser and Draw names off', (await page.locator('#gv-xmembers li').count()) === 1 && await page.locator('#gv-xdraw').isDisabled(), '');
    await page.selectOption('#gv-xaddsel', { label: 'Ada Admin' }); await page.click('#gv-xaddbtn'); await settle(page);
    check('X2 the organiser can add an adult', (await page.locator('#gv-xmembers li').count()) === 2, '');
    await page.click('#gv-xdelete'); await page.click('#gv-d-ok'); await page.waitForSelector('#gv-exchanges'); await settle(page);
    check('X2 deleting returns to the list without it', !/Cousins swap/.test(await text(page)), '');
    for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
      const c2 = await open(browser, { w, h, hash: '#/giving/exchanges' }); await settle(c2.page);
      check('X2 ' + label + ' exchanges list has no sideways scroll', !(await overflow(c2.page)), ''); await c2.ctx.close(); }
    await ctx.close(); }

  // X3. group gifts: a tracker only, hidden from the person it is for
  { const { ctx, page } = await open(browser); await settle(page);
    check('X3 an adult sees the Group gift icon with the open count', (await page.locator('#gv-giftsbtn .gv-circle-count').innerText()).trim() === '1', '');
    await who(page, 'Una Sample'); await page.goto(PREVIEW() + '#/giving'); await page.waitForSelector('#gv-minebtn');
    check('X3 the person the gift is for (a kid) has no Group gift icon', (await page.locator('#gv-giftsbtn').count()) === 0, '');
    await page.goto(PREVIEW() + '#/giving/gifts'); await page.waitForSelector('.gv-blocked, .gv-page'); await settle(page);
    check('X3 typing the address gives "not available" and shows nothing about the gift', /not available/i.test((await text(page)).replace(/ USD/g, '')) && !/Gran/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    await who(page, 'Sam Sample'); await goto(page, '/gifts');
    check('X3 Sam sees the gift, who it is for, the total and his confirmed part', /Gran.s birthday present/.test((await text(page)).replace(/ USD/g, '')) && /For Una Sample/.test((await text(page)).replace(/ USD/g, '')) && /\$20\.00 of \$120\.00/.test((await text(page)).replace(/ USD/g, '')) && /Your part confirmed/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    await page.click('.gv-row:has-text("Gran")'); await page.waitForSelector('#gv-gsum'); await settle(page);
    check('X3 the detail shows a progress bar with a text label and the no-money line', (await page.locator('.gv-bar[role=progressbar]').getAttribute('aria-valuenow')) === '16' && /never takes, holds or sends money/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    check('X3 Sam sees no list of who gave what and no organiser buttons', (await page.locator('#gv-gcontribs, #gv-gorg, #gv-gclose, #gv-gdelete').count()) === 0, '');
    check('X3 a confirmed part cannot be changed by Sam', /You put in \$20\.00\. Rae Sample confirmed it/.test((await text(page)).replace(/ USD/g, '')) && (await page.locator('#gv-gmark').count()) === 0, (await text(page)).replace(/ USD/g, ''));
    await who(page, 'Tia Sample'); await goto(page, '/gifts'); await page.click('.gv-row:has-text("Gran")'); await page.waitForSelector('#gv-gmark'); await settle(page);
    await page.fill('#gv-gamount', 'abc'); await page.click('#gv-gmark'); await settle(page);
    check('X3 a bad amount shows a message under the field', /plain amount/.test(await page.locator('#gv-gamount-err').innerText()), '');
    await page.fill('#gv-gamount', '25'); await page.fill('#gv-gcnote', 'Venmo'); await page.click('#gv-gmark'); await settle(page);
    check('X3 Tia marked $25, and it is waiting, not counted yet', /You marked \$25\.00\. Waiting for Rae Sample/.test((await text(page)).replace(/ USD/g, '')) && /\$20\.00 of \$120\.00 confirmed/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    await who(page, 'Rae Sample'); await goto(page, '/'); check('X3 Rae was told Tia marked a contribution', /Tia Sample marked a contribution/.test((await text(page)).replace(/ USD/g, '')), '');
    await goto(page, '/gifts'); await page.click('.gv-row:has-text("Gran")'); await page.waitForSelector('#gv-gcontribs'); await settle(page);
    check('X3 the organiser sees who gave what and $25 waiting', /Tia Sample · \$25\.00 · waiting · Venmo/.test((await text(page)).replace(/ USD/g, '')) && /\$25\.00 more is waiting/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    await page.click('[data-gconfirm]'); await settle(page);
    check('X3 confirming moves it into the total', /\$45\.00 of \$120\.00 confirmed/.test((await text(page)).replace(/ USD/g, '')) && (await page.locator('#gv-gpending').count()) === 0, (await text(page)).replace(/ USD/g, ''));
    await page.selectOption('#gv-grecwho', { label: 'Quinn Sample' }).catch(() => {});
    check('X3 the person it is for cannot be recorded and is not in the dropdown', !(await page.locator('#gv-grecwho option', { hasText: 'Una' }).count()), '');
    await page.selectOption('#gv-grecwho', { label: 'Ada Admin' }); await page.fill('#gv-grecamt', '75'); await page.click('#gv-grecbtn'); await settle(page);
    check('X3 recording cash makes it confirmed and reaches the goal', /\$120\.00 of \$120\.00 confirmed/.test((await text(page)).replace(/ USD/g, '')) && /Goal reached/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    await page.click('#gv-gclose'); await page.click('#gv-d-ok'); await settle(page);
    check('X3 closing shows Closed and offers Reopen', /Closed/.test((await text(page)).replace(/ USD/g, '')) && /Reopen/.test(await page.locator('#gv-gclose').innerText()), '');
    await goto(page, '/gifts/new'); await page.fill('#gv-gtitle', ''); await page.click('#gv-gsave'); await settle(page);
    check('X3 a name is required, with a message under the field', /Give the gift a name/.test(await page.locator('#gv-gtitle-err').innerText()), '');
    await page.fill('#gv-gtitle', 'Teacher thank-you'); await page.fill('#gv-ggoal', '60'); await page.click('#gv-gsave'); await page.waitForSelector('#gv-gsum'); await settle(page);
    check('X3 a new gift starts at $0 of $60', /\$0\.00 of \$60\.00 confirmed/.test((await text(page)).replace(/ USD/g, '')), (await text(page)).replace(/ USD/g, ''));
    await page.click('#gv-gdelete'); await page.click('#gv-d-ok'); await page.waitForSelector('#gv-gifts, #gv-nogift'); await settle(page);
    check('X3 deleting returns to the list without it', !/Teacher thank-you/.test((await text(page)).replace(/ USD/g, '')), '');
    for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
      const c2 = await open(browser, { w, h, hash: '#/giving/gifts' }); await settle(c2.page);
      check('X3 ' + label + ' group gifts list has no sideways scroll', !(await overflow(c2.page)), ''); await c2.ctx.close(); }
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
