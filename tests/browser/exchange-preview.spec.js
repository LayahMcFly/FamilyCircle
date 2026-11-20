/* Browser tests for the Family Exchange PREVIEW (real Chrome, real preview code, invented data, no backend).
 * Run:  cd tests/browser && node exchange-preview.spec.js   (set SHOTS=dir to save screenshots)
 * Proves screen behaviour and that the page makes no network request. Proves NOTHING about Appwrite or real families. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.SITE_ROOT || path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
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
    check('A5 build marker shown', /exchange-preview-step4 · file hash [0-9a-f]{16}/.test(await page.textContent('#pv-build')), await page.textContent('#pv-build'));
    check('A5b visible Step 4 marker under the banner matches the footer hash', /^Step 4 preview · build [0-9a-f]{8}$/.test((await page.textContent('#pv-step')).trim()) && (await page.textContent('#pv-build')).includes((await page.textContent('#pv-step')).trim().slice(-8)), await page.textContent('#pv-step'));
    check('A6 no Hub link, no Appwrite script', !(await page.$('a[href*="index.html"], a[href="../"]')) && !(await page.$('script[src*="appwrite"], script[src*="config.js"]')), 'links');
    check('A7 no native checkbox/radio/file inputs', !(await page.$('input[type=checkbox], input[type=radio], input[type=file], input[type=date]')), 'native');
    await ctx.close(); }

  /* B. browse */
  { const { ctx, page } = await open(browser);
    let t = await titles(page);
    check('B1 free items show available + reserved, not finished/draft/withdrawn', t.length === 6 && t.includes('Oak bookshelf') && t.includes('20-inch kids bike') && !t.includes('Floor lamp') && !t.includes('Mixing bowls') && !t.includes('Board games'), t.join('|'));
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
    check('C6 owner lifecycle buttons are live (Mark as gone, Withdraw); request buttons are live too (Reserve and Decline), none disabled', !!(await page.$('#ex-gone:not([disabled])')) && !!(await page.$('#ex-withdraw:not([disabled])')) && (await page.$$('.ex-req button[disabled]')).length === 0 && (await page.$$('.ex-req [data-act]')).length === 4, 'buttons'); await shot(page, 'phone-detail-owner');
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
    check('F7 moderator sees reports', (await page.$$('.ex-report')).length === 4, 'reports (3 sample + the one Ben just sent)');
    check('F8 report on moderator\'s own listing shows the conflict state, no actions', (await page.textContent('.ex-report[data-id=p1]')).includes('you cannot review this report') && !(await page.$('.ex-report[data-id=p1] button')), await page.textContent('.ex-report[data-id=p1]'));
    check('F9 other report shows reporter to the handler only, with live Keep and Hide actions', (await page.textContent('.ex-report[data-id=p2]')).includes('Reported by Dana Rowan (only the handler sees this)') && (await page.$$('.ex-report[data-id=p2] button[disabled]')).length === 0 && (await page.$$('.ex-report[data-id=p2] [data-act]')).length === 2, 'p2'); await shot(page, 'phone-reports');
    await who(page, 'ava'); await page.goto(URL_() + '#/listing/l6'); await settle(page);
    check('F10 reporter name never appears on a listing page', !(await page.textContent('main')).includes('Reported by'), 'leak');
    await ctx.close(); }


  /* H. Step 2: listing lifecycle (sample data, per-context in-memory) */
  const dlgBtn = p => p.click('dialog .btn:not(.secondary)');
  const status = async (p) => (await p.textContent('.ex-detail .ex-badge')).trim();
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail');
    check('H1 owner of a live free item sees Edit, Mark as gone, Withdraw and no restart button', !!(await page.$('#ex-edit')) && !!(await page.$('#ex-gone')) && !!(await page.$('#ex-withdraw')) && !(await page.$('#ex-again')), 'buttons'); await shot(page, 'phone-step2-owner-actions');
    await page.click('#ex-gone'); await page.waitForSelector('dialog[open]'); await shot(page, 'phone-step2-confirm-gone');
    check('H2b dialog title is readable (ink on paper, not cream on cream)', await page.$eval('dialog h2', e => { const c = s => s.match(/[\d.]+/g).slice(0, 3).map(Number), t = c(getComputedStyle(e).color), b = c(getComputedStyle(e.closest('dialog')).backgroundColor); const L = x => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(x[0]) + .7152 * f(x[1]) + .0722 * f(x[2]); }; const r = (Math.max(L(t), L(b)) + .05) / (Math.min(L(t), L(b)) + .05); return r >= 4.5; }), 'contrast');
    check('H2 confirm dialog explains requests close and nothing is final until confirmed', (await page.textContent('dialog')).includes('their requests close'), 'text');
    await page.click('dialog .btn.secondary'); await settle(page); check('H3 cancel changes nothing', (await status(page)).includes('AVAILABLE') || (await status(page)).toLowerCase().includes('available'), await status(page));
    await page.click('#ex-gone'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    check('H4 mark gone: badge Gone, edit and lifecycle buttons gone, restart offered', (await status(page)).toLowerCase() === 'gone' && !(await page.$('#ex-edit')) && !(await page.$('#ex-gone')) && !!(await page.$('#ex-again')), await status(page));
    check('H5 requests on it are closed, confirm buttons removed', (await page.$$eval('.ex-req .badge', n => n.map(x => x.textContent))).every(t => t === 'Closed') && !(await page.$('.ex-req button')), 'closed'); await shot(page, 'phone-step2-gone');
    await who(page, 'ben'); await settle(page);
    check('H6 requester sees closed request with the reason, no buttons', (await page.textContent('.ex-mine')).includes('no longer available (gone). Your request is closed.') && !(await page.$('#ex-interest')), await page.textContent('.ex-mine'));
    await page.goto(URL_() + '#/browse'); await settle(page); check('H7 gone item leaves Browse until "Show finished"', !(await titles(page)).includes('Oak bookshelf'), 'browse'); await page.click('#ex-finished'); await settle(page); check('H8 and returns with Show finished', (await titles(page)).includes('Oak bookshelf'), 'finished');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l3' }); await who(page, 'dana'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-gone'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    check('H9 a reserved item can be marked gone', (await status(page)).toLowerCase() === 'gone', await status(page)); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l5' }); await who(page, 'dana'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-gone'); await page.waitForSelector('dialog[open]');
    await page.evaluate(() => { window.ExchangePreview.state().db.listings.filter(l => l.id === 'l5')[0].status = 'withdrawn'; });
    await dlgBtn(page); await settle(page);
    check('H10 stale screen: acting on old state is refused with a clear message and does not overwrite', (await page.textContent('#toasts')).includes('already changed') && !(await page.evaluate(() => window.ExchangePreview.state().db.listings.filter(l => l.id === 'l5')[0].status === 'gone')), await page.textContent('#toasts'));
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/w1' }); await who(page, 'ben'); await page.waitForSelector('.ex-detail');
    check('H12 wanted owner sees Mark as fulfilled, Close post, Withdraw (no "Mark as gone")', !!(await page.$('#ex-fulfilled')) && !!(await page.$('#ex-close')) && !!(await page.$('#ex-withdraw')) && !(await page.$('#ex-gone')), 'wanted');
    await page.click('#ex-close'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    check('H13 close post: badge Closed and offers closed', (await status(page)).toLowerCase() === 'closed' && (await page.$$eval('.ex-req .badge', n => n.every(x => x.textContent === 'Closed'))), await status(page));
    await who(page, 'ava'); await settle(page); check('H14 the helper sees their offer closed', (await page.textContent('.ex-mine')).includes('closed'), await page.textContent('.ex-mine'));
    await page.goto(URL_() + '#/browse'); await page.click('.ex-kind .tab:nth-child(2)'); await settle(page); check('H15 closed post leaves Wanted browse', !(await titles(page)).includes('Tomato cages'), 'wanted'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail');
    await page.click('#ex-withdraw'); await page.waitForSelector('dialog[open]'); check('H16 withdraw dialog says it leaves Browse and cannot be put back here', (await page.textContent('dialog')).includes('leaves Browse') && (await page.textContent('dialog')).includes('cannot be put back'), 'text'); await dlgBtn(page); await settle(page);
    check('H17 withdrawn badge shown to owner', (await status(page)).toLowerCase() === 'withdrawn', await status(page));
    await who(page, 'ben'); await settle(page); check('H18 someone who asked sees a minimal closed record with the reason', (await page.textContent('.ex-mine')).includes('withdrew') && !(await page.$('#ex-interest')), await page.textContent('.ex-mine'));
    await page.goto(URL_() + '#/browse'); await settle(page); check('H19 withdrawn is not in Browse for anyone', !(await titles(page)).includes('Oak bookshelf'), 'browse');
    await who(page, 'dana'); await who(page, 'ava'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l2' }); await who(page, 'ava'); await page.waitForSelector('.ex-detail'); await page.goto(URL_() + '#/listing/l1'); await settle(page);
    await who(page, 'cleo'); check('H20 ineligible account still gets only the denied screen', !!(await page.$('.ex-state-denied')) && !(await page.$('.ex-detail')), 'denied'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/d1' }); await page.waitForSelector('.ex-detail');
    check('H21 draft detail offers Edit draft and Publish', (await page.textContent('#ex-edit')) === 'Edit draft' && !!(await page.$('#ex-publish-draft')) && !(await page.$('#ex-gone')), 'draft');
    await page.click('#ex-publish-draft'); await page.waitForSelector('dialog[open]'); check('H22 rules appear before the first publish', (await page.textContent('dialog')).includes('Please do not post'), 'rules');
    await page.click('#ex-ack'); await dlgBtn(page); await page.waitForSelector('dialog[open] h2:has-text("Publish to")'); await dlgBtn(page); await settle(page);
    check('H23 draft published from the detail page', (await status(page)).toLowerCase() === 'available', await status(page));
    await who(page, 'ben'); await page.goto(URL_() + '#/browse'); await settle(page); check('H24 other members now see it', (await titles(page)).includes('Mixing bowls'), 'visible'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/mine' }); await page.waitForSelector('.ex-chips');
    const n = async f => { await page.click('.chip[data-f=' + f + ']'); await settle(page); return (await titles(page)); };
    let t = await n('draft'); check('H25 My listings: Drafts group', t.length === 1 && t[0] === 'Mixing bowls', t.join('|'));
    t = await n('live'); check('H26 Live group', t.length === 2 && t.includes('Oak bookshelf'), t.join('|'));
    t = await n('done'); check('H27 Finished group', t.length === 1 && t[0].startsWith('Rain boots'), t.join('|'));
    await who(page, 'cleo'); await who(page, 'ben'); await page.goto(URL_() + '#/mine'); await settle(page); await page.click('.chip[data-f=draft]'); await settle(page);
    check('H28 empty group shows a calm empty state', !!(await page.$('.ex-state-empty')), 'empty'); await shot(page, 'phone-step2-mine-empty-group');
    await who(page, 'ava'); await page.goto(URL_() + '#/mine'); await settle(page); await page.click('.chip[data-f=done]'); await settle(page); await shot(page, 'phone-step2-mine-finished');
    await page.click('#ex-grid .ex-card'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-again'); await page.waitForSelector('.ex-form');
    check('H29 "start a new listing" prefills a fresh draft with the note', (await page.inputValue('#ex-title')) === 'Rain boots, kids size 2' && !!(await page.$('#ex-tpl-note')) && !!(await page.$('#ex-publish')) && (await page.textContent('#ex-publish')) === 'Publish to the family', 'tpl');
    await who(page, 'ben'); await page.goto(URL_() + '#/new/l1'); await settle(page); check('H30 cannot start from someone else\'s listing', !(await page.$('#ex-tpl-note')) && (await page.inputValue('#ex-title')) === '', 'foreign'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { w: 320, h: 700, hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail'); check('H31 owner action row has no horizontal scroll at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow'); await ctx.close(); }

  /* I. Step 2 decisions: relisting, minimal withdrawn record, edits while reserved */
  { const { ctx, page } = await open(browser, { hash: '#/listing/l3' }); await who(page, 'dana'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-gone'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    await page.click('#ex-again'); await page.waitForSelector('.ex-form');
    check('I1 relist copies item details (title, photos) and says nothing carries over', (await page.inputValue('#ex-title')) === '20-inch kids bike' && (await page.$$('.ex-pickbtn[aria-pressed=true]')).length === 2 && (await page.textContent('#ex-tpl-note')).includes('requests and status do not carry over'), 'copy');
    await page.click('#ex-publish'); await page.waitForSelector('dialog[open]'); await page.click('#ex-ack'); await dlgBtn(page); await page.waitForSelector('dialog[open] h2:has-text("Publish to")'); await dlgBtn(page); await page.waitForSelector('.ex-detail');
    const st = await page.evaluate(() => { const db = window.ExchangePreview.state().db, id = location.hash.split('/').pop(), l = db.listings.filter(x => x.id === id)[0]; return { status: l.status, reservedFor: l.reservedFor || null, pending: !!l.pending, reqs: db.requests.filter(r => r.listing === id).length, same: l.id !== 'l3' }; });
    check('I2 the relisted item is a fresh Available listing: no requests, no recipient, no reservation', st.status === 'available' && !st.reservedFor && !st.pending && st.reqs === 0 && st.same, JSON.stringify(st));
    check('I3 owner sees "No one has asked yet" and no reserved/pickup controls on it', (await page.textContent('.ex-requests')).includes('No one has asked yet') && !(await page.$('#ex-release')) && !(await page.$('#ex-pickup')), 'fresh');
    await who(page, 'ben'); await settle(page); check('I4 Ben (who held the old reservation) sees no trace of it on the new listing', !(await page.$('.ex-mine')) && !!(await page.$('#ex-interest')), 'trace'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail');
    await page.click('#ex-withdraw'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    check('I5 owner still sees the full withdrawn listing', !!(await page.$('.ex-desc')) && !!(await page.$('.ex-gallery')), 'owner');
    await who(page, 'ben'); await settle(page); const txt = await page.textContent('.ex-detail'), html = await page.$eval('.ex-detail', e => e.innerHTML);
    check('I6 applicant sees only a minimal record: title, status, own request', txt.includes('Oak bookshelf') && txt.includes('Withdrawn') && txt.includes('Your request is closed'), txt);
    check('I7 no photos, description, pickup area, facts or other applicants for the applicant', !html.includes('<img') && !txt.includes('Allen key') && !txt.includes('Near the library') && !txt.includes('Dana Rowan') && !(await page.$('.ex-gallery, .ex-desc, .ex-facts, .ex-requests, #ex-report')), txt);
    check('I8 photo files are not even requested from the page for the applicant', !(await page.$$eval('img', n => n.some(i => /shelf/.test(i.src)))), 'img');
    await page.goto(URL_() + '#/browse'); await settle(page); check('I9 and it never appears in Browse', !(await titles(page)).includes('Oak bookshelf'), 'browse'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/edit/l3'); await page.waitForSelector('.ex-form');
    check('I10 editing a reserved item says edits stay private until release', (await page.textContent('#ex-reserved-note')).includes('stay private until you release'), 'note');
    check('I11 reserved edit form offers Save private edits and Publish changes', (await page.textContent('#ex-private')) === 'Save private edits' && (await page.textContent('#ex-publish')) === 'Publish changes', 'buttons'); await shot(page, 'phone-step2-reserved-edit');
    await page.fill('#ex-title', '20-inch kids bike, red'); await page.click('#ex-private'); await page.waitForSelector('.ex-detail');
    check('I12 private edits saved: owner sees a notice, the public title is unchanged', (await page.textContent('#ex-pending')).includes('Other members still see the item as agreed') && (await page.textContent('.ex-title')) === '20-inch kids bike', await page.textContent('.ex-title'));
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l3'); await settle(page); check('I13 the reserved person still sees the agreed item', (await page.textContent('.ex-title')) === '20-inch kids bike' && (await page.textContent('.ex-mine')).includes('reserved for you'), 'agreed');
    await page.goto(URL_() + '#/browse'); await settle(page); check('I14 Browse still shows the agreed title', (await titles(page)).includes('20-inch kids bike') && !(await titles(page)).includes('20-inch kids bike, red'), 'browse');
    await who(page, 'dana'); await page.goto(URL_() + '#/edit/l3'); await page.waitForSelector('.ex-form'); check('I15 reopening the editor continues the private edit', (await page.inputValue('#ex-title')) === '20-inch kids bike, red', 'continue');
    await page.click('#ex-publish'); await page.waitForSelector('dialog[open]');
    check('I16 Publish changes while reserved is blocked, names what changed, points to Release', (await page.textContent('dialog')).includes('Cannot publish while reserved') && (await page.textContent('dialog')).includes('title') && (await page.textContent('dialog')).includes('release the reservation first'), await page.textContent('dialog')); await shot(page, 'phone-step2-publish-blocked'); await dlgBtn(page); await page.waitForSelector('.ex-detail');
    check('I17 nothing public changed by the blocked attempt', (await page.evaluate(() => window.ExchangePreview.state().db.listings.filter(l => l.id === 'l3')[0].title)) === '20-inch kids bike', 'public');
    await page.click('#ex-release'); await page.waitForSelector('dialog[open]'); check('I18 release dialog says the person can ask again', (await page.textContent('dialog')).includes('can ask again'), 'dlg'); await dlgBtn(page); await settle(page);
    check('I19 after release: Available, private edit notice now offers publishing', (await status(page)).toLowerCase() === 'available' && (await page.textContent('#ex-pending')).includes('not published yet') && !(await page.$('#ex-release')), await status(page));
    await who(page, 'ben'); await settle(page); check('I20 the previously reserved person is told and can ask again', (await page.textContent('.ex-mine')).includes('released the reservation') && (await page.textContent('#ex-interest')) === 'Ask again', 'released');
    await page.click('#ex-interest'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page); await page.waitForTimeout(150);
    check('I21 asking again makes it a waiting request, not a reservation', (await page.textContent('.ex-mine')).includes('Waiting for Dana Rowan'), await page.textContent('.ex-mine'));
    await who(page, 'dana'); await page.goto(URL_() + '#/edit/l3'); await page.waitForSelector('.ex-form'); check('I22 once released, the editor shows the continue notice and plain Save changes', !!(await page.$('#ex-pending-note')) && (await page.textContent('#ex-publish')) === 'Save changes', 'continue');
    await page.click('#ex-publish'); await page.waitForSelector('.ex-detail'); check('I23 publishing after release applies the edit and clears the private copy', (await page.textContent('.ex-title')) === '20-inch kids bike, red' && !(await page.$('#ex-pending')), await page.textContent('.ex-title')); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/edit/l3'); await page.waitForSelector('.ex-form');
    const typed = '  Red bike,   tires need air.\n\nTraining wheels not included. ';
    await page.fill('#ex-description', typed); await page.click('#ex-publish'); await page.waitForSelector('dialog[open]');
    check('I24 a spacing-only edit is still blocked while reserved, and the dialog says the text is kept exactly', (await page.textContent('dialog')).includes('Cannot publish while reserved') && (await page.textContent('dialog')).includes('exactly as you typed'), await page.textContent('dialog'));
    const st24 = await page.evaluate(() => { const l = window.ExchangePreview.state().db.listings.filter(x => x.id === 'l3')[0]; return { pend: l.pending && l.pending.description, pub: l.description }; });
    check('I24b the private copy is stored exactly as typed (spacing and line breaks kept), the public text is untouched', st24.pend === typed && st24.pub === 'Red bike, tires need air. Training wheels not included.', JSON.stringify(st24));
    await dlgBtn(page); await page.waitForSelector('.ex-detail'); await page.goto(URL_() + '#/edit/l3'); await page.waitForSelector('.ex-form');
    await page.fill('#ex-title', ''); await page.click('#ex-private'); await settle(page); check('I25 private edits are still validated (empty title refused)', !!(await page.$('.ex-err:not(:empty)')), 'validate');
    await page.fill('#ex-title', '20-inch kids bike'); await page.fill('#ex-area', '9 Oak Street'); await page.click('#ex-private'); await settle(page); check('I26 a street address is refused even in private edits', (await page.textContent('#ex-area-e')).includes('Street addresses'), 'address');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/edit/l3'); await page.waitForSelector('.ex-form'); await page.fill('#ex-title', 'Changed elsewhere');
    await page.evaluate(() => { const l = window.ExchangePreview.state().db.listings.filter(x => x.id === 'l3')[0]; l.status = 'available'; });
    await page.click('#ex-private'); await settle(page); check('I27 stale: saving private edits after the status changed elsewhere is refused cleanly', (await page.textContent('#toasts')).includes('already changed') && !(await page.evaluate(() => !!window.ExchangePreview.state().db.listings.filter(x => x.id === 'l3')[0].pending)), await page.textContent('#toasts')); await ctx.close(); }

  /* J. Pre-reserved sample listing (l7) for the release and private-edit tests; release never publishes private edits */
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/listing/l7'); await page.waitForSelector('.ex-detail');
    check('J1 the pre-reserved sample is clearly labelled and reserved for Ben', (await page.textContent('.ex-title')).startsWith('SAMPLE FOR TESTING') && (await status(page)).toLowerCase() === 'reserved' && !!(await page.$('#ex-release')), await page.textContent('.ex-title'));
    await page.goto(URL_() + '#/edit/l7'); await page.waitForSelector('.ex-form'); const typed = 'Brass lantern.  Two   spaces stay.\n\nSecond paragraph stays. ';
    await page.fill('#ex-description', typed); await page.click('#ex-private'); await page.waitForSelector('.ex-detail');
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l7'); await settle(page);
    check('J2 the reserved person still sees the original description while private edits exist', (await page.textContent('.ex-desc')).includes('pre-reserved sample') && !(await page.textContent('.ex-detail')).includes('Brass lantern'), 'recipient');
    await who(page, 'dana'); await page.goto(URL_() + '#/listing/l7'); await page.waitForSelector('.ex-detail');
    await page.click('#ex-release'); await page.waitForSelector('dialog[open]'); const dt = await page.textContent('dialog');
    check('J3 release confirmation says the item becomes available again, requests stay waiting, private edits stay private', dt.includes('The item will become available again') && dt.includes('Other waiting requests stay waiting') && dt.includes('private edits stay private until you publish them yourself'), dt);
    await shot(page, 'phone-step2-release-confirm'); await dlgBtn(page); await settle(page);
    const st = await page.evaluate(() => { const db = window.ExchangePreview.state().db, l = db.listings.filter(x => x.id === 'l7')[0], rq = id => db.requests.filter(r => r.id === id)[0].status; return { status: l.status, reservedFor: l.reservedFor || null, desc: l.description, pend: !!l.pending, ben: rq('r5'), ava: rq('r6') }; });
    check('J4 release: Available, recipient cleared, former request Released, other waiting request stays Waiting', st.status === 'available' && !st.reservedFor && st.ben === 'released' && st.ava === 'waiting', JSON.stringify(st));
    check('J5 release did NOT publish the private edits (public text unchanged, private copy still there)', st.desc.includes('pre-reserved sample') && st.pend === true, JSON.stringify(st));
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l7'); await settle(page);
    check('J6 other viewers still see the old public text after release', (await page.textContent('.ex-desc')).includes('pre-reserved sample') && !(await page.textContent('.ex-detail')).includes('Brass lantern'), 'public');
    await page.click('#ex-interest'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page); await page.waitForTimeout(150);
    const st2 = await page.evaluate(() => { const db = window.ExchangePreview.state().db; return { s: db.listings.filter(x => x.id === 'l7')[0].status, ben: db.requests.filter(r => r.id === 'r5')[0].status }; });
    check('J7 Ask again makes a waiting request and never reserves automatically', st2.s === 'available' && st2.ben === 'waiting', JSON.stringify(st2));
    await who(page, 'dana'); await page.goto(URL_() + '#/edit/l7'); await page.waitForSelector('.ex-form'); check('J8 owner reopens the editor and finds the private text exactly as typed', (await page.inputValue('#ex-description')) === typed, JSON.stringify(await page.inputValue('#ex-description')));
    await page.click('#ex-publish'); await page.waitForSelector('.ex-detail');
    check('J9 only the owner\'s explicit Save changes publishes it, text kept exactly', (await page.evaluate(() => { const l = window.ExchangePreview.state().db.listings.filter(x => x.id === 'l7')[0]; return l.description; })) === typed, 'published');
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l7'); await settle(page); check('J10 now other viewers see the published text, with the author\'s line breaks', (await page.textContent('.ex-desc')).includes('Second paragraph stays.') && (await page.$eval('.ex-desc', e => getComputedStyle(e).whiteSpace)) === 'pre-wrap', 'shown'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/edit/l5'); await page.waitForSelector('.ex-form'); const raw = '  Keep  these\n\nspaces and lines ';
    await page.fill('#ex-description', raw); await page.fill('#ex-title', 'Desk  chair,  adjustable'); await page.click('#ex-publish'); await page.waitForSelector('.ex-detail');
    const r = await page.evaluate(() => { const l = window.ExchangePreview.state().db.listings.filter(x => x.id === 'l5')[0]; return [l.description, l.title]; });
    check('J11 saving a normal edit never rewrites the author\'s spacing or line breaks', r[0] === raw && r[1] === 'Desk  chair,  adjustable', JSON.stringify(r)); await ctx.close(); }

  /* K. Step 3: requests, reservations, decline, cancel, My activity (sample data only) */
  const dbq = (p, fn, arg) => p.evaluate(`(${fn.toString()})(window.ExchangePreview.state().db, ${JSON.stringify(arg === undefined ? null : arg)})`);
  const detailText = p => p.textContent('.ex-detail');
  { const { ctx, page, log } = await open(browser, { hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail');
    const labels = await page.$$eval('.ex-req [data-act]', n => n.map(x => x.textContent));
    check('K1 owner sees Reserve and Decline for each waiting request, nothing disabled', labels.join('|') === 'Reserve for Ben Rowan|Decline|Reserve for Dana Rowan|Decline' && (await page.$$('.ex-detail button[disabled]')).length === 0, labels.join('|')); await shot(page, 'phone-step3-owner-requests');
    await page.click('[data-act=confirm][data-req=r1]'); await page.waitForSelector('dialog[open]'); const dt = await page.textContent('dialog'); await shot(page, 'phone-step3-reserve-confirm');
    check('K2 reserve dialog says one at a time, others stay waiting and are told nothing, nothing is sent', dt.includes('Reserve this for Ben Rowan?') && dt.includes('One person at a time') && dt.includes('Other waiting requests stay waiting') && dt.includes('Nothing is sent from this preview'), dt);
    await page.click('dialog .btn.secondary'); await settle(page);
    check('K3 cancelling the dialog changes nothing', (await dbq(page, db => db.listings.filter(l => l.id === 'l1')[0].status)) === 'available', 'status');
    /* stale: change the listing behind the open dialog, then confirm */
    await page.click('[data-act=confirm][data-req=r1]'); await page.waitForSelector('dialog[open]');
    await dbq(page, db => { db.listings.filter(l => l.id === 'l1')[0].status = 'gone'; });
    await dlgBtn(page); await settle(page); await page.waitForTimeout(100);
    const stl = await dbq(page, db => ({ s: db.listings.filter(l => l.id === 'l1')[0].status, r1: db.requests.filter(r => r.id === 'r1')[0].status }));
    check('K4 stale screen: confirming after the listing changed reserves nothing and shows the latest', stl.s === 'gone' && stl.r1 === 'waiting' && (await page.textContent('#toasts')).includes('already changed'), JSON.stringify(stl));
    check('K5 no network, no errors during request actions', log.external.length === 0 && log.errors.length === 0 && log.requests.every(u => u.startsWith('http://127.0.0.1')), JSON.stringify([log.external, log.errors])); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail');
    await page.click('[data-act=confirm][data-req=r1]'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    const st = await dbq(page, db => ({ s: db.listings.filter(l => l.id === 'l1')[0].status, f: db.listings.filter(l => l.id === 'l1')[0].reservedFor, r1: db.requests.filter(r => r.id === 'r1')[0].status, r2: db.requests.filter(r => r.id === 'r2')[0].status }));
    check('K6 reserving sets Reserved for Ben, his request Reserved, Dana\'s request stays Waiting', st.s === 'reserved' && st.f === 'ben' && st.r1 === 'reserved' && st.r2 === 'waiting', JSON.stringify(st));
    check('K7 while reserved the owner cannot reserve a second person but can still decline and release', !(await page.$('[data-act=confirm]')) && !!(await page.$('[data-req=r2] [data-act=decline]')) && !!(await page.$('#ex-release')) && (await detailText(page)).includes('Release the current reservation to choose someone else'), 'owner'); await shot(page, 'phone-step3-owner-reserved');
    await who(page, 'dana'); await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail');
    const dm = await detailText(page);
    check('K8 a waiting person sees reserved for someone else, stays waiting, can cancel, and cannot see who', dm.includes('reserved for someone else for now') && dm.includes('stays waiting') && !!(await page.$('#ex-cancel-req')) && !(await page.$('#ex-interest')) && !dm.includes('Ben'), dm.slice(0, 300)); await shot(page, 'phone-step3-waiting-reserved-other');
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail');
    check('K9 the reserved person sees reserved for you, pickup via Messages and Cancel my reservation', (await detailText(page)).includes('This is reserved for you') && !!(await page.$('#ex-pickup')) && !!(await page.$('#ex-cancel-resv')), 'recipient');
    await page.click('#ex-cancel-resv'); await page.waitForSelector('dialog[open]'); check('K10 cancel reservation explains the item becomes available and the owner is told', (await page.textContent('dialog')).includes('becomes available again') && (await page.textContent('dialog')).includes('owner will see that you cancelled'), 'dlg'); await dlgBtn(page); await settle(page);
    const c1 = await dbq(page, db => ({ s: db.listings.filter(l => l.id === 'l1')[0].status, f: db.listings.filter(l => l.id === 'l1')[0].reservedFor || null, r1: db.requests.filter(r => r.id === 'r1')[0].status, r2: db.requests.filter(r => r.id === 'r2')[0].status }));
    check('K11 recipient cancel: listing Available again, recipient cleared, request Cancelled, other request still Waiting', c1.s === 'available' && !c1.f && c1.r1 === 'cancelled' && c1.r2 === 'waiting', JSON.stringify(c1));
    check('K12 the person who cancelled can Ask again, and it makes a waiting request, never a reservation', !!(await page.$('#ex-interest')) && (await page.textContent('#ex-interest')) === 'Ask again', 'ask'); await page.click('#ex-interest'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page); await page.waitForTimeout(120);
    const c2 = await dbq(page, db => ({ s: db.listings.filter(l => l.id === 'l1')[0].status, r1: db.requests.filter(r => r.id === 'r1')[0].status }));
    check('K13 Ask again after cancelling is Waiting and the item stays Available', c2.s === 'available' && c2.r1 === 'waiting', JSON.stringify(c2));
    await who(page, 'ava'); await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail'); check('K14 owner sees Ben\'s earlier choice recorded: Ben waiting again, Dana waiting', (await page.$$eval('.ex-req .badge', n => n.map(x => x.textContent))).join('|') === 'Waiting for you|Waiting for you', 'badges');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/listing/l1' }); await page.waitForSelector('.ex-detail');
    await page.click('[data-act=decline][data-req=r2]'); await page.waitForSelector('dialog[open]'); const dt = await page.textContent('dialog');
    check('K15 decline dialog says they are not told why and cannot ask again, others unaffected', dt.includes('not told why') && dt.includes('cannot send another request') && dt.includes('Other requests are not affected'), dt); await dlgBtn(page); await settle(page);
    const d1 = await dbq(page, db => ({ r1: db.requests.filter(r => r.id === 'r1')[0].status, r2: db.requests.filter(r => r.id === 'r2')[0].status, s: db.listings.filter(l => l.id === 'l1')[0].status }));
    check('K16 declining changes only that request', d1.r2 === 'declined' && d1.r1 === 'waiting' && d1.s === 'available', JSON.stringify(d1));
    check('K17 owner row says You declined with no buttons left on it', (await page.textContent('[data-req=r2] .badge')) === 'You declined' && !(await page.$('[data-req=r2] button')), 'row');
    await who(page, 'dana'); await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail'); const dm = await detailText(page);
    check('K18 the declined person sees a plain notice, no reason, no Ask again, no cancel', dm.includes('The owner did not choose your request') && !(await page.$('#ex-interest')) && !(await page.$('#ex-cancel-req')) && !/because|reason/i.test(await page.textContent('.ex-mine')), dm.slice(0, 250));
    await who(page, 'ben'); await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail');
    check('K19 someone else\'s decline is invisible to other applicants', (await detailText(page)).includes('Waiting for Ava Rowan') && !(await detailText(page)).includes('declin'), 'ben');
    await page.click('#ex-cancel-req'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    check('K20 cancelling a waiting request marks it Cancelled and allows asking again', (await dbq(page, db => db.requests.filter(r => r.id === 'r1')[0].status)) === 'cancelled' && !!(await page.$('#ex-interest')), 'cancel'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'ben'); await page.goto(URL_() + '#/listing/w1'); await page.waitForSelector('.ex-detail');
    check('K21 wanted post owner sees Accept offer, not Reserve', (await page.textContent('[data-act=confirm]')) === 'Accept offer from Ava Rowan', 'wanted');
    await page.click('[data-act=confirm]'); await page.waitForSelector('dialog[open]'); check('K22 accept dialog is worded for an offer', (await page.textContent('dialog')).includes('Accept this offer?') && (await page.textContent('dialog')).includes('accepted Ava Rowan’s offer'), await page.textContent('dialog')); await dlgBtn(page); await settle(page);
    check('K23 accepted wanted post is labelled Offer accepted and can be released', (await status(page)) === 'Offer accepted' && (await page.textContent('#ex-release')) === 'Release accepted offer', await status(page));
    await who(page, 'ava'); await page.goto(URL_() + '#/listing/w1'); await page.waitForSelector('.ex-detail'); check('K24 the helper is told their offer was accepted and can cancel it', (await detailText(page)).includes('accepted your offer') && !!(await page.$('#ex-cancel-resv')), 'helper');
    await page.click('#ex-cancel-resv'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    check('K25 helper cancelling an accepted offer reopens the wanted post (Open)', (await dbq(page, db => db.listings.filter(l => l.id === 'w1')[0].status)) === 'open', 'reopen'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/activity' }); await page.waitForSelector('.ex-actsec');
    const t = await page.textContent('main');
    check('K26 owner activity: Needs your reply lists the item with its waiting count', (await page.textContent('#ex-act-needs')) === 'Needs your reply' && t.includes('Oak bookshelf') && t.includes('2 waiting requests'), t.slice(0, 300)); await shot(page, 'phone-step3-activity-owner');
    check('K27 activity link opens the listing', (await page.$eval('.ex-act', a => a.getAttribute('href'))).startsWith('#/listing/'), 'href');
    await who(page, 'ben'); await page.goto(URL_() + '#/activity'); await page.waitForSelector('.ex-actsec'); const bt = await page.textContent('main');
    check('K28 requester activity shows statuses: waiting for Ava, reserved for you (bike and lantern), no one else\'s requests', bt.includes('Waiting for Ava Rowan') && (bt.match(/Reserved for you/g) || []).length === 2 && !bt.includes('Dana Rowan asked'), bt.slice(0, 400)); await shot(page, 'phone-step3-activity-requester');
    await who(page, 'dana'); await page.goto(URL_() + '#/activity'); await page.waitForSelector('.ex-actsec');
    check('K29 reserver activity lists what they reserved for whom', (await page.textContent('#ex-act-held')) === 'Reserved by you' && (await page.textContent('main')).includes('Reserved for Ben Rowan'), 'held');
    check('K30 My activity tab is current in the nav and has no horizontal scroll at 320px', (await page.$eval('.ex-tab[aria-current=page]', a => a.textContent)) === 'My activity', 'tab');
    await dbq(page, db => { db.requests.length = 0; db.listings = db.listings.filter(l => l.owner !== 'dana'); }); await page.goto(URL_() + '#/browse'); await page.goto(URL_() + '#/activity'); await settle(page);
    check('K31 empty activity shows a calm empty state with a way to browse', !!(await page.$('.ex-state-empty')) && (await page.textContent('.ex-state-empty')).includes('No activity yet'), 'empty'); await shot(page, 'phone-step3-activity-empty');
    await cond(page, 'error'); check('K32 activity honours the connection error state', !!(await page.$('.ex-state-error')), 'err'); await cond(page, 'normal');
    await who(page, 'cleo'); await page.goto(URL_() + '#/activity'); await settle(page); check('K33 an ineligible account cannot open My activity', (await page.textContent('main')).includes('not available for this account') && !(await page.$('.ex-actsec')), 'denied'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { w: 320, h: 700, hash: '#/activity' }); await page.waitForSelector('.ex-actsec');
    check('K34 activity and request rows have no horizontal scroll at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'ov');
    await page.goto(URL_() + '#/listing/l1'); await page.waitForSelector('.ex-detail'); check('K35 owner request buttons fit at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'ov2');
    check('K36 dialog titles stay readable on the new dialogs', await (async () => { await page.click('[data-act=decline][data-req=r2]'); await page.waitForSelector('dialog[open]'); return page.$eval('dialog h2', e => getComputedStyle(e).color !== getComputedStyle(e.closest('dialog')).backgroundColor); })(), 'contrast'); await ctx.close(); }

  /* L. Step 4: moderation actions, hidden listings, access cases (sample data only) */
  { const { ctx, page, log } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report');
    check('L1 moderator sees Keep and Hide on reports about other people\'s listings, none disabled', (await page.$$('.ex-report [data-act=keep]')).length === 2 && (await page.$$('.ex-report [data-act=hide]')).length === 2 && (await page.$$('.ex-report button[disabled]')).length === 0, 'buttons'); await shot(page, 'phone-step4-reports');
    check('L2 the report on the moderator\'s own listing has no action buttons and says why', (await page.$$('[data-id=p1] button')).length === 0 && (await page.textContent('[data-id=p1]')).includes('you cannot review this report'), 'own');
    await page.click('[data-rep=p2][data-act=hide]'); await page.waitForSelector('dialog[open]'); const dt = await page.textContent('dialog'); await shot(page, 'phone-step4-hide-confirm');
    check('L3 hide dialog says who still sees it, requests go on hold, owner not told who reported', dt.includes('leaves Browse') && dt.includes('on hold') && dt.includes('not told who reported it'), dt);
    await page.click('dialog .btn.secondary'); await settle(page); check('L4 cancel hides nothing', (await dbq(page, db => db.listings.filter(l => l.id === 'l6')[0].status)) === 'available', 'cancel');
    await page.click('[data-rep=p2][data-act=hide]'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    const h1 = await dbq(page, db => ({ l: db.listings.filter(l => l.id === 'l6')[0].status, r: db.reports.filter(r => r.id === 'p2')[0].status }));
    check('L5 hiding sets the listing Hidden and the report Hidden', h1.l === 'hidden' && h1.r === 'hidden', JSON.stringify(h1));
    check('L6 hidden report offers Restore and Open listing, no more Keep/Hide', !!(await page.$('[data-rep=p2][data-act=restore]')) && !(await page.$('[data-rep=p2][data-act=hide]')), 'restore');
    await page.click('[data-id=p2] a'); await page.waitForSelector('.ex-detail'); check('L7 moderator can open the hidden listing and sees only a banner, no request or report buttons', !!(await page.$('#ex-hidden-mod')) && !(await page.$('#ex-interest')) && !(await page.$('#ex-report')), 'mod view');
    await who(page, 'ben'); await page.goto(URL_() + '#/browse'); await settle(page); const bt = await titles(page);
    check('L8 hidden listing is gone from Browse for everyone else', !bt.includes('Baby blankets'), bt.join('|'));
    await page.goto(URL_() + '#/listing/l6'); await page.waitForSelector('.ex-state'); const hiddenText = await page.textContent('main'); await page.goto(URL_() + '#/listing/zzz'); await page.waitForSelector('.ex-state'); const missingText = await page.textContent('main');
    check('L9 a direct link to a hidden listing looks exactly like a missing one (no hint it exists)', hiddenText === missingText && !hiddenText.includes('Baby blankets') && !/hidden|moderator/i.test(hiddenText), hiddenText);
    await who(page, 'ava'); await page.goto(URL_() + '#/listing/l6'); await page.waitForSelector('.ex-detail'); const ot = await detailText(page);
    check('L10 owner sees the listing with a notice: hidden by a moderator, requests on hold, reporter not named, no edit or lifecycle buttons', !!(await page.$('#ex-hidden-own')) && ot.includes('not told who reported it') && !ot.includes('Dana') && !(await page.$('#ex-edit')) && !(await page.$('#ex-gone')) && !(await page.$('#ex-withdraw')), ot.slice(0, 300)); await shot(page, 'phone-step4-owner-hidden');
    await page.goto(URL_() + '#/edit/l6'); await page.waitForSelector('.ex-state'); check('L11 owner cannot open the edit form for a hidden listing', !(await page.$('.ex-form')), 'edit');
    await page.goto(URL_() + '#/activity'); await page.waitForSelector('.ex-actsec'); check('L12 owner activity lists it under Hidden by a moderator', (await page.textContent('#ex-act-hid')) === 'Hidden by a moderator', 'act');
    await who(page, 'dana'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report'); await page.click('[data-rep=p2][data-act=restore]'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    const rs = await dbq(page, db => ({ l: db.listings.filter(l => l.id === 'l6')[0].status, r: db.reports.filter(r => r.id === 'p2')[0].status }));
    check('L13 restore returns the listing to how it was (Available) and closes the report', rs.l === 'available' && rs.r === 'kept', JSON.stringify(rs));
    await page.click('[data-rep=p3][data-act=keep]'); await page.waitForSelector('dialog[open]'); check('L14 keep dialog says the listing stays and the owner is not told', (await page.textContent('dialog')).includes('stays exactly as it is') && (await page.textContent('dialog')).includes('not told about the report'), 'keep'); await dlgBtn(page); await settle(page);
    const kp = await dbq(page, db => ({ l: db.listings.filter(l => l.id === 'l2')[0].status, r: db.reports.filter(r => r.id === 'p3')[0].status }));
    check('L15 keep closes the report and changes nothing on the listing', kp.l === 'available' && kp.r === 'kept', JSON.stringify(kp));
    check('L16 no network and no page errors through moderation', log.external.length === 0 && log.errors.length === 0, JSON.stringify([log.external, log.errors])); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'ben');
    await page.goto(URL_() + '#/listing/l3'); await page.waitForSelector('.ex-detail'); await who(page, 'dana'); await page.goto(URL_() + '#/listing/l1');
    /* hiding a reserved listing: the reserved person loses sight of it, reservation is kept for restore */
    await dbq(page, db => { db.reports.push({ id: 'p9', listing: 'l3', by: 'ben', reason: 'Other', detail: '', ago: 'Just now', status: 'open' }); });
    await who(page, 'ava'); await dbq(page, db => { db.reports.push({ id: 'p8', listing: 'l7', by: 'ava', reason: 'Other', detail: '', ago: 'Just now', status: 'open' }); });
    await who(page, 'dana'); await page.goto(URL_() + '#/browse'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report');
    check('L17 a report on Dana\'s own reserved lantern or bike cannot be acted on by Dana', (await page.$$('[data-id=p8] button')).length === 0 && (await page.$$('[data-id=p9] button')).length === 0, 'own');
    await dbq(page, db => { db.listings.filter(l => l.id === 'l3')[0].owner = 'ava'; }); await page.goto(URL_() + '#/browse'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report');
    await page.click('[data-rep=p9][data-act=hide]'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    const st = await dbq(page, db => { const l = db.listings.filter(x => x.id === 'l3')[0]; return { s: l.status, f: l.reservedFor, req: db.requests.filter(r => r.id === 'r3')[0].status }; });
    check('L18 hiding a reserved listing keeps the reservation data for a later restore', st.s === 'hidden' && st.f === 'ben' && st.req === 'reserved', JSON.stringify(st));
    await who(page, 'ben'); await page.goto(URL_() + '#/activity'); await page.waitForSelector('.ex-actsec'); const at = await page.textContent('main');
    check('L19 the reserved person no longer sees the hidden listing in My activity (no title leak)', !at.includes('20-inch kids bike'), at.slice(0, 300));
    await who(page, 'dana'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report'); await page.click('[data-rep=p9][data-act=restore]'); await page.waitForSelector('dialog[open]'); await dlgBtn(page); await settle(page);
    const st2 = await dbq(page, db => { const l = db.listings.filter(x => x.id === 'l3')[0]; return { s: l.status, f: l.reservedFor }; });
    check('L20 restoring brings back Reserved for the same person', st2.s === 'reserved' && st2.f === 'ben', JSON.stringify(st2)); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report');
    await page.click('[data-rep=p2][data-act=hide]'); await page.waitForSelector('dialog[open]');
    await dbq(page, db => { db.listings.filter(l => l.id === 'l6')[0].status = 'gone'; });
    await dlgBtn(page); await settle(page); await page.waitForTimeout(100);
    const sg = await dbq(page, db => ({ l: db.listings.filter(l => l.id === 'l6')[0].status, r: db.reports.filter(r => r.id === 'p2')[0].status }));
    check('L21 stale moderation: if the listing changed behind the dialog, nothing is hidden and the latest is shown', sg.l === 'gone' && sg.r === 'open' && (await page.textContent('#toasts')).includes('already changed'), JSON.stringify(sg)); await ctx.close(); }
  { const { ctx, page } = await open(browser, { hash: '#/browse' });
    for (const id of ['cleo', 'eli']) { await who(page, id); await page.goto(URL_() + '#/listing/l1'); await settle(page); const t = await page.textContent('main');
      check('L22 ' + id + ' (ineligible) opening a direct link sees only the not-available state, no listing and no reason', t.includes('not available for this account') && !t.includes('Oak bookshelf') && !/restrict|unclassified|removed/i.test(t), t); }
    await who(page, 'ava'); await page.goto(URL_() + '#/reports'); await settle(page); check('L23 a non-moderator opening the Reports link is refused', (await page.textContent('main')).includes('not available for this account') || (await page.textContent('main')).includes('Reports are not available'), 'non-mod');
    await cond(page, 'denied'); await page.goto(URL_() + '#/listing/l1'); await settle(page); check('L24 access removed mid-session (server says no access) shows a calm denied state and changes nothing', !!(await page.$('.ex-state-denied')) && (await page.textContent('main')).includes('Nothing was changed'), 'denied'); await shot(page, 'phone-step4-denied'); await ctx.close(); }
  { const { ctx, page } = await open(browser, { w: 320, h: 700, hash: '#/browse' }); await who(page, 'dana'); await page.goto(URL_() + '#/reports'); await page.waitForSelector('.ex-report');
    check('L25 reports screen has no horizontal scroll at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'ov'); await ctx.close(); }

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
