/*
 * Link pictures for Giving Center wishlists. Runs only when a person taps "Get a picture from the link" on an item.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 *
 * What it does: opens the shop page the person typed, looks for its preview picture (the "og:image" a shop publishes for sharing),
 * downloads that one picture, and hands it back. The app then makes it smaller exactly as it does for an uploaded photo.
 *
 * Safety rules (this is a server visiting addresses a person typed, so it is locked down):
 *  - https only, port 443 only, no passwords in the link.
 *  - The name is looked up first and refused if ANY answer is a private, loopback, link-local, carrier-grade, multicast or reserved address
 *    (this blocks the cloud metadata address and anything inside the network). The connection is then pinned to the checked address,
 *    so the name cannot be switched to a private address between the check and the visit.
 *  - Every redirect (at most 3) and the picture address are checked the same way.
 *  - Short time limit, page capped at 600 KB read, picture capped at 1.5 MB, and only real JPEG, PNG, WebP or GIF bytes are accepted
 *    (never SVG, never HTML, whatever the server claims).
 *  - Nothing is stored here and nothing about the family is sent to the shop: only a plain GET with a generic browser-style header.
 */
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

export const LINK_LIMITS = { pageBytes: 600000, imageBytes: 1500000, redirects: 3, timeoutMs: 4000 };

/** True for any address that must never be visited. */
export function blockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 88);
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return blockedAddress(mapped[1]);
    if (v === '::' || v === '::1') return true;
    const first = parseInt(v.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || first === 0x2001 && /^2001:0?db8/.test(v);
  }
  return true;
}

const fail = (why) => Object.assign(new Error(why), { linkPicture: true });

/** Checks a link and returns { url, host, ip, family }. Throws on anything not allowed. */
export async function vet(rawUrl, lookup = dns.lookup) {
  let u;
  try { u = new URL(rawUrl); } catch (e) { throw fail('bad link'); }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw fail('link not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || net.isIP(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) throw fail('link not allowed');
  const answers = await lookup(host, { all: true, verbatim: true });
  if (!answers.length || answers.some((a) => blockedAddress(a.address))) throw fail('address not allowed');
  return { url: u, host, ip: answers[0].address, family: answers[0].family };
}

function get(target, { maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: 'https:', hostname: target.host, port: 443, path: target.url.pathname + target.url.search, method: 'GET',
      servername: target.host, timeout: LINK_LIMITS.timeoutMs,
      lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address: target.ip, family: target.family }]) : cb(null, target.ip, target.family)),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FamilyCircle/1.0; +link-picture)', Accept: accept, 'Accept-Encoding': 'identity', Host: target.url.host }
    }, (res) => {
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { chunks.push(c.subarray(0, c.length - (n - maxBytes))); res.destroy(); } else chunks.push(c); });
      const end = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      res.on('end', end); res.on('close', end); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(fail('timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Follows up to three redirects, vetting every hop. */
async function fetchVetted(rawUrl, opts, deps) {
  let cur = rawUrl;
  for (let hop = 0; hop <= LINK_LIMITS.redirects; hop++) {
    const target = await vet(cur, deps.lookup);
    const res = await deps.get(target, opts);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) { cur = new URL(res.headers.location, target.url).href; continue; }
    if (res.status !== 200) throw fail('page answered ' + res.status);
    return { ...res, finalUrl: target.url.href };
  }
  throw fail('too many redirects');
}

/** The kind of picture, from its first bytes (never from what the server says). */
export function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length > 6 && /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  return '';
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

/** The shop's own preview picture address from a page's <head>: og:image, twitter:image, or link rel=image_src. */
export function findPictureUrl(html, base) {
  const head = html.slice(0, 600000);
  const metas = head.match(/<meta\b[^>]*>/gi) || [];
  const want = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'];
  const found = new Map();
  for (const m of metas) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(m);
    const val = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(m);
    if (key && val) found.set(key[1].toLowerCase(), decode(val[1] !== undefined ? val[1] : val[2]).trim());
  }
  let pick = want.map((k) => found.get(k)).find(Boolean);
  if (!pick) { const l = /<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(head); if (l) pick = decode(l[1]); }
  if (!pick) return '';
  try { return new URL(pick, base).href; } catch (e) { return ''; }
}

/** Returns { mime, bytes } or throws an Error with .linkPicture = true. `deps` exist so tests can run without the internet. */
export async function fetchLinkPicture(rawUrl, deps = { lookup: dns.lookup, get }) {
  const page = await fetchVetted(rawUrl, { maxBytes: LINK_LIMITS.pageBytes, accept: 'text/html,application/xhtml+xml,image/*;q=0.8' }, deps);
  let bytes = page.body, mime = sniffImage(bytes);
  if (mime && bytes.length >= LINK_LIMITS.pageBytes) throw fail('picture too large');
  if (!mime) {
    const pic = findPictureUrl(page.body.toString('utf8'), page.finalUrl);
    if (!pic) throw fail('no picture on the page');
    const img = await fetchVetted(pic, { maxBytes: LINK_LIMITS.imageBytes, accept: 'image/jpeg,image/png,image/webp,image/gif,image/*;q=0.5' }, deps);
    bytes = img.body; mime = sniffImage(bytes);
  }
  if (!mime) throw fail('not a usable picture');
  if (bytes.length >= LINK_LIMITS.imageBytes) throw fail('picture too large');
  return { mime, bytes };
}
