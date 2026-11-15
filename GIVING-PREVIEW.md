# Giving Center preview (Steps 1 to 3, sample data only)

This is a clickable preview of wishlists and private gift reservations. It runs on an in-memory fake server with invented people. It is not connected to Appwrite, your family or the live site, and no existing app file was changed.

## Open it
From the repo folder: `python3 -m http.server 8000`, then open `http://localhost:8000/giving-preview/index.html`.
Everything resets when you reload, or press **Reset sample data**. The page's CSP blocks every network request, and it uses no localStorage, cookies or URL parameters.

## What the fake server does
- Owner views never contain any reservation field. Buyers see their own reservation. Other givers see "Reserved" with no name.
- One active reservation per item, kept by a unique key per item. The same person asking twice is safe; a second person is refused.
- Eligibility is a plain yes/no per account (a stand-in, since no real eligibility rule is approved). No owner bypass.
- Other family, removed member and a made-up id all get the same "not available" answer.

## What is not real
Photos (sample pictures only), Appwrite tables, permissions, the real function, real eligibility, notifications beyond a simple in-page notice, and anything financial.

## Tests
`node --test tests/giving/giving.test.js` (16 rule tests) and `cd tests/browser && node giving-preview.spec.js` (51 checks). These prove the simulated rules and screens, not Appwrite.
