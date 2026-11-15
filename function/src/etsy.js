/*
 * Etsy listing pictures through Etsy's own free Open API (a personal app key), used for wishlist items whose link is an Etsy listing.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 *
 * Etsy's API terms shape this design:
 *  - Pictures are NOT copied into Family Circle's storage. They are fetched when a list is viewed, kept only in this function's memory for
 *    up to 5 hours (Etsy asks that listing content is never shown more than 6 hours out of date), and then dropped.
 *  - The Etsy trademark notice is shown in the app wherever an Etsy picture appears.
 *  - Only the public listing-images call is used, with the app key in the x-api-key header (format keystring:sharedsecret). Nothing about the family is sent.
 *  - Only addresses on etsystatic.com are downloaded as pictures.
 * Needs the function variable ETSY_API_KEY. Without it, Etsy links simply keep the placeholder tile.
 */
import { vet, sniffImage, LINK_LIMITS } from './link-picture.js';
import https from 'node:https';

export const ETSY_NOTICE = "The term 'Etsy' is a trademark of Etsy, Inc. This application uses Etsy's API but is not endorsed or certified by Etsy.";
export const ETSY_TTL_MS = 5 * 3600 * 1000;

/** The listing number from a normal Etsy listing link (any country site, with or without a language part), or ''. */
export function etsyListingId(raw) {
  let u; try { u = new URL(raw); } catch (e) { return ''; }
  if (!/^(www\.)?etsy\.com$/i.test(u.hostname)) return '';
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d{5,14})(?:\/|$)/i.exec(u.pathname);
  return m ? m[1] : '';
}

function getJson(host, path, apiKey, deps) {
  return deps.getApi(host, path, { 'x-api-key': apiKey, Accept: 'application/json' });
}

function realGetApi(host, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, port: 443, path, method: 'GET', headers, timeout: LINK_LIMITS.timeoutMs }, (res) => {
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n <= 200000) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function realGetImage(url, deps) {
  const target = await vet(url, deps.lookup);
  if (!/(^|\.)etsystatic\.com$/i.test(target.host)) throw Object.assign(new Error('not an Etsy picture host'), { linkPicture: true });
  return deps.get(target, { maxBytes: LINK_LIMITS.imageBytes, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.5' });
}

/** { mime, bytes } for the listing's first picture. size: 'thumb' (about 170 px) or 'full' (about 570 px). */
export async function fetchEtsyPicture(listingId, size, apiKey, deps) {
  const fail = (why, kind = 'none') => Object.assign(new Error(why), { linkPicture: true, kind });
  if (!apiKey) throw fail('etsy not set up', 'off');
  const res = await getJson('openapi.etsy.com', '/v3/application/listings/' + encodeURIComponent(listingId) + '/images', apiKey, deps);
  if (res.status === 403 || res.status === 401) throw fail('etsy key not accepted', 'off');
  if (res.status === 429) throw fail('etsy asked us to slow down', 'slow');
  if (res.status !== 200) throw fail('etsy answered ' + res.status);
  let data; try { data = JSON.parse(res.body); } catch (e) { throw fail('etsy answer unreadable'); }
  const list = Array.isArray(data && data.results) ? data.results.slice().sort((a, b) => (a.rank || 0) - (b.rank || 0)) : [];
  const first = list[0];
  const url = first && (size === 'full' ? (first.url_570xN || first.url_fullxfull) : (first.url_170x135 || first.url_75x75 || first.url_570xN));
  if (!url) throw fail('listing has no picture');
  const img = await realGetImage(url, deps);
  if (img.status !== 200) throw fail('picture answered ' + img.status);
  const mime = sniffImage(img.body);
  if (!mime || img.body.length >= LINK_LIMITS.imageBytes) throw fail('not a usable picture');
  return { mime, bytes: img.body };
}

/** The little memory cache: key -> { at, value }. Entries older than 5 hours are never used. */
export function makeEtsyCache(now, max = 300) {
  const m = new Map();
  return {
    get(k) { const e = m.get(k); if (!e) return null; if (now() - e.at >= ETSY_TTL_MS) { m.delete(k); return null; } return e.value; },
    set(k, v) { m.set(k, { at: now(), value: v }); if (m.size > max) m.delete(m.keys().next().value); }
  };
}

export { realGetApi };
