# Giving Center later phases: design for your approval

Status: design only. Nothing here is built. Each phase would follow the same path as the wishlists: a preview with sample people first (no network), then the real backend and screens, OFF for every family until its owner turns it on.

## What stays the same in every phase
- Everyone is a kid by default; owners, admins and tree admins mark adults. Kids can see and ask, but cannot pledge, draw or see adults-only things.
- Same family switch: Giving Center must already be turned on by the family owner. Each new phase has its own small switch under it, off by default.
- Reporting, removed-member rules (hidden 30 days, then deleted), limits, and "other family gets the same plain answer as a made-up id" all carry over.
- No money moves through Family Circle. No shop, checkout, wallet, charging, ads or affiliate links. This is your standing rule.

## Phase A: Requests and pledges (recommended first)
**What it is.** A board where a family member asks for something specific and others pledge to help. Examples: "Need two people to help move Saturday", "Need a winter coat for my son, size 8", "Looking for someone to drive Gran to her appointment Tuesday".

**How it works.**
- Any member can post a request: title, details, kind (a thing, someone's time, a task), how many helpers or items are needed, a needed-by date, and who can see it (everyone, or adults only).
- Adults can pledge: "I will bring the coat" or "I can drive on Tuesday". A pledge says what you are offering and, if you like, a short note.
- The person who asked sees who pledged (unlike wishlist reservations there is no surprise to protect). Other helpers see how many are still needed, and the names of other pledgers.
- Only the person who made the request marks a pledge as done, or closes the request. A pledger can withdraw before it is done.
- Requests that are past their date are shown as "past" and can be closed or reopened.
- Kids can post requests, but an adult marked in the family sees them first and approves them before the family does (so a child's request never goes out unreviewed).
- Money: a request may mention an amount as plain text for reference ("about $40"). The app never collects it. Pledging money means "I will cover this outside the app", and the requester confirms when it is sorted.

**Limits (proposed).** 10 open requests per person, 20 pledges per request, title 120 characters, details 1000.

## Phase B: Emergency assistance (built on Phase A, not a separate system)
**What it is.** An urgent request that goes only to the people you choose. Examples: car broke down, need a ride now, need a place to stay tonight.

**How it works.**
- It is a Phase A request with two differences: it is marked urgent, and its audience is a short list of chosen adults (up to 8) instead of the whole family.
- The chosen adults get an in-app notice and, if your push or email notices are set up, those too. A helper taps "I can help", and the requester sees who answered.
- It closes itself after 48 hours unless the requester keeps it open. Closed ones are deleted after 30 days.
- A fixed notice shows on the form and on the screen: for a life-threatening emergency call 911 (or your local number). Family Circle is not an emergency service and is not watched in real time.
- Privacy: the form tells people not to put medical details, account numbers or passwords in it, and nothing here is copied into notifications beyond "[Name] needs help, tap to open".

## Phase C: Gift exchanges (Secret Santa style)
**How it works.**
- An organiser (an adult) creates an exchange: name, date, optional spending limit, optional exclusions ("these two cannot draw each other").
- Adults join (or the organiser adds them). When the organiser starts the draw, each person is assigned exactly one other person, never themselves, respecting exclusions.
- Each person sees only who they drew, and that person's wishlist, from which they can reserve with the same surprise rules as today. Nobody else, including the organiser, sees who drew whom.
- If someone leaves or is removed before the date, the organiser can redraw everyone (everybody is told it was redrawn) or leave that person's slot empty.
- Honest limit: the pairings are stored on the server so the app can show you your match. Someone with direct access to your Appwrite project (you) could read them there. The app never shows them to anyone else.

## Phase D: Contributions
Two very different things are mixed under this name, so I split them.

**D1. Contribution tracker (recommended, in scope).** For a shared gift ("everyone chip in for Gran's present"): the organiser sets a goal and a reference amount per person; people mark "I contributed $20" after paying however they normally would (cash, Venmo, a card), and the organiser confirms. The app shows progress toward the goal. No payment is taken, held or sent.

**D2. Processed contributions (not recommended).** Moving money through Family Circle would need a payment processor, fees, refunds, fraud handling, tax and money-transmission rules, and handling minors' money. That conflicts with your rule of no checkout, wallet or charging. I recommend we do not build it. If you ever want it, it needs its own legal and cost review first, and I would not start without that.

## Data and safety sketch (for the backend design step, after you approve)
- New tables: `givingRequests`, `givingPledges`, `givingExchanges`, `givingExchangeMembers`, `givingExchangePairs` (private, function-only), `givingContributions`. All reads go through the function; the browser never reads these tables directly.
- Every action checks family membership, adult status where needed, and the switch for that phase. Wrong-family and made-up ids get the same plain answer.
- Tests per phase: rules tests on the preview fake server, function tests, browser tests for phone and desktop, themed controls, no sideways scroll, and no CSP violations (this time the in-app test will use the real security rules).

## Decisions I need from you
1. Order of building (recommended: A, then B, then C, then D1).
2. Kids' requests: held for an adult to approve first (recommended), or posted directly?
3. Requests that mention money as plain text: allowed (recommended), or no money at all?
4. Emergency requests: 48-hour auto-close and up to 8 chosen helpers (recommended), or different numbers?
5. Gift exchange draw: organiser can see the pairings (simplest), or nobody can (recommended)?
6. Processed contributions (D2): confirm it stays out of scope.

## Your answers (2026-11-15)
1. Order: Requests and pledges, then Emergency, then Exchanges, then Contributions (D1). Approved.
2. Kids' requests: held for an adult to approve first. Approved.
3. Money mentioned as plain text, reference only: allowed. Approved.
4. Emergency numbers (48-hour auto-close, up to 8 chosen helpers): not answered, so the recommended numbers stand until you change them.
5. Gift exchange draw: nobody in the app sees who drew whom, the organiser included. Approved.
6. Processed contributions (D2): not answered, so it stays out of scope until you say otherwise.
