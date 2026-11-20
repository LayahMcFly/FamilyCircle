# Update notice (browser and installed home-screen app)

**Bottom line:** every published version of the frontend has an id made from its own files. A page that is already open checks that id against the published `release.json`, and when they differ it shows an "Update available" notice. Nothing reloads until the person taps **Update now**, and unsaved work is protected first.

## What exists today
- **No build step, no service worker, no web app manifest.** GitHub Pages serves this repository as it is, from `main`. This change adds none of those. A service worker is not needed to show an update notice.
- "Installed" copies today are browser shortcuts (Add to Home Screen). They run the same page code, so they get the same notice. Nothing here was tested in a real installed shortcut; it was tested in Chrome.

## How a release gets its id
The publish workflow (`.github/workflows/publish-site.yml`, runs on every push to `main`) calls `node tools/build-site.js _site`. That copies only the website files into `_site` (an explicit list in `tools/build-site.js`: the top-level web files, `fonts/`, `vendor/`, the three preview routes and the licence files; no `function/`, `shop/`, `setup/`, tests, tools, workflows, package files or planning documents), then `tools/stamp-release.js` hashes every shipped file there (top-level `.js/.css/.html/.svg/.ico/.png`, `fonts/`, `vendor/`) and writes into `_site` only:
- `release.json` : `{ "schema": 1, "id": "<16 hex>", "entry": "index.html" }`
- the id in `<meta name="fc-release">` in `index.html` (this is what the running page reads)
- the same id as the `?v=` value on every local script and stylesheet.

The build then validates itself (stamp matches the files, `index.html` carries the id, every versioned file exists, `release-check.js` is loaded). If anything fails, the job fails and the deploy job never runs, so the live site stays as it was. The whole `_site` folder is uploaded as one artifact and that artifact is what gets published, so `release.json` and the files it describes always come from the same build. The workflow uses no secrets and never touches Appwrite.

The id comes from the content: same files, same id. Putting older files back produces the older id, which differs from the current one, so a rollback counts as an update. Ids are compared for equality only, never ordered. `maintenance.json` and `release.json` are not part of the id.
Nobody types a version number. In the repository the stamp is deliberately absent (`index.html` has an empty `fc-release` tag, and there is no `release.json`), so a page served straight from the source folder has the checker switched off instead of announcing anything. `config.js` `version` is only the footer label now.
As an extra guard the page announces a new id only after it has fetched that release's `index.html` and seen the same id in it.

## Cutover (one-time owner setting, not applied yet)
Pages has two publishing modes, and the mode decides what a push to `main` does:
- **Today (publish from the branch):** a push to `main` publishes the committed files directly, with no stamp. Merging the new code under this setting can therefore put the new frontend live before any stamped deployment exists. The checker stays silent there because the source has no release id.
- **After Settings > Pages > Build and deployment > Source is set to "GitHub Actions":** branch publishing stops. `publish-site.yml` has a push trigger, so every push to `main` still publishes automatically, but only through the workflow: build, stamp, validate, then deploy that one artifact. A failed build or validation publishes nothing.
Exact order: (1) merge to `main`, which publishes the unstamped frontend through the old mode; (2) change the Pages Source to "GitHub Actions"; (3) run the workflow once (Actions > Publish site > Run workflow) so the stamped site goes live. Open pages begin to see release ids after step 3.
What changes in the published site: it is now only the website files (backend, tests, tools and planning documents are no longer served), and files are served as they are (the old build ran Jekyll, which rendered `.md` files and skipped `_` and dot files).

## When it checks
Startup, tab visible again (also back-forward cache restores), connectivity returns, and about every 5 minutes while the page is visible. Never while offline, never two at once, at least 30 seconds apart, and failures slow the 5-minute check down (1, 2, 4 ... up to 30 minutes). The request is a plain GET with `cache: "no-store"`, a throwaway query and no credentials, so neither the browser cache nor a future service worker answers it.
Network errors, offline, a maintenance page, bad JSON, a wrong shape, or a release whose `index.html` is not live yet never show a notice and never break the app.

## The notice
A quiet bar (not a modal; it never takes focus): "Update available / A new version of FamilyCircle is ready. Update to get the latest changes." with **Update now** and **Later**. A screen reader hears a short status message. **Later** shrinks it to an "Update available" pill that stays on screen and reopens it. It never reappears by itself for the same release. If the published release becomes the running one again (a rollback of the rollback), the notice disappears.

## Updating safely
- Unsaved work = text typed by the person into a field (any non-empty edited field) or a view guard registered with `FCRelease.registerUnsaved` (About me and Appearance register theirs). If there is any, the app's own confirm dialog warns and defaults to Cancel.
- Nothing is stored. Drafts are not saved anywhere. Storage, cookies, caches and sign-in are never cleared; no service worker is registered or removed.
- Update now loads the same page again with `?r=<id>&n=<time>`, which asks for a fresh copy of `index.html` and keeps the `#/route`. That helps with the browser cache and Pages' own cache; it cannot be guaranteed to get past every proxy or CDN in between. The new page removes those parameters, checks that it really is the release it was sent for, and says "Family Circle is up to date." If it is not (a stale response from the host or any cache on the way), it says the update did not load, that nothing was lost, and offers **Try again**. It makes one attempt per tap, so there is no reload loop.

## Several tabs
Tabs are independent. Updating one tab does not touch the others; each still shows its own notice and warns before it discards its own unsaved text. Limitation: a tab left on old code may lazily load a file (for example the family tree library) that is now the new version, because GitHub Pages serves one current copy of each file. Reloading that tab fixes it.

## First rollout
Tabs and home-screen copies opened before this version is published contain no checker. They keep running old code until they are reloaded or reopened once. Only after that do they start noticing future releases.

## Rolling back (source revert and redeploy)
Deleting an unmerged branch only abandons a candidate. It is not a rollback of anything live. To roll back a published change:
1. On GitHub open the merge or commit that introduced it and use **Revert** (or `git revert <sha>`), then merge that revert into `main`.
2. The push to `main` runs the publish workflow, which builds, stamps and validates the reverted files and deploys them. Check the Actions run finished green; the site is the reverted version only after that.
3. Open pages that run a stamped build now see a different id and offer the update (if the reverted version still contains the detector).
What a revert means for the detector itself: if the reverted version does not contain `release-check.js`, every client that loads it has no update detection from then on, and a client that had the detector only learns about the revert once, offering the update to the older, detector-less page. If a deploy fails, nothing is published and the previous site stays live.
Caches: the check request uses `no-store` and a throwaway query, but intermediaries are outside our control. That is why detection compares ids, verifies the published `index.html`, and shows Try again when a response is stale.

## Platforms: what is verified
- **Desktop/mobile browser tab (Chrome, automated tests):** implemented and tested.
- **Installed home-screen shortcut:** same code, **not verified** in a real installed shortcut.
- **Android APK:** **not built, not verified.** No APK work is authorized.

## Future Android app (nothing built, nothing tested)
Keep two separate questions apart:
1. **Web release** (this mechanism): which files the page is running.
2. **Native package version** (APK or store build): which app binary is installed.
- **Remotely hosted wrapper (TWA or a WebView pointing at the site):** the web mechanism would be reused unchanged, because the page is loaded from the site. Still to test: that the wrapper's own HTTP cache or a WebView cache does not answer `release.json`, that the reload keeps sign-in, and back-button/resume behaviour. **Untested.**
- **Bundled-web-content APK (files packaged inside the app):** reloading does not update those files, so a page reload must never be presented as an update. Such an app would compare its packaged release id with `release.json` and hand off to the native update path (for example the store's in-app update) instead of the `?r=` reload. **Not implemented.**
- **Integration boundary:** `release-check.js` exposes `window.FCRelease` (`running`, `published()`, `check()`, `registerUnsaved()`, `attach()`). A future native bridge would call `check()` and replace only the accept step. No wrapper, native dependency, APK download, install permission or store link was added.
