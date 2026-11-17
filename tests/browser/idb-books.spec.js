/* The cookbook reader used by My Cookbooks: reads saved cookbooks without creating anything when none exist. Real Chrome, real IndexedDB. */
const { chromium } = require('playwright-core'); const fs = require('fs');
const src = fs.readFileSync(require('path').resolve(__dirname, '../../app.js'), 'utf8');
const m = /function books\(\) \{[\s\S]*?\n    \}\n/.exec(src); if (!m) { console.log('FAIL could not find books() in app.js'); process.exit(1); }
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }), p = await (await b.newContext()).newPage();
  await p.goto('about:blank'); await p.goto('http://127.0.0.1:9/').catch(() => {});
  const ctxPage = await (await b.newContext()).newPage(); await ctxPage.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<html></html>' })); await ctxPage.goto('http://example.test/');
  const res = await ctxPage.evaluate(async (code) => {
    const S = { user: { $id: 'u1' } }; const books = new Function('S', code + '; return books;')(S);
    const empty = await books(); const dbs1 = (await indexedDB.databases()).map(d => d.name);
    await new Promise((ok, no) => { const r = indexedDB.open('fcrb_cookbooks_u1', 1); r.onupgradeneeded = () => { r.result.createObjectStore('books', { keyPath: 'id' }); r.result.createObjectStore('meta', { keyPath: 'id' }); }; r.onsuccess = () => { const t = r.result.transaction('books', 'readwrite'); t.objectStore('books').put({ id: 'a', name: 'Old', updated: 1 }); t.objectStore('books').put({ id: 'b', name: 'New', updated: 2 }); t.oncomplete = () => { r.result.close(); ok(); }; }; r.onerror = no; });
    const got = await books(); return { empty, dbs1, names: got.map(x => x.name) };
  }, m[0]);
  const ok = res.empty.length === 0 && !res.dbs1.includes('fcrb_cookbooks_u1') && JSON.stringify(res.names) === '["New","Old"]';
  console.log((ok ? 'PASS' : 'FAIL') + ' reads saved cookbooks newest first, and creates nothing when there are none ' + JSON.stringify(res)); await b.close(); process.exit(ok ? 0 : 1);
})();
