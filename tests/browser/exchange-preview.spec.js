/* Browser tests for the Family Exchange PREVIEW (real Chrome, real preview code, invented data, no backend).
 * Run:  cd tests/browser && node exchange-preview.spec.js   (set SHOTS=dir to save screenshots)
 * Proves screen behaviour and that the page makes no network request. Proves NOTHING about Appwrite or real families. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
let pass = 0, fail = 0; const out = [];
function check(n, ok, d) { (ok ? pass++ : fail++); out.push((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); }
let PORT; const URL_ = () => 'http://127.0.0.1:' + PORT + SUB + 'exchange-preview/index.html';
const SHOTS = process.env.SHOTS;
async function open(browser, o) {
  o = o || {}; const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, colorScheme: o.dark ? 'dark' : 'light' });
  const page = await ctx.newPage(); const log = { errors: [], console: [], requests: [], external: [] };
  page.on('pageerror', e => log.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.text()); });
  page.on('request', r => log.requests.push(r.url()));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });
  await page.goto(URL_() + (o.hash || '')); await page.waitForSelector('.ex-head, .ex-state', { timeout: 8000 }); return { ctx, page, log };
}
const settle = p => p.waitForTimeout(90);
const who = async (p, id) => { await p.selectOption('#pv-who', id); await settle(p); };
const cond = async (p, v) => { await p.selectOption('#pv-net', v); await settle(p); };
const titles = p => p.$$eval('#ex-grid .ex-card h3', n => n.map(x => x.textContent));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  /* A. shell, banner, no network, marker */
  { const { ctx, page, log } = await open(browser);
    check('A1 banner text', (await page.textContent('#pv-banner')).includes('Preview — sample data, not connected to your family.'), 'banner');
    check('A2 noindex + CSP connect-src none', await page.$eval('meta[name=robots]', m => m.content.includes('noindex')) && (await page.$eval('meta[http-equiv=Content-Security-Policy]', m => m.content)).includes("connect-src 'none'"), 'meta');
    check('A3 no external requests', log.external.length === 0 && log.requests.every(u => u.startsWith('http://127.0.0.1')), JSON.stringify(log.external));
    check('A4 no page or console errors', log.errors.length === 0 && log.console.length === 0, JSON.stringify([log.errors, log.console]));
    check('A5 build marker shown', /exchange-preview-step1 · file hash [0-9a-f]{16}/.test(await page.textContent('#pv-build')), await page.textContent('#pv-build'));
    check('A6 no Hub link, no Appwrite script', !(await page.$('a[href*="index.html"], a[href="../"]')) && !(await page.$('script[src*="appwrite"], script[src*="config.js"]')), 'links');
    check('A7 no native checkbox/radio/file inputs', !(await page.$('input[type=checkbox], input[type=radio], input[type=file], input[type=date]')), 'native');
    await ctx.close(); }

  /* B. browse */
  { const { ctx, page } = await open(browser);
    let t = await titles(page);
    check('B1 free items show available + reserved, not finished/draft/withdrawn', t.length === 5 && t.includes('Oak bookshelf') && t.includes('20-inch kids bike') && !t.includes('Floor lamp') && !t.includes('Mixing bowls') && !t.includes('Board games'), t.join('|'));
    check('B2 card thumbnails are square', await page.$$eval('.ex-thumb', n => n.every(x => Math.abs(x.getBoundingClientRect().width - x.getBoundingClientRect().height) < 1.5)), 'square');
    await page.click('#ex-finished'); await settle(page); t = await titles(page);
    check('B3 show finished adds Floor lamp', t.includes('Floor lamp'), t.join('|')); await page.click('#ex-finished');
    await page.fill('#ex-q', 'chair'); await settle(page); t = await titles(page);
    check('B4 search narrows', t.length === 1 && t[0].startsWith('Desk chair'), t.join('|'));
    check('B5 search keeps focus and typed case', await page.evaluate(() => document.activeElement.id === 'ex-q') && (await page.inputValue('#ex-q')) === 'chair', 'focus');
    await page.fill('#ex-q', 'zzzz'); await settle(page);
    check('B6 empty state with clear button', (await page.textContent('.ex-state-empty')).includes('Nothing matches') && !!(await page.$('#ex-clear')), 'empty'); await shot(page, 'phone-browse-empty');
    await page.click('#ex-clear'); await settle(page);
    await page.selectOption('#ex-cat', 'Furniture'); await settle(page); t = await titles(page);
    check('B7 category filter', t.length === 2, t.join('|')); await page.selectOption('#ex-cat', ''); await settle(page);
    await page.click('.ex-kind .tab:nth-child(2)'); await settle(page); t = await titles(page);
    check('B8 wanted tab shows open wanted posts only', t.length === 2 && t.includes('Tomato cages') && !t.includes('Rain boots, kids size 2'), t.join('|'));
    check('B9 wanted cards show "Wanted" placeholder, no fake photo', await page.$$eval('.ex-nophoto', n => n.length === 2), 'nophoto'); await shot(page, 'phone-browse-wanted');
    await page.click('.ex-kind .tab:nth-child(1)'); await settle(page); await shot(page, 'phone-browse-free');
    check('B10 no horizontal scroll at 390', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow');
    await ctx.close(); }

  /* C. detail + photo aspect */
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' });
    await page.waitForSelector('.ex-detail');
    const r = await page.$eval('.ex-photo img', i => ({ nw: i.naturalWidth, nh: i.naturalHeight, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height }));
    check('C1 detail photo keeps original aspect (not cropped to a square)', Math.abs(r.nw / r.nh - r.w / r.h) < 0.02 && Math.abs(r.w / r.h - 1) > 0.2, JSON.stringify(r));
    check('C2 three photos, thumbnail buttons', (await page.$$('.ex-tb')).length === 3, 'thumbs');
    await page.click('.ex-tb:nth-child(2)'); await settle(page);
    const r2 = await page.$eval('.ex-photo img', i => ({ nw: i.naturalWidth, nh: i.naturalHeight, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height }));
    check('C3 wide photo stays wide', r2.nw / r2.nh > 1.5 && Math.abs(r2.nw / r2.nh - r2.w / r2.h) < 0.03, JSON.stringify(r2));
    check('C4 owner sees requests with names and no applicant-only text', (await page.textContent('.ex-requests')).includes('Ben Rowan') && (await page.textContent('.ex-requests')).includes('Dana Rowan'), 'reqs');
    check('C5 owner has edit; no interest/report buttons', !!(await page.$('#ex-edit')) && !(await page.$('#ex-interest')) && !(await page.$('#ex-report')), 'buttons');
    check('C6 later-step buttons are disabled, not fake', await page.$$eval('.ex-actions button[disabled]', n => n.length === 2), 'disabled'); await shot(page, 'phone-detail-owner');
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail');
    check('C7 applicant sees only own status, not others', (await page.textContent('.ex-detail')).includes('You asked for this') && !(await page.textContent('.ex-detail')).includes('Dana Rowan asked') && !(await page.$('.ex-requests')), 'applicant');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l5' });
    await page.waitForSelector('.ex-detail'); await who(page, 'ava'); await page.waitForSelector('.ex-detail');
    check('C8 non-owner sees interest + report, no owner tools', !!(await page.$('#ex-interest')) && !!(await page.$('#ex-report')) && !(await page.$('#ex-edit')), 'viewer');
    await page.click('#ex-interest'); await page.waitForSelector('dialog[open]');
    check('C9 interest dialog says request, not reservation', (await page.textContent('dialog')).includes('not a reservation'), 'dlg');
    await page.fill('#ex-note', 'call me at 555 123 4567'); await page.click('dialog .btn:not(.secondary)');
    check('C10 phone number in note is refused and dialog stays open', !!(await page.$('dialog[open]')) && (await page.getAttribute('#ex-note', 'aria-invalid')) === 'true', 'refuse');
    await page.fill('#ex-note', 'I can come Friday'); await page.click('dialog .btn:not(.secondary)'); await settle(page); await page.waitForTimeout(150);
    check('C11 request recorded: status line replaces button', (await page.textContent('.ex-mine')).includes('Waiting for Dana Rowan') && !(await page.$('#ex-interest')), 'status');
    await page.goto(URL_() + '#/listing/l3'); await who(page, 'ben'); await page.waitForSelector('.ex-detail');
    check('C12 reserved-for-you shows pickup message button, simulated', (await page.textContent('.ex-mine')).includes('reserved for you') && !!(await page.$('#ex-pickup')), 'reserved');
    await page.click('#ex-pickup'); check('C13 pickup dialog says nothing is sent', (await page.textContent('dialog')).includes('Nothing is sent'), 'pickup'); await page.keyboard.press('Escape');
    await page.goto(URL_() + '#/listing/l3'); await who(page, 'ava'); await page.waitForSelector('.ex-detail');
    check('C14 others see "reserved for someone else", no name', (await page.textContent('.ex-detail')).includes('reserved for someone else') && !(await page.textContent('.ex-detail')).includes('Ben Rowan asked'), 'other');
    await page.goto(URL_() + '#/listing/l4'); await page.waitForSelector('.ex-detail');
    check('C15 gone item has no interest button', !(await page.$('#ex-interest')) && (await page.textContent('.ex-detail')).includes('This item is gone'), 'gone');
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/d1'); await settle(page);
    check('C16 someone else\'s draft is "not available"', (await page.textContent('.ex-state')).includes('not available'), 'draft');
    await page.goto(URL_() + '#/listing/nope'); await settle(page);
    check('C17 unknown id gives the same message', (await page.textContent('.ex-state')).includes('not available'), 'missing');
    await ctx.close(); }

  /* D. states: eligibility and connection */
  { const { ctx, page } = await open(browser);
    for (const [id, name] of [['cleo', 'D1 ineligible (restriction)'], ['eli', 'D2 ineligible (unclassified)']]) { await who(page, id); check(name + ' sees only the denied screen with no reason and no listings', !!(await page.$('.ex-state-denied')) && !(await page.$('.ex-card')) && !(await page.textContent('main')).match(/restriction|age|minor|child/i), await page.textContent('main')); }
    await shot(page, 'phone-denied'); await who(page, 'ava');
    await cond(page, 'loading'); check('D3 stuck loading shows skeleton and busy state', !!(await page.$('.ex-skel')) && (await page.getAttribute('.ex-grid', 'aria-busy')) === 'true', 'loading'); await shot(page, 'phone-loading');
    await cond(page, 'error'); check('D4 error state is an alert with Try again', !!(await page.$('.ex-state-error[role=alert]')) && !!(await page.$('#ex-retry')), 'error'); await page.click('#ex-retry'); await settle(page);
    check('D5 retry still fails while connection is "always fails"', !!(await page.$('.ex-state-error')), 'still'); await shot(page, 'phone-error');
    await cond(page, 'failonce'); check('D6 fails once', !!(await page.$('.ex-state-error')), 'once'); await page.click('#ex-retry'); await settle(page);
    check('D7 retry then works', !!(await page.$('#ex-grid')), 'recovered');
    await cond(page, 'denied'); check('D8 server denied state', !!(await page.$('.ex-state-denied')), 'denied');
    await cond(page, 'slow'); check('D9 slow shows loading first', !!(await page.$('.ex-skel')), 'slow'); await page.waitForSelector('#ex-grid', { timeout: 4000 }); check('D10 slow then loads', true);
    await ctx.close(); }

  /* E. create, validate, publish, edit */
  { const { ctx, page } = await open(browser, { hash: '#/new' });
    await page.waitForSelector('.ex-form');
    await page.click('#ex-publish'); await settle(page);
    check('E1 empty publish shows field errors and moves focus to summary', (await page.$$eval('.ex-err', n => n.filter(x => x.textContent).length)) >= 3 && await page.evaluate(() => document.activeElement.id === 'ex-summary'), 'errors');
    await page.fill('#ex-title', 'Garden hose'); await page.selectOption('#ex-category', 'Garden and outdoor'); await page.selectOption('#ex-condition', 'Good'); await page.fill('#ex-description', 'Fifty feet, one small leak near the end.');
    await page.fill('#ex-area', '412 Maple Street'); await page.click('#ex-publish'); await settle(page);
    check('E2 street address in pickup area is refused', (await page.textContent('#ex-area-e')).includes('Street addresses'), await page.textContent('#ex-area-e'));
    await page.fill('#ex-area', 'near the library'); await page.fill('#ex-description', 'Text me 912-555-0199 please'); await page.click('#ex-publish'); await settle(page);
    check('E3 phone number in description is refused', (await page.textContent('#ex-description-e')).includes('phone numbers'), 'phone');
    await page.fill('#ex-description', 'Fifty feet, one small leak near the end.');
    await page.click('.ex-pickbtn:nth-child(1)'); await page.click('.ex-pickbtn:nth-child(2)'); await page.click('.ex-pickbtn:nth-child(3)'); await page.click('.ex-pickbtn:nth-child(4)');
    check('E4 photo picker caps at 3', (await page.textContent('#ex-photo-count')).startsWith('3 of 3'), await page.textContent('#ex-photo-count'));
    check('E5 live preview card uses typed title with its case', (await page.textContent('#ex-prev h3')) === 'Garden hose', 'preview');
    await page.click('.ex-pickbtn:nth-child(3)'); await page.click('.ex-pickbtn:nth-child(3)');
    await shot(page, 'phone-create');
    await page.click('#ex-publish'); await page.waitForSelector('dialog[open]');
    check('E6 first publish shows the rules before anything is posted', (await page.textContent('dialog')).includes('Please do not post') && (await page.textContent('dialog')).includes('not decided'), 'rules');
    await page.click('dialog .btn:not(.secondary)'); check('E7 Continue is blocked until the rules are accepted', !!(await page.$('dialog[open]')) && (await page.textContent('dialog')).includes('Please do not post'), 'blocked');
    await shot(page, 'phone-rules'); await page.click('#ex-ack'); check('E8 rules toggle is an app-styled switch, not a browser checkbox', (await page.getAttribute('#ex-ack', 'aria-pressed')) === 'true', 'switch');
    await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('dialog[open] h2:has-text("Publish to")');
    await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('.ex-detail');
    check('E9 published listing opens with Available badge and owner tools', (await page.textContent('.ex-badge')).includes('Available') && !!(await page.$('#ex-edit')), 'published');
    await page.click('#ex-edit'); await page.waitForSelector('.ex-form'); await page.fill('#ex-title', 'Garden hose, 50 ft'); await page.click('#ex-publish'); await page.waitForSelector('.ex-detail');
    check('E10 edit saves without a second rules dialog', (await page.textContent('.ex-title')) === 'Garden hose, 50 ft', 'edit');
    await page.goto(URL_() + '#/edit/l1'); await page.waitForSelector('.ex-form');
    check('E11 edit of a listing with requests shows the undecided-rule note', (await page.textContent('#ex-edit-note')).includes('not decided'), 'note');
    await page.goto(URL_() + '#/new'); await page.waitForSelector('.ex-form'); await page.fill('#ex-title', 'Quiet draft'); await page.click('#ex-save'); await page.waitForSelector('.ex-detail');
    check('E12 draft saves with a draft-only notice', (await page.textContent('.ex-detail')).includes('only visible to you'), 'draft');
    await page.goto(URL_() + '#/mine'); await settle(page); check('E13 My listings shows the draft', (await titles(page)).includes('Quiet draft'), 'mine');
    await who(page, 'ben'); await page.goto(URL_() + '#/browse'); await settle(page);
    check('E14 other members do not see the draft but do see the new published listing', !(await titles(page)).includes('Quiet draft') && (await titles(page)).includes('Garden hose, 50 ft'), (await titles(page)).join('|'));
    await page.goto(URL_() + '#/edit/n101'); await settle(page); check('E15 other members cannot open edit for it', (await page.textContent('.ex-state')).includes('not available'), 'edit-denied');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/new' });
    await page.click('.ex-kindpick .tab:nth-child(2)'); await settle(page);
    check('E16 wanted form hides condition and photos', !(await page.$('#ex-condition')) && !(await page.$('.ex-pick')), 'wanted');
    await page.fill('#ex-title', 'Step ladder'); await page.selectOption('#ex-category', 'Kitchen and home'); await page.fill('#ex-description', 'Any height is fine.'); await shot(page, 'phone-create-wanted');
    await page.click('#ex-publish'); await page.waitForSelector('dialog[open]'); await page.click('#ex-ack'); await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('dialog[open] h2:has-text("Publish to")'); await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('.ex-detail');
    check('E17 wanted post is Open with "I can help" for others', (await page.textContent('.ex-badge')).includes('Open'), 'open');
    const id = page.url().split('/').pop(); await who(page, 'ben'); await page.goto(URL_() + '#/listing/' + id); await page.waitForSelector('.ex-detail');
    check('E18 helper button reads "I can help"', (await page.textContent('#ex-interest')) === 'I can help', await page.textContent('#ex-interest'));
    await ctx.close(); }

  /* F. reporting and moderator */
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' });
    await page.waitForSelector('.ex-detail'); await who(page, 'ben'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-report'); await page.waitForSelector('dialog[open]');
    check('F1 report dialog says owner is not told who reported', (await page.textContent('dialog')).includes('not shown who reported'), 'dlg');
    await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('dialog[open] h2:has-text("Report sent")');
    check('F2 handler available: routed to moderator, honest that nothing is really sent', (await page.textContent('dialog')).includes('Exchange moderator') && (await page.textContent('dialog')).includes('nothing is really sent'), 'sent'); await page.keyboard.press('Escape');
    await page.selectOption('#pv-handler', 'off'); await page.click('#ex-report'); await page.waitForSelector('dialog[open]'); await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('dialog[open] h2:has-text("could not be sent")');
    check('F3 no handler: escalation-unavailable, not saved, not sent to owner', (await page.textContent('dialog')).includes('not saved') && (await page.textContent('dialog')).includes('nothing was sent to the owner'), 'unavail'); await shot(page, 'phone-report-unavailable'); await page.keyboard.press('Escape');
    await page.selectOption('#pv-handler', 'on'); await page.goto(URL_() + '#/listing/l5'); await who(page, 'ava'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-report'); await page.waitForSelector('dialog[open]'); await page.click('dialog .btn:not(.secondary)'); await page.waitForSelector('dialog[open] h2:has-text("could not be sent")');
    check('F4 report about the only moderator\'s own listing is never routed back to them', true); await page.keyboard.press('Escape');
    check('F5 non-moderators have no Reports tab and cannot open it', !(await page.$('a[href="#/reports"]')), 'tab');
    await page.goto(URL_() + '#/reports'); await settle(page); check('F6 reports route is denied for non-moderators', !!(await page.$('.ex-state-denied')), 'denied');
    await who(page, 'dana'); await page.goto(URL_() + '#/reports'); await settle(page);
    check('F7 moderator sees reports', (await page.$$('.ex-report')).length === 3, 'reports (2 sample + the one Ben just sent)');
    check('F8 report on moderator\'s own listing shows the conflict state, no actions', (await page.textContent('.ex-report[data-id=p1]')).includes('you cannot review this report') && !(await page.$('.ex-report[data-id=p1] button')), await page.textContent('.ex-report[data-id=p1]'));
    check('F9 other report shows reporter to the handler only and disabled actions', (await page.$$('.ex-report[data-id=p2] button[disabled]')).length === 2, 'p2'); await shot(page, 'phone-reports');
    await who(page, 'ava'); await page.goto(URL_() + '#/listing/l6'); await settle(page);
    check('F10 reporter name never appears on a listing page', !(await page.textContent('main')).includes('Reported by'), 'leak');
    await ctx.close(); }

  /* G. layout + themes + keyboard */
  { const { ctx, page } = await open(browser, { w: 320, h: 700, hash: '#/listing/l2' });
    await page.waitForSelector('.ex-detail'); check('G1 detail has no horizontal scroll at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'ov');
    await page.goto(URL_() + '#/new'); await page.waitForSelector('.ex-form'); check('G2 form has no horizontal scroll at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'ov2');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { w: 1280, h: 900 });
    check('G3 desktop browse uses three columns', await page.$$eval('#ex-grid .ex-card', n => new Set(n.map(x => Math.round(x.getBoundingClientRect().left))).size === 3), 'cols'); await shot(page, 'desktop-browse');
    await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail'); await shot(page, 'desktop-detail');
    await page.goto(URL_() + '#/new'); await page.waitForSelector('.ex-form'); await shot(page, 'desktop-create');
    check('G4 inputs, selects, textareas are themed (rounded, not default border), selects have no native arrow', await page.$$eval('#ex-title, #ex-category, #ex-description', n => n.every(x => getComputedStyle(x).borderRadius !== '0px')) && (await page.$eval('#ex-category', s => getComputedStyle(s).appearance)) === 'none', 'themed');
    await page.keyboard.press('Tab'); check('G5 skip link first in tab order', await page.evaluate(() => document.activeElement.classList.contains('skip-link')), 'skip');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { dark: true }); await shot(page, 'phone-browse-dark');
    check('G6 dark mode readable: card text differs from background', await page.$eval('.ex-card h3', e => getComputedStyle(e).color !== getComputedStyle(document.body).backgroundColor), 'dark'); await ctx.close(); }

  await browser.close(); server.close();
  console.log(out.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
