# Family Exchange: unique-index probe plan (Step 7, revision 2, proposal only)

Status: NOT approved, NOT run. Nothing in this file has touched Appwrite. Stages A, B and C each need their own approval. Revision 2 replaces the plan at 8601345, which relied on a key "limited to exchange_probe" inside the production project. That does not exist (see section 1).

**Bottom line.** The probe runs in a separate, empty, disposable Appwrite project with its own short-lived key. Nothing in the production project (Family Circle, id 6aef6a03002636be44c2) is touched, and no credential that works on production is used. A pass is supporting evidence about the schedules tried. It does not prove every concurrency schedule, does not open the feature, and does not leave `persistenceVerified` anywhere but false.

## 1. Credential boundary: what Appwrite supports
Finding, from Appwrite's current documentation (API keys page and scope catalog, read 2026-11-19): API key access is "restricted by scopes instead of permissions". Every database scope is worded for the whole project: `databases.read/write` ("your project's databases"), `tables.*`, `columns.*`, `indexes.*`, `rows.*`. I found no documented way to limit a key to one database, table or row set. A community thread asking for exactly that (a key limited to one bucket and collection) describes the same gap. Appwrite Cloud is versioned by the provider, so "our version" is the current Cloud release; I could not check the Console key screen myself, so she should confirm on screen at Stage A that the key form offers scopes only and no resource picker. If a resource picker does exist, this plan still stands, because a separate project is stronger.
Consequences for the plan:
- Empty table permissions do not isolate a server key (server keys bypass row and table permissions).
- A database-id check in the script is only a guard against mistakes. `assertTarget` in `exchange-probe/probe.js` refuses the production project id and any id that differs from the recorded probe project id. It is documented in code as NOT isolation.
- Real isolation: a separate project has separate keys, so a probe key cannot be used on production at all.

## 2. Target and setup (approval A)
She creates these in the Appwrite Console (I do not hold an organization key and none is requested):
1. A new project named `exchange-probe-2026-11`, region New York (same as production), in her existing organization. Record its project id in the proposal log (the id is not a secret).
2. One database `exchange_probe`, three tables (`probeEvents`, `probeHints`, `probeText`), with the columns and indexes below. Table and row permissions: none for every role.
| Table | Mirrors | Columns | Indexes |
|---|---|---|---|
| probeEvents | exchangeEvents | familyId, listingId, claimKey, opKey, actorId, kind (strings); seq (integer); state (text) | UNIQUE claimKey, UNIQUE opKey, key [listingId, seq], key [familyId, actorId] |
| probeHints | exchangeRequests | familyId, listingId, requesterId, requesterMembership, requestKey (strings) | UNIQUE requestKey, key [familyId, requesterId] |
| probeText | state column | state (text) | none |
Column types and sizes are copied from `EXCHANGE_SCHEMA` in `function/src/exchange.js` at the commit approved for Stage A (the commit is named in the approval request).
3. No functions, no sites, no storage buckets, no auth users, no teams, no platforms, no webhooks, no messaging in that project.
4. Rows contain invented values only, with `familyId: "probe"`.

## 3. Credential: scopes, expiry
- Created by her in the Console of the probe project only, with an expiry date set at creation. Expiry: 24 hours after creation (the run takes minutes; a short expiry limits exposure if the key leaks). An ephemeral key (maximum 3600 seconds) is an alternative if she prefers; the cost is that setup waiting for index readiness may need a second key.
- Scopes, exactly these ten and no others: `databases.read`, `databases.write`, `tables.read`, `tables.write`, `columns.read`, `columns.write`, `indexes.read`, `indexes.write`, `rows.read`, `rows.write`. If she creates the tables herself in the Console (step 2), the key needs only `rows.read`, `rows.write`, `tables.read`, `columns.read`, `indexes.read`, and the other five are left off. Preferred: she creates the schema, the key gets those five.
- Never granted: `keys.read`, `keys.write` (a key holding `keys.write` can alter and delete other keys), `project.read/write`, functions, sites, users, teams, storage, messaging, or any organization-level scope.
- The key value is never pasted into chat or committed. How the key reaches the script is an open decision (section 8).

## 4. Cost and resource limits
- Plan: Appwrite's free plan allows two projects per organization and one database per project, with resources shared across projects (per the billing pages, read 2026-11-19). I do not know how many projects her organization already has or which plan it is on. If a third project is not allowed, she must delete an unused one (her decision) or the probe waits. Any paid plan or charge is hers to approve; none is assumed.
- Expected load, an upper estimate: about 4,000 write attempts (most are intended 409 refusals) and under 2,000 reads. Created rows at most about 700. Usage is billed per row affected, so this is far below free-tier quotas.
- Hard stops in the script: abort on any rate-limit response that persists after a short backoff and report the check as inconclusive, and refuse to run a second time without a clean project.
- Free projects can be paused after inactivity; the project is deleted at Stage C, so this does not matter.

## 5. Probe run (approval B)
Script `exchange-probe/probe.js` plus a small Appwrite adapter (`appwrite-adapter.js`, to be written and reviewed offline before B). Rehearsed offline in `exchange-probe/probe.test.js` against a fake that enforces unique keys and fakes that do not (the probe must fail those).
| Check | What it does | Pass means |
|---|---|---|
| P0 | Readiness, index types | every column and index `available`, unique ones are `unique` |
| P1 | Second row with the same claimKey, then the same opKey | both refused with 409 |
| P2 | 20 concurrent inserts, same claimKey, different opKeys, 25 rounds | exactly 1 success and 19 conflicts, 0 other errors, every round |
| P3 | 20 concurrent inserts, same opKey, different claimKeys, 25 rounds | exactly 1 success and 19 conflicts |
| P4 | 20 concurrent identical inserts, 25 rounds | exactly 1 success and 19 conflicts |
| P5 | The real loop: 16 writers read the newest seq, claim seq+1, retry on 409 (5 rounds) | each writer lands once, seq is 1..16 with no gap or duplicate |
| P6 | 40 write-then-read pairs, newest first | informational: counts stale reads, never fails |
| P7 | 40 inserts with a 1 to 7 ms client timeout, lookup by opKey, retry with the same keys | exactly one row per opKey at the end |
| P8 | Delete a hint, recreate with the same id and key; insert the same key under another id | recreate works and the duplicate key is still 409 |
| P9 | 60000-byte state, ASCII and 20000 CJK characters, hash round trip; then 65535 and 70000 bytes | 60000 bytes round-trip identically; the other two results record the real ceiling |
| P10 | 250 rows paged 100 at a time with cursorAfter; orderDesc seq; orderDesc $createdAt | all 250 seen once, ordering correct |
Expected conflicts: P2 to P4 produce 19 x 25 = 475 refusals each by design. A non-409 error (429, 5xx) is counted as "other" and fails that check; the check is rerun once at lower width to separate rate limiting from a real fault, and a rate-limited run is reported inconclusive, never a pass.
Partial or timeout outcomes: nothing is assumed after a stop. The run is repeated only from a clean project, or the project is deleted at Stage C.

## 6. Cleanup boundary (approval C)
Principle: delete only what is recorded as created for the probe. Never delete or modify any pre-existing resource, automatically or otherwise.
- **Before Stage A** (read-only, recorded in the approval request): inventory of her organization's projects (id and name) and, for the production project, nothing is listed or changed. This is the pre-probe inventory.
- **Created-resource record**, written during A and B: the probe project id, database id, three table ids, the key id, and the row ids the script reports as created.
- **Cleanup steps:** (1) the script deletes rows only from the recorded ids; (2) she revokes the key and deletes the probe project in the Console after checking that its id equals the recorded id; (3) compare the organization's project list with the pre-probe inventory: the only difference must be the removal of the recorded probe project; (4) confirm the production project's `family-api` function, its active deployment (reported 6afbacf20a0e3243296c) and the `family` database were not touched (read-only view).
- Anything unexpected (an unrecorded resource, a mismatch) stops the cleanup and is reported. Nothing is deleted on a guess.

## 7. What the isolated probe can and cannot establish about production
Differences from production: separate project (own quotas, rate-limit buckets and key), possibly a different plan and limits, tiny data volume, no function runtime (so no function timeouts, cold starts or many parallel function instances), no Teams, no real permissions or real rows, and schema created fresh by hand instead of by the Step 7 setup script.
Can establish: that unique indexes on current Appwrite Cloud TablesDB refuse concurrent duplicate inserts with 409 under the schedules tried; that retries after timeouts converge to one row; the real text column ceiling; the query behaviours the code uses; delete-then-recreate of a unique key.
Cannot establish: behaviour of the production project's configuration or limits, behaviour under real function concurrency, Teams paging, every possible schedule, or future platform changes. After any pass, Step 7 schema creation in production still needs its own approval, and its first readiness check re-verifies the unique indexes there (no insert load on family data).

## 8. Decisions that block Stage A
1. Does her organization have room for another project, and is a charge acceptable (none assumed)?
2. Who runs the script and how the key reaches it without being pasted in chat. I have not confirmed the shell here can reach the Appwrite API; if it cannot, the options are her running it herself or using the Appwrite connector, and I will bring that as its own proposal.
3. Expiry: 24-hour Console key (proposed) or one-hour ephemeral key.
4. The exact commit for the schema definition and probe scripts (this branch tip, once she approves its contents for this purpose).
