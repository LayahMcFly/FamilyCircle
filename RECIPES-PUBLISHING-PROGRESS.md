# Recipes family publishing: progress

Branch `recipes-publishing-preview`. Slice 1 is a hidden preview only. No schema, permission, function, deployment or live-app change.

## Decisions accepted (2026-11-16)
1. Private drafts stay on the device until published.
2. An author who leaves: their published recipes are hidden at once, kept 30 days, then deleted. Re-inviting never restores them; the author republishes from a device draft.
3. Published photos: one fixed square JPEG (cropped square), size-capped.
4. Readers: every confirmed member who passes the existing feature check. No new age rule.

## Slice 1, version 2 (2026-11-16): the preview now IS the real Recipes screen
The first preview had its own look. This version loads the real `recipes.js` and the app's styles, and adds the sharing parts through an optional `X.publish` hook in `recipes.js` (v2.3.0). With no `X.publish`, the Recipe Book behaves exactly as before (recipes-native: 59 of 59). Added: three section chips (My Recipes, My Cookbooks, Family Library), a status badge on each card, a Sharing panel on the recipe page, a read-only shared recipe page (Cook mode, Timer, Print, no Edit/Remove), and a remove-choice when the recipe is published. Photos are checked as real square JPEGs by reading the JPEG header.

## Slice 1, version 1 (superseded)
- `recipes-pub-core.js`: shared rules (labels, snapshot, validation, state, read/author checks).
- `recipes-publishing-preview/`: hidden page (noindex, unlinked, fake data, forgets on reload), fake server, screens.
- Tests: `node --test tests/recipes-pub/*.test.js` and `tests/browser/recipes-pub-preview.spec.js`.
- Not in this slice: cookbooks, real backend, real photo cropping, PDF export. Fake-backend tests do not prove live permissions.
