/* Browser tests for @mentions (class B evidence: real Chrome at a phone size, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && node mentions.spec.js
 * Proves the pick-a-person list, the highlight, and the Activity entries. It does NOT prove anything on the live project or a real phone keyboard. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots'); let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); };
const prof = (id, name) => ({ $id: 'p' + id, userId: id, familyId: 'famA', displayName: name, about: '[]' });
const now = new Date().toISOString();
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript((now) => {
    window.__MOCK = {
      signedIn: true, user: { $id: 'uA', name: 'Alex Me', email: 'a@e.com', emailVerification: true, prefs: {} },
      families: [{ id: 'famA', name: 'Alpha', role: 'owner' }],
      members: [{ $id: 'm1', userId: 'uA', confirm: true, roles: ['owner'], userName: 'Alex Me' }],
      tables: {
        profiles: [['uA', 'Alex Me'], ['uB', 'Sam Rivera'], ['uC', 'Samantha Lee'], ['uD', 'Ann Marie Cole'], ['uE', 'Ann Cole']].map(a => ({ $id: 'p' + a[0], userId: a[0], familyId: 'famA', displayName: a[1], about: '[]' })),
        people: [], reactions: [],
        posts: [{ $id: 'post1', familyId: 'famA', authorId: 'uB', kind: 'text', body: 'Hello family', $createdAt: now, $updatedAt: now }],
        comments: [
          { $id: 'c1', familyId: 'famA', postId: 'post1', authorId: 'uB', body: '@Alex Me look at this', likedBy: [], $createdAt: now, $updatedAt: now },
          { $id: 'c2', familyId: 'famA', postId: 'post1', authorId: 'uC', body: 'hi @Ann Marie Cole and @Ann, also @Sam, @Nobody and mail a@b.com', likedBy: [], $createdAt: now, $updatedAt: now }
        ],
        chatMessages: [{ $id: 'm1', familyId: 'famA', convId: 'ch-a', kind: 'channel', authorId: 'uD', body: 'dinner at 6 @Alex Me', $createdAt: now }]
      },
      api: { createComment: () => ({ commentId: 'cNew' }) }, log: []
    };
  }, now);
  await page.goto('http://127.0.0.1:' + port + SUB + '#/post/post1'); await page.waitForSelector('.comment-input'); await page.waitForTimeout(900);

  // Highlight
  const marks = await page.$$eval('.comment-body .mention', els => els.map(e => ({ t: e.textContent, me: e.classList.contains('mention-me') })));
  check('Highlights a full name, the longer of two overlapping names, and a first name only when it is unique ( @Ann is shared, so it is not)', JSON.stringify(marks.map(m => m.t)) === JSON.stringify(['@Alex Me', '@Ann Marie Cole', '@Sam']), JSON.stringify(marks));
  check('My own name is highlighted as me', marks[0] && marks[0].me && !marks[1].me, JSON.stringify(marks));
  const plain = await page.$$eval('.comment-body', els => els.map(e => e.textContent));
  check('A name that is not in the family, and an email address, are not highlighted', plain[1].includes('@Nobody') && plain[1].includes('a@b.com') && marks.length === 3, plain[1]);

  // Drop-down
  const ta = page.locator('.comment-input'); await ta.click();
  await ta.pressSequentially('@Sa');
  let opts = await page.$$eval('.mention-opt .mention-name', els => els.map(e => e.textContent));
  check('Typing @Sa lists the matching people (not me)', JSON.stringify(opts) === JSON.stringify(['Sam Rivera', 'Samantha Lee']), JSON.stringify(opts));
  const box = await page.evaluate(() => { const r = document.querySelector('.mention-list').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
  check('The list is fully on screen', box.l >= 0 && box.r <= box.vw && box.t >= 0 && box.b <= box.vh, JSON.stringify(box));
  await page.screenshot({ path: path.join(OUT, 'mention-list-390.png') });
  await ta.pressSequentially('m R');
  opts = await page.$$eval('.mention-opt .mention-name', els => els.map(e => e.textContent));
  check('Typing more narrows the list, including a space in a two-word name', JSON.stringify(opts) === JSON.stringify(['Sam Rivera']), JSON.stringify(opts));
  await page.keyboard.press('Enter');
  check('Enter picks the person and writes @Name plus a space', (await ta.inputValue()) === '@Sam Rivera ', await ta.inputValue());
  check('The list closes after picking', (await page.$('.mention-list')) === null, '');
  await ta.fill(''); await ta.pressSequentially('hey @Ann');
  opts = await page.$$eval('.mention-opt .mention-name', els => els.map(e => e.textContent));
  check('Works in the middle of a sentence', opts.length === 2 && opts.includes('Ann Marie Cole') && opts.includes('Ann Cole'), JSON.stringify(opts));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  check('Escape closes the list and keeps the text', (await page.$('.mention-list')) === null && (await ta.inputValue()) === 'hey @Ann', await ta.inputValue());
  await ta.fill(''); await ta.pressSequentially('mail a@b');
  check('An @ inside a word (an email) does not open the list', (await page.$('.mention-list')) === null, '');
  await ta.fill(''); await ta.pressSequentially('@Zed');
  check('No list when nobody matches', (await page.$('.mention-list')) === null, '');
  await ta.fill(''); await ta.pressSequentially('@Ann M');
  await page.locator('.mention-opt').first().click();
  check('Tapping a person picks them', (await ta.inputValue()) === '@Ann Marie Cole ', await ta.inputValue());

  // Highlight while typing: chips above the box
  await page.waitForTimeout(100);
  const chip1 = await page.$$eval('.mention-chips .mention', els => els.map(e => e.textContent));
  check('After picking, the named person shows highlighted above the box', JSON.stringify(chip1) === JSON.stringify(['@Ann Marie Cole']), JSON.stringify(chip1));
  const chipBox = await page.evaluate(() => { const c = document.querySelector('.mention-chips').getBoundingClientRect(), t = document.querySelector('.comment-input').getBoundingClientRect(); return { above: c.bottom <= t.top + 1, inView: c.left >= 0 && c.right <= innerWidth && c.top >= 0 }; });
  check('The chip bar sits above the text box and inside the screen', chipBox.above && chipBox.inView, JSON.stringify(chipBox));
  await page.screenshot({ path: path.join(OUT, 'mention-typing-390.png') });
  await ta.fill(''); await ta.pressSequentially('hi @Ann');
  check('While the list is open the chip bar is hidden', (await page.$('.mention-chips')) === null, '');
  await ta.fill(''); await ta.pressSequentially('no names here');
  check('No chips when nobody is named', (await page.$('.mention-chips')) === null, '');
  await ta.fill(''); await ta.pressSequentially('@Ann M'); await page.locator('.mention-opt').first().click();

  // Posting shows the highlight
  await ta.pressSequentially('thanks'); await page.click('.comment-send'); await page.waitForTimeout(500);
  const last = await page.$$eval('.comment-body', els => { const e = els[els.length - 1]; return { text: e.textContent, m: Array.from(e.querySelectorAll('.mention')).map(x => x.textContent) }; });
  check('A comment you post shows the mention highlighted', last.m.length === 1 && last.m[0] === '@Ann Marie Cole', JSON.stringify(last));
  await page.screenshot({ path: path.join(OUT, 'mention-posted-390.png') });

  // Activity
  await page.goto('http://127.0.0.1:' + port + SUB + '#/activity'); await page.waitForSelector('.act-item', { timeout: 5000 }); await page.waitForTimeout(500);
  const acts = await page.$$eval('.act-item .act-text', els => els.map(e => e.textContent));
  check('Activity says who mentioned you in a comment', acts.some(t => /^Sam Rivera mentioned you in a comment: @Alex Me look/.test(t)), JSON.stringify(acts));
  check('Activity says who mentioned you in the family chat', acts.some(t => /^Ann Marie Cole mentioned you in the family chat: dinner at 6/.test(t)), JSON.stringify(acts));
  check('A comment that names someone else is not listed for me', !acts.some(t => /Samantha Lee mentioned/.test(t)), JSON.stringify(acts));
  await page.screenshot({ path: path.join(OUT, 'mention-activity-390.png') });


  // Chat box and chat message highlight
  await page.goto('http://127.0.0.1:' + port + SUB + '#/chat'); await page.waitForTimeout(1200);
  await page.locator('.side-item').first().click().catch(() => {}); await page.waitForTimeout(1200);
  const cta = page.locator('textarea[aria-label^="Message"]');
  const hasChat = await cta.count();
  check('The chat message box is on the page', hasChat > 0, 'no chat textarea; url ' + page.url());
  if (hasChat) {
    await cta.first().click(); await cta.first().pressSequentially('@Ann M');
    const co = await page.$$eval('.mention-opt .mention-name', els => els.map(e => e.textContent));
    check('Typing @ in the chat box lists people too', JSON.stringify(co) === JSON.stringify(['Ann Marie Cole']), JSON.stringify(co));
    await page.keyboard.press('Enter');
    check('Enter picks the person in chat and does NOT send the message', (await cta.first().inputValue()) === '@Ann Marie Cole ' && !(await page.evaluate(() => window.__MOCK.log.some(l => l.indexOf('api chatSend') === 0))), await cta.first().inputValue());
    await page.screenshot({ path: path.join(OUT, 'mention-chat-390.png') });
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed'); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
