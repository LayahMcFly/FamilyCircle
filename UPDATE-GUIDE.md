# Update notice (browser and installed home-screen app)

**Bottom line:** every published version of the frontend has an id made from its own files. A page that is already open checks that id against the published `release.json`, and when they differ it shows an "Update available" notice. Nothing reloads until the person taps **Update now**, and unsaved work is protected first.

## What exists today
- **No build step, no service worker, no web app manifest.** GitHub Pages serves this repository as it is, from `main`. This change adds none of those. A service worker is not needed to show an update notice.
- "Installed" copies today are browser shortcuts (Add to Home Screen). They run the same page code, so they get the same notice. Nothing here was tested in a real installed shortcut; it was tested in Chrome.

## How a release gets its id
`node tools/stamp-release.js` hashes every shipped file (top-level `.js/.css/.html/.svg/.ico/.png`, `fonts/`, `vendor/`) and writes:
- `release.json` : `{ "schema": 1, "id": "<16 hex>", "entry": "index.html" }`
- `<meta name="fc-release" content="<id>">` in `index.html` (this is what the running page reads)
- the same id as the `?v=` value on every local script and stylesheet, so a release also busts the browser cache for its files.

The id is content-derived: same files, same id. So a rollback (putting older files back) produces the older id, which differs from the current one, so it counts as an update. Ids are only compared for equality, never ordered. `maintenance.json` and `release.json` are not part of the id.

**Nobody types a version number.** The stamp is generated; `config.js` `version` is now only the label in the footer. The test `tests/release-stamp.test.js` fails when files changed and the stamp was not regenerated, so a stale stamp cannot slip through unnoticed.
Release and files are published together: Pages publishes one commit as one site, so `release.json` is never live before the files it names. As an extra guard the page only announces a new id after it has fetched that release's `index.html` and seen the same id in it.

Optional stronger setup (needs your approval because it changes the Pages source setting): build the stamp in a GitHub Actions deploy so it can never be forgotten. Not done here.

## When it checks
Startup, tab visible again (also back-forward cache restores), connectivity returns, and about every 5 minutes while the page is visible. Never while offline, never two at once, at least 30 seconds apart, and failures slow the 5-minute check down (1, 2, 4 ... up to 30 minutes). The request is a plain GET with `cache: "no-store"`, a throwaway query and no credentials, so neither the browser cache nor a future service worker answers it.
Network errors, offline, a maintenance page, bad JSON, a wrong shape, or a release whose `index.html` is not live yet never show a notice and never break the app.

## The notice
A quiet bar (not a modal; it never takes focus): "Update available / A new version of FamilyCircle is ready. Update to get the latest changes." with **Update now** and **Later**. A screen reader hears a short status message. **Later** shrinks it to an "Update available" pill that stays on screen and reopens it. It never reappears by itself for the same release. If the published release becomes the running one again (a rollback of the rollback), the notice disappears.

## Updating safely
- Unsaved work = text typed by the person into a field (any non-empty edited field) or a view guard registered with `FCRelease.registerUnsaved` (About me and Appearance register theirs). If there is any, the app's own confirm dialog warns and defaults to Cancel.
- Nothing is stored. Drafts are not saved anywhere. Storage, cookies, caches and sign-in are never cleared; no service worker is registered or removed.
- Update now loads the same page again with `?r=<id>&n=<time>` (defeats a cached `index.html`), keeping the `#/route`. The new page removes those parameters, checks that it really is the release it was sent for, and says "Family Circle is up to date." If it is not (a stale host or CDN), it says the update did not load, that nothing was lost, and offers **Try again**. It makes one attempt per tap, so there is no reload loop.

## Several tabs
Tabs are independent. Updating one tab does not touch the others; each still shows its own notice and warns before it discards its own unsaved text. Limitation: a tab left on old code may lazily load a file (for example the family tree library) that is now the new version, because GitHub Pages serves one current copy of each file. Reloading that tab fixes it.

## First rollout
Tabs and home-screen copies opened before this version is published contain no checker. They keep running old code until they are reloaded or reopened once. Only after that do they start noticing future releases.

## Deployment and rollback requirements
- Run `node tools/stamp-release.js` before committing any frontend change (the test fails otherwise). Commit `release.json` and `index.html` with the change.
- Rollback: revert the commit (the stamp reverts with it). Open pages then see a different id and offer the update. A rollback that leaves the stamp unregenerated would be caught by the test.
- GitHub Pages caches files at its edge for about 10 minutes. `release.json` and the verification request use throwaway queries and `no-store`, so the check itself is not delayed; the `?r=` reload avoids a cached `index.html`.

## Future Android app (nothing built, nothing tested)
Keep two separate questions apart:
1. **Web release** (this mechanism): which files the page is running.
2. **Native package version** (APK or store build): which app binary is installed.
- **Remotely hosted wrapper (TWA or a WebView pointing at the site):** the web mechanism would be reused unchanged, because the page is loaded from the site. Still to test: that the wrapper's own HTTP cache or a WebView cache does not answer `release.json`, that the reload keeps sign-in, and back-button/resume behaviour. **Untested.**
- **Bundled-web-content APK (files packaged inside the app):** reloading does not update those files, so a page reload must never be presented as an update. Such an app would compare its packaged release id with `release.json` and hand off to the native update path (for example the store's in-app update) instead of the `?r=` reload. **Not implemented.**
- **Integration boundary:** `release-check.js` exposes `window.FCRelease` (`running`, `published()`, `check()`, `registerUnsaved()`, `attach()`). A future native bridge would call `check()` and replace only the accept step. No wrapper, native dependency, APK download, install permission or store link was added.
