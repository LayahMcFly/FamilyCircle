import test from 'node:test';
import assert from 'node:assert/strict';
import { etsyListingId, fetchEtsyPicture, makeEtsyCache, ETSY_TTL_MS, ETSY_NOTICE } from '../src/etsy.js';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 2)]);
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('etsyListingId: normal listing links only (any language prefix, query strings, www or not); everything else is empty', () => {
  assert.equal(etsyListingId('https://www.etsy.com/listing/1426958759/personalized-name-necklace-14k-solid'), '1426958759');
  assert.equal(etsyListingId('https://etsy.com/listing/1426958759'), '1426958759');
  assert.equal(etsyListingId('https://www.etsy.com/uk/listing/1426958759/x?ref=shop_home'), '1426958759');
  assert.equal(etsyListingId('https://www.etsy.com/ca-fr/listing/1426958759/x'), '1426958759');
  for (const no of ['https://www.etsy.com/shop/Someone', 'https://evil.com/listing/1426958759', 'https://etsy.com.evil.com/listing/1426958759', 'https://www.etsy.com/listing/12/x', 'not a url', '', 'https://etsy.me/abc']) assert.equal(etsyListingId(no), '', no);
});

test('fetchEtsyPicture: asks the listing-images call with the key header, takes the first picture by rank, and downloads only from etsystatic.com', async () => {
  const seen = [];
  const deps = {
    lookup,
    getApi: async (host, path, headers) => { seen.push([host, path, headers['x-api-key']]); return { status: 200, body: JSON.stringify({ count: 2, results: [{ rank: 2, url_170x135: 'https://i.etsystatic.com/b.jpg' }, { rank: 1, url_170x135: 'https://i.etsystatic.com/a-170.jpg', url_570xN: 'https://i.etsystatic.com/a-570.jpg' }] }) }; },
    get: async (t) => { seen.push([t.host, t.url.pathname]); return { status: 200, headers: {}, body: jpeg }; }
  };
  const small = await fetchEtsyPicture('1426958759', 'thumb', 'key:secret', deps);
  assert.equal(small.mime, 'image/jpeg');
  assert.deepEqual(seen[0], ['openapi.etsy.com', '/v3/application/listings/1426958759/images', 'key:secret']);
  assert.deepEqual(seen[1], ['i.etsystatic.com', '/a-170.jpg']);
  await fetchEtsyPicture('1426958759', 'full', 'key:secret', deps);
  assert.deepEqual(seen[3], ['i.etsystatic.com', '/a-570.jpg']);
});

test('fetchEtsyPicture: no key, a refused key, rate limits, empty listings, other hosts and non-pictures are plain errors', async () => {
  const api = (status, body = '{}') => ({ lookup, getApi: async () => ({ status, body }), get: async () => ({ status: 200, headers: {}, body: jpeg }) });
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', '', api(200)), (e) => e.linkPicture && e.kind === 'off');
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', api(403)), (e) => e.kind === 'off');
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', api(429)), (e) => e.kind === 'slow');
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', api(404)), (e) => e.linkPicture);
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', api(200, '{"results":[]}')), (e) => e.linkPicture);
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', api(200, 'not json')), (e) => e.linkPicture);
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', api(200, JSON.stringify({ results: [{ rank: 1, url_170x135: 'https://evil.example/a.jpg' }] }))), (e) => e.linkPicture);
  await assert.rejects(fetchEtsyPicture('1426958759', 'thumb', 'k:s', { ...api(200, JSON.stringify({ results: [{ rank: 1, url_170x135: 'https://i.etsystatic.com/a.jpg' }] })), get: async () => ({ status: 200, headers: {}, body: Buffer.from('<html>') }) }), (e) => e.linkPicture);
});

test('the memory cache keeps an entry for under 5 hours and never longer', () => {
  let t = 1000; const c = makeEtsyCache(() => t);
  c.set('a', 1); assert.equal(c.get('a'), 1);
  t += ETSY_TTL_MS - 1; assert.equal(c.get('a'), 1);
  t += 2; assert.equal(c.get('a'), null);
  assert.ok(ETSY_TTL_MS < 6 * 3600 * 1000);
  assert.match(ETSY_NOTICE, /trademark of Etsy, Inc\..*not endorsed or certified by Etsy/);
});
