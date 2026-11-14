# Giving Center: progress and plan

Branch `giving-center-preview` (from `main` at v1.51.99.22, commit `bb6ed16`). Standing spec: the Giving Center master prompt. This file is the concise checklist. Implementation, deployment and verification are recorded separately and never merged into one claim.

## Status

| Step | Implementation | Deployed / production effect | My manual verification |
|---|---|---|---|
| 0 Inspect and plan | Done (this file) | None | Waiting for your review |
| 1 Synthetic UI preview | Built on this branch | None | Not yet tested by you |
| 2 Wishlist behavior (fake backend) | Built on this branch | None | Not yet tested by you |
| 3 Reservations and surprise privacy (fake backend) | Built on this branch | None | Not yet tested by you |
| 4 Real backend design and approval gate | Not started | None | n/a |
| 5 to 7 | Not started, need your approvals | None | n/a |

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
- `giving-preview/giving-core.js`: validation and rules shared by the fake server, the screens and the tests (text, safe links, estimated prices with currency, limits).
- `giving-preview/giving-fake-server.js`: in-memory fake of the proposed server actions, with synthetic accounts and families.
- `giving-preview/giving-ui.js`: the screens.
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
10. **Currencies (proposed).** USD, CAD, GBP, EUR, AUD, chosen per item. Estimated prices are reference only and totals are shown per currency, never added across currencies.
11. **Photos.** Preview simulates sample photos from a list; no upload. Real photos need your approval of formats, limits, private storage and cleanup first.
12. **Reporting gap** (above): reuse chat reporting, or accept the gap for a first private release?

Later phases (requests and pledges, gift exchanges, emergency assistance, processed contributions) stay mapped only and are not built.
