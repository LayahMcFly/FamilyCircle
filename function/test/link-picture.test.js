import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedAddress, vet, sniffImage, findPictureUrl, fetchLinkPicture, LINK_LIMITS } from '../src/link-picture.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const lookupOf = (map) => async (host) => { if (!map[host]) throw new Error('ENOTFOUND'); return [].concat(map[host]).map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })); };
const page = (html) => ({ status: 200, headers: {}, body: Buffer.from(html) });

test('blocked addresses: private, loopback, link-local, metadata, carrier-grade, multicast and mapped forms are refused; ordinary ones pass', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'ff02::1', 'not-an-ip']) assert.equal(blockedAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(blockedAddress(ip), false, ip);
});

test('vet: https only, no passwords or odd ports, no IP literals or local names, and refuses a name with any private answer', async () => {
  const lookup = lookupOf({ 'shop.example': '93.184.216.34', 'evil.example': ['93.184.216.34', '10.0.0.5'], 'meta.example': '169.254.169.254' });
  assert.equal((await vet('http://shop.example/a', lookup)).url.protocol, 'https:');   // http is upgraded
  for (const bad of ['ftp://shop.example/', 'https://u:p@shop.example/', 'https://shop.example:8443/', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://printer.local/', 'https://intranet/', 'https://evil.example/', 'https://meta.example/', 'https://missing.example/', 'not a url'])
    await assert.rejects(vet(bad, lookup), undefined, bad);
});

test('sniffImage trusts bytes, not claims; SVG and HTML are never pictures', () => {
  assert.equal(sniffImage(png), 'image/png');
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(Buffer.from('GIF89a....')), 'image/gif');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), '');
  assert.equal(sniffImage(Buffer.from('<html><body>hi</body></html>')), '');
});

test('findPictureUrl: og:image in either attribute order and quote style, twitter fallback, relative paths, entities', () => {
  assert.equal(findPictureUrl('<meta property="og:image" content="https://cdn.example/a.jpg">', 'https://shop.example/p'), 'https://cdn.example/a.jpg');
  assert.equal(findPictureUrl("<meta content='/img/b.png' property='og:image'>", 'https://shop.example/p/1'), 'https://shop.example/img/b.png');
  assert.equal(findPictureUrl('<meta name="twitter:image" content="https://cdn.example/t.webp?a=1&amp;b=2">', 'https://shop.example/'), 'https://cdn.example/t.webp?a=1&b=2');
  assert.equal(findPictureUrl('<link rel="image_src" href="https://cdn.example/l.gif">', 'https://shop.example/'), 'https://cdn.example/l.gif');
  assert.equal(findPictureUrl('<html><head><title>x</title></head></html>', 'https://shop.example/'), '');
});

test('fetchLinkPicture: page then picture, a link that is itself a picture, redirects vetted, and every failure is a plain linkPicture error', async () => {
  const lookup = lookupOf({ 'shop.example': '93.184.216.34', 'cdn.example': '93.184.217.1', 'evil.example': '10.0.0.9' });
  const seen = [];
  const get = async (t) => {
    seen.push(t.host + t.url.pathname);
    if (t.url.pathname === '/item') return page('<head><meta property="og:image" content="https://cdn.example/a.png"></head>');
    if (t.url.pathname === '/a.png') return { status: 200, headers: {}, body: png };
    if (t.url.pathname === '/direct.png') return { status: 200, headers: {}, body: png };
    if (t.url.pathname === '/hop') return { status: 302, headers: { location: '/item' }, body: Buffer.alloc(0) };
    if (t.url.pathname === '/toevil') return { status: 302, headers: { location: 'https://evil.example/x' }, body: Buffer.alloc(0) };
    if (t.url.pathname === '/loop') return { status: 302, headers: { location: '/loop' }, body: Buffer.alloc(0) };
    if (t.url.pathname === '/nopic') return page('<head></head>');
    if (t.url.pathname === '/notimg') return page('<head><meta property="og:image" content="https://cdn.example/x.svg"></head>');
    if (t.url.pathname === '/x.svg') return { status: 200, headers: {}, body: Buffer.from('<svg/>') };
    if (t.url.pathname === '/huge') return { status: 200, headers: {}, body: Buffer.concat([png, Buffer.alloc(LINK_LIMITS.pageBytes, 1)]) };
    return { status: 404, headers: {}, body: Buffer.alloc(0) };
  };
  const deps = { lookup, get };
  const ok = await fetchLinkPicture('https://shop.example/item', deps);
  assert.equal(ok.mime, 'image/png'); assert.deepEqual(seen, ['shop.example/item', 'cdn.example/a.png']);
  assert.equal((await fetchLinkPicture('https://shop.example/direct.png', deps)).mime, 'image/png');
  assert.equal((await fetchLinkPicture('https://shop.example/hop', deps)).mime, 'image/png');   // a redirect is followed
  for (const p of ['/toevil', '/loop', '/nopic', '/notimg', '/huge', '/missing']) await assert.rejects(fetchLinkPicture('https://shop.example' + p, deps), (e) => e.linkPicture === true, p);
  const before = seen.length;
  await assert.rejects(fetchLinkPicture('https://evil.example/item', deps), (e) => e.linkPicture === true);
  assert.equal(seen.length, before, 'a private address is never even requested');
});

test('findPictureUrl also reads schema.org Product data and the main product image tag', () => {
  assert.equal(findPictureUrl('<script type="application/ld+json">{"@graph":[{"@type":"Product","image":["https://cdn.example/p1.jpg","https://cdn.example/p2.jpg"]}]}</script>', 'https://shop.example/'), 'https://cdn.example/p1.jpg');
  assert.equal(findPictureUrl('<script type="application/ld+json">{"@type":"Product","image":{"url":"https://cdn.example/o.png"}}</script>', 'https://shop.example/'), 'https://cdn.example/o.png');
  assert.equal(findPictureUrl('<img id="landingImage" src="data:image/gif;base64,xx" data-old-hires="https://m.example/I/big.jpg">', 'https://shop.example/'), 'https://m.example/I/big.jpg');
  assert.equal(findPictureUrl('<img id="landingImage" data-a-dynamic-image="{&quot;https://m.example/I/a._SX300_.jpg&quot;:[300,300]}" src="data:x">', 'https://shop.example/'), 'https://m.example/I/a._SX300_.jpg');
});

test('fetchLinkPicture tells a shop that refuses or shows a robot check apart from a page with no picture', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const mk = (status, html) => ({ lookup, get: async () => ({ status, headers: {}, body: Buffer.from(html) }) });
  await assert.rejects(fetchLinkPicture('https://shop.example/a', mk(503, '')), (e) => e.linkPicture && e.kind === 'blocked');
  await assert.rejects(fetchLinkPicture('https://shop.example/a', mk(403, '')), (e) => e.kind === 'blocked');
  await assert.rejects(fetchLinkPicture('https://shop.example/a', mk(200, '<html>Enter the characters you see below</html>')), (e) => e.kind === 'blocked');
  await assert.rejects(fetchLinkPicture('https://shop.example/a', mk(200, '<html><head></head></html>')), (e) => e.kind === 'none');
});
