# Family Exchange: progress checklist (standing spec: the Family Exchange master prompt)

Update this file at every step. Continue by step number. Nothing here enables Exchange for real families.

## Steps
- [x] Step 0: inspection (see "Step 0 findings" below). Waiting on answers to the batched questions.
- [x] Step 1: merged as 39a103e; her manual checks passed (reported 2026-11-18). Dialog-title contrast fix confirmed in Step 2 build. Path: /FamilyCircle/exchange-preview/
- [x] Step 2: listing lifecycle merged as c16cef8; her manual checks passed (reported 2026-11-18)
- [x] Step 3: merged as 931ac3d; her manual checks passed (reported 2026-11-19). Sample rules only, see "Step 3" below.
- [x] Step 4: merged as 786ba31; her manual checks passed (reported 2026-11-19)
- [x] Step 5: design merged as afe9dbe (`EXCHANGE-BACKEND-DESIGN.md`). It is the current draft only: its section 12 decisions are unresolved and no backend deployment is authorized
- [~] Step 6: backend code, revision 2 (source commit 280d5eb; branch `exchange-step6` tip 0bf99a4). The first candidate 22a94df is withdrawn. Revision 2 IS PRESENT in `main`'s history: GitHub's push record shows `main` fast-forwarded from 87b1cdd to 0bf99a4 on 2026-11-19 at 20:53 UTC. Who asked for that push and whether this exact commit was approved is UNKNOWN; being in `main` is not approval, and its review remains OPEN. Upload of the function and activation of any deployment are UNVERIFIED (no record either way; Appwrite was not checked); this document does not claim either occurred. No schema is recorded as created and Exchange is off by default (nobody is eligible, `persistenceVerified` is never set). The code is wired into the function's action table in `function/src/logic.js` but fails closed. The Pages publish does not include `function/`. Details in "Step 6" below.
- [ ] Step 7: external changes and dedicated live tests (each needs separate approval)
- [ ] Step 8: production release and closeout (needs release approval)

## Deferred (not in the first release, not dropped)
Lending, due dates, deposits, returns; optional priced listings; priced family-service listings; shipping labels; ratings or reviews; AI suggestions; external retailer links; push or email notifications; auctions or paid priority; partial quantities; public listings.

## Step 0 findings (2026-11-16, main at 149e0b1, v1.51.99.60)
- Hub: a "Planned" card for Family Exchange already exists (hub.js). It does not navigate. Do not touch it until Step 8.
- Preview precedent: `giving-preview/` and `recipes-publishing-preview/` are unlisted folders in the repo root, each with its own page-level CSP (connect-src none), `noindex`, a fake in-memory server and no Hub link.
- Deployment (corrected 2026-11-21): the "Publish site" workflow (`.github/workflows/publish-site.yml`) runs on every push to `main` (and manually). It builds the site from an explicit allowlist of website files, stamps and validates it, then publishes that one artifact to GitHub Pages; a push to `main` therefore publishes automatically, including the unlisted `exchange-preview/` folder, and never `function/`. The older statement here (no Pages workflow, four manual workflows) was true on 2026-11-16 and is obsolete. Before that workflow existed, Pages built from `main` directly. A Pages publish says nothing about whether any backend function was uploaded or activated.
- Eligibility: there is NO approved adult mechanism for Exchange. `ageGroup` exists on profiles but "does not limit anything yet". Giving Center has its own per-family `givingAdult` flag (owner counts as adult). Production Exchange stays disabled until you choose the mechanism.
- Messaging: family-api chat has real DMs with per-family blocks and an "allow DMs" setting. A listing could open or reuse a DM; nothing sends automatically.
- Reporting: Giving Center has its own report table and moderators (owner or tree admin who is an adult). Chat has no report feature.
- Media: Giving photos use a client-side convert/compress step, one square JPEG in the private media bucket plus a text thumbnail.
- Licence: file headers say GPL v3 or later; the `LICENSE` file at the root is MPL 2.0 text, with a GPL v3 text beside it. I will not change either. Reused code is my own from this repo.

## Step 1 decisions from you (2026-11-16), preview only, none are production policy
- Eligibility: synthetic eligible/ineligible accounts only. No Exchange adult flag. Production eligibility blocked pending a proposal.
- Moderation: one simulated designated moderator. Tree admin does not imply moderator. Real assignment undecided.
- Reports about the owner: routed to an independent handler or an honest "escalation unavailable" state. Never back to the accused. Real escalation design comes separately.
- Retention: no automatic deletion. 30/90 days NOT approved. Separate proposal for retention, author deletion, moderation evidence, removed members.
- Photos (preview only): up to 3 bundled JPEGs, 600px longest edge, about 110 KB; square thumbnails, original ratio in detail.
- Licence: LICENSE and headers untouched. New preview files carry a "licence not yet marked" line.
- Pages: before merge, show deployment uncertainty and the smallest check; verify the deployed page carries the build marker.

## Step 2 decisions from you (2026-11-17), preview only
- Relisting: keep "Start a new listing from this one". Copies item details only. Never old requests, recipient identity or reservation state.
- Withdrawn: previous applicants see a minimal closed record (title, status, poster name) and their own request status. No photos, description, pickup area or other applicants.
- Editing while reserved: private draft edits are allowed and invisible to others. Publishing material changes is blocked until the owner releases the reservation.
- Material change (preview definition, awaiting her review): any change to title (including capitals), category, condition, description text, pickup area, or photos (added, removed, reordered). Not material: extra spaces and line breaks only.
- Preview assumption to confirm: releasing returns the listing to Available; the previously reserved person's request shows "Released" and they may ask again. Other waiting requests stay waiting.

## Step 2 policy directions, round 2 (2026-11-17), preview only, not production approval
- Material changes: conservative definition accepted. Typo corrections also wait until release. While reserved, ANY text difference (even spacing) is blocked from publishing and kept as a private edit.
- Saved text is never altered: titles, descriptions and areas are stored exactly as typed. Whitespace is ignored only when deciding what counts as "material", never when saving.
- Release reservation accepted as proposed. Release never publishes private edits. The confirmation says the item becomes available again.
- Pre-reserved sample for her tests: "SAMPLE FOR TESTING: reserved lantern" (view as Dana Rowan).
- Visible build marker under the banner: "Step 2 preview · build <8 characters>", and the full hash in the footer.
- Step 3 was on hold until this candidate settled; it is now settled.

## Step 3 (2026-11-18), preview only, sample rules, not production policy
- Owner can Reserve (free item) or Accept offer (wanted post) for one waiting request at a time. Other waiting requests stay waiting and are told nothing.
- Owner can Decline a waiting request. Declined person sees a plain notice, no reason, and cannot send another request for that listing (sample assumption, to confirm).
- Requester can Cancel a waiting request, or Cancel their reservation (listing returns to Available/Open, owner sees "They cancelled", they may Ask again, which creates a waiting request).
- A waiting person on a reserved listing sees "reserved for someone else for now" with no name. Applicants never see each other.
- New "My activity" tab: Needs your reply, Reserved by you, Your requests.
- Every action re-reads current state first (stale-screen guard). Nothing is sent: no notifications, no messages.
- Still undecided for production: re-request after decline, notifications, timeouts for unanswered requests, what Messages integration looks like.

## Step 4 (2026-11-19), preview only, sample rules, not production policy
- Simulated moderator (Dana) can Keep or Hide a reported listing, and Restore a hidden one. Never on her own listing (existing rule kept).
- Hidden: leaves Browse; only the owner and moderators can open it; a direct link looks identical to a missing listing; requests go on hold; a reserved listing keeps its reservation data and returns to Reserved on restore; the owner sees "hidden by a moderator" and is never told who reported it; no editing or lifecycle buttons while hidden.
- Reported-listing state shown on each report: Open, Kept, Hidden. Keep and Hide re-read state first (stale guard).
- Access cases: ineligible accounts see only "not available for this account" on any link, with no reason; non-moderators cannot open Reports; "server says no access" shows a calm denied state and changes nothing.
- Sample quirk: report p2 was filed by Dana, who is also the simulated moderator. Real reporter/handler separation is undecided.
- Still undecided for production: who moderates, escalation when the owner is the handler, how long moderation records are kept, removed-member data, whether owners get a way to appeal.

## Open note (2026-11-19)
- The Hub's planned Family Exchange card text still says "listings, giveaways, services and deals". That is wider than the approved scope (free items and Wanted posts, no deals, services or payments). It needs a wording change with her approval before any release (Step 8). Not changed.

## Step 6 (2026-11-19, revision 2, source commit 280d5eb; branch exchange-step6; present in main, see the checklist line above)
Revision 2 replaces the first candidate (22a94df) after an independent inspection found backend issues. The first candidate must not be merged.
- Files: `function/src/exchange-rules.js`, `function/src/exchange.js`, routing in `function/src/logic.js`, `function/test/exchange.test.js`, plus `EXCHANGE-SCHEMA-PROPOSAL.md` (schema and mechanism, replaces sections 2 and 3 of the design draft). No frontend, Hub, schema, Appwrite or environment change.
- Persistence: one atomic insert per change into an append-only snapshot chain (`exchangeEvents`, UNIQUE claimKey and opKey). Nothing is applied afterwards, nothing is overwritten, a failed insert changes nothing. Full reasoning is in `EXCHANGE-SCHEMA-PROPOSAL.md`.
- Gate: the feature stays closed unless `persistenceVerified === true`, which is not set anywhere. It opens only after the Step 7 probe confirms every unique index is available and refuses a duplicate insert with 409.
- Membership binding, recipient recheck before reserving, paged membership reads and the live-listings limit are implemented and tested. The consistency boundary for membership changes is stated in the proposal.
- Fail closed: Exchange is off by default, eligibility and moderators are deliberately unset, so nobody is eligible and no report can be filed.
- Placeholder numbers to confirm: 60 requests a minute, 10 reports a day, 20 reports per listing, 40 open requests per listing, 50 live listings per member (soft under simultaneous creates), 300 on the home list.
- Package (not uploaded): built from the committed `function/` tree with fixed file dates so the checksum depends only on contents. Command: extract `git archive <commit>:function package.json package-lock.json src` into an empty folder, then `tar --sort=name --mtime='2026-01-01 00:00:00Z' --owner=0 --group=0 --numeric-owner -cf - -C <folder> package.json package-lock.json src | gzip -n`. Source commit 280d5eb (function/ is identical at the branch tip). 16 entries: package.json, package-lock.json, src/ (13 files). sha256 df3c9abbb8b5994f22062e8acf425c47f16a8107bf27d917c09512682c6fe3dc. Before any upload, her upload record must be compared with this `function/` folder, because the active deployment may hold features this tree lacks.
- Rollback: the primary function rollback target is whichever deployment is active immediately before activation. Reported active now: 6afbacf20a0e3243296c. Do not auto-pick 6afb96027ecde62c258a. Reconfirm at the activation gate. New tables stay unused while the switch is off.
- Licence: new files carry no licence statement. exchange-rules.js keeps the source file's own notice unchanged. The repository licence decision stays separate.
- Blocked decisions: eligibility source, moderators and escalation, retention, photos, pickup messaging, licence.

## Known defects in the published synthetic preview
- Reporter exposure (found 2026-11-19, after her manual pass; her earlier passes stay recorded and this later defect is listed separately): in the previously published preview, a moderator who owned the reported listing was sent that report's text and reporter name, and the screen showed a card about it. FIX MERGED AND PUBLISHED: `main` 86c5616 (2026-11-22; the Publish site run succeeded, release ID 8008c41e107a4b92). The preview's fake API now answers each account only with what the real server would, so the accused account's response contains no byte of that report (no card, placeholder or count), and deciding it is refused. The preview scripts load as `exchange-fake-api.js?v=2`, `build-marker.js?v=2` and `exchange-preview.js?v=2` so cached copies cannot mix with the new ones; the expected build marker is `exchange-preview-step4-reporter-fix` (files hash f8a961ae48eb5a5a). NOT YET VERIFIED LIVE: no live check was possible from the build session, so she should confirm the marker on the live preview and that the accused moderator's sample account sees nothing about the report.
- Hub copy: the planned card says "services and deals". Correct before release.

