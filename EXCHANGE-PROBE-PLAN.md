# Family Exchange: unique-index probe plan (Step 7, proposal only)

Status: NOT approved, NOT run. Nothing in this file has touched Appwrite. Each stage below needs its own approval.

**Bottom line.** The Exchange backend is safe only if Appwrite refuses a second insert that repeats a unique key, even when many inserts arrive at once. The probe tests that on a throwaway database holding invented rows, then deletes the database. A pass is supporting evidence about the schedules tried. It is not proof of every possible concurrency schedule, and it does not open the feature. The `persistenceVerified` switch stays false until she approves a separate enablement step.

## Scope and limits
- Target: a new database `exchange_probe` in the existing Appwrite project (Family Circle, nyc). Never the `family` database. No family id, member id, or real text is used. Every row uses the id prefix `e`, `h` or `x` plus a random run id, and `familyId: "probe"`.
- No function upload, no activation, no configuration or environment change, no frontend change, no use of the `family-api` function. The probe runs from a script using a short-lived API key limited to the `exchange_probe` database, created by her and revoked afterwards (the key value is never pasted into chat).
- Not covered: Appwrite Teams paging (separate read path, tested only against the fake), real traffic, and Appwrite behaviour outside the schedules below.

## Stage A: create the probe database (approval A)
Tables mirror the real ones, with the same column types and indexes (`EXCHANGE_SCHEMA` in `function/src/exchange.js` is the source):
| Probe table | Mirrors | Columns | Indexes |
|---|---|---|---|
| `probeEvents` | `exchangeEvents` | familyId, listingId, seq (integer), claimKey, opKey, actorId, kind, state (text) | UNIQUE claimKey, UNIQUE opKey, key [listingId, seq], key [familyId, actorId] |
| `probeHints` | `exchangeRequests` | familyId, listingId, requesterId, requesterMembership, requestKey | UNIQUE requestKey, key [familyId, requesterId] |
| `probeText` | state column only | state (text) | none |
Permissions: none for any role (server key only), as in the real schema.
Readiness: poll until every column and index reports `available` (up to 2 minutes). P0 refuses to continue unless each unique index is of type `unique`.
Rollback for A: delete the database `exchange_probe`.

## Stage B: run the probe (approval B)
Script: `exchange-probe/probe.js`, rehearsed offline in `exchange-probe/probe.test.js` against a fake that enforces unique keys and against fakes that do not (the probe must fail those).
| Check | What it does | Pass means |
|---|---|---|
| P0 | Readiness, index types | all `available`, unique ones are `unique` |
| P1 | Sequential: second row with the same claimKey, then the same opKey | both refused with 409 |
| P2 | 20 concurrent inserts, same claimKey, different opKeys, 25 rounds | exactly 1 success, 19 conflicts, 0 other errors, every round |
| P3 | 20 concurrent inserts, same opKey, different claimKeys, 25 rounds | exactly 1 success, 19 conflicts |
| P4 | 20 concurrent identical inserts, 25 rounds | exactly 1 success, 19 conflicts |
| P5 | The real loop: 16 writers each read the newest seq, claim seq+1, retry on 409 (5 rounds) | every writer lands once, seq values are 1..16 with no gap and no duplicate |
| P6 | 40 write-then-read pairs, newest first | informational: counts stale reads, never fails (the design tolerates stale reads because a stale claim is refused) |
| P7 | 40 inserts with a client timeout of 1 to 7 ms, then lookup by opKey, then retry with the same keys | exactly one row per opKey at the end, whether the timed-out call committed or not |
| P8 | Delete a hint, recreate it with the same id and key; also insert the same key under another id | recreate works, duplicate key still 409 (guards the stale-unique-entry reports; gates `sweepHints`) |
| P9 | 60000-byte state, ASCII and 20000 CJK characters (60000 bytes), stored and read back by hash; then 65535 and 70000 bytes | 60000 bytes round-trip identically; the 65535/70000 results are recorded as the real ceiling |
| P10 | 250 hint rows paged 100 at a time with cursorAfter; orderDesc seq; orderDesc $createdAt | all 250 seen once, ordering correct |
Expected conflicts: P2 to P4 each produce 19 x 25 = 475 refusals by design. Any non-409 error (429, 5xx) is reported as "other" and fails the check, then the check is rerun once at lower width to separate rate limiting from a real fault. A rate-limited run is inconclusive, not a pass.
Partial or timeout outcomes: if the run stops midway, nothing is assumed. Stage C removes everything by database deletion, and the run is repeated from a clean database.
Rollback for B: none needed beyond Stage C; no real data is touched.

## Stage C: cleanup (approval C)
1. Script deletes every row it created (`cleanup` in probe.js), reporting any failures.
2. Delete the database `exchange_probe`; list databases to confirm only `family` remains.
3. She revokes the temporary API key.
4. Confirm the `family-api` function, its active deployment (reported 6afbacf20a0e3243296c) and the `family` database are unchanged.

## What each result decides
- All pass: the unique-index assumption has supporting evidence. Schema creation in the `family` database can be proposed next (separate approval), still with the switch off.
- Any of P1 to P5 fails: stop. The append-only chain does not work on this Appwrite setup; redesign before any schema.
- P8 fails: keep `sweepHints` unrun and never delete hint rows. The chain itself is unaffected.
- P9 shows a ceiling below 60000 bytes: lower `stateBytesMax` and `stateSoftMax` before schema creation.
