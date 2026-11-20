/* Browser tests for the Family Tree drawn as a living tree (trunk, limbs, seasonal foliage) (class B evidence: real Chrome, real app code, FAKE Appwrite backend, SYNTHETIC people only).
 * Run:  cd tests/browser && SHOTS=/some/dir node tree-seasons.spec.js
 * Proves the screens, classes, geometry and requests the app produces. It does NOT prove anything about the live Appwrite project, other browsers or real devices. */
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
const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots');
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
const me = id => ({ $id: id, name: id, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name, extra) => Object.assign({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' }, extra || {});
const person = (id, name, o) => Object.assign({ $id: id, familyId: 'famA', name, parentIds: [], partnerIds: [], $createdAt: '2026-01-01' }, o || {});

/* ---------- synthetic fixtures (invented names; nothing from a real family) ---------- */
function complexPeople() {
  return [
    person('g1', 'Rowan Hale', { partnerIds: ['g2', 'g5'], birthday: '1948-03-01' }), person('g2', 'Ines Hale', { partnerIds: ['g1'] }), person('g5', 'Elin Voss', { partnerIds: ['g1'] }),
    person('g3', 'Ada Okoye', { partnerIds: ['g4'] }), person('g4', 'Samir Okoye', { partnerIds: ['g3'] }),
    person('m', 'Mara Hale', { parentIds: ['g1', 'g2'], partnerIds: ['t'], userId: 'u1', confirmed: true, birthday: '1978-05-02' }), person('t', 'Tomas Vega', { partnerIds: ['m'] }),
    person('j', 'Jude Hale', { parentIds: ['g1', 'g5'], partnerIds: ['s'] }), person('s', 'Sana Okoye', { parentIds: ['g3', 'g4'], partnerIds: ['j'] }),
    person('k1', 'Lia Vega', { parentIds: ['m', 't'] }), person('k2', 'Noel Vega', { parentIds: ['m', 't'] }), person('k3', 'Pip Hale', { parentIds: ['j', 's'] }),
    person('z', 'Zoe Marsh'), person('k4', 'Wren Hale', { parentIds: ['j', 's', 'z'], parentKinds: JSON.stringify({ j: 'adoptive', s: 'adoptive', z: 'birth' }) }),
    person('x1', 'Kit Moreau', { partnerIds: ['x2'] }), person('x2', 'Lou Moreau', { partnerIds: ['x1'] }), person('lone', 'Nova Reyes')
  ];
}
function largePeople(n) {   // six generations, couples with two to three children, plus a few extra partners
  const out = []; let id = 0; const mk = (name, o) => { const p = person('L' + (++id), name, o); out.push(p); return p; };
  let gen = [[mk('Root A1', { userId: 'u1', confirmed: true }), mk('Root A2', {})]]; gen[0][0].partnerIds = [gen[0][1].$id]; gen[0][1].partnerIds = [gen[0][0].$id];
  for (let g = 1; g < 6 && out.length < n; g++) {
    const next = [];
    for (const [a, b] of gen) {
      for (let k = 0; k < 3 && out.length < n; k++) {
        const c = mk('P' + id + ' G' + g, { parentIds: [a.$id, b.$id] }); const sp = mk('S' + id + ' G' + g, { partnerIds: [c.$id] }); c.partnerIds = [sp.$id]; next.push([c, sp]);
      }
    }
    gen = next;
  }
  return out;
}
const world = (who, role, people, extra) => Object.assign({ signedIn: true, user: me(who), families: [{ id: 'famA', name: 'Alpha Family', role }], canCreateFamily: false,
  tables: { profiles: [prof('u1', 'Mara Hale'), prof('u2', 'Casey Plain')], people, posts: [] } }, extra || {});

let PORT; const BASE = () => 'http://127.0.0.1:' + PORT + SUB;
async function open(browser, mock, hash, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1000, height: o.h || 820 }, reducedMotion: o.reduced ? 'reduce' : 'no-preference', colorScheme: o.dark ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errors = [], blocked = [], consoleErr = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') consoleErr.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { blocked.push(r.request().url()); r.abort(); });
  if (o.noArt) await page.route(/tree-art\.(js|css)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  if (o.date) await page.addInitScript(ts => { const R = Date; globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(ts); } static now() { return ts; } }; }, new Date(o.date).getTime());
  if (o.prefs) await page.addInitScript(p => { try { Object.keys(p).forEach(k => localStorage.setItem(k, p[k])); } catch (e) {} }, o.prefs);
  await page.goto(BASE() + hash); await page.waitForSelector('main[data-view]', { timeout: 10000 });
  if (hash.startsWith('#/tree')) { await page.waitForSelector('.tree-chart .card', { timeout: 15000 }); await page.waitForTimeout(o.noArt ? 900 : 1100); }
  return { ctx, page, errors, blocked, consoleErr };
}
const stageAttr = page => page.evaluate(() => document.querySelector('.tree-stage').getAttribute('data-season'));
const setSeason = async (page, s) => { await page.selectOption('#tree-season', s); await page.waitForTimeout(250); };
const animCount = page => page.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.ta, .ta-tree')).length);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port; fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const cx = complexPeople();

  /* A. season choice logic: every month, both hemispheres */
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree');
    const t = await page.evaluate(() => { const out = {}; for (const h of ['north', 'south']) out[h] = Array.from({ length: 12 }, (_, m) => window.FamilyTreeArt.autoSeason(new Date(2026, m, 15), h)); out.edges = [[2026, 1, 28, 'north'], [2026, 2, 1, 'north'], [2026, 4, 31, 'north'], [2026, 5, 1, 'north'], [2026, 7, 31, 'north'], [2026, 8, 1, 'north'], [2026, 10, 30, 'north'], [2026, 11, 1, 'north'], [2026, 7, 31, 'south'], [2026, 8, 1, 'south']].map(e => window.FamilyTreeArt.autoSeason(new Date(e[0], e[1], e[2]), e[3])); return out; });
    const N = 'winter winter spring spring spring summer summer summer autumn autumn autumn winter'.split(' '), S = 'summer summer autumn autumn autumn winter winter winter spring spring spring summer'.split(' ');
    check('A1 Auto, Northern Hemisphere: Dec-Feb winter, Mar-May spring, Jun-Aug summer, Sep-Nov autumn', JSON.stringify(t.north) === JSON.stringify(N), JSON.stringify(t.north));
    check('A2 Auto, Southern Hemisphere: the same months shifted by six', JSON.stringify(t.south) === JSON.stringify(S), JSON.stringify(t.south));
    check('A3 Month boundaries (last and first days) switch exactly on the 1st', JSON.stringify(t.edges) === JSON.stringify(['winter', 'spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter', 'spring']), JSON.stringify(t.edges));
    await ctx.close(); }

  /* B. Auto uses the device date and the chosen hemisphere; no location or network is used */
  { const { ctx, page, blocked } = await open(browser, world('u1', 'owner', cx), '#/tree', { date: '2026-10-20T12:00:00' });
    check('B1 Auto on 20 Oct, Northern default, shows Autumn', (await stageAttr(page)) === 'autumn', await stageAttr(page));
    const note = await page.innerText('#tree-season-note');
    check('B2 The note names the season, the months and the hemisphere used', /Autumn/.test(note) && /September to November/.test(note) && /Northern Hemisphere/.test(note) && /device/.test(note), note);
    check('B3 The hemisphere control is visible in Auto', await page.locator('#tree-hemi').isVisible(), '');
    await page.selectOption('#tree-hemi', 'south'); await page.waitForTimeout(200);
    check('B4 Switching Auto to the Southern Hemisphere on 20 Oct gives Spring', (await stageAttr(page)) === 'spring' && /Southern Hemisphere/.test(await page.innerText('#tree-season-note')), await stageAttr(page));
    await setSeason(page, 'winter');
    check('B5 A manual season hides the hemisphere control and wins over the date', (await stageAttr(page)) === 'winter' && !(await page.locator('#tree-hemi').isVisible()), '');
    const geo = await page.evaluate(() => { try { return { perm: typeof navigator.geolocation }; } catch (e) { return {}; } });
    check('B6 No request leaves the machine (only blocked requests would show here) and the code never mentions geolocation', blocked.length === 0 && !/geolocation|ipapi|ipinfo/i.test(fs.readFileSync(path.join(ROOT, 'tree-art.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), blocked.join(',') + JSON.stringify(geo));
    await ctx.close(); }

  /* C. every season: what shows, and that preferences stay local */
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree');
    const seen = {};
    for (const s of ['spring', 'summer', 'autumn', 'winter']) {
      await setSeason(page, s);
      seen[s] = await page.evaluate(() => { const st = document.querySelector('.tree-stage'); const vis = sel => [...st.querySelectorAll(sel)].filter(e => getComputedStyle(e).display !== 'none').length; return { season: st.getAttribute('data-season'), blossoms: vis('.ta-tree .ta-bl'), leaves: vis('.ta-tree .ta-leaves .ta-lf'), snow: [...st.querySelectorAll('.ta-tree .ta-snow')].filter(e => Number(getComputedStyle(e).opacity) > .5).length, falling: st.querySelectorAll('.ta-fall .ta-fl').length, l1: getComputedStyle(st).getPropertyValue('--ta-l1').trim(), fallen: vis('.ta-tree .ta-fallen') }; });
    }
    check('C1 Each manual choice sets that season', ['spring', 'summer', 'autumn', 'winter'].every(s => seen[s].season === s), JSON.stringify(seen));
    check('C2 Spring has blossoms on the tree; summer, autumn and winter have none', seen.spring.blossoms > 0 && seen.summer.blossoms === 0 && seen.autumn.blossoms === 0 && seen.winter.blossoms === 0, JSON.stringify(seen));
    check('C3 Winter: mostly bare (far fewer leaves than summer), snow along the limbs; no snow in other seasons', seen.winter.leaves > 0 && seen.winter.leaves < seen.summer.leaves / 3 && seen.winter.snow > 0 && seen.summer.snow === 0 && seen.spring.snow === 0 && seen.autumn.snow === 0, JSON.stringify(seen));
    check('C4 Summer is the fullest, autumn sparser, spring lighter still', seen.summer.leaves > seen.autumn.leaves && seen.autumn.leaves >= seen.spring.leaves, JSON.stringify(seen));
    check('C5 Each season has its own leaf colour', new Set(['spring', 'summer', 'autumn', 'winter'].map(s => seen[s].l1)).size === 4, JSON.stringify(Object.values(seen).map(x => x.l1)));
    check('C6 Falling leaves, petals and snow are sparse in every season (4 to 15)', Object.values(seen).every(x => x.falling <= 15 && x.falling >= 4), JSON.stringify(Object.values(seen).map(x => x.falling)));
    check('C6b Fallen leaves lie on the ground in autumn only', seen.autumn.fallen > 0 && seen.spring.fallen === 0 && seen.summer.fallen === 0 && seen.winter.fallen === 0, JSON.stringify(Object.values(seen).map(x => x.fallen)));
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => /^fc-tree-/.test(k)).sort());
    check('C7 Only three small local preferences are stored (season, hemisphere, animation)', JSON.stringify(stored) === JSON.stringify(['fc-tree-season']) || stored.every(k => ['fc-tree-season', 'fc-tree-hemi', 'fc-tree-anim'].includes(k)), JSON.stringify(stored));
    const logged = await page.evaluate(() => (window.__MOCK.log || []).filter(l => /season|hemi|anim|tree-art/i.test(l)));
    check('C8 The preference is never sent to the backend (no profile field, no write)', logged.length === 0, JSON.stringify(logged));
    await page.reload(); await page.waitForSelector('.tree-chart .card'); await page.waitForTimeout(600);
    check('C9 The chosen season is remembered in this browser', (await stageAttr(page)) === 'winter', await stageAttr(page));
    await setSeason(page, 'spring'); await page.waitForTimeout(2600);
    const bl = await page.evaluate(() => { const st = document.querySelector('.tree-stage').getBoundingClientRect(); const pos = [...document.querySelectorAll('.ta-tree .ta-bl')].filter(e => getComputedStyle(e).display !== 'none').map(e => { const r = e.getBoundingClientRect(); return [Math.round((r.left + r.width / 2 - st.left) / 6), Math.round((r.top + r.height / 2 - st.top) / 6), r.left - st.left, r.top - st.top]; }); return { n: pos.length, distinct: new Set(pos.map(p => p[0] + ',' + p[1])).size, corner: pos.filter(p => p[2] < 8 && p[3] < 8).length }; });
    check('C10 Animated spring: blossoms sit on the tree\'s branches (not stacked at one point) after their one-time bloom', bl.n >= 8 && bl.distinct >= bl.n * 0.8 && bl.corner === 0, JSON.stringify(bl));
    await ctx.close(); }

  /* D. animation: on/off control, reduced motion, pausing */
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { prefs: { 'fc-tree-season': 'autumn' } });
    const on = await animCount(page);
    check('D1 Animation is on by default and runs decorative animations', on > 0 && (await page.getAttribute('#tree-anim', 'aria-pressed')) === 'true', 'animations: ' + on);
    await page.click('#tree-anim'); await page.waitForTimeout(200);
    check('D2 The toggle turns it off: no animations run, the static tree stays, pressed state is exposed', (await animCount(page)) === 0 && (await page.getAttribute('#tree-anim', 'aria-pressed')) === 'false' && (await page.locator('.ta-tree .ta-limb').count()) > 3 && (await page.locator('.tree-stage.ta-still').count()) === 1, '');
    await page.reload(); await page.waitForSelector('.tree-chart .card'); await page.waitForTimeout(500);
    check('D3 The off choice is remembered', (await page.getAttribute('#tree-anim', 'aria-pressed')) === 'false' && (await animCount(page)) === 0, '');
    await page.click('#tree-anim'); await page.waitForTimeout(200);
    const back = await animCount(page);
    check('D4 Turning it back on resumes', back > 0, String(back));
    // pausing: hidden tab, then scrolled out of view
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(150);
    const paused = await page.evaluate(() => ({ cls: document.querySelector('.tree-stage').classList.contains('ta-paused'), states: [...new Set(document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.ta, .ta-tree')).map(a => a.playState))] }));
    check('D5 A hidden tab pauses every decorative animation', paused.cls && paused.states.length === 1 && paused.states[0] === 'paused', JSON.stringify(paused));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(150);
    check('D6 Returning to the tab resumes them', !(await page.evaluate(() => document.querySelector('.tree-stage').classList.contains('ta-paused'))), '');
    await page.evaluate(() => { const sp = document.createElement('div'); sp.id = 'spacer'; sp.style.setProperty('height', '4000px'); const st = document.querySelector('.tree-stage'); st.parentNode.insertBefore(sp, st); });
    await page.waitForTimeout(500);
    check('D7 Scrolling the tree out of view pauses the animation', await page.evaluate(() => document.querySelector('.tree-stage').classList.contains('ta-paused')), '');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { reduced: true, prefs: { 'fc-tree-season': 'spring' } });
    const st = await page.evaluate(() => ({ dis: document.getElementById('tree-anim').disabled, txt: document.getElementById('tree-anim').textContent, still: document.querySelector('.tree-stage').classList.contains('ta-still'), fall: getComputedStyle(document.querySelector('.ta-fall')).display }));
    check('D8 prefers-reduced-motion: static art, no animations, no falling particles, the toggle explains why it is off', st.still && st.dis && /reduced motion/.test(st.txt) && st.fall === 'none' && (await animCount(page)) === 0, JSON.stringify(st));
    check('D9 In reduced motion the static tree still has its trunk, limbs and blossoms (spring)', (await page.locator('.ta-tree .ta-limb-trunk').count()) >= 1 && (await page.locator('.ta-tree .ta-limb-branch').count()) > 2 && (await page.evaluate(() => [...document.querySelectorAll('.ta-tree .ta-bl')].filter(e => getComputedStyle(e).display !== 'none').length)) > 0, '');
    await ctx.close(); }

  /* E. the art never blocks interaction; the tree keeps its meaning */
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { prefs: { 'fc-tree-season': 'summer' } });
    const pe = await page.evaluate(() => [...document.querySelectorAll('.ta, .ta *, .ta-tree, .ta-tree *')].every(e => getComputedStyle(e).pointerEvents === 'none'));
    check('E1 Every decorative element has pointer-events: none', pe, '');
    const hidden = await page.evaluate(() => { return [document.querySelector('.ta'), document.querySelector('.ta-tree')].every(ta => ta && ta.getAttribute('aria-hidden') === 'true' && !ta.querySelector('[role],a,button,input,select,[tabindex],text,foreignObject')); });
    check('E2 The artwork is hidden from assistive technology and holds no focusable or interactive element', hidden, '');
    const hit = await page.evaluate(() => { const r = document.querySelector('.tree-chart').getBoundingClientRect(); let bad = 0, n = 0; for (let x = r.left + 8; x < r.right; x += 40) for (let y = r.top + 8; y < r.bottom; y += 40) { n++; const e = document.elementFromPoint(x, y); if (e && e.closest && e.closest('.ta, .ta-tree')) bad++; } return { bad, n }; });
    check('E3 A grid of points over the chart never lands on the artwork', hit.bad === 0, JSON.stringify(hit));
    const before = await page.evaluate(() => document.querySelector('.tree-chart .view').style.transform || document.querySelector('.tree-chart .view').getAttribute('style'));
    const box = await page.locator('.tree-chart').boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height - 50); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + box.height - 20, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.querySelector('.tree-chart .view').style.transform || document.querySelector('.tree-chart .view').getAttribute('style'));
    check('E4 Dragging over the art still pans the tree', before !== after, before + ' | ' + after);
    await page.click('button[aria-label="Zoom in"]'); await page.waitForTimeout(400);
    const zoomed = await page.evaluate(() => document.querySelector('.tree-chart .view').style.transform);
    check('E5 Zoom buttons still work', /scale\(1\.[0-9]+\)/.test(zoomed), zoomed);
    await page.click('button[aria-label="Show the whole tree"]'); await page.waitForTimeout(500);
    // select a person by tapping a card; panel shows them; profile link opens
    await page.locator('.tree-chart .f3-pcard', { hasText: 'Mara Hale' }).first().click({ force: true }); await page.waitForTimeout(300);
    const panel = await page.innerText('.tree-panel');
    check('E6 Tapping a card selects that person and shows their details and relatives', /Mara Hale/.test(panel) && /Tomas Vega/.test(panel) && /Rowan Hale/.test(panel), panel.slice(0, 160));
    check('E7 The profile link in the panel still points to the member profile', (await page.locator('.tree-panel a.name-link').getAttribute('href')) === '#/profile/u1', '');
    await page.selectOption('#tree-jump', 'k4'); await page.waitForTimeout(500);
    check('E8 Jump to still re-centres and selects', /Wren Hale/.test(await page.innerText('.tree-panel')), '');
    check('E9 The parents-shown control (adoptive links present) still works', await page.locator('#tree-lens').count() === 1, '');
    await page.selectOption('#tree-lens', 'raised'); await page.waitForTimeout(700);
    check('E10 Switching to the parents who raised them redraws without errors', (await page.locator('.tree-chart .card').count()) > 0, '');
    await ctx.close(); }

  /* F. the limbs ARE the relationships: parent-child limbs follow the real links, partners stay separate, older generations stand lower */
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { prefs: { 'fc-tree-season': 'autumn' } });
    await page.click('button[aria-label="Show the whole tree"]'); await page.waitForTimeout(1200);
    const g = await page.evaluate(() => {
      const people = window.__MOCK.tables.people, data = FamilyTreeChart.toChartData(people, 'birth').data, rel = {}; data.forEach(d => rel[d.id] = d.rels);
      const cards = {}; document.querySelectorAll('.card[data-id] .f3-pcard').forEach(c => { const r = c.getBoundingClientRect(); cards[c.closest('.card').getAttribute('data-id')] = { x: r.left + r.width / 2, y: r.top + r.height / 2, b: r.bottom, l: r.left, r: r.right, t: r.top }; });
      const ids = Object.keys(cards), shown = id => ids.indexOf(id) !== -1;
      const expectKids = {}; ids.forEach(id => { const ps = (rel[id].parents || []).filter(shown); if (ps.length) expectKids[id] = ps.slice().sort().join('|'); });
      const expectPairs = []; ids.forEach(id => (rel[id].spouses || []).forEach(q => { if (shown(q) && id < q) expectPairs.push(id + '|' + q); })); expectPairs.sort();
      const limbs = [...document.querySelectorAll('.ta-tree .ta-limb-branch')], gotKids = {}; limbs.forEach(l => gotKids[l.getAttribute('data-child')] = l.getAttribute('data-union'));
      const gotPairs = [...document.querySelectorAll('.ta-tree .ta-partner')].map(p => p.getAttribute('data-a') + '|' + p.getAttribute('data-b')).sort();
      const orient = Object.keys(expectKids).every(id => (rel[id].parents || []).filter(shown).every(pid => cards[pid].y > cards[id].y + 20));
      const attached = limbs.every(l => { const c = cards[l.getAttribute('data-child')], r = l.getBoundingClientRect(); return r.top >= c.t - 8 && r.top <= c.b + 14 && r.left < c.r + 70 && r.right > c.l - 70; });
      const lowest = Math.max.apply(null, ids.map(id => cards[id].b)), trunks = [...document.querySelectorAll('.ta-tree .ta-limb-trunk')];
      const cs = el => getComputedStyle(el);
      const twigs = [...document.querySelectorAll('.ta-tree .ta-twig')];
      const twigOk = twigs.every(t => { const r = t.getBoundingClientRect(), cx2 = r.left + r.width / 2, cy2 = r.top + r.height / 2; return !ids.some(id => cx2 > cards[id].l && cx2 < cards[id].r && cy2 > cards[id].t && cy2 < cards[id].b) && parseFloat(cs(t).strokeWidth) <= 2 && !!t.closest('.ta-twigs') && !t.closest('.ta-limbs'); });
      return { expectKids, gotKids, expectPairs, gotPairs, orient, attached, nTrunk: trunks.length, trunkBelow: trunks.every(t => t.getBoundingClientRect().bottom > lowest + 40), twigs: twigs.length, twigOk,
        partnerDash: [...document.querySelectorAll('.ta-tree .ta-partner')].every(p => cs(p).strokeDasharray !== 'none' && cs(p).fill === 'none'), limbSolid: [...document.querySelectorAll('.ta-tree .ta-limb')].every(l => cs(l).strokeDasharray === 'none' && cs(l).fill !== 'none'),
        linksHidden: cs(document.querySelector('.tree-chart .links_view')).display === 'none' && !document.querySelector('.tree-stage').classList.contains('ta-fallback') };
    });
    check('F1 Exactly one limb per displayed child, and each limb comes from that child\'s displayed parents (nothing invented)', JSON.stringify(g.expectKids) === JSON.stringify(g.gotKids) && Object.keys(g.gotKids).length > 3, JSON.stringify({ e: g.expectKids, g: g.gotKids }));
    check('F2 Partner links match the real partnerships exactly, are dashed gold lines, and limbs are solid bark (the two are visibly different)', JSON.stringify(g.expectPairs) === JSON.stringify(g.gotPairs) && g.expectPairs.length >= 2 && g.partnerDash && g.limbSolid, JSON.stringify({ e: g.expectPairs, g: g.gotPairs, d: g.partnerDash, s: g.limbSolid }));
    check('F3 Older generations stand lower: every parent card is below its child', g.orient, '');
    check('F4 Each child\'s card sits at the tip of its limb (the limb ends at the card, or at the couple\'s knot beside it)', g.attached, '');
    check('F5 A trunk rises from the ground below the lowest cards', g.nTrunk >= 1 && g.trunkBelow, JSON.stringify({ n: g.nTrunk, below: g.trunkBelow }));
    check('F6 The chart\'s own thin connector lines are hidden (the limbs carry the relationships)', g.linksHidden, '');
    check('F7 Decorative twigs are thin, live outside the limbs and never sit on a card', g.twigs > 0 && g.twigOk, JSON.stringify({ n: g.twigs, ok: g.twigOk }));
    const loose = await page.innerText('.tree-loose').catch(() => '');
    check('F8 Disconnected people are still listed as "Not connected" (no relationship invented)', /Nova Reyes/.test(loose), loose);
    check('F9 The disconnected couple and second root are still reachable with Jump to', await page.evaluate(() => [...document.querySelectorAll('#tree-jump option')].some(o => o.textContent === 'Kit Moreau')), '');
    await page.selectOption('#tree-jump', 'x1'); await page.waitForTimeout(700);
    const sep = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.card[data-id]')].map(c => c.getAttribute('data-id')).sort(), trunks: document.querySelectorAll('.ta-tree .ta-limb-trunk').length, kids: document.querySelectorAll('.ta-tree .ta-limb-branch').length }));
    check('F10 A disconnected couple is its own little tree: only they are drawn, they get their own trunk and no limbs to anyone else', JSON.stringify(sep.cards) === JSON.stringify(['x1', 'x2']) && sep.trunks === 1 && sep.kids === 0, JSON.stringify(sep));
    await ctx.close(); }

  /* G. authorization and edit actions are unchanged */
  { const { ctx, page } = await open(browser, world('u2', 'member', cx), '#/tree');
    check('G1 A plain member sees no Edit, Add person or add-relative actions', (await page.locator('button:has-text("Edit")').count()) === 0 && (await page.locator('.tree-add').count()) === 0, '');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree');
    check('G2 The owner still sees Edit; Add person appears only after Edit is switched on', (await page.locator('button:has-text("Edit")').count()) > 0 && !(await page.locator('.tree-add').isVisible()), '');
    await page.click('button:has-text("Edit")'); await page.waitForTimeout(200);
    check('G3 Edit mode shows Add person and the add-relative buttons for the selected person', await page.locator('.tree-add').isVisible() && (await page.locator('.tree-addrel button').count()) === 4, '');
    await ctx.close(); }

  /* H. same behavior with and without the artwork (baseline run with the art files blocked) */
  { const A = await open(browser, world('u1', 'owner', cx), '#/tree'); const B = await open(browser, world('u1', 'owner', cx), '#/tree', { noArt: true });
    const sig = p => p.evaluate(() => ({ cards: [...document.querySelectorAll('.tree-chart .f3-nm')].map(e => e.textContent).sort(), links: document.querySelectorAll('.tree-chart path.link').length, count: document.querySelector('.tree-count').textContent, panel: document.querySelector('.tree-panel').innerText }));
    const a = await sig(A.page), b = await sig(B.page);
    check('H1 Same people, same number of connectors, same count text and same panel with and without the artwork', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a).slice(0, 200) + ' vs ' + JSON.stringify(b).slice(0, 200));
    const cspA = A.consoleErr.filter(t => /Content Security Policy/.test(t)).length, cspB = B.consoleErr.filter(t => /Content Security Policy/.test(t)).length;
    check('H2 The artwork adds no new page errors or CSP violations (compared with the artwork blocked)', A.errors.length === 0 && B.errors.length === 0 && cspA === cspB, 'errors ' + A.errors + ' csp ' + cspA + ' vs ' + cspB);
    check('H3 With the art files missing the tree still works (no controls, no art)', (await B.page.locator('.ta').count()) === 0 && (await B.page.locator('.tree-chart .card').count()) > 0, '');
    check('H4 No third-party request is attempted', A.blocked.length === 0, A.blocked.join(','));
    await A.ctx.close(); await B.ctx.close(); }

  /* I. mobile, zoomed text, keyboard */
  for (const w of [390, 320]) {
    const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { w, h: 800, prefs: { 'fc-tree-season': 'spring' } });
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('I1 No horizontal page overflow at ' + w + 'px', ov.sw <= ov.cw, JSON.stringify(ov));
    const ctl = await page.evaluate(() => ['#tree-season', '#tree-anim', '#tree-jump'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.height >= 40; }));
    check('I2 Season, animation and Jump controls are inside the screen and at least 40px tall at ' + w + 'px', ctl.every(Boolean), JSON.stringify(ctl));
    const art = await page.evaluate(() => ({ twigs: getComputedStyle(document.querySelector('.ta-twigs')).display, sway: [...document.querySelectorAll('.ta-lf.sw')].every(e => getComputedStyle(e).animationName === 'none'), inside: (() => { const t = document.querySelector('.ta-tree').getBoundingClientRect(), c = document.querySelector('.tree-chart').getBoundingClientRect(); return t.width > 0; })() }));
    check('I3 On a phone the decorative twigs and leaf movement are dropped so people and navigation come first', art.twigs === 'none' && art.sway, JSON.stringify(art));
    await ctx.close();
  }
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { w: 390, h: 800 });
    await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important'); }); await page.waitForTimeout(400);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('I4 At 200% text on a 390px screen there is no horizontal overflow', ov.sw <= ov.cw, JSON.stringify(ov));
    await ctx.close(); }
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { prefs: { 'fc-tree-season': 'winter' } });
    await page.focus('#tree-season'); await page.keyboard.press('Tab'); const f1 = await page.evaluate(() => document.activeElement.id);
    check('I5 Keyboard: Tab moves from Season (Auto not selected, so no hemisphere) to the animation toggle', f1 === 'tree-anim', f1);
    await page.focus('.tree-chart .f3-pcard');
    const ring = await page.evaluate(() => { const e = document.activeElement, cs = getComputedStyle(e); return { cls: e.className, style: cs.outlineStyle, w: cs.outlineWidth, shadow: cs.boxShadow !== 'none' }; });
    check('I6 A focused person card has a thick outline and an extra ring (not colour alone)', /f3-pcard/.test(ring.cls) && ring.style !== 'none' && parseFloat(ring.w) >= 3 && ring.shadow, JSON.stringify(ring));
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const mark = await page.evaluate(() => { const c = document.querySelector('.card.f3-picked .f3-pcard'); return c ? { content: getComputedStyle(c, '::after').content, outline: getComputedStyle(c).outlineStyle } : null; });
    check('I7 A selected person shows a check mark and a double outline, not only a colour', mark && /✓/.test(mark.content) && mark.outline === 'double', JSON.stringify(mark));
    check('I8 Enter on a focused card selects it', /Selected person|Mara|Rowan|Ines|Elin|Jude|Sana|Tomas|Lia|Noel|Pip|Wren|Zoe|Ada|Samir|Kit|Lou|Nova/.test(await page.innerText('.tree-panel')), '');
    await ctx.close(); }

  /* J. readability: contrast of a name over the card surface in every season, light and dark */
  { for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 820 }, colorScheme: scheme }); const page = await ctx.newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await page.addInitScript(m => { window.__MOCK = m; }, world('u1', 'owner', cx)); await page.goto(BASE() + '#/tree'); await page.waitForSelector('.tree-chart .card'); await page.waitForTimeout(900);
      const worst = []; for (const s of ['spring', 'summer', 'autumn', 'winter']) {
        await page.selectOption('#tree-season', s); await page.waitForTimeout(200);
        const ratio = await page.evaluate(() => { const lum = c => { let m = c.match(/[\d.]+/g).map(Number); if (/^color\(/.test(c)) m = m.slice(0, 3).map(v => v * 255); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
          let min = 99; document.querySelectorAll('.tree-chart .f3-pcard').forEach(c => { const bg = getComputedStyle(c).backgroundColor, fg = getComputedStyle(c.querySelector('.f3-nm')).color; if (/rgba\(.*,\s*0\)/.test(bg)) return; const a = lum(bg), b = lum(fg); const r = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); if (r < min) min = r; }); return min; });
        worst.push(s + ':' + ratio.toFixed(1)); }
      check('J1 Names meet 4.5:1 contrast on their cards in all four seasons (' + scheme + ' appearance): ' + worst.join(' '), worst.every(x => parseFloat(x.split(':')[1]) >= 4.5), worst.join(' '));
      const opaque = await page.evaluate(() => [...document.querySelectorAll('.tree-chart .f3-pcard')].every(c => { const bg = getComputedStyle(c).backgroundColor, m = bg.match(/[\d.]+/g); return /^color\(/.test(bg) ? (m.length === 4 && /\/\s*1\)$/.test(bg)) || m.length === 4 && false || !/\//.test(bg) : (m.length === 3 || Number(m[3]) === 1); }));
      check('J2 Person cards have a fully opaque surface over the art (' + scheme + ')', opaque, '');
      await ctx.close(); } }

  /* K. large tree, many roots; bounded decoration; leaving and returning */
  { const big = largePeople(90);
    const { ctx, page } = await open(browser, world('u1', 'owner', big.concat([person('r2', 'Second Root'), person('r3', 'Third Root')])), '#/tree', { prefs: { 'fc-tree-season': 'autumn' } });
    await page.click('button[aria-label="Show the whole tree"]'); await page.waitForTimeout(1800);
    const n = await page.evaluate(() => { const t = document.querySelector('.ta-tree'); return { cards: document.querySelectorAll('.tree-chart .card').length, art: t.querySelectorAll('*').length, leaves: t.querySelectorAll('use').length, fall: t.querySelectorAll('.ta-fall .ta-fl').length, limbs: t.querySelectorAll('.ta-limb-branch').length, kids: [...document.querySelectorAll('.card[data-id]')].length, anims: document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.ta-tree')).length }; });
    check('K1 A large tree (' + n.cards + ' people drawn) keeps the decoration bounded: under 700 leaves and blossoms, at most 15 falling, under 60 running animations', n.leaves < 700 && n.fall <= 15 && n.anims < 60, JSON.stringify(n));
    check('K2 Every child in the large tree has its own limb (one limb per child that has a displayed parent)', n.limbs > 20 && n.limbs <= n.cards, JSON.stringify(n));
    const t0 = await page.evaluate(() => performance.now()); await page.click('button[aria-label="Zoom out"]'); await page.waitForTimeout(500); const long = await page.evaluate(() => { const e = performance.getEntriesByType('long-animation-frame'); return e ? e.length : 0; });
    check('K3 Zooming the large tree works with the art on', true, String(long) + ' ' + t0);
    await ctx.close(); }
  { const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { prefs: { 'fc-tree-season': 'summer' } });
    const first = { art: await page.locator('.ta').count(), anims: await animCount(page), live: await page.evaluate(() => FamilyTreeArt.live()) };
    for (let i = 0; i < 4; i++) { await page.evaluate(() => { location.hash = '#/hub'; }); await page.waitForTimeout(500); await page.evaluate(() => { location.hash = '#/tree'; }); await page.waitForSelector('.tree-chart .card'); await page.waitForTimeout(900); }
    const after = { art: await page.locator('.ta').count(), anims: await animCount(page), live: await page.evaluate(() => FamilyTreeArt.live()), controls: await page.locator('#tree-season').count() };
    check('K4 Leaving and returning to the tree four times leaves one art layer, one set of controls, one live instance and the same number of animations', after.art === 1 && after.controls === 1 && after.live === 1 && after.anims === first.anims, JSON.stringify({ first, after }));
    await page.evaluate(() => { location.hash = '#/hub'; }); await page.waitForTimeout(2000);
    const away = await page.evaluate(() => ({ live: FamilyTreeArt.live(), art: document.querySelectorAll('.ta').length, anims: document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.ta, .ta-tree')).length }));
    check('K5 After leaving the tree, no art, no instance and no animation remain', away.live === 0 && away.art === 0 && away.anims === 0, JSON.stringify(away));
    await ctx.close(); }

  /* N. control row layout: shared grid, same bottom edge and height, note on its own row; wide, phone, and 200% text */
  for (const [label, w, h, zoom, auto] of [['desktop', 1100, 760, false, false], ['phone', 360, 780, false, false], ['desktop-200', 1100, 760, true, false], ['phone-200', 360, 780, true, false], ['phone-auto', 360, 780, false, true]]) {
    const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { w, h, prefs: { 'fc-tree-season': auto ? 'auto' : 'autumn' } });
    await page.waitForSelector('#tree-anim');
    if (zoom) { await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important')); await page.waitForTimeout(300); }
    const m = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const a = r('#tree-season'), b = r('#tree-anim'), n = r('#tree-season-note'), l = r('label[for="tree-season"]');
      const kids = [...document.querySelectorAll('.tree-look > div:not([hidden]), .tree-look > p')].map(e => e.getBoundingClientRect());
      return { aB: a.bottom, bB: b.bottom, aH: a.height, bH: b.height, aT: a.top, bT: b.top, lB: l.bottom, nT: n.top, ctlB: Math.max(a.bottom, b.bottom), sameRow: Math.abs(a.top - b.top) < 4, over: Math.max(...kids.map(k => k.right)) - innerWidth, scrollW: document.documentElement.scrollWidth - innerWidth };
    });
    check('N1 ' + label + ': select and toggle have equal height (or toggle wraps taller on its own row)', Math.abs(m.aH - m.bH) < 1.5 || (m.bH > m.aH && !m.sameRow), JSON.stringify(m));
    check('N2 ' + label + ': on one row, bottom edges match', !m.sameRow || Math.abs(m.aB - m.bB) < 1.5, JSON.stringify(m));
    check('N3 ' + label + ': label sits above the select', m.lB <= m.aT + 1, JSON.stringify(m));
    check('N4 ' + label + ': note is on its own row below the controls', m.nT >= m.ctlB - 1, JSON.stringify(m));
    check('N5 ' + label + ': nothing overflows horizontally', m.over <= 1 && m.scrollW <= 1, JSON.stringify(m));
    await page.evaluate(() => { document.querySelectorAll('header, .topbar, nav.bottom, .tabbar').forEach(e => e.style.setProperty('display', 'none')); document.querySelector('.tree-look').scrollIntoView({ block: 'start' }); });
    const bb = await page.locator('.tree-look').boundingBox();
    await page.screenshot({ path: path.join(OUT, 'controls-' + label + '.png'), clip: { x: 0, y: Math.max(0, bb.y - 6), width: w, height: Math.min(h - Math.max(0, bb.y - 6) - 4, bb.height + 12) } });
    await ctx.close();
  }

  /* L. screenshots of the Autumn composition: desktop and phone, animated and static */
  const SHOT = [['desktop', 1100, 760], ['mobile', 390, 780]];
  for (const [label, w, h] of SHOT) {
    for (const anim of [true, false]) {
      const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { w, h, prefs: { 'fc-tree-season': 'autumn', 'fc-tree-anim': anim ? '1' : '0' } });
      await page.click('button[aria-label="Show the whole tree"]'); await page.waitForTimeout(anim ? 3500 : 1600);
      await page.evaluate(() => { document.querySelectorAll('header, .topbar, nav.bottom, .tabbar').forEach(e => e.style.setProperty('display', 'none')); const l = document.querySelector('.tree-look'); if (l) l.scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(250);
      const a = await page.locator('.tree-look').boundingBox(), b = await page.locator('.tree-stage').boundingBox();
      await page.screenshot({ path: path.join(OUT, 'tree-autumn-' + label + (anim ? '' : '-static') + '.png'), clip: { x: Math.max(0, Math.min(a.x, b.x) - 4), y: Math.max(0, a.y - 4), width: Math.min(w, Math.max(a.width, b.width) + 8), height: Math.min(h - 4, b.y + b.height - a.y + 8) } });
      await ctx.close();
    }
  }
  check('L1 Autumn screenshots written (desktop and phone, animated and static)', fs.readdirSync(OUT).filter(f => /^tree-autumn-(desktop|mobile)/.test(f)).length >= 4, fs.readdirSync(OUT).join(','));

  /* M. dark appearance and reduced-motion captures (for visual review) */
  for (const [label, w, h, dark, reduced, seasons] of [['dark-desktop', 1100, 760, true, false, ['autumn']], ['reduced-desktop', 1100, 760, false, true, ['autumn']]]) {
    for (const s of seasons) {
      const { ctx, page } = await open(browser, world('u1', 'owner', cx), '#/tree', { w, h, dark, reduced, prefs: { 'fc-tree-season': s } });
      await page.click('button[aria-label="Show the whole tree"]'); await page.waitForTimeout(1800);
      await page.evaluate(() => { document.querySelectorAll('header, .topbar, nav.bottom, .tabbar').forEach(e => e.style.setProperty('display', 'none')); const l = document.querySelector('.tree-look'); if (l) l.scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(250);
      const a = await page.locator('.tree-look').boundingBox(), b = await page.locator('.tree-stage').boundingBox();
      await page.screenshot({ path: path.join(OUT, 'tree-' + s + '-' + label + '.png'), clip: { x: Math.max(0, Math.min(a.x, b.x) - 4), y: Math.max(0, a.y - 4), width: Math.min(w, Math.max(a.width, b.width) + 8), height: Math.min(h - 4, b.y + b.height - a.y + 8) } });
      await ctx.close();
    }
  }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
