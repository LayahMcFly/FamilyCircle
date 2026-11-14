# Calendar port plan (Family Board into Family Circle)

Status: PLAN ONLY. Nothing is built, deployed or changed in production.

## What moves (your choices)
- Calendar (month and week), tasks, task groups, repeating and multi-day tasks, steps, "special" days, check-off record (who completed what, who it was for).
- Shopping / products list (bought, running low, delete).
- Alerts: the notification bell, plus device alerts (see "Alerts" below).
- Change requests: members ask, owners/admins accept, reject or ignore.
- Not moving: cycle tracker, Doppelme avatars, the bread themes and cursor effects, the separate Supabase sign-in, "private local mode".

## How it fits Family Circle
- Native page, not an embed: `board.js`, route `#/calendar`, a Hub card (Hub side of the bottom bar, like Recipes). Family Circle theme, icons and input styling only.
- Same account and same family. The people on the board are the family's members (names and pictures from Family Circle profiles). No invites, no workspaces, no second login.
- Roles come from Family Circle (owner, admin, member), not a second set.
- GPL header kept (C) 2026 Leia; the Board's changes noted.

## Data (needs approval before any change)
New tables in database `family`, one family per row set, readable only by that family's members:
boardTasks, boardGroups, boardHistory, boardRequests, boardProducts (+ a notifications table if the existing Activity feed cannot carry board alerts).
All writes go through new `family-api` actions so permissions and approvals are enforced on the server, not in the browser.

## Order of work (each step stops for your approval)
1. Front end on a fake backend: month/week calendar, tasks, groups, check-off record, requests, shopping, bell. Screenshots, automated tests, handoff for you to try. No backend.
2. Backend proposal: exact tables and columns, permissions, function actions, risks, deploy steps, rollback. You approve separately.
3. Create tables and deploy the function (separately approved), then wire the front end.
4. Merge to main (separately approved), then live checks.

## Open items I will not guess
- Device alerts (alerts when the app is closed) need a push service and a service worker. I plan to ship the in-app bell first and do device alerts as their own step.
- Import: the Board has Export (JSON). I can add a one-time import of that file into the family calendar. Your existing Supabase data would be moved by export then import, not connected.
- Events (branch `events-minimum`) is a separate preview. The calendar will stay separate unless you want them merged later.
