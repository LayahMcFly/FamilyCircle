# Family Exchange: progress checklist (standing spec: the Family Exchange master prompt)

Update this file at every step. Continue by step number. Nothing here enables Exchange for real families.

## Steps
- [x] Step 0: inspection (see "Step 0 findings" below). Waiting on answers to the batched questions.
- [x] Step 1: merged as 39a103e; her manual checks passed (reported 2026-11-18). Dialog-title contrast fix confirmed in Step 2 build. Path: /FamilyCircle/exchange-preview/
- [x] Step 2: listing lifecycle merged as c16cef8; her manual checks passed (reported 2026-11-18)
- [x] Step 3: merged as 931ac3d; her manual checks passed (reported 2026-11-19). Sample rules only, see "Step 3" below.
- [~] Step 4: safety and access simulation built on branch `exchange-step4`, NOT merged; needs her approval of the exact commit
- [ ] Step 5: real backend design gate (needs approval)
- [ ] Step 6: approved backend implementation (branch only, production disabled)
- [ ] Step 7: external changes and dedicated live tests (each needs separate approval)
- [ ] Step 8: production release and closeout (needs release approval)

## Deferred (not in the first release, not dropped)
Lending, due dates, deposits, returns; optional priced listings; priced family-service listings; shipping labels; ratings or reviews; AI suggestions; external retailer links; push or email notifications; auctions or paid priority; partial quantities; public listings.

## Step 0 findings (2026-11-16, main at 149e0b1, v1.51.99.60)
- Hub: a "Planned" card for Family Exchange already exists (hub.js). It does not navigate. Do not touch it until Step 8.
- Preview precedent: `giving-preview/` and `recipes-publishing-preview/` are unlisted folders in the repo root, each with its own page-level CSP (connect-src none), `noindex`, a fake in-memory server and no Hub link.
- Deployment: no Pages workflow in the repo. All four workflows are manual (`workflow_dispatch`), so a push runs nothing. GitHub Pages appears to publish from `main` directly; I cannot read the Pages settings through the proxy, so a deployment check needs your confirmation or a page fetch.
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
