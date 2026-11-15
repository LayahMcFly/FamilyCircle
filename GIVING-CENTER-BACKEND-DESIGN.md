# Giving Center: Step 4 real backend design

**Status:** design only. Nothing in this document is built. No code, no Appwrite schema change, no function upload, no merge. Steps 5, 6 and 7 each need your separate "yes".

**Bottom line:** the Giving Center gets six new function-only tables and one new set of actions inside `family-api`, copied from the rules the passed preview already proves. Wishlists never touch the browser directly. Every read and write goes through the function, which decides who sees what. The adult flag reuses today's roles (owner, admin, tree admin) and is stored on the existing membership relationship, never self-editable. The feature stays switched off in production until Step 7.

---

## 1. What stays the same as the preview

| Rule (passed on your phone) | Where it is enforced for real |
|---|---|
| Everyone is a kid by default | Missing flag reads as kid |
| Owners, admins and tree admins mark others as adults, never themselves | `memberSetAdult` action |
| Only adults reserve and mark a list "Adults only" | `reserve`, `listSave` |
| Kids and list owners never see reservation info | Response builder strips fields; reservations live in their own table |
| Everyone sees all lists except adults-only | `home`, `listGet` filter |
| Limits: 10 lists/person, 100 items/list, title 120, notes 1000, list name 60 | `giving.js` validators, same numbers as `giving-core.js` |
| 22 two-decimal currencies | Same list, same strict price parser |
| Reporting, owner told only "removed by a family admin" | `report`, `reportResolve` |

The rule code in `giving-preview/giving-core.js` is moved, not rewritten, so the 22 rule tests keep meaning the same thing.

## 2. Where the adult flag lives

**Decision for you:** reuse existing roles; add one new field, not a new role system.

- **Who may change it:** the family owner, and any member who is a manager (admin or `profiles.treeAdmin`). Same manager test `board.js` already uses (`ctx.isOwner || treeAdmin`).
- **Never self:** the action rejects `target === caller`. Example: Ada Admin cannot mark Ada Admin as an adult; the owner or another admin must do it.
- **Owners are adults** automatically, so a family always has at least one adult who can reserve and review reports.
- **Storage:** a new `givingAdult` boolean column on the existing `profiles` table (one row per member, already used for `treeAdmin`). Only the function writes it. Missing column or missing value reads as `false` (kid), so a half-finished setup fails safe.
- **Removal and re-invite:** removing a member deactivates their lists (hidden, not deleted, for 30 days). A re-invited member returns as a kid until a manager marks them again, matching the preview.
- **Why not a new table:** one more place to forget to update. The profile row already follows the member everywhere.
- **Open question for Step 5:** whether the flag should be per family or per person. A person in two families could be an adult in one and a kid in the other. Per family is safer. This would mean storing it on the membership-linked profile for that family. I will confirm how `profiles` is keyed before Step 5.

## 3. Tables

All tables have **no client permissions at all**, the same pattern as `addresses` and the five board tables. Only `family-api` reads or writes them. Every row carries `familyId`; every query filters on it.

| Table | Key columns | Notes |
|---|---|---|
| `givingLists` | `familyId`, `ownerId`, `name`, `audience` (`everyone` / `adults`), `active`, `data` (JSON: description, created/updated) | Max 10 per owner per family |
| `givingItems` | `familyId`, `listId`, `ownerId`, `data` (JSON: title, notes, priority, price, currency, url, photo or link-picture reference, received flag) | Max 100 per list |
| `givingReservations` | `familyId`, `itemId` (**unique index**), `listId`, `reservedBy`, `reservedAt` | Separate table so a list or item read can never carry it by accident |
| `givingReports` | `familyId`, `listId`, `itemId`, `reporterId`, `reason`, `note`, `status` (`open` / `resolved`), `resolvedBy`, `resolution` | Only managers who are adults can read, through the function |
| `givingNotices` | `familyId`, `userId`, `kind`, `read`, `data` | One-time notices, such as "removed by a family admin" |
| `givingState` | `familyId`, `enabled` (bool), `enabledBy`, `enabledAt` | **Feature flag**, default off. One row per family |

Index plan: `givingLists(familyId, ownerId)`, `givingItems(listId)`, `givingReservations(itemId)` unique, `givingReports(familyId, status)`, `givingNotices(familyId, userId, read)`.

Table creation is a schema change, so it needs your approval at Step 5 with the exact column list.

## 4. Reservation without double-booking

Two people tapping "Reserve" at the same moment must produce one winner.

- `givingReservations.itemId` has a **unique index**. The function inserts the row; if Appwrite answers "already exists" (HTTP 409), the second person gets "Someone already reserved this." No read-then-write race.
- `release` only works for the person who reserved, or a manager who is an adult, after verifying the row's `reservedBy`.
- Item delete or list delete removes the reservation row in the same action.
- The preview already models this with its `insertUnique` map, so the browser tests carry over.

## 5. Function actions

Added to `family-api` as `function/src/giving.js`, routed the same way `board.js` is. Every action starts with `requireMember` (confirmed member of the family), then the feature flag check, then the rules.

| Action | Who | What it does |
|---|---|---|
| `givingHome` | member | Lists visible lists with item counts, plus notices. Kids and owners never get reservation fields |
| `givingListGet` | member | One list and its items. Adults-only lists return "not available" to kids |
| `givingListSave` / `givingListDelete` | list owner | Create, edit, delete. Only adults may set audience `adults` |
| `givingItemSave` / `givingItemDelete` / `givingItemReceived` | list owner | Item changes. Marking received clears the reservation |
| `givingReserve` / `givingRelease` | adults only, not on own list | Reserve and release |
| `givingMembers` | manager | Lists members with adult flag |
| `givingMemberSetAdult` | manager, not self | Sets the flag |
| `givingReport` | any member | Files a report on a list or item |
| `givingReports` / `givingReportResolve` | manager who is an adult | Review queue; resolve by dismissing or removing |
| `givingNoticeDismiss` | member | Marks a notice read |
| `givingSetEnabled` | family owner only | Turns the feature on or off for that family |

**Uniform "not available":** other-family, nonexistent, hidden and adults-only-for-a-kid all return the same 404 text ("That list does not exist."), copying how private calendar tasks behave. A kid cannot learn that an adults-only list exists by probing ids.

## 6. Surprise protection (the part that matters most)

A gift list owner must never learn who reserved what. The design blocks every leak path:

- **Responses:** the owner view is built from a fixed allow-list of fields. It cannot contain `reservedBy`, a reservation flag or a "reserved" count. The preview's key-walker test is ported to run against real response objects.
- **Separate table:** reservations are never joined into list or item rows.
- **Notices:** no notice is created for the owner when someone reserves.
- **Logs:** function logs record action name and ids only, never item titles or reserver names.
- **Realtime:** no realtime subscription on any giving table (no client permission exists, so none can be opened).
- **Caching:** responses are not cached by the browser (`Cache-Control: no-store` through the existing function response helper).
- **Kids:** same stripped view as owners.
- **Reports:** the owner is told only "removed by a family admin". The reporter's name never reaches the owner. Only adult managers see who reported.

## 7. Reporting and review

- Any member can report a list or item with one of the preview's reasons plus an optional note (limit 300).
- Reviewers are owners, admins and tree admins **who are adults**.
- Resolve options: dismiss (no change), or remove the item or list (hidden, owner gets the notice above).
- Reports are never deleted by the app; resolved ones stay as a record.
- A reporter cannot see who else reported or what the outcome was beyond "thanks, an admin will look".

## 8. Photos and link pictures (needs its own approval at Step 6)

| Option | Works how | Risk | Recommendation |
|---|---|---|---|
| Upload a photo | Resized in the browser, stored in a **private** bucket `givingPhotos`, served only through the function with a membership check | Storage cost; photos are personal | Yes, Step 6 |
| Paste an image address | Stored as text, shown via `<img>` | The CSP currently limits images to your own sources; allowing any site weakens it and leaks the viewer's IP to that site | Not recommended |
| Server fetch from a product link | The function downloads the page's picture and saves a copy | Fetching arbitrary sites from your server is an abuse path (SSRF); retailers block bots; copyright | **Not authorised.** Needs a separate yes and its own design |
| Keep the simulated tile | A coloured tile with the site name | None | Default until you approve more |

Until Step 6, real wishlists store no images. Item links are saved as text and shown as plain `https://` links only (`javascript:` and other schemes rejected by `cleanUrl`).

## 9. Security checklist

- JWT-verified user only; names come from the account, never from the request body.
- `familyId` always checked against the caller's confirmed membership.
- All text length-limited and stripped of control characters; JSON `data` fields parsed through an allow-list.
- Rate limit: 60 giving actions per member per minute (matching chat's pattern), reports capped at 10 per member per day.
- No new third-party services, no new secrets, no new outbound network calls.

## 10. Tests that will exist before anything goes live

1. The 22 rule tests, now run against `giving.js` instead of the fake server.
2. A new function test file: 409 on double reserve, kid blocked from reserve and adults-only, self-adult change rejected, owner response has no reservation keys, cross-family returns 404, flag off returns "not available".
3. The 81 browser checks, pointed at a mocked function.
4. A final end-to-end run on a **test family** only, before any real family is enabled.

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A response leaks reservation info | Low if the allow-list is used | Key-walker test on every action; code review of the response builder |
| Wrong person marked adult | Medium (human error) | Only managers; change recorded with who and when; kids can be marked back |
| Function upload replaces the working calendar build | Real | Giving code ships in the same tarball as the current build; keep the previous deployment id for rollback |
| Missing `givingAdult` column | Medium | Reads as kid; setup guide lists the column; function says "finish setup" rather than failing silently |
| Reports used to harass someone | Low | Adult review, reporter hidden from the owner, 10/day cap |
| Photos stored forever | Medium (Step 6) | Delete with item or list; 30-day removal cleanup |

## 12. Rollback

- **Feature flag:** `givingSetEnabled` off hides the feature in seconds without any upload. This is the first lever.
- **Function:** Git revert does **not** restore a function. Rollback means activating the previous deployment in Console > family-api > Deployments (currently `6af8f13324b2263631c1`, or the private-tasks build once you upload it).
- **Tables:** new tables are unused when the flag is off. Deleting them is optional and only done on your request.
- **Hub card:** stays "Planned" and non-clickable until Step 7.

## 13. The approvals I will ask for later

| Step | What it is | What you will see before saying yes |
|---|---|---|
| 5 | Build the real backend, not enabled | Diff, tests, exact table and column list, tarball. Then you create the tables and upload the function |
| 6 | Real photos | Bucket permissions, size limits, delete behaviour, cost note |
| 7 | Staged turn-on | Turn on for a test family first, then yours, with the checklist |

## 14. Questions for you (answer only if you have a preference)

1. **Adult flag per family or per person?** I recommend per family (section 2).
2. **Reporter hidden from other reporters?** Recommended yes.
3. **Removed members' lists:** hide for 30 days, then delete. OK, or keep forever?

If you say nothing, I use the recommended answers.
