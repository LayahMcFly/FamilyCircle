/* Browser tests for the Calendar built into Family Circle (real Chrome, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && node calendar-native.spec.js
 * Proves the screens and flows. The server rules are covered by function/test/board.test.js. It proves nothing about the live site. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const mkUser = (id, name) => ({ $id: id, name, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name) => ({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const world = (user, role) => ({ signedIn: true, user, families: [{ id: 'famA', name: 'Alpha Family', role }], canCreateFamily: false, tables: { profiles: [prof('uA', 'Alex Tester'), prof('uB', 'Bea Tester')], people: [], posts: [] },
  members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'Alex Tester' }, { $id: 'm2', userId: 'uB', confirm: true, roles: ['member'], userName: 'Bea Tester' }] });
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }

/* A tiny in-page board backend (the real rules are tested in function/test/board.test.js). Runs inside the page. */
function installBackend(meId, manager) {
  const M = window.__MOCK, S = { n: 0, tasks: [], groups: [], products: [], requests: [], notes: [] };
  const members = [{ userId: 'uA', name: 'Alex Tester', owner: true }, { userId: 'uB', name: 'Bea Tester', owner: false }];
  const nm = id => (members.find(m => m.userId === id) || {}).name;
  const id = () => 'x' + (++S.n);
  const out = t => ({ ...t.d, id: t.id, due: t.due, status: t.status });
  M.api = {
    boardLoad: () => ({ me: { userId: meId, name: nm(meId), manager }, members, tasks: S.tasks.map(out), groups: S.groups, products: S.products, requests: S.requests.filter(r => manager || r.byId === meId), notes: S.notes.filter(n => n.to === meId) }),
    boardTaskSave: b => { const t = b.task; if (!t.title) return { __deny: 'Title is required.', __code: 400, __error: 'bad_request' };
      if (t.id) { const r = S.tasks.find(x => x.id === t.id); r.due = t.due; r.d = { ...r.d, ...t, id: undefined }; return { task: out(r) }; }
      const r = { id: id(), due: t.due, status: 'open', d: { ...t, id: undefined, createdBy: meId, history: [{ type: 'created', actorName: nm(meId), at: '2026-12-01T10:00:00Z' }], completedByName: '' } }; S.tasks.push(r);
      (t.assigneeIds || []).filter(a => a !== meId).forEach(a => S.notes.push({ id: id(), to: a, read: false, kind: 'assigned', actorName: nm(meId), title: t.title, due: t.due, at: '2026-12-01T10:00:00Z' })); return { task: out(r) }; },
    boardTaskComplete: b => { const r = S.tasks.find(x => x.id === b.taskId); r.status = b.done === false ? 'open' : 'complete'; r.d.completedByName = b.done === false ? '' : nm(meId); r.d.completedAt = '2026-12-01T10:00:00Z'; return { task: out(r) }; },
    boardStep: b => { const r = S.tasks.find(x => x.id === b.taskId); r.d.steps.find(s => s.id === b.stepId).done = b.done; return { task: out(r) }; },
    boardTaskDelete: b => { const r = S.tasks.find(x => x.id === b.taskId); if (!manager && r.d.createdBy !== meId) return { __deny: 'Only the person who made this task can delete it.', __code: 403, __error: 'forbidden' }; S.tasks = S.tasks.filter(x => x !== r); return { deleted: true }; },
    boardGroupSave: b => { S.groups.push({ id: id(), ...b.group }); return { group: S.groups[S.groups.length - 1] }; },
    boardProductSave: b => { S.products.push({ id: id(), ...b.product, low: false, qty: 0 }); return {}; },
    boardProductLow: b => { Object.assign(S.products.find(p => p.id === b.productId), { low: true, qty: b.qty, opened: b.opened, goneBy: b.goneBy, by: nm(meId) }); return {}; },
    boardProductBought: b => { Object.assign(S.products.find(p => p.id === b.productId), { low: false, qty: 0 }); return {}; },
    boardRequest: b => { S.requests.push({ id: id(), status: 'pending', kind: b.kind, title: (S.tasks.find(t => t.id === b.taskId) || { d: {} }).d.title, name: b.name, byId: meId, byName: nm(meId) }); return {}; },
    boardDecide: b => { S.requests.find(r => r.id === b.requestId).status = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'ignored'; return {}; },
    boardNotesRead: () => { S.notes.forEach(n => { if (n.to === meId) n.read = true; }); return {}; }
  };
  window.__BOARD = S;
}
async function newPage(ctx, mock, who, manager, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push('console ' + m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.addInitScript(`(${installBackend.toString()})(${JSON.stringify(who)}, ${manager})`);
  return page;
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const PORT = server.address().port; const URL0 = 'http://127.0.0.1:' + PORT + SUB;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const A = mkUser('uA', 'Alex Tester');
  const page = await newPage(ctx, world(A, 'owner'), 'uA', true, errors);
  await page.goto(URL0 + '#/hub'); await page.waitForSelector('a[data-hub="calendar"]');

  const card = page.locator('a[data-hub="calendar"]');
  check('1 Hub card opens inside the app, same tab, no frame', (await card.getAttribute('href')) === '#/calendar' && (await card.getAttribute('target')) === null, await card.getAttribute('href'));
  await card.click(); await page.waitForSelector('main[data-view="calendar"] .bd-grid');
  check('14 first visit shows the How the calendar works card', (await page.locator('.bd-help h2').innerText()) === 'How the calendar works' && (await page.locator('.bd-help dt').count()) === 8 && (await page.locator('.bd-help dt', { hasText: 'Private tasks' }).count()) === 1, '');
  await page.screenshot({ path: path.join(shots, 'calendar-help.png') });
  await page.click('.bd-help button:has-text("Got it")');
  check('14 Got it hides the card', (await page.locator('.bd-help').count()) === 0, '');
  await page.evaluate(() => { location.hash = '#/hub'; }); await page.waitForSelector('a[data-hub="calendar"]'); await page.click('a[data-hub="calendar"]'); await page.waitForSelector('.bd-grid');
  check('14 it stays hidden on the next visit', (await page.locator('.bd-help').count()) === 0, '');
  check('14 the i icon sits at the top right beside the bell', await page.evaluate(() => { const i = document.querySelector('.bd-how').getBoundingClientRect(), b = document.querySelector('.bd-bell').getBoundingClientRect(); return i.right <= b.left + 1 && b.right > innerWidth - 40 && !!document.querySelector('.bd-how svg'); }), '');
  await page.click('.bd-how'); check('14 the i button brings it back', (await page.locator('.bd-help').count()) === 1, '');
  await page.click('.bd-how'); check('14 and hides it again without forgetting', (await page.locator('.bd-help').count()) === 0, '');
  check('1 no iframe, no Back to Hub link (navigation has the Hub button)', (await page.locator('iframe').count()) === 0 && (await page.locator('main .hub-back a[href="#/hub"]').count()) === 0, '');
  const today = await page.evaluate(() => { const d = new Date(), p = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); });
  check('2 month grid with today picked', (await page.locator('.bd-cell.today.picked').count()) === 1, '');
  await page.screenshot({ path: path.join(shots, 'calendar-month-empty.png') });

  // add a task
  await page.click('.bd-day .btn'); await page.waitForSelector('dialog.bd-dialog[open]');
  await page.fill('dialog input[type="text"]', 'Take out the trash');
  await page.locator('dialog .bd-people label', { hasText: 'Bea Tester' }).click();
  await page.screenshot({ path: path.join(shots, 'calendar-task-form.png') });
  const ctrl = await page.evaluate(() => { const bad = []; document.querySelectorAll('dialog input, dialog select, dialog textarea').forEach(el => { const cs = getComputedStyle(el), t = (el.type || el.tagName).toLowerCase(), r = el.getBoundingClientRect(); if (r.width < 4) return; if (t === 'checkbox' || t === 'radio') { if (cs.appearance !== 'none') bad.push(t + ' default'); return; } if (parseFloat(cs.borderTopWidth) < 1 || parseFloat(cs.borderTopLeftRadius) < 8) bad.push((el.name || t) + ' default shape'); if (el.tagName === 'SELECT' && (cs.appearance !== 'none' || cs.backgroundImage === 'none')) bad.push('select arrow'); }); return bad; });
  check('3 every control in the task form is themed', ctrl.length === 0, ctrl.join('; '));
  await page.click('dialog button[type="submit"]'); await page.waitForSelector('.bd-day .bd-task');
  check('3 task appears under the picked day', (await page.locator('.bd-day .bd-task-title').first().innerText()).includes('Take out the trash'), '');
  check('3 a dot shows on the day', (await page.locator('.bd-cell.today .bd-dot').count()) === 1, '');
  check('3 the form closed', (await page.locator('dialog[open]').count()) === 0, '');

  // empty title shows the server message, dialog stays
  await page.click('.bd-day .btn'); await page.waitForSelector('dialog[open]'); await page.click('dialog button[type="submit"]');
  await page.waitForSelector('dialog .bd-error:not([hidden])');
  check('4 a rejected form shows the message and stays open', (await page.locator('dialog .bd-error').innerText()).includes('Title is required'), '');
  await page.click('dialog button:has-text("Cancel")');

  // tick and detail
  await page.locator('.bd-day .bd-task input[type="checkbox"]').check(); await page.waitForSelector('.bd-task.done');
  await page.locator('.bd-day .bd-task-main').click(); await page.waitForSelector('dialog .bd-record');
  check('5 detail shows who finished it, written by the server', (await page.locator('dialog .bd-record').innerText()).includes('Done by Alex Tester'), await page.locator('dialog .bd-record').innerText());
  await page.screenshot({ path: path.join(shots, 'calendar-task-detail.png') });
  await page.click('dialog button:has-text("Mark not done")'); await page.waitForTimeout(150);
  check('5 can be marked not done again', (await page.locator('.bd-task.done').count()) === 0, '');

  // steps
  await page.locator('.bd-day .bd-task-main').click(); await page.click('dialog button:has-text("Edit")');
  await page.click('dialog button:has-text("Add a step")'); await page.locator('dialog .bd-steps-edit input[type="text"]').first().fill('Tie the bag');
  await page.click('dialog button[type="submit"]'); await page.waitForTimeout(200);
  check('6 step saved and counted', (await page.locator('.bd-task-meta').first().innerText()).includes('0/1 steps'), await page.locator('.bd-task-meta').first().innerText());
  await page.locator('.bd-day .bd-task-main').click(); await page.locator('dialog .bd-step input').check(); await page.waitForSelector('dialog .bd-step .is-done');
  check('6 step can be ticked in the detail', true, '');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);

  // tabs: week, tasks
  await page.click('.bd-tab:has-text("Week")'); await page.waitForSelector('.bd-day');
  check('7 week view lists seven days', (await page.locator('.bd-day').count()) === 7, String(await page.locator('.bd-day').count()));
  await page.click('.bd-tab:has-text("Tasks")'); await page.waitForSelector('.bd-list .bd-task');
  check('7 tasks tab lists the task', (await page.locator('.bd-list .bd-task').count()) === 1, '');
  await page.screenshot({ path: path.join(shots, 'calendar-tasks.png') });

  // the section row scrolls sideways on a phone and must not jump back when a section is chosen
  await page.click('.bd-tab:has-text("Month")');
  const over2 = await page.evaluate(() => { const t = document.querySelector('.bd-tabs'); t.scrollLeft = t.scrollWidth; return { sw: t.scrollWidth, cw: t.clientWidth, left: t.scrollLeft }; });
  check('13 the section row really scrolls sideways at 390px', over2.sw > over2.cw && over2.left > 0, JSON.stringify(over2));
  await page.click('.bd-tab:has-text("Requests")'); await page.waitForTimeout(150);
  const after2 = await page.evaluate(() => { const t = document.querySelector('.bd-tabs'), on = t.querySelector('.bd-tab.on'), r = on.getBoundingClientRect(), tr = t.getBoundingClientRect(); return { left: t.scrollLeft, tab: on.textContent, visible: r.left >= tr.left - 1 && r.right <= tr.right + 1 }; });
  check('13 choosing a section keeps the row where it was (no jump back to the left)', after2.left > 0, JSON.stringify(after2));
  check('13 the chosen section stays fully in view', after2.visible, JSON.stringify(after2));
  await page.click('.bd-tab:has-text("Groups")'); await page.waitForTimeout(150);
  check('13 choosing another section from the scrolled row still keeps it', (await page.evaluate(() => document.querySelector('.bd-tabs').scrollLeft)) > 0, '');
  const gap = await page.evaluate(() => { const b = document.querySelector('main .bd-toprow .btn').getBoundingClientRect(), c = document.querySelector('main .bd-groups > section.card').getBoundingClientRect(); return Math.round(c.top - b.bottom); });
  check('14 the New group button is not touching the card below it (gap ' + gap + 'px)', gap >= 14, String(gap));
  // groups (owner)
  await page.click('.bd-tab:has-text("Groups")'); await page.click('main .btn:has-text("New group")'); await page.waitForSelector('dialog[open]');
  await page.fill('dialog input[type="text"]', 'Chores'); await page.click('dialog button[type="submit"]'); await page.waitForSelector('.bd-chip.bd-group');
  check('8 owner can add a group', (await page.locator('.bd-chip.bd-group').innerText()) === 'Chores', '');

  // shopping
  await page.click('.bd-tab:has-text("Shopping")'); await page.click('main .btn:has-text("Add a product")'); await page.waitForSelector('dialog[open]');
  await page.fill('dialog input[type="text"] >> nth=0', 'Milk'); await page.click('dialog button[type="submit"]'); await page.waitForSelector('.bd-prod');
  await page.click('.bd-prod button:has-text("Running low")'); await page.waitForSelector('dialog[open]'); await page.click('dialog button[type="submit"]');
  await page.waitForSelector('.bd-prod.low');
  check('9 running low is flagged', (await page.locator('section:has-text("Running low")').count()) >= 1, '');
  await page.screenshot({ path: path.join(shots, 'calendar-shopping.png') });
  await page.click('.bd-prod button:has-text("Bought it")'); await page.waitForTimeout(150);
  check('9 bought clears it', (await page.locator('.bd-prod.low').count()) === 0, '');

  // overflow at phone width
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('10 no sideways scrolling at 390px', !over, '');
  await page.screenshot({ path: path.join(shots, 'calendar-month.png') });

  // private tasks: on by itself when the task is only for me, with a pop-up; off switch; others on it
  await page.click('.bd-tab:has-text("Month")'); await page.waitForSelector('.bd-day .btn');
  await page.click('.bd-day .btn'); await page.waitForSelector('dialog.bd-dialog[open]');
  const priv = page.locator('dialog #bd-private'), note = page.locator('dialog .bd-callout');
  check('15 a new task starts with you ticked, Private on, and the note showing', await page.locator('dialog .bd-people label', { hasText: '(me)' }).locator('input').isChecked() && await priv.isChecked() && await note.isVisible(), '');
  check('15 the note explains how to share it', /only you can see this task\. Turn off Private to share it with the family\./i.test(await note.innerText()), '');
  await page.screenshot({ path: path.join(shots, 'calendar-private-form.png') });
  await page.locator('dialog .bd-people label', { hasText: 'Bea Tester' }).click();
  check('15 adding someone else switches it back off (not touched by hand yet)', !(await priv.isChecked()), '');
  await page.locator('dialog .bd-people label', { hasText: 'Bea Tester' }).click();
  check('15 back to just me, Private on again', await priv.isChecked(), '');
  check('15 a pop-up message appears', /This task is private\. Only you can see it\./.test(await page.locator('.toast').last().innerText()), '');
  await priv.uncheck();
  await page.locator('dialog .bd-people label', { hasText: '(me)' }).click(); await page.locator('dialog .bd-people label', { hasText: '(me)' }).click();
  check('15 once you turn Private off yourself, ticking your own name no longer turns it on', !(await priv.isChecked()), '');
  await priv.check(); await page.fill('dialog input[type="text"]', 'Surprise party plan');
  await page.click('dialog button[type="submit"]'); await page.waitForSelector('.bd-day .bd-task:has-text("Surprise party plan")');
  check('15 the task saved as private and shows a Private tag', (await page.locator('.bd-day .bd-task', { hasText: 'Surprise party plan' }).locator('.bd-private').count()) === 1, '');
  check('15 the server was told it is private', await page.evaluate(() => window.__BOARD.tasks.find(t => t.d.title === 'Surprise party plan').d.private === true), '');
  await page.locator('.bd-day .bd-task-main', { hasText: 'Surprise party plan' }).click(); await page.waitForSelector('dialog .bd-detail');
  check('15 the details show Private', (await page.locator('dialog .bd-detail .bd-private').count()) === 1, '');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check('15 no sideways scrolling with the Private note', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), '');

  // a member: bell, ask to delete, no group manage
  const B = mkUser('uB', 'Bea Tester'), ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pb = await newPage(ctx2, world(B, 'member'), 'uB', false, errors);
  await pb.goto(URL0 + '#/calendar'); await pb.waitForSelector('main[data-view="calendar"] .bd-grid');
  await pb.evaluate(() => { const S = window.__BOARD; S.tasks.push({ id: 'tA', due: new Date().toLocaleDateString('en-CA'), status: 'open', d: { title: "Alex's task", createdBy: 'uA', assigneeIds: ['uB'], steps: [], history: [] } }); S.notes.push({ id: 'n1', to: 'uB', read: false, kind: 'assigned', actorName: 'Alex Tester', title: "Alex's task", due: '2026-12-01', at: '2026-12-01T10:00:00Z' }); });
  await pb.evaluate(() => { location.hash = '#/hub'; }); await pb.waitForSelector('a[data-hub="calendar"]'); await pb.click('a[data-hub="calendar"]'); await pb.waitForSelector('.bd-grid');
  check('11 member sees the bell badge with 1 new alert', (await pb.locator('.bd-badge').innerText()) === '1', await pb.locator('.bd-badge').count() + '');
  await pb.click('.bd-bell'); await pb.waitForSelector('dialog .bd-note.new');
  check('11 the alert reads in plain words', (await pb.locator('dialog .bd-note').innerText()).includes('Alex Tester gave you'), await pb.locator('dialog .bd-note').innerText());
  await pb.waitForTimeout(200); await pb.keyboard.press('Escape'); await pb.waitForTimeout(100);
  check('11 opening the bell clears the badge', (await pb.locator('.bd-badge').count()) === 0, '');
  await pb.locator('.bd-day .bd-task-main').first().click(); await pb.waitForSelector('dialog .bd-detail');
  check('11 a member cannot delete someone else\'s task, only ask', (await pb.locator('dialog .btn.danger').count()) === 0 && (await pb.locator('dialog button:has-text("Ask to delete")').count()) === 1, '');
  await pb.click('dialog button:has-text("Ask to delete")'); await pb.waitForTimeout(200);
  await pb.click('.bd-tab:has-text("Requests")');
  check('11 the request shows as waiting', (await pb.locator('main').innerText()).includes('Waiting'), '');
  await pb.click('.bd-tab:has-text("Groups")');
  check('11 member only gets Ask for a group', (await pb.locator('main .btn:has-text("Ask for a group")').count()) === 1 && (await pb.locator('main .btn:has-text("New group")').count()) === 0, '');
  check('11 no edit/delete buttons on groups for a member', (await pb.locator('.bd-prod button').count()) === 0, '');
  const errs = errors.filter(e => !/net::ERR|Failed to load resource/.test(e));
  check('12 no page errors or CSP violations', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1); });
