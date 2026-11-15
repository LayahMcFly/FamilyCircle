# Giving Center: setup (Step 5 build, not enabled)

**Bottom line:** the Giving Center backend is written and tested, and it is **off for every family**. Nothing here changes how Family Circle works today. You only need this guide when you decide to turn Giving Center on (Step 7). The function file can be uploaded earlier or later; with no tables present it simply reports "not available".

**Nothing in this guide has been done for you.** No table, column, index or function upload exists yet.

## 1. One column on an existing table

Databases > family > `profiles` > Columns > Create column:

| Column | Type | Required | Default |
|---|---|---|---|
| `givingAdult` | Boolean | no | (leave empty) |

Empty means "kid". Owners are always adults and do not need the column set.

## 2. Six new tables

Create each under Databases > family. For every table: **Permissions tab empty, Row security off.** No role, no "Any", no "Users". Only the function reads or writes them.

| Table ID | Columns |
|---|---|
| `givingState` | `familyId` String 36 required; `enabled` Boolean; `enabledBy` String 36; `enabledAt` String 40 |
| `givingLists` | `familyId` String 36 required; `ownerId` String 36 required; `audience` String 10 required; `hiddenAt` String 40 (not required); `data` String 2000 required |
| `givingItems` | `familyId` String 36 required; `listId` String 36 required; `received` Boolean; `version` Integer (min 1); `data` String 4000 required |
| `givingReservations` | `familyId` String 36 required; `itemId` String 36 required; `buyerId` String 36 required; `version` Integer |
| `givingReports` | `familyId` String 36 required; `reporterId` String 36 required; `kind` String 10 required; `targetId` String 36 required; `listId` String 36 required; `data` String 1000 required |
| `givingNotices` | `familyId` String 36 required; `userId` String 36 required; `data` String 600 required |

## 3. Indexes

| Table | Index key | Type | Attributes | Why |
|---|---|---|---|---|
| `givingReservations` | `uniq_itemId` | **Unique** | `itemId` | Two people reserving at the same moment: exactly one wins. **This one is essential.** |
| `givingLists` | `idx_family` | Key | `familyId` | Home screen |
| `givingLists` | `idx_hidden` | Key | `hiddenAt` | 30-day cleanup |
| `givingItems` | `idx_list` | Key | `listId` | List screen |
| `givingItems` | `idx_family` | Key | `familyId` | Home screen |
| `givingReservations` | `idx_family` | Key | `familyId` | Home screen |
| `givingReports` | `idx_family` | Key | `familyId` | Review queue |
| `givingReports` | `idx_target` | Key | `targetId` | Clean up on delete |
| `givingNotices` | `idx_user` | Key | `userId` | Bell |

The `givingState` row uses the family id as its row id, so it needs no index.

## 4. Function

Console > Functions > family-api > Deployments > Create deployment > Manual. Entrypoint `src/main.js`, build command `npm install`, then Activate. The function keeps its existing scopes (it already reads and writes your tables).

**Rollback:** activate the previous deployment (the private-tasks build, or `6af8f13324b2263631c1`). Git revert does not restore a function.

## 5. Turning it on for one family (Step 7, not yet)

The real screens exist (open `#/giving` in the app). They are not linked from the Hub (the card still says "Planned"). When Giving Center is off, the **family owner** sees a **Turn on Giving Center** button there, and everyone else is told it is not turned on. Once it is on, the owner sees a **Turn off Giving Center** button at the bottom of the home screen. Turning it off hides everything at once, deletes nothing, and needs no upload. Turning it on only works after the tables in sections 1 to 3 exist.

## 6. What the backend does, in plain words

- Everyone is a kid until the owner or a tree admin marks them as an adult (never themselves). Owners are always adults.
- Only adults can reserve a gift or make a list "Adults only". Kids never see reservation information or adults-only lists.
- The person whose list it is never gets any reservation information, and is never notified when someone reserves.
- Two people reserving the same item at once: one wins, the other is told "Someone has already reserved this item."
- Reports go to owners and tree admins who are adults. The list owner is only told "removed by a family admin".
- If someone leaves the family, their lists are hidden at once and deleted after 30 days. Their reservations are released. If they are invited back, they return as a kid and their hidden lists do not come back.
- No photos yet (Step 6). The item form has no photo picker; a link shows a plain placeholder tile (the site's first letter), nothing is fetched. Links are saved as plain text and only `https://` and `http://` are accepted.

## 7. Known limits

- The "30 days" starts when someone next opens Giving Center in that family after the person left, or when the scheduled cleanup next runs (the cleanup only deletes lists already hidden). If nobody opens it for a while, the list stays unhidden-looking but is unreachable, because its owner is no longer a member.
- A person who is removed and re-invited **before** anyone opens Giving Center would get their old lists back (the hide step had not run yet). Reservations they held stay released.
- The per-minute limit (60 actions) is kept in the function's memory, so it is a brake, not a guarantee.
- Error messages show one problem at a time; per-field highlighting arrives with the real screens.

## Photos (Step 6)
- Add a text column `thumb` (not required) to `givingItems`. Done in production 2026-11-14.
- Storage: the Appwrite plan allows one bucket, so photos live in the existing `family-media` bucket (override with the function variable `GIVING_BUCKET_ID`). Each photo file is created by the function with no permissions, so members cannot open it directly; the function serves it after a membership check.
- Rollback: deleting the `thumb` column and the photo files (their ids are in each item's `photoId`) removes photos; nothing else depends on them.
