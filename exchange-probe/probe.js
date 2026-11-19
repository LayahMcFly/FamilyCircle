/* Family Exchange unique-index probe: the test logic, written against a tiny adapter so it can be rehearsed offline and then pointed at a DISPOSABLE Appwrite database.
 * Copyright (C) 2026 Leia.  Not part of the family-api function package. Not run against Appwrite yet. Uses only invented data and a run id; never a family id.
 * A pass is supporting evidence about the schedules tried. It is not proof of every possible concurrency schedule. */
'use strict';
const crypto = require('crypto');
const CJK = (n) => '漢'.repeat(n);

/* adapter: { create(table, id, data), del(table, id), get(table, id), list(table, q) -> rows, readiness() -> [{kind,table,key,status,type?}], createWithTimeout?(table,id,data,ms) }
 * q is a plain object: { eq: [attr, value]?, orderDesc: attr?, limit: n?, after: id? }.  create/del/get throw an object with .code (HTTP status; 0 = no answer / timeout). */
const is409 = (e) => e && e.code === 409;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(a, { timeoutMs = 120000, pollMs = 2000 } = {}) {
  const t0 = Date.now(); let last = [];
  while (Date.now() - t0 < timeoutMs) {
    last = await a.readiness();
    if (last.length && last.every((x) => x.status === 'available')) return { ok: true, items: last };
    await sleep(pollMs);
  }
  return { ok: false, items: last };
}

async function runProbe(a, { tables, runId = crypto.randomBytes(5).toString('hex'), rounds = 25, width = 20, trials = 40, log = () => {} } = {}) {
  const E = tables.events, H = tables.hints, X = tables.text, created = [];
  const results = [], add = (id, name, pass, detail, info) => { results.push({ id, name, pass, detail, info: info || null }); log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + (pass ? '' : ' -> ' + detail)); };
  const mk = (table, id, data) => a.create(table, id, data).then((r) => { created.push([table, id]); return r; });
  const ev = (listing, seq, op, claim) => ({ familyId: 'probe', listingId: listing, seq, claimKey: claim || listing + '_' + seq, opKey: op, actorId: 'probe', kind: 'probe', state: '{}' });
  const settle = (ps) => Promise.allSettled(ps);
  const tally = (rs) => ({ ok: rs.filter((r) => r.status === 'fulfilled').length, conflict: rs.filter((r) => r.status === 'rejected' && is409(r.reason)).length, other: rs.filter((r) => r.status === 'rejected' && !is409(r.reason)).length });

  /* P0 readiness */
  const ready = await waitReady(a);
  const p0 = ready.ok && ready.items.filter((x) => x.kind === 'index' && x.unique).every((x) => x.type === 'unique');
  add('P0', 'every column and index reports available, and the unique ones are unique', p0, JSON.stringify(ready.items.filter((x) => x.status !== 'available' || (x.unique && x.type !== 'unique'))), { items: ready.items.length });
  if (!p0) return { results, pass: false, created };

  /* P1 sequential duplicate */
  { const L = 'p1' + runId; await mk(E, 'e' + L + 'a', ev(L, 1, L + '_o1'));
    const dupClaim = await a.create(E, 'e' + L + 'b', ev(L, 1, L + '_o2')).then(() => 'created', (e) => e.code);
    const dupOp = await a.create(E, 'e' + L + 'c', ev(L, 2, L + '_o1')).then(() => 'created', (e) => e.code);
    add('P1', 'a second row with the same claimKey, or the same opKey, is refused with 409', dupClaim === 409 && dupOp === 409, JSON.stringify({ dupClaim, dupOp })); }

  /* P2-P4 concurrent inserts */
  for (const [id, name, shape] of [
    ['P2', 'same claimKey, different opKeys, concurrently: exactly one wins', (L, i) => ev(L, 1, L + '_o' + i)],
    ['P3', 'same opKey, different claimKeys, concurrently: exactly one wins', (L, i) => ev(L, i + 1, L + '_same')],
    ['P4', 'identical rows (same claimKey and opKey), concurrently: exactly one wins', (L) => ev(L, 1, L + '_same')]
  ]) {
    let bad = null;
    for (let r = 0; r < rounds && !bad; r++) {
      const L = id.toLowerCase() + 'r' + r + runId, rs = await settle(Array.from({ length: width }, (_, i) => mk(E, 'e' + L + 'w' + i, shape(L, i)))), t = tally(rs);
      if (t.ok !== 1 || t.conflict !== width - 1 || t.other) bad = { round: r, ...t };
    }
    add(id, name + ` (${rounds} rounds of ${width})`, !bad, JSON.stringify(bad));
  }

  /* P5 the real pattern: read the head, claim head+1, retry on 409 */
  { let bad = null;
    for (let r = 0; r < Math.max(5, rounds >> 2) && !bad; r++) {
      const L = 'p5r' + r + runId, W = Math.min(width, 16);
      const writer = async (i) => { for (let attempt = 0; attempt < 60; attempt++) { const top = (await a.list(E, { eq: ['listingId', L], orderDesc: 'seq', limit: 1 }))[0]; const seq = top ? top.seq + 1 : 1; try { await mk(E, 'e' + L + 'w' + i + 'a' + attempt, ev(L, seq, L + '_op' + i)); return seq; } catch (e) { if (!is409(e)) throw e; } } throw new Error('gave up'); };
      const rs = await settle(Array.from({ length: W }, (_, i) => writer(i)));
      const rows = await a.list(E, { eq: ['listingId', L], limit: 100 }), seqs = rows.map((x) => x.seq).sort((p, q) => p - q), ops = new Set(rows.map((x) => x.opKey));
      if (rs.some((x) => x.status !== 'fulfilled') || rows.length !== W || seqs.some((s, i) => s !== i + 1) || ops.size !== W) bad = { round: r, rows: rows.length, seqs, rejected: rs.filter((x) => x.status !== 'fulfilled').length };
    }
    add('P5', 'the real claim loop: every writer succeeds exactly once, sequence numbers are gap-free, nothing is lost or doubled', !bad, JSON.stringify(bad)); }

  /* P6 read after write (informational about staleness; the design is safe either way because P5 passes) */
  { const L = 'p6' + runId; let stale = 0;
    for (let i = 1; i <= trials; i++) { await mk(E, 'e' + L + i, ev(L, i, L + '_o' + i)); const top = (await a.list(E, { eq: ['listingId', L], orderDesc: 'seq', limit: 1 }))[0]; if (!top || top.seq !== i) stale++; }
    add('P6', 'newest-first read right after a write (stale reads are counted, not failed)', true, '', { trials, stale }); }

  /* P7 unknown outcomes */
  if (typeof a.createWithTimeout === 'function') {
    const L = 'p7' + runId; let unknown = 0, committed = 0, bad = null;
    for (let i = 1; i <= trials && !bad; i++) {
      const row = ev(L, i, L + '_o' + i), id = 'e' + L + i;
      let outcome; try { await a.createWithTimeout(E, id, row, 1 + (i % 7)); outcome = 'ok'; created.push([E, id]); } catch (e) { outcome = is409(e) ? '409' : 'unknown'; }
      if (outcome === 'unknown') { unknown++; const seen = (await a.list(E, { eq: ['opKey', row.opKey], limit: 5 })); committed += seen.length; if (seen.length) created.push([E, id]); }
      await a.create(E, id + 'r', row).then(() => created.push([E, id + 'r']), (e) => { if (!is409(e)) bad = { i, code: e.code }; });   // the retry with the same keys
      const n = (await a.list(E, { eq: ['opKey', row.opKey], limit: 5 })).length; if (n !== 1) bad = { i, rowsForOpKey: n };
    }
    add('P7', 'a request that times out may or may not have committed; retrying with the same keys always ends with exactly one row', !bad, JSON.stringify(bad), { attempts: trials, unknown, committedAmongUnknown: committed });
  } else add('P7', 'timeouts (adapter cannot force them)', true, '', { skipped: true });

  /* P8 delete then recreate a unique key (hint cleanup and retry) */
  { const L = 'p8' + runId, key = L + '_k', id = 'h' + L;
    await mk(H, id, { familyId: 'probe', listingId: L, requesterId: 'u', requesterMembership: 'm', requestKey: key });
    await a.del(H, id); created.pop();
    const again = await a.create(H, id, { familyId: 'probe', listingId: L, requesterId: 'u', requesterMembership: 'm', requestKey: key }).then(() => { created.push([H, id]); return 'created'; }, (e) => e.code);
    const other = await a.create(H, id + 'x', { familyId: 'probe', listingId: L, requesterId: 'u', requesterMembership: 'm', requestKey: key }).then(() => 'created', (e) => e.code);
    add('P8', 'a deleted hint can be recreated with the same id and key, and a duplicate key is still refused', again === 'created' && other === 409, JSON.stringify({ again, other })); }

  /* P9 large text */
  { const sizes = [['ASCII 60000 bytes', 'a'.repeat(60000)], ['CJK 60000 bytes', CJK(20000)]], info = {}; let good = true;
    for (const [label, text] of sizes) { const id = 'x' + label.replace(/\W/g, '').slice(0, 6) + runId; const hash = crypto.createHash('sha256').update(text).digest('hex');
      try { await mk(X, id, { state: text }); const back = await a.get(X, id); info[label] = Buffer.byteLength(text) + ' bytes stored, ' + (back && crypto.createHash('sha256').update(back.state).digest('hex') === hash ? 'read back identical' : 'READ BACK DIFFERENT'); if (!back || crypto.createHash('sha256').update(back.state).digest('hex') !== hash) good = false; } catch (e) { info[label] = 'refused ' + e.code; good = false; } }
    for (const [label, bytes] of [['65535 bytes', 65535], ['70000 bytes', 70000]]) { const id = 'xb' + bytes + runId; info[label] = await a.create(X, id, { state: 'a'.repeat(bytes) }).then(() => { created.push([X, id]); return 'accepted'; }, (e) => 'refused ' + e.code); }
    add('P9', 'a 60000-byte state (ASCII and multibyte) is stored and read back byte for byte; the real ceiling is recorded', good, JSON.stringify(info), info); }

  /* P10 the queries the app depends on */
  { const L = 'p10' + runId; let ok = true, why = '';
    for (let i = 1; i <= 250; i++) await mk(H, 'q' + L + i, { familyId: L, listingId: 'l' + (i % 5), requesterId: 'u' + (i % 7), requesterMembership: 'm', requestKey: L + '_' + i });
    const seen = new Set(); let after = null;
    for (let p = 0; p < 5; p++) { const page = await a.list(H, { eq: ['familyId', L], limit: 100, after }); page.forEach((r) => seen.add(r.$id)); if (page.length < 100) break; after = page[page.length - 1].$id; }
    if (seen.size !== 250) { ok = false; why += ' paging saw ' + seen.size; }
    const top = await a.list(E, { eq: ['listingId', 'p6' + runId], orderDesc: 'seq', limit: 1 }); if (!top[0] || top[0].seq !== trials) { ok = false; why += ' orderDesc seq'; }
    const byCreated = await a.list(H, { eq: ['familyId', L], orderDesc: '$createdAt', limit: 3 }); if (byCreated.length !== 3) { ok = false; why += ' orderDesc createdAt'; }
    add('P10', 'paging 250 rows at 100 a page, newest-first by seq and by creation time', ok, why); }

  return { results, pass: results.every((r) => r.pass), created };
}

async function cleanup(a, created) {
  let removed = 0, failed = [];
  for (const [t, id] of created.slice().reverse()) { try { await a.del(t, id); removed++; } catch (e) { if (e.code !== 404) failed.push(t + '/' + id); } }
  return { removed, failed };
}
/* Secondary guard only. It is NOT credential isolation: a key valid for the production project would pass a script check like this and could still act on production.
 * Isolation comes from using a separate, empty project with its own key (see EXCHANGE-PROBE-PLAN.md). */
const PRODUCTION_PROJECT_ID = '6aef6a03002636be44c2';
function assertTarget({ projectId, recordedProbeProjectId }) {
  if (!projectId || !recordedProbeProjectId) throw new Error('probe target not recorded');
  if (projectId === PRODUCTION_PROJECT_ID) throw new Error('refusing to run against the production project');
  if (projectId !== recordedProbeProjectId) throw new Error('project id does not match the recorded probe project');
  return true;
}
module.exports = { runProbe, cleanup, waitReady, assertTarget, PRODUCTION_PROJECT_ID };
