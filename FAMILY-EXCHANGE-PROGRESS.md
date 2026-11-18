# Family Exchange: progress checklist (standing spec: the Family Exchange master prompt)

Update this file at every step. Continue by step number. Nothing here enables Exchange for real families.

## Steps
- [x] Step 0: inspection (see "Step 0 findings" below). Waiting on answers to the batched questions.
- [~] Step 1: merged to main as 39a103e. DEPLOYMENT AND MANUAL VERIFICATION PENDING her report (a matching marker only proves the file is served). Path: /FamilyCircle/exchange-preview/
- [~] Step 2: listing lifecycle built on branch `exchange-step2`, NOT merged; needs her approval of the exact commit before it can replace the deployed Step 1 preview
- [ ] Step 3: interest and reservations (sample accounts)
- [ ] Step 4: safety and access simulation
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
