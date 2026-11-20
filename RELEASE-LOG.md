# Release log

## 2026-11-19: "Support the site" footer button and update notification (COMPLETED)

**Published source:** `main` at `ed273ac354656f7f7d61f253de4069c89b65690c` (fast-forward from `0bf99a4`). GitHub Pages now builds from GitHub Actions (`.github/workflows/publish-site.yml`). Workflow run 44664875974 (push to `main`) succeeded; the deployment record shows source `ed273ac`. Release id `6454a8c6f7b60307`, which matches an independent local build of the same commit.

**What shipped**
- Footer button "Support the site" opens a popup with the Cash App handle `$LayahMcFly` (link, Copy handle) and a disabled "Watch ads" option marked "Coming soon". No payment form, ad network or tracking.
- Update detection: each publish gets a content-derived release id (`release.json`, a `fc-release` meta tag, `?v=` asset values). The page checks on startup, when the tab becomes visible, when the connection returns and about every 5 minutes. A different published release (including a rollback) shows "Update available" with "Update now" and "Later". Unsaved work is protected, and a stale reload shows "update did not load" with Try again. No service worker, no manifest, no storage clearing.
- The site is built from an explicit allowlist of website files (no backend, tests, tooling or planning documents are published).

**Live checks reported by the owner (2026-11-19, about 22:05 ET):** "Everything works." These were her manual checks on the live site; Claude could not reach the live site from its workspace.

**Platform limitations (not verified)**
- Tabs opened before this release do not contain the detector. Each needs one manual reload (or a normal navigation) once.
- The update transition on an already-open old tab was not exercised on the live site.
- Installed shortcuts (home-screen or installed-app windows): behavior not verified.
- Android APK: not built and not tested. A remotely hosted wrapper could reuse the web check but still needs testing. A bundled-content APK would not update from a page reload.

**Recovery:** in GitHub, set Pages Source back to "Deploy from a branch", branch `main`, folder `/ (root)`, then push a revert of `0bf99a4..ed273ac` to `main`. Previous state: `main` `0bf99a4`, legacy "pages build and deployment" run 44613161637.

**Not part of this release:** Family Exchange work, the Exchange probe (paused), the preview reporter-leak fix (`3172e01`), the Hub copy change and the family-tree redesign.
