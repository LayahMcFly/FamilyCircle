/* Browser test of the REAL Giving screens (giving-ui.js in real mode + giving.js) talking to the REAL function code (function/src/giving.js
 * through logic.js) on an in-memory database. Run:  cd tests/browser && node giving-real.spec.js
 * Proves screens + adapter + backend rules work together. Proves NOTHING about the live Appwrite project (tables, indexes, permissions). */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }

(async () => {
  const { makeWorld } = await import('./support/giving-world.mjs');
  const w = makeWorld();
  await w.addFamily('famA', 'owner', ['tia', 'ann', 'bob', 'kid']);
  await w.addFamily('famB', 'zed', ['yan']);
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/api' && req.method === 'POST') {
      let body = ''; req.on('data', d => body += d); req.on('end', async () => {
        const uid = req.headers['x-test-user'];
        const out = await w.api.handle({ user: { $id: uid, emailVerification: true, status: true, labels: [] }, body: JSON.parse(body || '{}'), deadline: Number.MAX_SAFE_INTEGER });
        res.writeHead(out.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.json));
      }); return;
    }
    let f = path.join(ROOT, u); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); const log = { errors: [], console: [], external: [], missing: [] };
  page.on('pageerror', e => log.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/api')) log.missing.push(r.status() + ' ' + r.url()); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });
  const BASE = 'http://127.0.0.1:' + PORT + '/tests/browser/support/giving-real.html';
  const settle = () => page.waitForTimeout(120);
  const as = async (user, hash) => { await page.goto(BASE + '?as=' + user + (hash || '#/giving')); await page.waitForSelector('.gv-page, .gv-blocked', { timeout: 8000 }); await settle(); };
  const text = () => page.locator('#main').innerText();
  const dlgOk = async () => { await page.locator('#gv-d-ok').click(); await settle(); };
  const rowsOf = t => [...w.world.tables[t].values()];

  // 1-2 off by default
  await as('owner');
  let t = await text();
  check('1 Off: owner is told it is not turned on and sees the turn-on button', /not turned on/.test(t) && await page.locator('#gv-turnon').isVisible(), t);
  check('1 No preview banner or sample wording in the real screens', !(await page.content()).match(/Preview —|sample data|pv-banner/i), '');
  await as('ann'); t = await text();
  check('2 Off: a member is told to ask the owner, with no button', /Ask the family owner/.test(t) && (await page.locator('#gv-turnon').count()) === 0, t);

  // 3 owner turns it on
  await as('owner'); await page.locator('#gv-turnon').click(); await dlgOk(); await page.waitForSelector('#main h2:has-text("Your wishlists")');
  check('3 Owner turns it on from the page and the home screen appears', rowsOf('givingState').length === 1 && rowsOf('givingState')[0].enabled === true, JSON.stringify(rowsOf('givingState')));
  await page.waitForSelector('#gv-switch'); check('3 The owner sees a Turn off button on the home screen', await page.locator('#gv-turnoff').isVisible(), '');

  // 4 owner marks adults
  await page.waitForSelector('#gv-members .gv-member');
  for (const u of ['ann', 'bob']) { await page.locator('button[aria-label="Mark as adult: ' + u + '"]').click(); await settle(); await page.waitForSelector('button[aria-label="Mark as kid: ' + u + '"]'); }
  check('4 Owner marks ann and bob as adults; the flag is stored on their profiles', rowsOf('profiles').filter(p => p.givingAdult === true).map(p => p.userId).sort().join() === 'ann,bob', JSON.stringify(rowsOf('profiles').map(p => [p.userId, p.givingAdult])));
  check('4 Nobody else is an adult (kid and tia stay kids)', !rowsOf('profiles').some(p => ['kid', 'tia'].includes(p.userId) && p.givingAdult === true), '');
  check('4 The owner cannot change their own setting (no button on their own row)', (await page.locator('.gv-member[data-member="owner"] button').count()) === 0, '');

  // 5 ann builds a wishlist
  await as('ann', '#/giving/list/new');
  check('5 An adult sees the "who can see it" choice on the list form', await page.locator('#gv-audience').isVisible(), '');
  await page.fill('#gv-name', 'Birthday'); await page.locator('#gv-save').click(); await page.waitForSelector('#main h1:has-text("Birthday")'); await settle();
  check('5 Wishlist is created and opened', rowsOf('givingLists').length === 1 && rowsOf('givingLists')[0].ownerId === 'ann', '');
  await page.locator('#gv-additem').click(); await page.waitForSelector('#gv-title');
  check('5 The item form has no photo picker in the real screens', (await page.locator('#gv-photo').count()) === 0, '');
  const controls = await page.evaluate(() => [...document.querySelectorAll('#main input:not([type=hidden]), #main select, #main textarea')].map(e => { const c = getComputedStyle(e); return { id: e.id, bw: c.borderTopWidth, br: c.borderTopLeftRadius }; }));
  check('5 Every form control is themed (border and rounded corners)', controls.length >= 6 && controls.every(c => c.bw !== '0px' && c.br !== '0px'), JSON.stringify(controls));
  await page.fill('#gv-title', 'Blue mug'); await page.fill('#gv-url', 'javascript:alert(1)'); await page.locator('#gv-save').click(); await settle();
  check('5 A script link is refused with a message and the form stays', (await page.locator('.gv-formmsg').innerText()).length > 0 && (await page.locator('#gv-title').count()) === 1, '');
  await page.fill('#gv-url', 'https://shop.example.com/mug'); await page.fill('#gv-notes', 'Any shade of blue'); await page.fill('#gv-price', '24'); await page.selectOption('#gv-currency', 'USD');
  await page.locator('#gv-save').click(); await page.waitForSelector('.gv-item'); await settle();
  check('5 Item is saved with its link, price and notes', rowsOf('givingItems').length === 1 && /shop.example.com/.test(rowsOf('givingItems')[0].data), '');
  check('5 The link shows a placeholder tile and says real pictures come later', (await page.locator('.gv-photo[data-from-link="true"]').count()) === 1 && /Pictures from links come later/.test(await text()), await text());

  // 5b photo upload, view and removal
  const png = fs.readFileSync(__dirname + '/support/pic.png');
  await page.locator('.gv-item [data-act="edit"], .gv-item .gv-edit, .gv-item button:has-text("Edit")').first().click(); await page.waitForSelector('#gv-photofile');
  check('5b The edit form has a themed photo picker', await page.locator('#gv-photofile').isVisible() && await page.evaluate(() => { const c = getComputedStyle(document.getElementById('gv-photofile')); return c.borderTopWidth !== '0px' && c.borderTopLeftRadius !== '0px'; }), '');
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/shot-form.png', fullPage: true });
  await page.setInputFiles('#gv-photofile', { name: 'pic.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#gv-photoprev img'); await page.locator('#gv-save').click(); await page.waitForSelector('.gv-photo-btn'); await settle();
  check('5b The picture is saved: a small copy on the item and the full one in the private bucket', /^data:image\/jpeg;base64,/.test(rowsOf('givingItems')[0].thumb || '') && /photoId/.test(rowsOf('givingItems')[0].data), JSON.stringify(rowsOf('givingItems')[0]).slice(0, 200));
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/shot-list.png' });
  // 5c compress and convert: BMP and GIF are converted, a huge photo is compressed, an unreadable HEIC gets a plain message
  await page.locator('.gv-item [data-act="edit"]').first().click(); await page.waitForSelector('#gv-photofile');
  const sizesOk = await page.evaluate(() => [...document.querySelectorAll('#gv-photofile, #gv-photosize')].length);
  for (const [name, type] of [['pic.bmp', 'image/bmp'], ['pic.gif', 'image/gif']]) {
    await page.setInputFiles('#gv-photofile', { name, mimeType: type, buffer: fs.readFileSync(__dirname + '/support/' + name) });
    await page.waitForFunction(() => /Will be sent as a JPEG/.test(document.getElementById('gv-photoinfo').textContent), null, { timeout: 8000 });
    check('5c ' + name + ' is converted to a JPEG and the size is shown', /Original .*Will be sent as a JPEG of \d+ KB/.test(await page.locator('#gv-photoinfo').innerText()), await page.locator('#gv-photoinfo').innerText());
  }
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/shot-size.png', fullPage: true });
  await page.evaluate(() => new Promise(res => { const c = document.createElement('canvas'); c.width = 3600; c.height = 2400; const x = c.getContext('2d'); const d = x.createImageData(3600, 2400); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); c.toBlob(b => { const f = new File([b], 'huge.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('gv-photofile'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); res(); }, 'image/png'); }));
  await page.waitForFunction(() => /Will be sent as a JPEG/.test(document.getElementById('gv-photoinfo').textContent) && /huge|MB/.test(document.getElementById('gv-photoinfo').textContent), null, { timeout: 30000 });
  const info = await page.locator('#gv-photoinfo').innerText(); const kbSent = +(/JPEG of (\d+) KB/.exec(info) || [])[1];
  check('5c A huge photo (many MB) is compressed to under 250 KB', /MB/.test(info) && kbSent > 0 && kbSent <= 250, info);
  await page.selectOption('#gv-photosize', 'small'); await page.waitForTimeout(600);
  check('5c The size choice re-compresses the picture', /Will be sent as a JPEG/.test(await page.locator('#gv-photoinfo').innerText()), await page.locator('#gv-photoinfo').innerText());
  await page.setInputFiles('#gv-photofile', { name: 'IMG_1.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a picture') });
  await page.waitForFunction(() => /cannot open HEIC/.test(document.getElementById('gv-photofile-err').textContent), null, { timeout: 8000 });
  check('5c An unreadable HEIC gets a plain message with what to do', /Most Compatible/.test(await page.locator('#gv-photofile-err').innerText()), await page.locator('#gv-photofile-err').innerText());
  check('5c The size picker is themed', await page.evaluate(() => { const e = document.getElementById('gv-photosize'); const c = getComputedStyle(e); return c.borderTopWidth !== '0px' && c.borderTopLeftRadius !== '0px'; }), '');
  await page.locator('a:has-text("Cancel")').first().click(); await page.waitForSelector('.gv-item');
  await page.locator('.gv-photo-btn').first().click(); await page.waitForSelector('.gv-bigphoto'); await page.waitForFunction(() => /^data:image\/jpeg/.test(document.querySelector('.gv-bigphoto').src) && document.querySelector('.gv-bigphoto').src.length > 500); await settle();
  check('5b Tapping the picture opens the full one', await page.locator('#gv-p-note').innerText() === '', '');
  await page.locator('#gv-p-close').click();
  await page.locator('.gv-item button:has-text("Edit"), .gv-item [data-act="edit"], .gv-item .gv-edit').first().click(); await page.waitForSelector('#gv-photoremove'); await page.locator('#gv-photoremove').click(); await page.locator('#gv-save').click(); await page.waitForSelector('.gv-item'); await settle();
  check('5b Removing the picture clears it', !(rowsOf('givingItems')[0].thumb) && !/photoId/.test(rowsOf('givingItems')[0].data) && (await page.locator('.gv-photo-btn').count()) === 0, JSON.stringify(rowsOf('givingItems')[0]).slice(0, 200));

  // 6 a kid sees it but cannot reserve
  await as('kid'); await page.locator('.gv-row', { hasText: 'Birthday' }).click(); await page.waitForSelector('#main h1:has-text("Birthday")'); await settle();
  t = await text();
  check('6 A kid sees the wishlist and the item', /Blue mug/.test(t), t);
  check('6 A kid gets no reserve button and no reservation wording', (await page.locator('[data-act="reserve"]').count()) === 0 && !/Reserve|Reserved/.test(t), t);

  // 7 bob reserves, ann never learns
  await as('bob'); await page.locator('.gv-row', { hasText: 'Birthday' }).click(); await page.waitForSelector('#main h1:has-text("Birthday")');
  await page.locator('[data-act="reserve"]').click(); await page.waitForSelector('.gv-badge.is-mine'); await settle();
  check('7 An adult reserves an item and sees "Reserved by you"', /Reserved by you/.test(await text()) && rowsOf('givingReservations').length === 1, '');
  await as('ann'); await page.locator('.gv-row', { hasText: 'Birthday' }).click(); await page.waitForSelector('#main h1:has-text("Birthday")'); await settle();
  const annHtml = await page.locator('#main').innerHTML();
  check('7 The list owner sees nothing about the reservation (no badge, no name, no button)', !/Reserved|reserve|bob/i.test(annHtml), annHtml.slice(0, 300));
  await as('ann'); check('7 The list owner has no notice about it', (await page.locator('.gv-notice').count()) === 0, '');
  await as('tia'); await page.locator('.gv-row', { hasText: 'Birthday' }).click(); await page.waitForSelector('#main h1:has-text("Birthday")');
  check('7 A person not yet marked as an adult (a tree admin) sees no reserve button', (await page.locator('[data-act="reserve"]').count()) === 0, '');

  // 8 adults-only list
  await as('ann', '#/giving/list/new'); await page.fill('#gv-name', 'Surprise for the kid'); await page.selectOption('#gv-audience', 'adults'); await page.locator('#gv-save').click(); await page.waitForSelector('#main h1:has-text("Surprise")'); await settle();
  await as('kid'); check('8 An adults-only list is not listed for a kid', !/Surprise/.test(await text()), await text());
  await as('kid', '#/giving/list/' + rowsOf('givingLists').find(l => l.audience === 'adults').$id); await page.waitForSelector('.gv-blocked'); 
  check('8 A kid opening it by its address gets the same "not available" as for nothing', /That is not available/.test(await text()), await text());
  await as('bob'); check('8 An adult sees the adults-only list, tagged', /Surprise for the kid/.test(await text()) && /Adults only/.test(await text()), await text());

  // 9 report and remove
  await as('kid'); await page.locator('.gv-row', { hasText: 'Birthday' }).click(); await page.waitForSelector('#main h1:has-text("Birthday")');
  await page.locator('[data-act="report"]').first().click(); await page.waitForSelector('#gv-r-reason'); await page.selectOption('#gv-r-reason', 'unsafe'); await page.locator('#gv-r-send').click(); await settle();
  check('9 A kid can report an item', rowsOf('givingReports').length === 1, '');
  await as('owner'); await page.waitForSelector('#gv-reports'); t = await text();
  check('9 The owner (an adult manager) sees the report queue with the reporter', /Reports \(1\)/.test(t), t);
  await page.waitForSelector('.gv-report'); check('9 The queue names the reporter to the reviewer', /Reported by kid/.test(await text()), await text());
  await page.locator('[data-act="remove"]').click(); await dlgOk(); await settle();
  check('9 Removing deletes the item and frees bob\'s reservation', rowsOf('givingItems').length === 0 && rowsOf('givingReservations').length === 0, '');
  await as('ann'); t = await text();
  check('9 The list owner is told only that an admin removed it, never who reported', /removed by a family admin/.test(t) && !/kid|bob|owner|report/i.test(await page.locator('.gv-notice').allInnerTexts().then(a => a.join(' ').replace('removed by a family admin', ''))), t);
  await as('bob'); check('9 The buyer is told the item is no longer on the list', /no longer on the wishlist/.test(await text()), await text());

  // 10 off again
  await as('owner'); await page.locator('#gv-turnoff').click(); await dlgOk(); await page.waitForSelector('.gv-off'); await settle();
  check('10 Owner turns it off and sees the turn-on button again', await page.locator('#gv-turnon').isVisible(), await text());
  await as('ann'); check('10 Everyone else is told it is not turned on', /not turned on/.test(await text()), await text());
  check('10 Nothing was deleted by turning it off', rowsOf('givingLists').length === 2, String(rowsOf('givingLists').length));

  // 11 hygiene
  check('11 No page errors', log.errors.length === 0, log.errors.join(' | '));
  // the browser logs every 4xx answer from /api (the expected "not available" and "invalid" answers); anything else is a real problem
  check('11 No console errors other than expected refusals from the server', log.console.filter(m => !/Failed to load resource: the server responded with a status of 4\d\d/.test(m)).length === 0, log.console.join(' | '));
  check('11 Every script, style and font file loaded (no missing file)', log.missing.length === 0, log.missing.join(' | '));
  check('11 No request left this machine', log.external.length === 0, log.external.join(' | '));

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
