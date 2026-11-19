# Family Exchange: schema and persistence proposal (revision 2, branch exchange-step6)

Status: PROPOSAL ONLY. Nothing here has been created in Appwrite. It replaces sections 2 and 3 of `EXCHANGE-BACKEND-DESIGN.md` (the first draft on main) for the build on this branch. Creating any of it is Step 7 action 1 and needs its own approval.

## Why the first mechanism was dropped
The first build claimed a sequence number with one unique-key insert, then applied a list of writes to several mutable rows. Each of those writes was a read-then-write: a paused executor could pass its check, a newer operation could finish, and the old executor could then write over the newer state. Checking before every write only narrows that window. Appwrite offers no conditional update, and its transaction conflict, unique-index and locking behaviour is not documented well enough to rely on, so that design is gone.

## The mechanism now: one atomic write per change
The authoritative state of a listing (listing fields, requests, the reservation, reports) is an append-only chain of full snapshots in `exchangeEvents`. A change reads the newest snapshot, validates its intent against it, then inserts snapshot n+1. The insert is one row, and `claimKey` (listingId_n+1) has a UNIQUE index, so exactly one writer wins each number. A loser gets 409, reads the new head, validates again, and either applies on top of it or fails with "changed".
- No row is ever updated or deleted in the chain, so an old writer has nothing to overwrite.
- A stale read can only produce a refused claim, never a wrong write.
- A second unique key, `opKey`, makes a duplicate retry of the same action a no-op.
- There are no partial failures to repair: a failed insert changes nothing.
- Hint rows (who owns what, who asked, who reported) are create-only. The one exception is `exchangeListings.ended`, which only goes false to true, and only after a terminal snapshot exists, so a late or repeated write of it is always correct. State is never read from hints.

Assumption that remains, and the gate for it: Appwrite enforces UNIQUE indexes under concurrent inserts and answers 409. Appwrite's own community threads show unique-index conflicts surfacing as a 409 backed by a database duplicate-entry error, and one 2026 thread reports an index that was not enforcing, which is why Step 7 must confirm each index is `available` and run a duplicate-insert probe. Until then the code keeps the whole feature closed: it needs `persistenceVerified === true` (not set anywhere), in addition to the per-family switch and the eligibility hook.

## Tables (all function-only, no client permissions)
| Table | Role | Columns | Unique | Indexes |
|---|---|---|---|---|
| exchangeEvents | authoritative chain, append-only | familyId, listingId, seq (int), claimKey, opKey, actorId, kind, state (text, 65535 bytes; code refuses over 60000) | claimKey, opKey | listingId+seq |
| exchangeListings | hint, row id = listingId | familyId, ownerId, ownerMembership, kind, ended (bool) | none | familyId+ended, ownerMembership+ended |
| exchangeRequests | hint | familyId, listingId, requesterId, requesterMembership, requestKey | requestKey (listingId_membershipId) | listingId, familyId+requesterId |
| exchangeReports | hint | familyId, listingId, reporterId, reporterMembership, reportKey | reportKey (listingId_membershipId) | familyId, familyId+reporterId |
| exchangeState | per-family switch, row id = familyId | familyId, enabled, enabledBy, enabledAt | none | none |

Removed from the first draft: `exchangeReservations` (the reservation lives in the snapshot, so a second reservation is impossible by construction). Not yet verified: the exact maximum size of an Appwrite text column on this project. Step 7 must confirm it before the column is created.

## Membership-instance binding
Rights belong to an Appwrite team membership id, not an account. The snapshot stores the owner's membership id (`ownerM`), each request's (`m`), and the reservation's. Removal and re-invitation produce a new membership id, so the person gets none of the old rights. A listing whose owner membership is no longer current is "orphaned": nobody can open or change it, it is hidden from everyone, and it does not count toward any limit. Orphaned data is kept, not deleted (retention is undecided). The accused-handler rule still matches by account, so a re-invited accused cannot become a handler for their own listing.

## Consistency boundary for membership and eligibility
Membership and eligibility live outside the chain, so no single operation covers both. Reserving reads the current membership list and calls the eligibility hook for the chosen person immediately before the claim, on every attempt, and refuses with `recipient_unavailable` unless the person holds the same membership and passes. A removal or eligibility change that lands after that read and before the claim insert is not caught at commit. The effect is contained: the next call by that person fails the membership check, the owner view shows the recipient as unavailable, and the owner can release. Nothing is exposed to the removed person.

## Other revised behaviour
- Memberships are read page by page (100 per page, up to 50 pages). A family too large to read completely fails closed.
- The per-person listing limit counts live listings (draft, available, open, reserved, hidden) from their real state. Withdrawn, gone, fulfilled and closed listings free a place at once. The number 50 stays provisional. The count is soft under simultaneous creates: two creates at the same instant can both pass.
- Placeholder numbers still to confirm: 60 requests a minute (in memory), 10 reports a day, 20 reports per listing, 40 open requests per listing (100 entries), 50 live listings per member, 300 on the home list.
- Home, activity and report lists read one snapshot per listing (eight at a time). That is fine for a family-sized list and is capped by the numbers above.


---

## Addendum (Step 7 review, branch exchange-step7-review, 2026-11-19): retention, size, hints

Status: proposal only. Not approved for execution. Code is in `function/src/exchange.js`, tests in `function/test/exchange.test.js` (66 tests in that file).

### 1. Retention and deletion
**Bottom line.** An append-only chain keeps every past snapshot, so without a deliberate step, personal content stays forever. This is stated here so nobody assumes otherwise: **retention is indefinite until a retention policy and a job that applies it exist. Neither exists, and no period is chosen.**
What exists (not wired to any action, not routed, no defaults):
- `erase`: appends one new snapshot that clears the personal content (title, description, area, notes, report detail) and closes the listing. The chain stays valid because this is an ordinary append.
- `blankHistory`: sets `state` to `{}` (and optionally `actorId` to `erased`) on rows below the head. It keeps `claimKey` and `opKey`, so a stale writer is still refused with 409 and a replayed op is still a no-op. The head row is never blanked, so the current state is always readable.
- `redactMember`: runs `erase` on that person's listings, clears their notes, report details and account id, deletes their hint rows, then blanks history. The `[familyId, actorId]` index on `exchangeEvents` exists so this finds a person's rows without a scan.
- `sweepHints(familyId, olderThanMs)`: deletes only hint rows with no matching snapshot entry. Requires a window of at least one hour; there is no default.
Example: Dana leaves the family. `redactMember` appends an erased snapshot to her listing, removes her request and report hints, and blanks her older snapshots. Another member's listing that mentions Dana in a request note keeps the note text only if that note was written by someone else; her own notes are cleared.
Report evidence: a report's reason and detail live in the snapshot. Whether evidence is kept after the report is resolved, and for how long, is a decision for her. The mechanism can clear detail while keeping "a report existed and how it ended". Decision needed before any job is written.
Still open: retention periods, who triggers redaction (admin action, account deletion, a schedule), and whether moderators may keep evidence after a member leaves.

### 2. Snapshot size and safety actions
**Bottom line.** Actions that make a snapshot bigger (ask, report, edit) are refused once it passes a soft cap of 40000 bytes. The hard cap is 60000 bytes, so 20000 bytes of headroom is always left for withdraw, close, release, decline, cancel, hide, restore and keep. A change that does not enlarge the snapshot is never refused for size, even above the soft cap.
Evidence: tests fill a listing with maximum-length fields in CJK and emoji (3 bytes and 4 bytes per character), up to 25 reports and maximum-length notes, confirm growth is refused, then run every safety action successfully under the hard cap. A 160-operation random run asserts the invariants, and a mutation check (soft cap raised to 59990) makes those tests fail. The headroom is asserted to be at least ten times the largest single change.
Assumption to confirm in Step 7: the text column accepts 60000 bytes (probe check P9). If the real ceiling is lower, both caps move down.

### 3. Hint rows
**Bottom line.** Hint rows are created before the snapshot that references them, so a failure in between can leave an orphan. An orphan grants nothing and hides nothing.
- Hint ids are a hash of the key (`q` for requests, `p` for reports), so a retry or later recreation always lands on the same row, and a repeated create is a 409 treated as success.
- If the snapshot commit fails after the hint exists: the retry reuses the hint and commits. If nobody retries, the orphan is invisible (state is read only from the chain) and `sweepHints` removes it after the window.
- If the hint is lost but the snapshot exists: the next ask recreates it. Rights never depend on it.
- A hint cannot count toward another person's limits (`activeCount` checks owner id and membership id on the real snapshot).
Tests cover: ask failure then retry, ended-listing cleanup, report orphan, a create orphan with a squatted opId then sweep, forged hints granting nothing, and a lost hint restored.

### 4. Schema change
Add to `exchangeEvents` the index key `[familyId, actorId]` (used by `redactMember`). Nothing else in the five-table schema changes.
