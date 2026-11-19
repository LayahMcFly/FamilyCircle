# Family Exchange: Step 5 real backend design gate

**Status:** design only. Nothing here is built. No code, no Appwrite schema change, no function upload, no Hub link, no enabling for any family. Step 6 (build on a branch), Step 7 (external changes and live tests) and Step 8 (release) each need your separate "yes".

**Bottom line:** the Exchange backend copies the pattern the Giving Center already uses. Function-only tables with no browser permissions, one new set of actions inside `family-api`, a per-family feature switch that starts off, and a unique index so two people can never reserve the same item. The rules the passed preview already proves (Steps 1 to 4) move into the function unchanged. Six decisions are still yours and are **not** assumed anywhere in this design: who counts as eligible, who moderates, how long records are kept, photos, how pickup messaging connects, and the licence. Each is listed in section 12 with options.

---

## 1. What stays the same as the preview

| Rule (passed on your phone) | Where it is enforced for real |
|---|---|
| Free items and Wanted posts only. No money, fees, ads, tracking | No price, payment or external link field exists in any table |
| Listing limits: title 80, description 1000, area 60, note 300, 3 photos | `exchange.js` validators, same numbers as `exchange-rules.js` |
| No street addresses or contact details in public text | `looksLikeAddress` and `looksLikeContact` run again on the server |
| Owner confirms who gets an item, one person at a time | `exchangeReserve` |
| Applicants never see each other, and never see why they were not chosen | Response builder allow-list |
| Hidden listing looks identical to a missing one for everyone but the owner and moderators | `exchangeListingGet` returns the same "not available" body for both |
| Reserved listings: edits stay private, material changes blocked from publishing | `exchangeListingSave` with the same `materialChanges` rule |
| Saved text is never altered, spacing included | Stored raw, whitespace ignored only to detect material change |
| Release returns the item to Available and never auto-reserves anyone | `exchangeRelease`, `exchangeRequestCreate` |
| Reporter identity never reaches the reported member | Reports table is readable only by the handler through the function |

The rule file `exchange-preview/exchange-rules.js` is moved, not rewritten, so the 8 rule tests keep meaning the same thing.

## 2. Tables (function-only, no client permissions)

Every table has **no client permissions at all**, like `addresses` and the Giving tables. Only `family-api` reads or writes them. Every row carries `familyId`, and every query filters on it.

| Table | Key columns | Notes |
|---|---|---|
| `exchangeListings` | `familyId`, `ownerId`, `kind` (`free` / `wanted`), `status`, `rev` (integer), `hiddenFrom`, `data` (JSON: title, category, condition, description, area), `pending` (JSON, owner only) | `rev` goes up on every change and powers stale-screen checks |
| `exchangeRequests` | `familyId`, `listingId`, `requesterId`, `status`, `data` (note) | **Unique index** on `listingId + requesterId`. Re-asking reuses the row |
| `exchangeReservations` | `familyId`, `listingId` (**unique index**), `requestId`, `reservedFor`, `reservedAt` | Separate table so a listing read can never carry it by accident |
| `exchangeReports` | `familyId`, `listingId`, `reporterId`, `reason`, `status` (`open` / `kept` / `hidden`), `handledBy`, `data` (detail) | Readable only by the handler, through the function |
| `exchangeEvents` | `familyId`, `listingId`, `actorId`, `kind`, `at` | Append-only record of moderation and lifecycle decisions. Retention is **undecided** (section 12) |
| `exchangeState` | `familyId`, `enabled`, `moderators` (list of member ids), `enabledBy`, `enabledAt` | **Feature switch**, default off, one row per family |

Statuses match the preview: listings `draft`, `available`, `open`, `reserved`, `gone`, `withdrawn`, `closed`, `fulfilled`, `hidden`. Requests `waiting`, `reserved`, `released`, `declined`, `cancelled`, `closed`.

Index plan: `exchangeListings(familyId, status)`, `exchangeListings(familyId, ownerId)`, `exchangeRequests(listingId, requesterId)` unique, `exchangeRequests(familyId, requesterId)`, `exchangeReservations(listingId)` unique, `exchangeReports(familyId, status)`.

Table and index creation is a schema change, so it needs your approval at Step 7 with the exact column list. Nothing is created before that.

## 3. Reserving without double-booking

Two owners' devices, or one owner tapping twice, must produce one reservation.

- `exchangeReservations.listingId` has a **unique index**. The function inserts the row first. If Appwrite answers "already exists" (HTTP 409), the second attempt gets "This listing already changed" and nothing else is touched.
- Only after the insert succeeds does the function update the request to `reserved` and the listing to `reserved`. If either update fails, the function deletes the reservation row it just made and reports the failure, so the data never stays half-finished.
- Every state-changing action sends the `rev` the screen was showing. If it no longer matches, the function changes nothing and returns "changed", which the screen turns into the "already changed, showing the latest" message. This replaces the preview's re-read check.
- **To confirm before Step 6:** whether this Appwrite project's TablesDB transactions can wrap the three writes in one step. I have not checked. The insert-first design above works without them.

## 4. Function actions

Added to `family-api` as `function/src/exchange.js`, routed the way `giving.js` is. Every action starts with confirmed family membership, then the feature switch, then the eligibility check (section 12), then the rules.

| Action | Who | What it does |
|---|---|---|
| `exchangeHome` | eligible member | Browse list: visible, live listings only. No `pending`, no reservation fields, no other people's requests |
| `exchangeListingGet` | eligible member | One listing. Hidden, draft and withdrawn follow the preview's visibility rules. Missing and not-allowed return the same body |
| `exchangeListingSave` | owner | Create or edit. Reserved listings accept private edits only |
| `exchangeListingPublish` | owner | Publish a draft, or publish private edits when not reserved |
| `exchangeListingEnd` | owner | Gone, fulfilled, closed, withdraw. Closes requests. Withdrawn leaves the minimal record for past applicants |
| `exchangeRequestCreate` / `exchangeRequestCancel` | requester | Ask (or ask again) and cancel. Never reserves |
| `exchangeReserve` / `exchangeRequestDecline` | owner | Confirm one waiting request, or decline one |
| `exchangeRelease` / `exchangeCancelReservation` | owner / recipient | Return the item to Available. Other waiting requests stay waiting |
| `exchangeActivity` | eligible member | My activity: requests I sent, requests waiting on my listings, hidden notices |
| `exchangeReport` | eligible member | File a report |
| `exchangeReportList` / `exchangeReportResolve` | handler | Keep, hide, restore. Never on the handler's own listing |
| `exchangeSetState` | owner | Turn the feature on or off for the family |

Each response is built by an allow-list, never by passing a stored row through.

## 5. Privacy rules that matter most

- **Applicants never see each other.** A request row is returned only to its requester and to the listing owner. Example: Dana sees "reserved for someone else for now" with no name.
- **Declined people get no reason.** The decline is stored, the reason is not asked for.
- **Reporter identity.** `exchangeReports` has no path to the reported member. The owner of a hidden listing learns only "a moderator hid this".
- **Reports about the handler.** The handler never reviews a report about their own listing. Routing is a decision in section 12.
- **No realtime.** No client permission exists on these tables, so no subscription can be opened.

## 6. Pickup coordination

The preview has a "Message" button that does nothing. The real design does **not** build a new chat. Options are in section 12. Until you choose, the real Step 6 build has no pickup button, and listings tell people to arrange pickup through whichever approved channel you pick.

## 7. Photos (not approved, needs its own gate)

The preview uses 3 bundled sample images. Real photos need storage, a private bucket, resizing and delete rules, so they are **not** part of Step 6 unless you approve a separate photo design. Until then the real build is text-only. Options are in section 12.

## 8. Security checklist

- JWT-verified user only. Names come from the account, never from the request body.
- `familyId` always checked against the caller's confirmed membership. A listing from another family returns the same "not available" body.
- All text is length-limited and stripped of control characters. JSON `data` fields are parsed through an allow-list.
- Rate limits: 60 Exchange actions per member per minute (chat's pattern), 10 requests per member per hour, 10 reports per member per day.
- No new third-party services, no new secrets, no outbound network calls, no external links in listings.

## 9. Tests that will exist before anything goes live

1. The 8 rule tests, run against `exchange.js`.
2. A function test file: 409 on a second reservation, stale `rev` changes nothing, an ineligible member gets "not available", cross-family returns the missing body, hidden equals missing, applicants never see each other, reserved-edit privacy, no response key walker leak.
3. The 211 browser checks, pointed at a mocked function.
4. An end-to-end run on a **test family** only, before any real family is enabled.

## 10. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A response leaks another applicant or a reporter | Low with the allow-list | Key-walker test on every action |
| Half-finished reservation after a failed write | Medium | Insert-first plus compensating delete, tested by forcing failures |
| Wrong member treated as eligible | Depends on section 12 | Fails closed: missing eligibility data reads as ineligible |
| Moderator misuse, or no moderator available | Medium | Decision needed in section 12, honest "escalation unavailable" state |
| Records kept forever | Medium | Decision needed in section 12. Code deletes nothing by default |
| Function upload replaces the working build | Real | Exchange ships in the same tarball as the current build. Keep the previous deployment id |
| Pickup details shared publicly | Medium | The server repeats the address and contact checks |

## 11. Rollback

- **Feature switch:** `exchangeSetState` off hides Exchange in seconds, with no upload. This is the first lever.
- **Function:** Git revert does not restore a function. Rollback means activating the previous deployment in Console > family-api > Deployments.
- **Tables:** unused while the switch is off. Deleting them is optional and only done on your request.
- **Preview:** the isolated preview stays as it is and is independent of all of this.

## 12. Decisions that are yours (nothing below is assumed)

| # | Decision | Options | What the build does until you decide |
|---|---|---|---|
| 1 | **Who is eligible** | (a) Reuse the existing adult and role system once the role-lifecycle fix lands. (b) A list of approved members kept by the owner. (c) An Exchange-only flag, which you have already said you do not want | Production eligibility stays blocked. The function rejects everyone |
| 2 | **Who moderates** | (a) Members the family owner names in `exchangeState`. (b) The owner only. (c) Tree admins, which you have said should not be automatic | No real moderator. Reports queue and show "escalation unavailable" |
| 3 | **Reports about the handler or the owner** | (a) A second named moderator. (b) Owner as last resort, with "escalation unavailable" if the owner is the one accused | Honest "escalation unavailable" state, never back to the accused |
| 4 | **Retention** | Keep forever, keep with a stated end date, or let authors delete their own. Also needs a rule for moderation evidence and removed members | Nothing is deleted by code. Author "withdraw" is a status only |
| 5 | **Photos** | (a) Text-only. (b) Private bucket with membership-checked serving, like the Giving design | Text-only |
| 6 | **Pickup messaging** | (a) Open the existing family chat with the listing named. (b) A short in-Exchange note shown only to the two people. (c) Nothing, owner shares details in person | No pickup button |
| 7 | **Licence** | Root `LICENSE` says MPL 2.0 while source headers say GPL v3. New `exchange.js` needs a header | New files carry "licence not yet marked". Not changed |

## 13. What I did not verify

- I did not read the `roles-and-age-groups` branch or the `profiles` schema for this design, so how eligibility would be keyed is open.
- I did not check whether TablesDB transactions are available on this project.
- I did not read the live Appwrite project. No call to Appwrite was made.
- The live Pages preview has never been read by me, so everything about it rests on your reports.

## 14. Approvals still to come

| Step | What it is | What you will see before saying yes |
|---|---|---|
| 6 | Build the real backend on a branch, switch off, no production data | Diff, tests, exact table and column list, tarball |
| 7 | Create tables, upload the function, set permissions, live tests | The exact console steps, one at a time |
| 8 | Staged release | A test family first, then yours, with a checklist |

If you say nothing on a decision in section 12, the "until you decide" column is what the build does.
