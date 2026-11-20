# Family Exchange: unique-index probe plan (Step 7, revision 4, proposal only)

Status: NOT approved, NOT run. No key, project, schema or credential exists or was used, and the probe has never been run. One mistaken, keyless connectivity GET was attempted and failed locally (see Incident below). Stages A, B and C each need their own approval, and so do the connectivity check, the key, and the choice of runner. Revision 3 replaces revision 2 (`4199408`).

**Bottom line.** The probe is a self-contained, pinned package in `exchange-probe/` that runs against a separate, empty, disposable Appwrite project with its own short-lived key. It is built and tested offline against a fake that has the same call shapes as the pinned SDK. Its result, if it ever runs, is evidence about that project, that configuration and the schedules observed. It is not verification of production.

## 1. Credential boundary (unchanged from revision 2)
Appwrite API keys are limited by service scopes that cover the whole project (`databases.*`, `tables.*`, `columns.*`, `indexes.*`, `rows.*` are worded "your project's ..."). I found no documented way to restrict a key to one database. Empty table permissions and a project-id check in a script are not credential isolation (server keys bypass row permissions, and a production key would pass the check). The isolation is a separate project, which has its own keys. `assertTarget` in `probe.js` is a mistake guard only and says so.

## 2. The candidate (one exact commit)
The commit is named in the approval request, with the tree hash of `exchange-probe/` (`git rev-parse <commit>:exchange-probe`) so she or a reviewer can check the folder is byte-identical to what was reviewed. The candidate does not import anything from `function/` at run time.
| File | Purpose |
|---|---|
| `schema.manifest.json` | The exact schema: database `exchange_probe`; tables `probeEvents`, `probeHints`, `probeText`; every column type, size and required flag; every index key, type and columns; table permissions `[]`, row security off. Copied here, not imported. |
| `probe.js` | The checks P0 to P10, `budget()`, `assertTarget()`, `cleanup()`. |
| `adapter.js` | Wraps `node-appwrite` `TablesDB` (object-parameter calls, as the production function uses). Hard call cap, wall-clock deadline, immediate stop on 401/403 and on repeated 429/5xx/unexpected network loss. Also `verifySchema` (read-only) and `createSchema` (create-only, stops on any 409). |
| `run.js` | Command line: `budget`, `connectivity` (keyless), `verify-schema`, `create-schema`, `run`, `cleanup`. Everything it prints goes through `summary.js`. |
| `summary.js`, `errors.js` | Public output. Fixed line templates, per-field validators and fixed reason codes. No SDK response, header, exception text, environment value, row or state payload can be printed or written to the summary files; a line that fails the character check (letters, digits, `_ . - =` only; no `:`) is refused, so workflow-command injection is impossible. `created.json` (the ids to clean up) is local only and never part of the public output. |
| `redact.js` | Backup only: masks the key value and key-shaped strings after the allowlist has already run. It is not what keeps output safe. |
| `fake-sdk.js` + `*.test.js` | Offline tests. |
| `package.json`, `package-lock.json` | One dependency, `node-appwrite` exactly `31.1.0` (the version the production function pins), 4 packages total, every one pinned with an integrity hash. |
Schema (all columns required; defaults, arrays, encryption, index orders and lengths are left at Appwrite's defaults and are not compared):
| Table | Mirrors | Columns | Indexes |
|---|---|---|---|
| `probeEvents` | `exchangeEvents` | familyId string(36), listingId string(36), seq integer, claimKey string(80), opKey string(80), actorId string(36), kind string(24), state text | `uq_claimKey` UNIQUE [claimKey], `uq_opKey` UNIQUE [opKey], `ix_listing_seq` [listingId, seq], `ix_family_actor` [familyId, actorId] |
| `probeHints` | `exchangeRequests` | familyId, listingId, requesterId, requesterMembership string(36), requestKey string(80) | `uq_requestKey` UNIQUE [requestKey], `ix_listing` [listingId], `ix_family_requester` [familyId, requesterId] |
| `probeText` | the state column | state text | none |
A drift test compares `probeEvents` and `probeHints` with `EXCHANGE_SCHEMA` at the candidate commit and fails if they differ. It is an alarm for reviewers, not a dependency. Differences from production that remain: all columns required (production's flags are unspecified), no `exchangeListings`, `exchangeReports` or `exchangeState` tables, and a different database and table ids.

## 3. Commands
Setup (on whichever machine is approved as the runner, section 4):
```
git clone https://github.com/LayahMcFly/FamilyCircle.git && cd FamilyCircle
git checkout <candidate commit>
test "$(git rev-parse HEAD:exchange-probe)" = "<tree hash from the approval>"
cd exchange-probe && npm ci --ignore-scripts && npm test        # 47 tests, offline, no key
node run.js budget                                              # prints the call budget, no key, no network
node run.js connectivity                                        # keyless: one GET of <endpoint>/health/version; prints only a status number and a version (needs PROBE_ENDPOINT only)
```
Key file (never an argument, never in Git or logs): `umask 077; mkdir -p ~/probe-secret; read -rs V; printf %s "$V" > ~/probe-secret/key; unset V`. `read -s` keeps it out of the screen and the shell history. Then:
```
export PROBE_ENDPOINT=https://nyc.cloud.appwrite.io/v1
export PROBE_PROJECT_ID=<probe project id>
export PROBE_KEY_FILE=$HOME/probe-secret/key
node run.js verify-schema --expect-project <probe project id>   # Stage A check, read-only, 7 calls
node run.js create-schema --expect-project <id>                 # only if the runner creates the schema (setup key), 115 calls at most
node run.js run           --expect-project <id>                 # Stage B, 6015 calls at most
node run.js cleanup       --expect-project <id>                 # Stage C, rows recorded in out/created.json only
rm -P ~/probe-secret/key || shred -u ~/probe-secret/key         # then she revokes the key and deletes the project in the Console
```
The runner refuses to start unless `--expect-project` (typed by hand) equals `PROBE_PROJECT_ID`, neither is the production project id, and the endpoint is exactly `https://<region>.cloud.appwrite.io/v1` (so the key cannot be sent to another host). `run` refuses a project whose tables already hold rows, whose schema differs from the manifest, or whose `out/created.json` still lists rows.

## 4. Runner and secret delivery (decision for her; nothing assumed)
The runner is the Node script above. It needs Node 20 or newer (tested on 22.23.4), `git`, access to the npm registry for `npm ci`, and outbound HTTPS to `nyc.cloud.appwrite.io`. It sends the key only in the SDK's request header, over HTTPS, to that host.
- **Runner A, her own computer (proposed).** She holds the key, writes the key file with the commands above, and runs the three commands. She sends back `exchange-probe/out/run-*.json` (it contains results and counts, no key). Cost: she has said she tests only through a browser link, so this needs her explicit agreement.
- **Runner B, this workspace (not available as things stand).** Two things are unconfirmed. This workspace reaches the internet through a policy proxy, and I have not checked that `nyc.cloud.appwrite.io` is allowed. There is also no channel for a secret other than pasting it into chat, and no Appwrite-key variable exists in this environment. I will not use it unless she shows a channel that keeps the key out of chat, Git, arguments, logs and test files.
- Not proposed: CI (a workflow would have to live on `main`, which is not approved), the Appwrite connector (it acts under its own credentials and its project is not confirmed), any shared or pasted key.
How the key stays contained: it is read once from the key file (outside the repository, regular file, owner-only mode) or from `PROBE_APPWRITE_KEY` (removed from the environment after reading); a key-shaped argument is refused; all output goes through a redactor that masks the key and key-shaped strings, including inside SDK error messages; `out/` is git-ignored and holds only ids, counts and results (a test scans it); no child processes are started. Tests use a fake key built in code. A mutation check (redaction disabled) fails the redaction test.
**Connectivity check (separate approval, not run).** Exact target: one `GET https://nyc.cloud.appwrite.io/v1/health/version`, no key, no project header, no body, from the approved runner. It changes nothing; it tells us the host is reachable from that runner and reports the server's version, which I would record in the progress file. If the endpoint answers 401 or similar, reachability is still shown. No other live request is part of this check.

## 5. Project and costs (her Console checks, once she is ready)
I have not created a project, upgraded a plan or incurred a charge, and will not. Before approving Stage A she should check, in the Console:
1. Organization, plan, and how many projects exist; whether a further project is allowed (Free: 2 per organization, one database per project, shared resources, per Appwrite's billing page).
2. Whether creating the project would change what she pays, and the usage and billing pages' current figures. The expected load is at most 6,015 calls for the run (about 3,300 in a typical run), at most 491 rows, nothing stored afterwards.
3. Region New York is selectable for the new project.
4. The key form: that it offers service scopes with no way to limit to one database (if it does offer resource limits, tell me; the plan still stands), and which expiry choices it shows.
5. That the project's settings page allows deleting it.
6. Which runner (section 4) she is willing to use.

## 6. Keys (nothing created; to be proposed again at the execution gate)
Console-created keys in the probe project only. Preferred: she creates the database and tables by hand from the manifest (the Console shows the same column and index fields), so no schema-privilege key is ever issued, and one run key does `verify-schema`, `run` and `cleanup`.
| Key | When | Scopes (exact) | Never |
|---|---|---|---|
| Run key | Stages B and C, and the read-only `verify-schema` | `rows.read`, `rows.write`, `tables.read`, `columns.read`, `indexes.read` | `keys.*`, `project.*`, `databases.write`, `tables.write`, `columns.write`, `indexes.write`, users, teams, storage, functions, messaging, any organization scope |
| Setup key (only if the runner creates the schema) | Stage A `create-schema`, then deleted | `databases.write`, `tables.write`, `columns.write`, `indexes.write`, `tables.read`, `columns.read`, `indexes.read` | `rows.*`, `keys.*`, `project.*` |
The two are never one key. Expiry: the shortest the Console offers that covers the stage (setup about 6 minutes of calls, run at most 15). The short ephemeral keys Appwrite documents (3600 seconds) are made through the key API, which needs a key with `keys.write`, so they are not used. If the shortest Console expiry is a day, I will say so, and she revokes each key right after its stage (revocation, not expiry, is the real limit). If a call returns 401 or 403 the runner stops; widening scopes is a new approval, never automatic.

## 7. Call budget and stop conditions (enforced in code, covered by tests)
Calls per stage, worst case, with the defaults: precheck 3; P0 readiness 150; P1 3; P2 to P4 1,500; P5 3,845; P6 80; P7 160; P8 4; P9 6; P10 257. Total 6,008, plus a 7-call schema check = **6,015 cap**. `create-schema` 115 at most (1 database, 3 tables, every column and index create, plus up to 30 column-readiness polls per table; the earlier figure of 114 was a miscount, the code and its test give 115), `verify-schema` 7, `cleanup` at most 491 (one per recorded row; rows created at most 491). A typical correct run is about 3,300 calls. The adapter refuses the next request once the cap is reached (a test confirms the fake sees exactly the cap and no more).
The run stops, sends nothing further, records the rows created so far in `out/created.json`, and exits with status 2 on: any 401 or 403; five consecutive 429, 5xx or unexpected network failures; the call cap; the wall-clock limit (run 15 min, create-schema 6, cleanup 10, verify 1); a project that is not clean; a schema that differs from the manifest; any 409 during `create-schema` (it never touches pre-existing resources). A rate-limited run is reported inconclusive, never a pass. If the process is killed, deleting the project is the cleanup of last resort.

## 8. Checks, and what a result means
P0 readiness and index types; P1 sequential duplicate claimKey and opKey; P2 to P4 20 concurrent inserts (same claimKey; same opKey; identical rows), 25 rounds each, expecting exactly 1 success and 19 conflicts; P5 the real claim loop with 16 writers, 5 rounds, gap-free sequence; P6 stale-read count (informational); P7 timeouts then lookup then retry, one row per opKey; P8 delete then recreate a unique key; P9 60000-byte ASCII and multibyte state round trip plus the 65535 and 70000-byte results (the real text ceiling); P10 paging, orderDesc seq and orderDesc $createdAt.
**Evidence wording.** A pass is evidence that, in that project, with that configuration, on the date and Appwrite version observed, the schedules tried behaved as expected. A pass is not production verification, not proof of every concurrency schedule, and does not set `persistenceVerified`. The run record says so in its `note` field. Later, production schema creation will report index configuration and status; that shows the indexes exist and are marked unique and available. It does not by itself show that production enforces uniqueness under concurrent inserts, and the plan never claims it does.
What it cannot show about production: its own configuration, limits and rate-limit buckets, behaviour under real function concurrency, Teams paging, every schedule, or future platform changes. Differences from production: separate project and plan limits, tiny data volume, no function runtime, hand-made schema, fewer tables.

## 9. Cleanup boundary
Delete only what is recorded as created for the probe; never delete or modify a pre-existing resource.
- Before Stage A, a read-only inventory of her organization's projects (id and name) is recorded in the approval request.
- Created-resource record: the probe project id; the database, table and key ids; and `out/created.json` (the exact rows the run created). The script's `cleanup` deletes only those rows, and a test confirms an unrecorded row survives.
- Then she revokes the key and deletes the probe project in the Console after checking its id equals the recorded id. The organization's project list must equal the pre-probe inventory minus nothing and plus nothing. Production's `family-api` function, its active deployment (reported 6afbacf20a0e3243296c) and the `family` database are never touched; a read-only look confirms nothing changed.
- Anything unexpected stops the cleanup and is reported. Nothing is deleted on a guess.

## 10. Offline test evidence (at the candidate commit)
`cd exchange-probe && npm ci --ignore-scripts && npm test` (Node 22.23.4, fresh clone): 47 tests, 47 pass, 0 fail. By file: `manifest.test.js` 4, `adapter.test.js` 15, `runner.test.js` 12, `probe.test.js` 6, `public-output.test.js` 10. `cd function && npm test` 142/142 and `node --test test/*.test.js` 259/259 (unchanged). Nothing was run against Appwrite or GitHub's runners.
`public-output.test.js` feeds hostile material into every channel the runner can see: SDK errors whose message, response, headers, stack, url and type carry canary strings and `::add-mask::` / `::error::` workflow commands (statuses 401, 403, 429, 500 and none, for every command); rows and state payloads with canaries; schemas with canary-named columns and tables; environment values (including ones holding the key); hostile arguments, project ids and endpoints; and a keyless connectivity check with hostile bodies (huge, HTML, injection in the version, non-semver), a headers object that throws if read, a stream cut off at 64 KB, timeouts and network errors. It asserts that no canary or key appears in any printed line or summary file, that every line matches the safe pattern, that summary files contain only allowlisted fields, and that `run.js` has no raw print, never prints exception text and writes only the summary files plus the local `created.json`. Four mutations (printing the exception message, passing findings through, disabling the line guard, passing check detail through) each make these tests fail.
Limits: this is offline evidence about the code. It says nothing about Appwrite's behaviour; that is what the probe itself would measure.

## 11. Decisions that block the next action
1. Her Console checks (section 5) and whether a further project is acceptable at no charge.
2. Which runner (section 4), and her explicit agreement if it is her own computer.
3. Whether she creates the schema by hand (preferred, one key) or allows the setup key.
4. Separate approvals still needed, in order: the connectivity check, Stage A (project and schema), the key(s), Stage B, Stage C.

## Incident and candidate status (2026-11-19)

One unapproved, keyless GET to `https://nyc.cloud.appwrite.io/v1/health/version` was attempted by mistake on 2026-11-19 (Claude ran `node run.js connectivity` in a scratch copy to check it needs no `node_modules`). It failed locally with `error=network` and no response was received; whether the request reached Appwrite is unknown. No key, project or credential was involved. The rest of the probe work, including all tests, ran offline with injected fake networking; `npm install` was the only other network use.

Replacement probe candidate, REPORTED, pending independent review (not approval to merge or execute): commit `99727352f52d5c3a0ed9cc900b3d7e9dce268055` (supersedes `95a05b0`; the earlier text naming `9972735` as the candidate refers to this commit, and its commit message cannot be amended). Pins: `exchange-probe/` tree `88462972edfdae9fe8d0c8d5d5e81b3a737849ca`, manifest blob `52d4606143d401a7b06050a50014b9baf379b639`, lock blob `32530cd2dea1f1d9c456a473bc157799b993ef55`. Regression test `tests/exchange-probe-offline.test.js` (with `tests/helpers/no-network.cjs`) proves that importing the modules or running the probe suite makes no network attempt and cannot invoke the real connectivity command; it fails if a probe test calls it against the real endpoint. Probe work is paused.
