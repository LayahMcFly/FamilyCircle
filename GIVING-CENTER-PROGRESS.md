# Giving Center: progress and plan

Branch `giving-center-preview` (from `main` at v1.51.99.22, commit `bb6ed16`). Standing spec: the Giving Center master prompt. This file is the concise checklist. Implementation, deployment and verification are recorded separately and never merged into one claim.

## Status

| Step | Implementation | Deployed / production effect | Your manual verification |
|---|---|---|---|
| 0 Inspect and plan | Done | None | Waiting for your review |
| 1 Synthetic UI preview | Done | None | Passed (you, 2026-11-14, phone) |
| 2 Wishlist behavior (fake backend) | Done | None | Passed (you, 2026-11-14, phone) |
| 3 Reservations and surprise privacy (fake backend) | Done, includes adult or kid, adults-only lists, reporting | None | Passed (you, 2026-11-14, phone) |
| 4 Real backend design and approval gate | Not started | None | n/a |
| 5 to 7 | Not started, need your approvals | None | n/a |

## Checklist

**Finished (built and tested on my side only)**
- [x] Step 0: inspected the repo, wrote the plan, file list and 12 decisions
- [x] Preview page with a strict "no network" rule and a banner that says it is sample data
- [x] Sample people: a wishlist owner, two gift-givers, two accounts without access, a removed member, and a second family
- [x] Wishlists: create, rename, delete (with confirmation), up to 10 per person
- [x] Items: add, edit, delete, mark received and not received, up to 100 per list
- [x] Item fields: title, notes, priority, optional link, estimated price with a currency, simulated photo
- [x] Safe links only (https or http), prices parsed strictly (a bug that read "1,5" as 15 was found and fixed)
- [x] Estimated totals shown per currency, never mixed, labeled reference only
- [x] Reserve and release, with only one active reservation per item
- [x] Surprise privacy: the list owner never receives any reservation information; the buyer sees their own; other givers see "Reserved" with no name
- [x] "Changed since you reserved" flag for title, link and price edits
- [x] Received or deleted items release the reservation and the buyer gets a notice
- [x] Removed buyer releases reservations; removed owner makes lists unreachable; re-invite starts clean
- [x] Adult or kid control by owners, admins and family tree admins (nobody changes their own); kids cannot reserve or see adults-only lists, no owner bypass; other family and made-up ids get the same plain answer
- [x] Network conditions: slow, server error, fail once, access denied
- [x] Switching person or family clears the screen and drops late answers
- [x] Phone and desktop screenshots, no sideways scroll, every control themed
- [x] 16 rule tests and 51 browser checks passing
- [x] Adults-only wishlists, so a gift list for a child stays a surprise
- [x] Reporting for lists and items, with an admin review list (dismiss or remove)
- [x] Pushed to branch `giving-center-preview` (nothing deployed)

**Not finished**
- [ ] You have not yet tested the preview (checklist F in the handoff)
- [x] Your answers on the 12 decisions (recorded above)
- [ ] Decide how the real version gets a picture from an item's link (you chose: keep simulated for now; settle at Step 4)
- [x] Adult flag location proposed in the design (profiles column, managers only, never self); needs your yes
- [x] Step 4: real backend design written (`GIVING-CENTER-BACKEND-DESIGN.md`). approved by you 2026-11-14 (third answer: removed members' lists hidden 30 days, then deleted)
- [x] Step 5: real backend built and tested (23 new tests), OFF for every family. Not yet uploaded: tables and function are your actions (`GIVING-CENTER-SETUP.md`)
- [x] Step 5b: real screens built and tested (`giving-ui.js` real mode, `giving.js`, `giving.css`, route `#/giving`), version 1.51.99.24. Hub card still "Planned". On the branch only, not merged
- [ ] Step 6: real photo upload. Needs approval
- [ ] Step 7: staged turn-on for real family members. Needs approval
- [ ] Hub card still says Planned and is not clickable (change only after approval)
- [ ] Merge to main (not requested yet)
- [ ] Later phases only mapped, never built: requests and pledges, gift exchanges, emergency assistance, processed contributions
- [ ] Never in scope: shop or Printify, checkout, wallet, charging, ads or affiliate links

## Step 0 inspection record

- **Main:** `bb6ed16`, v1.51.99.22. Giving Center exists only as a non-clickable **Planned** card on the Hub (`hub.js`, id `giving`). No module, route, table, action or test exists for it.
- **Branch pushes do not deploy.** GitHub Pages builds from `main` only. The four workflows in `.github/workflows` are all manual (`workflow_dispatch`) and none runs on push. A push of this branch cannot reach production or write data.
- **Existing preview pattern (reused):** the Events preview on `events-minimum` and the Recipes preview. Each lives in its own folder with its own `index.html`, a strict Content Security Policy (`connect-src 'none'`), an in-memory fake server and Node plus browser tests. No existing file is changed. Giving Center follows it exactly: `giving-preview/`.
- **Look and feel reused (nothing new):** `styles.css`, `fonts.css`, `themes.css` and `theme.js` (light, dark, system), the `.card`, `.btn`, `.badge`, `.alert`, `.hint`, `.tabs` classes, the themed form controls at the end of `styles.css` (design rule 1), `<dialog>` confirmations like `confirmDialog`, toasts. The preview adds only a small `giving.css` for layout, using the app's color variables. No framework, font, icon service or script is added.
- **Eligibility:** no approved mechanism exists. `profiles.ageGroup` is a free label (kid, teen, adult, grandparent, other) that was explicitly added as a label only. The minors policy is undecided. So the real feature stays disabled; the preview uses a plain per-account yes or no ("has Giving Center access") with no birthday or age logic.
- **Existing helpers I can reuse later (backend stage):** `requireMember`, the confirmed-membership check, team-read row permissions, the function-only table pattern (as used by the address and calendar tables), and chat's block and report tables.
- **Safety gap to flag now:** chat has blocking and moderation tables. Wishlist text, notes and links written by one member are shown to others, and there is no way yet to report them. Before any production release this needs either reuse of the chat reporting path or a decision to accept the gap. No report button is invented in the preview.
- **Licensing:** all preview code is new, written for this repository, and carries the GPL v3 header. No third-party code is copied.

## Not bundled (left untouched)

Tree-name work, role-membership binding, Events, Recipes and Family Board migration (the Calendar is already merged separately), Shop and Printify, licensing, and the other Planned cards.

## File plan (all new, no existing file changed)

- `giving-preview/index.html`: preview page with its own CSP (`connect-src 'none'`), banner, controls.
- `giving-core.js` (moved to the repository root so the real app can use it): validation and rules shared by the fake server, the screens and the tests (text, safe links, estimated prices with currency, limits).
- `giving-preview/giving-fake-server.js`: in-memory fake of the proposed server actions, with synthetic accounts and families.
- `giving-ui.js` (moved to the repository root; the preview and the real app both use it): the screens.
- `giving-preview/giving-preview.js`: starts it.
- `giving-preview/giving.css`: layout only.
- `tests/giving/giving.test.js`: rule tests (Node, no dependencies).
- `tests/browser/giving-preview.spec.js`: real Chrome checks.
- `GIVING-PREVIEW.md`: how to open, what persists, how to reset.

## Preview entry point and reset

Open locally with `python3 -m http.server 8000` from the repository root, then `http://localhost:8000/giving-preview/index.html`. Everything lives in memory. A reload, or the **Reset sample data** button, restores the starting data. Nothing is written to the browser's storage.

## Hard dependencies versus preferred sequencing

- **Hard (block the real backend, not the preview):** an approved eligibility mechanism; the surprise policy; the reservation uniqueness design (unique key on one row per item); a decision on photos; the reporting gap.
- **Preferred:** finish Steps 1 to 3 and your review before any backend design is requested.

## Decisions to settle (one batch)

Defaults shown are what the preview does. They are proposals, not approvals.

1. **Eligibility source.** Who counts as adult-eligible, and where is that recorded? (No birthday inference, no owner bypass, no new profile admin flags.) Preview: per-account yes or no.
2. **Surprise policy.** Recipient sees no reservation clue and no buyer. Buyer sees their own reservation. Other eligible givers see "Reserved" with no identity. Confirm.
3. **Reservation expiry.** Preview: none in v1. If you want one, you choose the duration.
4. **Abandoned reservations.** Preview: only the buyer can release. No owner override. Confirm, or specify a process.
5. **Item edited while reserved.** Preview: reservation stays. Only the buyer sees "Changed since you reserved". Edits to title, link or price count; notes and priority do not.
6. **Recipient marks an item received while reserved.** Preview: reservation closes; the buyer sees "Marked received".
7. **Member removed.** Preview: a buyer's reservations are released; a recipient's lists become unreachable and reservations on them are void. **Re-invite:** starts clean, old reservations are not revived, and the person's old lists are not restored automatically. Confirm.
8. **Who sees which lists.** Preview: every eligible member of the family sees every member's lists. The data model keeps room for a per-list audience later.
9. **Limits (proposed, not approved).** 10 wishlists per person, 100 items per list, title 120 characters, notes 1000, list name 60.
10. **Currencies.** You asked for more. The preview now offers 22 two-decimal currencies (USD, CAD, GBP, EUR, AUD, NZD, MXN, BRL, INR, PKR, PHP, NGN, ZAR, KES, AED, SGD, HKD, CHF, SEK, NOK, DKK, PLN), chosen per item. Currencies with no cents, such as JPY, are not offered yet. Estimated prices are reference only and totals are shown per currency, never added across currencies.
11. **Photos.** Preview simulates sample photos from a list; no upload. Real photos need your approval of formats, limits, private storage and cleanup first.
12. **Reporting gap** (above): reuse chat reporting, or accept the gap for a first private release?

## Your answers (2026-11-14)

| # | Decision | Your answer | In the preview |
|---|---|---|---|
| 1 | Who is an adult | Everyone is a kid automatically. Owners, admins and family tree admins control someone's age. Only adults can keep a wishlist public or adults only (for example a gift for the child) | Built |
| 2 | Surprise rule | Yes | Built |
| 3 | No reservation expiry in v1 | Yes | Built |
| 4 | Only the buyer releases | Yes | Built |
| 5 | Edit flag for title, link, price | Yes | Built |
| 6 | Received closes the reservation | Yes | Built |
| 7 | Removal and re-invite rules | Yes (a re-invited person is a kid again) | Built |
| 8 | Everyone sees every list | Yes, except adults-only lists | Built |
| 9 | Limits | Approved | Built |
| 10 | Currencies | More wanted | 22 currencies |
| 11 | Photos | Approved as planned | Simulated, link picture simulated |
| 12 | Reporting | Wanted for wishlists too | Built (report, admin review, dismiss or remove) |

Kids can have wishlists, see public lists and report. They cannot reserve, cannot see adults-only lists, and never receive reservation information. Reports are reviewed by owners, admins and family tree admins who are marked as adults. The owner of a reported item is told only that an admin removed it, never who reported it.

Later phases (requests and pledges, gift exchanges, emergency assistance, processed contributions) stay mapped only and are not built.

## Step 5b: real screens (2026-11-14)

- Files: `giving-core.js`, `giving-ui.js` (moved out of `giving-preview/`), `giving.css` (the screen styles, shared with the preview), `giving.js` (the adapter to the function).
- The preview still works the same: `giving-preview/index.html` loads the shared files from the root. Its own CSS now holds only the preview page shell.
- Real mode differences: no sample banner, no viewer switcher, no photo picker, owner-only turn on/off buttons, "not turned on" screen.
- Reached only at `#/giving`. The Hub card stays "Planned" and does not link there.
- Tests: `tests/browser/giving-real.spec.js` (37 checks: real screens + real function code on an in-memory database), `tests/browser/giving-in-app.spec.js` (7 checks: wiring into the app), preview 81 checks and rule tests 22 unchanged and passing.

## Step 6 (photos) and layout fix, 2026-11-14
- Photo picker, viewer and remove are in the real screens; function needs `family-media` (plan allows one bucket) and the `thumb` column (added).
- Layout fix (v1.51.99.25): side padding on the Giving screens, equal-height buttons with no stray top margin, item actions in their own row.
- v1.51.99.26: photo picker accepts any picture type the browser can open (JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC where supported), converts it to JPEG, shows original and sent sizes, and has a Picture size choice (600 / 800 / 1000 px). Photos up to 60 MB are compressed on the device to under 250 KB. An unreadable HEIC gets a plain message.
- v1.51.99.27 (Step 7): the Hub card for Giving Center is a real link to #/giving for every member. A family whose owner has not turned Giving on sees the short "not turned on" screen (members are told to ask the owner; the owner gets the Turn on button). Rollback: put the card back into PLANNED in hub.js.
- v1.51.99.27: new calendar tasks start on the signed-in person, so they start Private; adding someone else turns Private off by itself. Repost original box tidied (40 px avatar beside the name, short date).

## Link pictures (approved 2026-11-15), v1.51.99.28
- Only when a person taps "Get a picture from the link" on an item. Nothing is fetched automatically, when saving, or when anyone views a list.
- New action `givingLinkPicture` (function/src/link-picture.js): https only, port 443, no passwords; the name is resolved and refused if any answer is private/loopback/link-local/metadata/carrier-grade; the connection is pinned to the checked address; redirects (max 3) and the picture address are vetted the same way; 4 s timeout; page read capped at 600 KB, picture at 1.5 MB; only real JPEG/PNG/WebP/GIF bytes (never SVG or HTML); 10 tries per person per 10 minutes; nothing stored by the lookup. The app then shrinks the picture and saves it exactly like an uploaded photo.
- Many shops block automated visits (the lookup then says no picture was found and offers the photo upload). It reads the shop's own share picture (og:image); it never copies prices or text.
- Needs the new function upload. Rollback: upload the previous function tarball; the button then shows a plain error and uploads still work.
- v1.51.99.29: link pictures now say when a shop refuses or shows a robot check (then: save the picture and upload it), and also read schema.org Product data and the main product image tag. Family Circle does not pretend to be another service's crawler (such as Discord's) to get past a shop's bot rules.
- v1.51.99.30: link pictures never wait forever (10 s overall limit on the function, 20 s on the screen); a shop that does not answer gets its own plain message. Etsy and Amazon block automated visits, so for them the photo picker is the way.
- v1.51.99.31: Etsy listing links show their picture through Etsy's own API (function/src/etsy.js, action givingEtsyPicture). Never stored; shown with Etsy's required notice. Needs ETSY_API_KEY; without it nothing changes. Amazon has no usable free route (its Creators API needs an approved Associates account with 10 qualifying sales in 30 days), so Amazon pictures stay upload-only.
