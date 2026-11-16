/* Giving Center preview: the FAKE SERVER (PREVIEW CODE, not wired into the live app).
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 *
 * An in-memory simulation of what the proposed family-api actions would enforce. It holds invented people and wishlists only,
 * makes no network request, and nothing survives a reload. It is NOT the real server code and it does NOT prove Appwrite enforcement:
 * no table, function or permission exists for Giving Center.
 *
 * Every call is  server.call(userId, action, body). `userId` plays the signed-in account (the real function reads it from the login
 * token), so a body can never name another person. Answers are {ok:true,...} or {ok:false,error,message}.
 *
 * Rules modelled here:
 *  - Everyone is a KID until an owner, admin or family-tree admin marks them as an adult. Nothing is guessed from a birthday or a role.
 *  - Kids can have wishlists that the family sees, and can report content. They cannot reserve, cannot see adults-only lists,
 *    and never receive any reservation information.
 *  - Adults can reserve, and can make a wishlist "Adults only" (for example a gift list for a child).
 *  - Surprise: the OWNER of a list never receives any reservation field at all. A buyer sees their own reservation. Other adults see
 *    only "reserved", never who.
 *  - Anyone who can see a list or item, and does not own it, can report it. Owners and admins who are adults review reports. */
(function (root, factory) {
  var C = typeof module === 'object' && module.exports ? require('../giving-core.js') : root.GivingCore;
  var api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GivingFake = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var L = C.LIMITS;
  var RQ_KINDS = C.REQUEST_KINDS;
  var PHOTOS = ['', 'mug', 'book', 'plant', 'lamp'];
  var MANAGER_ROLES = ['owner', 'admin', 'treeAdmin'];
  function fail(error, message) { return { ok: false, error: error, message: message }; }
  var NA = function () { return fail('not_available', 'That is not available.'); };

  /* options: seed:false for an empty world (tests). */
  function create(options) {
    options = options || {};
    var families = {}, members = [], lists = {}, items = {}, notices = {}, reports = {};
    var requests = {}, pledges = {};   // Phase A: family requests and the pledges made on them
    var reservations = {};   // itemId -> row. One key per item = "unique index on itemId": a second insert for the same item is refused.
    var seq = 0, clockMs = 0;   // clockMs: pretend time that has passed (the preview can fast-forward it)
    var nid = function (p) { return p + (++seq); };

    /* the unique-key insert the real backend would get from a unique index; returns false on conflict */
    function insertUnique(itemId, row) { if (Object.prototype.hasOwnProperty.call(reservations, itemId)) return false; reservations[itemId] = row; return true; }

    function membership(userId, familyId) { return members.filter(function (m) { return m.userId === userId && m.familyId === familyId && m.active; })[0] || null; }
    function nameOf(familyId, userId) { var m = members.filter(function (x) { return x.userId === userId && x.familyId === familyId; })[0]; return m ? m.name : 'Family member'; }
    var isManager = function (m) { return MANAGER_ROLES.indexOf(m.role) !== -1; };
    var canModerate = function (m) { return isManager(m) && m.adult; };

    /** Every action starts here: current membership only. A non-member gets the same answer as for something that does not exist. */
    function gate(userId, familyId) {
      var m = families[familyId] && membership(userId, familyId);
      return m ? { m: m } : { err: NA() };
    }
    /** A list is reachable only if it exists, its owner is still a member, and the viewer is allowed to see its audience. */
    function listFor(m, listId) {
      var l = lists[listId];
      if (!l || l.familyId !== m.familyId || l.archived) return null;
      if (!membership(l.ownerId, m.familyId)) return null;
      if (l.ownerId === m.userId) return l;
      if (l.audience === 'adults' && !m.adult) return null;   // looks exactly like a list that does not exist
      return l;
    }
    function notify(userId, text) { (notices[userId] = notices[userId] || []).push({ id: nid('n'), text: text }); }

    function itemView(m, it, list) {
      var v = { id: it.id, listId: it.listId, title: it.title, notes: it.notes, priority: it.priority, url: it.url, priceCents: it.priceCents, currency: it.currency, photo: it.photo, received: it.received, mine: list.ownerId === m.userId };
      if (v.mine) return v;                 // the owner gets NO reservation fields of any kind
      if (!m.adult) { v.kid = true; return v; }   // a kid gets none either, and cannot reserve
      var r = reservations[it.id];
      v.reserved = !!r;
      if (r && r.buyerId === m.userId) { v.reservedByMe = true; v.changedSinceReserved = r.version !== it.version; }
      return v;
    }

    /* ---------- Requests and pledges (Phase A) ---------- */
    var RQ = C.REQ;
    /** A request is reachable if it exists, its owner is still a member, and the viewer may see it:
     *  approved ones follow the audience rule; one waiting for approval is seen only by its owner and by adult owners/admins. */
    var HOUR = 36e5;
    function settleUrgent(r) { if (r.urgent && r.status === 'open' && clockMs >= r.expiresAt) r.status = 'closed'; return r; }
    function requestFor(m, id) {
      var r = requests[id];
      if (!r || r.familyId !== m.familyId || r.archived) return null;
      if (!membership(r.ownerId, m.familyId)) return null;
      if (r.urgent) {   // an emergency is seen only by its owner and the adults they chose (not by admins, not by anyone else)
        settleUrgent(r);
        if (r.ownerId === m.userId) return r;
        return m.adult && r.helpers.indexOf(m.userId) >= 0 && membership(m.userId, m.familyId) ? r : null;
      }
      if (r.ownerId === m.userId) return r;
      if (r.approval !== 'approved') return canModerate(m) ? r : null;
      if (r.audience === 'adults' && !m.adult) return null;
      return r;
    }
    function pledgesOf(rid) { return Object.keys(pledges).map(function (k) { return pledges[k]; }).filter(function (p) { return p.requestId === rid; }).sort(function (a, b) { return a.n - b.n; }); }
    function requestView(m, r, full) {
      var ps = pledgesOf(r.id), active = ps.filter(function (p) { return p.status !== 'withdrawn'; });
      var v = { id: r.id, title: r.title, details: r.details, kind: r.kind, kindLabel: RQ_KINDS[r.kind], needed: r.needed, amount: r.amount, neededBy: r.neededBy, audience: r.audience,
        ownerName: nameOf(r.familyId, r.ownerId), mine: r.ownerId === m.userId, status: r.status, approval: r.approval,
        pledgedCount: active.length, doneCount: active.filter(function (p) { return p.status === 'done'; }).length };
      v.stillNeeded = Math.max(0, r.needed - active.length);
      if (r.urgent) {
        v.urgent = true; v.hoursLeft = r.status === 'open' ? Math.max(0, Math.ceil((r.expiresAt - clockMs) / HOUR)) : 0;
        if (r.ownerId === m.userId) v.helperNames = r.helpers.map(function (id) { return nameOf(r.familyId, id); });
      }
      if (full) {
        v.pledges = active.map(function (p) { return { id: p.id, userId: p.userId, name: nameOf(r.familyId, p.userId), note: p.note, status: p.status, mine: p.userId === m.userId }; });
        var mineP = active.filter(function (p) { return p.userId === m.userId; })[0]; if (mineP) v.myPledgeId = mineP.id;
      }
      return v;
    }
    function removeRequest(r, reason) {
      pledgesOf(r.id).forEach(function (p) { if (p.status !== 'withdrawn' && reason) notify(p.userId, reason.replace('{request}', r.title)); delete pledges[p.id]; });
      Object.keys(reports).forEach(function (k) { if (reports[k].kind === 'request' && reports[k].targetId === r.id) delete reports[k]; });
      delete requests[r.id];
    }
    function itemsOf(listId) { return Object.keys(items).map(function (k) { return items[k]; }).filter(function (i) { return i.listId === listId; }).sort(function (a, b) { return a.n - b.n; }); }
    function listSummary(m, l) {
      var its = itemsOf(l.id);
      var s = { id: l.id, name: l.name, audience: l.audience, ownerId: l.ownerId, ownerName: nameOf(l.familyId, l.ownerId), mine: l.ownerId === m.userId, itemCount: its.filter(function (i) { return !i.received; }).length, receivedCount: its.filter(function (i) { return i.received; }).length };
      if (!s.mine && m.adult) s.availableCount = its.filter(function (i) { return !i.received && !reservations[i.id]; }).length;
      return s;
    }
    function dropReservation(itemId, reason) {
      var r = reservations[itemId]; if (!r) return;
      delete reservations[itemId];
      var it = items[itemId];
      if (reason && it) notify(r.buyerId, reason.replace('{item}', it.title));
    }
    function dropReports(kind, id) { Object.keys(reports).forEach(function (k) { if (reports[k].kind === kind && reports[k].targetId === id) delete reports[k]; }); }
    function removeItem(it, reason) { dropReservation(it.id, reason); dropReports('item', it.id); delete items[it.id]; }
    function removeList(l, reason) { itemsOf(l.id).forEach(function (i) { removeItem(i, reason); }); dropReports('list', l.id); delete lists[l.id]; }

    /* ---------- actions (each receives the already-checked member `m`) ---------- */
    var actions = {
      families: null,   // handled below: it needs no family
      home: function (m, b) {
        var ls = Object.keys(lists).map(function (k) { return lists[k]; }).filter(function (l) { return listFor(m, l.id); }).sort(function (a, c) { return (a.ownerId === m.userId ? 0 : 1) - (c.ownerId === m.userId ? 0 : 1) || a.n - c.n; }).map(function (l) { return listSummary(m, l); });
        var mine = !m.adult ? [] : Object.keys(reservations).map(function (k) { return reservations[k]; }).filter(function (r) { return r.buyerId === m.userId && r.familyId === m.familyId && items[r.itemId] && listFor(m, items[r.itemId].listId); })
          .map(function (r) { var it = items[r.itemId], l = lists[it.listId]; return { itemId: it.id, title: it.title, listId: l.id, ownerName: nameOf(m.familyId, l.ownerId), changedSinceReserved: r.version !== it.version }; });
        var open = canModerate(m) ? Object.keys(reports).filter(function (k) { return reports[k].familyId === m.familyId; }).length : 0;
        var out = { ok: true, lists: ls, reservations: mine, notices: (notices[m.userId] || []).slice(), canCreateList: ls.filter(function (x) { return x.mine; }).length < L.lists,
          me: { adult: !!m.adult }, canManageAges: isManager(m), canModerate: canModerate(m) };
        out.requests = { urgent: Object.keys(requests).map(function (k) { return settleUrgent(requests[k]); }).filter(function (q) { return q.urgent && q.status === 'open' && q.ownerId !== m.userId && requestFor(m, q.id); }).length, open: Object.keys(requests).filter(function (k) { var q = requests[k]; return q.status === 'open' && q.approval === 'approved' && requestFor(m, q.id); }).length };
        if (canModerate(m)) { out.openReports = open; out.requests.waiting = Object.keys(requests).filter(function (k) { var q = requests[k]; return q.approval === 'pending' && q.ownerId !== m.userId && requestFor(m, q.id); }).length; }   // everyone else gets no report field at all
        return out;
      },
      noticeDismiss: function (m, b) { notices[m.userId] = (notices[m.userId] || []).filter(function (n) { return n.id !== b.noticeId; }); return { ok: true }; },
      listGet: function (m, b) {
        var l = listFor(m, b.listId); if (!l) return NA();
        var its = itemsOf(l.id).map(function (i) { return itemView(m, i, l); });
        return { ok: true, list: listSummary(m, l), items: its, me: { adult: !!m.adult }, totals: l.ownerId === m.userId ? C.totalsByCurrency(its) : undefined };
      },
      listSave: function (m, b) {
        var v = C.validateList(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted field.', fields: v.errors };
        var audience = b.audience === undefined ? undefined : (C.AUDIENCES[b.audience] ? b.audience : 'everyone');
        if (audience === 'adults' && !m.adult) return fail('adults_only', 'Only adults can make a wishlist adults only.');
        if (b.listId) {
          var l = listFor(m, b.listId); if (!l || l.ownerId !== m.userId) return NA();
          l.name = v.value.name; if (audience) { if (!m.adult && audience !== l.audience) return fail('adults_only', 'Only adults can change who sees a wishlist.'); l.audience = audience; }
          return { ok: true, list: listSummary(m, l) };
        }
        var mineCount = Object.keys(lists).map(function (k) { return lists[k]; }).filter(function (x) { return x.familyId === m.familyId && x.ownerId === m.userId && !x.archived; }).length;
        if (mineCount >= L.lists) return fail('limit', 'You can have up to ' + L.lists + ' wishlists. Delete one to add another.');
        var nl = { id: nid('l'), n: seq, familyId: m.familyId, ownerId: m.userId, name: v.value.name, audience: audience || 'everyone', archived: false };
        lists[nl.id] = nl; return { ok: true, list: listSummary(m, nl) };
      },
      listDelete: function (m, b) {
        var l = listFor(m, b.listId); if (!l || l.ownerId !== m.userId) return NA();
        removeList(l, 'A wishlist with an item you reserved ({item}) was removed.'); return { ok: true };
      },
      itemSave: function (m, b) {
        var l = listFor(m, b.listId); if (!l || l.ownerId !== m.userId) return NA();
        var v = C.validateItem(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        var photo = PHOTOS.indexOf(b.photo || '') === -1 ? '' : (b.photo || '');
        if (b.itemId) {
          var it = items[b.itemId]; if (!it || it.listId !== l.id) return NA();
          var material = it.title !== v.value.title || it.url !== v.value.url || it.priceCents !== v.value.priceCents || it.currency !== v.value.currency;
          Object.assign(it, v.value, { photo: photo }); if (material) it.version++;   // notes and priority do not count as a change the buyer needs to know about
          return { ok: true, item: itemView(m, it, l) };
        }
        if (itemsOf(l.id).length >= L.items) return fail('limit', 'A wishlist can have up to ' + L.items + ' items.');
        var ni = Object.assign({ id: nid('i'), n: seq, listId: l.id, familyId: m.familyId, photo: photo, received: false, version: 1 }, v.value);
        items[ni.id] = ni; return { ok: true, item: itemView(m, ni, l) };
      },
      itemDelete: function (m, b) {
        var it = items[b.itemId], l = it && listFor(m, it.listId); if (!it || !l || l.ownerId !== m.userId) return NA();
        removeItem(it, 'An item you reserved ({item}) is no longer on the wishlist.'); return { ok: true };
      },
      itemReceived: function (m, b) {
        var it = items[b.itemId], l = it && listFor(m, it.listId); if (!it || !l || l.ownerId !== m.userId) return NA();
        it.received = b.received !== false;
        if (it.received) dropReservation(it.id, 'An item you reserved ({item}) was marked received.');
        return { ok: true, item: itemView(m, it, l) };
      },
      reserve: function (m, b) {
        var it = items[b.itemId], l = it && listFor(m, it.listId); if (!it || !l) return NA();
        if (l.ownerId === m.userId) return fail('own_item', 'You cannot reserve something from your own wishlist.');   // same answer whatever the reservation state
        if (!m.adult) return fail('adults_only', 'Gift reservations are for adults.');
        if (it.received) return fail('unavailable', 'This item is no longer available.');
        var row = { id: nid('r'), itemId: it.id, familyId: m.familyId, buyerId: m.userId, version: it.version };
        if (!insertUnique(it.id, row)) {
          var cur = reservations[it.id];
          if (cur.buyerId === m.userId) return { ok: true, already: true, item: itemView(m, it, l) };   // the same person asking twice is safe
          return fail('taken', 'Someone has already reserved this item.');
        }
        return { ok: true, item: itemView(m, it, l) };
      },
      release: function (m, b) {
        var r = reservations[b.itemId];
        if (!r || r.buyerId !== m.userId || r.familyId !== m.familyId) return NA();   // someone else's reservation looks exactly like none
        delete reservations[b.itemId];
        var it = items[b.itemId], l = lists[it.listId];
        return { ok: true, item: itemView(m, it, l) };
      },

      /* ----- who is an adult: owners, admins and family-tree admins ----- */
      members: function (m) {
        if (!isManager(m)) return NA();
        return { ok: true, members: members.filter(function (x) { return x.familyId === m.familyId && x.active; }).map(function (x) { return { userId: x.userId, name: x.name, adult: !!x.adult, self: x.userId === m.userId }; }) };
      },
      memberSetAdult: function (m, b) {
        if (!isManager(m)) return NA();
        var t = membership(b.userId, m.familyId); if (!t) return NA();
        if (t.userId === m.userId) return fail('self', 'Ask another owner or admin to change your own setting.');
        var adult = b.adult === true;
        if (t.adult && !adult) {   // a new kid: reservations are released, and the person is told only that they were released
          Object.keys(reservations).forEach(function (k) { var r = reservations[k]; if (r.familyId === m.familyId && r.buyerId === t.userId) { notify(t.userId, 'Your gift reservations were released.'); delete reservations[k]; } });
        }
        t.adult = adult; return { ok: true };
      },


      /* ----- Emergency requests (Phase B) ----- */
      emergencySave: function (m, b) {
        var v = C.validateEmergency(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        var bad = v.value.helpers.some(function (id) { var mm = membership(id, m.familyId); return !mm || !mm.adult || id === m.userId; });
        if (bad) return fail('invalid', 'You can only ask other adults in your family.');
        var mineOpen = Object.keys(requests).map(function (k) { return settleUrgent(requests[k]); }).filter(function (x) { return x.urgent && x.familyId === m.familyId && x.ownerId === m.userId && x.status === 'open'; }).length;
        if (mineOpen >= 1) return fail('limit', 'You already have an emergency request open. Close it before sending another.');
        var nr = { id: nid('q'), n: seq, familyId: m.familyId, ownerId: m.userId, status: 'open', archived: false, approval: 'approved', audience: 'chosen', urgent: true, kind: 'time', needed: v.value.helpers.length, amount: '', neededBy: '', title: v.value.title, details: v.value.details, helpers: v.value.helpers, expiresAt: clockMs + C.EMERGENCY.hours * HOUR };
        requests[nr.id] = nr;
        v.value.helpers.forEach(function (id) { notify(id, nameOf(m.familyId, m.userId) + ' needs help. Tap to open.'); });
        return { ok: true, request: requestView(m, nr, true) };
      },
      emergencyHelpers: function (m) {
        return { ok: true, helpers: members.filter(function (x) { return x.familyId === m.familyId && x.active && x.adult && x.userId !== m.userId; }).map(function (x) { return { userId: x.userId, name: nameOf(m.familyId, x.userId) }; }), max: C.EMERGENCY.helpers };
      },
      emergencyKeepOpen: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r || !r.urgent || r.ownerId !== m.userId) return NA();
        r.status = 'open'; r.expiresAt = clockMs + C.EMERGENCY.hours * HOUR;
        return { ok: true, request: requestView(m, r, true) };
      },
      /* ----- Requests and pledges (Phase A) ----- */
      requestsHome: function (m) {
        var all = Object.keys(requests).map(function (k) { return requests[k]; }).filter(function (r) { return requestFor(m, r.id); }).sort(function (a, b) { return b.n - a.n; });
        var urgent = all.filter(function (r) { return r.urgent && r.status === 'open'; }); all = all.filter(function (r) { return !(r.urgent && r.status === 'open'); });
        var pending = canModerate(m) ? all.filter(function (r) { return r.approval === 'pending' && r.ownerId !== m.userId; }) : [];
        var visible = all.filter(function (r) { return r.approval === 'approved' || r.ownerId === m.userId; });
        var openCount = Object.keys(requests).map(function (k) { return requests[k]; }).filter(function (r) { return r.familyId === m.familyId && r.ownerId === m.userId && r.status === 'open' && !r.archived && !r.urgent; }).length;
        return { ok: true, me: { adult: !!m.adult }, canModerate: canModerate(m), canCreate: openCount < RQ.open,
          urgent: urgent.map(function (r) { return requestView(m, r, false); }),
          open: visible.filter(function (r) { return r.status === 'open'; }).map(function (r) { return requestView(m, r, false); }),
          closed: visible.filter(function (r) { return r.status === 'closed'; }).slice(0, 20).map(function (r) { return requestView(m, r, false); }),
          waiting: pending.map(function (r) { return requestView(m, r, false); }) };
      },
      requestGet: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r) return NA();
        return { ok: true, request: requestView(m, r, true), me: { adult: !!m.adult }, canModerate: canModerate(m) };
      },
      requestSave: function (m, b) {
        var v = C.validateRequest(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        if (v.value.audience === 'adults' && !m.adult) return fail('adults_only', 'Only adults can make a request adults only.');
        if (b.requestId) {
          var r = requestFor(m, b.requestId); if (!r || r.ownerId !== m.userId || r.urgent) return NA();
          Object.assign(r, v.value);
          if (!m.adult) { r.approval = 'pending'; }   // a kid's edit goes back for an adult to look at again
          return { ok: true, request: requestView(m, r, true) };
        }
        var openCount = Object.keys(requests).map(function (k) { return requests[k]; }).filter(function (x) { return x.familyId === m.familyId && x.ownerId === m.userId && x.status === 'open' && !x.archived && !x.urgent; }).length;
        if (openCount >= RQ.open) return fail('limit', 'You can have up to ' + RQ.open + ' open requests. Close one to add another.');
        var nr = Object.assign({ id: nid('q'), n: seq, familyId: m.familyId, ownerId: m.userId, status: 'open', archived: false, approval: m.adult ? 'approved' : 'pending' }, v.value);
        requests[nr.id] = nr;
        return { ok: true, request: requestView(m, nr, true), waitingForApproval: nr.approval === 'pending' };
      },
      requestApprove: function (m, b) {
        if (!canModerate(m)) return NA();
        var r = requests[b.requestId]; if (!r || r.familyId !== m.familyId || r.archived || r.approval !== 'pending') return NA();
        if (r.ownerId === m.userId) return fail('self', 'Ask another owner or admin to approve your own request.');
        r.approval = 'approved'; notify(r.ownerId, 'Your request "' + r.title + '" was approved and the family can see it.'); return { ok: true };
      },
      requestReject: function (m, b) {
        if (!canModerate(m)) return NA();
        var r = requests[b.requestId]; if (!r || r.familyId !== m.familyId || r.archived || r.approval !== 'pending') return NA();
        notify(r.ownerId, 'Your request "' + r.title + '" was not posted. An owner or admin can tell you why.'); removeRequest(r); return { ok: true };
      },
      requestClose: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r || r.ownerId !== m.userId) return NA();
        if (b.reopen && r.urgent) return fail('invalid', 'Use Keep open for an emergency request.');
        r.status = b.reopen ? 'open' : 'closed';
        if (b.reopen) { var open2 = Object.keys(requests).map(function (k) { return requests[k]; }).filter(function (x) { return x.familyId === m.familyId && x.ownerId === m.userId && x.status === 'open' && !x.archived; }).length; if (open2 > RQ.open) { r.status = 'closed'; return fail('limit', 'You can have up to ' + RQ.open + ' open requests. Close one to reopen this.'); } }
        return { ok: true, request: requestView(m, r, true) };
      },
      requestDelete: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r || r.ownerId !== m.userId) return NA();
        removeRequest(r, 'A request you pledged to ("{request}") was removed.'); return { ok: true };
      },
      pledgeSave: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r || r.approval !== 'approved') return NA();
        if (!m.adult) return fail('adults_only', 'Pledging is for adults.');
        if (r.ownerId === m.userId) return fail('own_request', 'You cannot pledge to your own request.');
        if (r.status !== 'open') return fail('closed', 'This request is closed.');
        var v = C.validatePledge(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted field.', fields: v.errors };
        var mine = pledgesOf(r.id).filter(function (p) { return p.userId === m.userId && p.status !== 'withdrawn'; })[0];
        if (mine) { if (mine.status === 'done') return fail('done', 'Your pledge is already marked done.'); mine.note = v.value.note; return { ok: true, request: requestView(m, r, true) }; }
        if (pledgesOf(r.id).filter(function (p) { return p.status !== 'withdrawn'; }).length >= RQ.pledges) return fail('limit', 'This request already has ' + RQ.pledges + ' pledges.');
        var np = { id: nid('g'), n: seq, requestId: r.id, familyId: m.familyId, userId: m.userId, note: v.value.note, status: 'pledged' }; pledges[np.id] = np;
        notify(r.ownerId, nameOf(m.familyId, m.userId) + ' pledged to help with "' + r.title + '".');
        return { ok: true, request: requestView(m, r, true) };
      },
      pledgeWithdraw: function (m, b) {
        var p = pledges[b.pledgeId], r = p && requestFor(m, p.requestId); if (!p || !r || p.userId !== m.userId || p.status === 'withdrawn') return NA();
        if (p.status === 'done') return fail('done', 'A pledge marked done cannot be withdrawn. Ask the person who made the request.');
        p.status = 'withdrawn'; notify(r.ownerId, nameOf(m.familyId, m.userId) + ' withdrew a pledge on "' + r.title + '".');
        return { ok: true, request: requestView(m, r, true) };
      },
      pledgeDone: function (m, b) {
        var p = pledges[b.pledgeId], r = p && requestFor(m, p.requestId); if (!p || !r || r.ownerId !== m.userId || p.status === 'withdrawn') return NA();
        p.status = b.done === false ? 'pledged' : 'done';
        if (p.status === 'done') notify(p.userId, 'Thank you. "' + r.title + '" marked your help as done.');
        return { ok: true, request: requestView(m, r, true) };
      },
      requestReport: function (m, b) {
        var r = requestFor(m, b.targetId); if (!r || r.approval !== 'approved') return NA();
        if (r.ownerId === m.userId) return fail('own_content', 'You cannot report your own request.');
        var v = C.validateReport(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted field.', fields: v.errors };
        var dupe = Object.keys(reports).filter(function (k) { var x = reports[k]; return x.reporterId === m.userId && x.kind === 'request' && x.targetId === r.id; })[0];
        if (!dupe) {
          var mineN = Object.keys(reports).filter(function (k) { return reports[k].reporterId === m.userId; }).length;
          if (mineN >= 20) return fail('limit', 'You have sent a lot of reports. An admin will review them first.');
          var rp = { id: nid('p'), familyId: m.familyId, kind: 'request', targetId: r.id, listId: null, reporterId: m.userId, reason: v.value.reason, note: v.value.note }; reports[rp.id] = rp;
        }
        return { ok: true, message: 'Thanks. An owner or admin will take a look. The person who wrote it is not told who reported it.' };
      },

      /* ----- reporting ----- */
      report: function (m, b) {
        var kind = b.kind === 'list' ? 'list' : 'item', it = null, l = null;
        if (kind === 'item') { it = items[b.targetId]; l = it && listFor(m, it.listId); } else { l = listFor(m, b.targetId); }
        if (!l) return NA();
        if (l.ownerId === m.userId) return fail('own_content', 'You cannot report your own wishlist.');
        var v = C.validateReport(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted field.', fields: v.errors };
        var targetId = kind === 'item' ? it.id : l.id;
        var dupe = Object.keys(reports).filter(function (k) { var r = reports[k]; return r.reporterId === m.userId && r.kind === kind && r.targetId === targetId; })[0];
        if (!dupe) {
          var mine = Object.keys(reports).filter(function (k) { return reports[k].reporterId === m.userId; }).length;
          if (mine >= 20) return fail('limit', 'You have sent a lot of reports. An admin will review them first.');
          var rp = { id: nid('p'), familyId: m.familyId, kind: kind, targetId: targetId, listId: l.id, reporterId: m.userId, reason: v.value.reason, note: v.value.note };
          reports[rp.id] = rp;
        }
        return { ok: true, message: 'Thanks. An owner or admin will take a look. The person who wrote it is not told who reported it.' };   // the same answer whether or not it was a repeat
      },
      reports: function (m) {
        if (!canModerate(m)) return NA();
        var out = Object.keys(reports).map(function (k) { return reports[k]; }).filter(function (r) { return r.familyId === m.familyId; }).map(function (r) {
          if (r.kind === 'request') { var q = requests[r.targetId]; return { id: r.id, kind: 'request', reasonLabel: C.REPORT_REASONS[r.reason], note: r.note, reporterName: nameOf(m.familyId, r.reporterId), ownerName: q ? nameOf(m.familyId, q.ownerId) : '', listName: 'Family requests', title: q ? q.title : '', notes: q ? q.details : '', url: '' }; }
          var l = lists[r.listId], it = r.kind === 'item' ? items[r.targetId] : null;
          return { id: r.id, kind: r.kind, reasonLabel: C.REPORT_REASONS[r.reason], note: r.note, reporterName: nameOf(m.familyId, r.reporterId), ownerName: nameOf(m.familyId, l.ownerId), listName: l.name,
            title: it ? it.title : l.name, notes: it ? it.notes : '', url: it ? it.url : '' };   // content only: never anything about reservations
        });
        return { ok: true, reports: out };
      },
      reportResolve: function (m, b) {
        if (!canModerate(m)) return NA();
        var r = reports[b.reportId]; if (!r || r.familyId !== m.familyId) return NA();
        if (r.kind === 'request') {
          var q = requests[r.targetId];
          if (b.action === 'remove' && q) { notify(q.ownerId, 'Your request was removed by a family admin.'); removeRequest(q, 'A request you pledged to ("{request}") was removed.'); } else { delete reports[r.id]; }
          return { ok: true };
        }
        if (b.action === 'remove') {
          var l = lists[r.listId];
          if (r.kind === 'item' && items[r.targetId]) { removeItem(items[r.targetId], 'An item you reserved ({item}) is no longer on the wishlist.'); notify(l.ownerId, 'An item on your wishlist was removed by a family admin.'); }
          else if (r.kind === 'list') { removeList(l, 'A wishlist with an item you reserved ({item}) was removed.'); notify(l.ownerId, 'Your wishlist was removed by a family admin.'); }
        } else { delete reports[r.id]; }
        return { ok: true };
      }
    };

    /* ---------- set-up and scenario controls (the preview's own buttons and the tests; not actions a person can call) ---------- */
    var admin = {
      addFamily: function (id, name) { families[id] = { name: name }; },
      /** role: 'member' (default), 'admin', 'treeAdmin' or 'owner'. A new member is a kid until someone marks them as an adult. */
      addMember: function (familyId, userId, name, role, adult) { members.push({ familyId: familyId, userId: userId, name: name, role: role || 'member', adult: !!adult, active: true }); },
      setAdult: function (familyId, userId, yes) { var m = membership(userId, familyId); if (m) m.adult = !!yes; },
      /** A removed member: the person's reservations are released, and their wishlists stop being reachable. */
      removeMember: function (familyId, userId) {
        members.forEach(function (m) { if (m.familyId === familyId && m.userId === userId) m.active = false; });
        Object.keys(reservations).forEach(function (k) { var r = reservations[k]; if (r.familyId === familyId && r.buyerId === userId) delete reservations[k]; });
        Object.keys(requests).forEach(function (k) { var q = requests[k]; if (q.familyId === familyId && q.ownerId === userId) q.archived = true; });
        Object.keys(pledges).forEach(function (k) { var g = pledges[k]; if (g.familyId === familyId && g.userId === userId && g.status !== 'done') g.status = 'withdrawn'; });
        Object.keys(lists).forEach(function (k) {
          var l = lists[k]; if (l.familyId !== familyId || l.ownerId !== userId) return;
          l.archived = true;
          itemsOf(l.id).forEach(function (i) { dropReservation(i.id, 'An item you reserved ({item}) is no longer available.'); });
        });
      },
      /** A re-invitation is a fresh membership: a kid again, and nothing from before is revived. */
      reinvite: function (familyId, userId) { members.forEach(function (m) { if (m.familyId === familyId && m.userId === userId) { m.active = true; m.adult = false; } }); },
      addList: function (familyId, ownerId, name, audience) { var l = { id: nid('l'), n: seq, familyId: familyId, ownerId: ownerId, name: name, audience: audience || 'everyone', archived: false }; lists[l.id] = l; return l; },
      addItem: function (listId, fields) { var l = lists[listId]; var it = Object.assign({ id: nid('i'), n: seq, listId: listId, familyId: l.familyId, notes: '', priority: 'medium', url: '', priceCents: 0, currency: '', photo: '', received: false, version: 1 }, fields); items[it.id] = it; return it; },
      reserveFor: function (userId, itemId) { var it = items[itemId]; return call(userId, 'reserve', { familyId: it.familyId, itemId: itemId }); },
      addRequest: function (familyId, ownerId, fields) { var m = membership(ownerId, familyId); var r = Object.assign({ id: nid('q'), n: seq, familyId: familyId, ownerId: ownerId, details: '', kind: 'thing', needed: 1, amount: '', neededBy: '', audience: 'everyone', status: 'open', archived: false, approval: m && m.adult ? 'approved' : 'pending' }, fields); requests[r.id] = r; return r; },
      clearNotices: function (userId) { notices[userId] = []; },
      advanceHours: function (h) { clockMs += h * 36e5; },
      pledgeFor: function (userId, requestId, note) { var r = requests[requestId]; return call(userId, 'pledgeSave', { familyId: r.familyId, requestId: requestId, note: note || '' }); },
      /** For tests only: everything the server holds. */
      dump: function () { return JSON.stringify({ lists: lists, items: items, reservations: reservations, notices: notices, reports: reports, requests: requests, pledges: pledges }); }
    };

    function call(userId, action, body) {
      body = body || {};
      if (typeof userId !== 'string' || !userId || !Object.prototype.hasOwnProperty.call(actions, action)) return fail('bad_request', 'Unknown request.');
      if (action === 'families') return fam(userId);
      var g = gate(userId, body.familyId); if (g.err) return g.err;
      return actions[action](g.m, body);
    }
    function fam(u) {
      var out = []; Object.keys(families).forEach(function (id) { if (membership(u, id)) out.push({ id: id, name: families[id].name }); });
      return { ok: true, families: out };
    }

    if (options.seed !== false) seed(admin);
    return { call: call, admin: admin, familiesOf: function (u) { return fam(u).families; }, PHOTOS: PHOTOS };
  }

  var VIEWERS = [
    { userId: 'u-rae', name: 'Rae Sample', note: 'An adult with wishlists. Cannot see anything about who reserved her items.' },
    { userId: 'u-sam', name: 'Sam Sample', note: 'An adult gift-giver. Has reserved one of Rae’s items.' },
    { userId: 'u-tia', name: 'Tia Sample', note: 'An adult gift-giver. Has an adults-only list of gift ideas for Riley.' },
    { userId: 'u-ada', name: 'Ada Admin', note: 'An adult and a family admin. Can mark people as adults and review reports.' },
    { userId: 'u-riley', name: 'Riley Sample', note: 'A kid (marked by an admin). Has a wishlist. Cannot reserve gifts or see adults-only lists.' },
    { userId: 'u-una', name: 'Una Sample', note: 'A kid by default: nobody has marked this member as an adult yet.' },
    { userId: 'u-quinn', name: 'Quinn Sample', note: 'Removed from Family A. Every request is refused.' },
    { userId: 'u-olive', name: 'Olive Example', note: 'An adult in Family B only. Cannot see anything in Family A.' }
  ];

  function seed(a) {
    a.addFamily('famA', 'Sample Family A'); a.addFamily('famB', 'Sample Family B');
    a.addMember('famA', 'u-ada', 'Ada Admin', 'admin', true);
    [['u-rae', 'Rae Sample'], ['u-sam', 'Sam Sample'], ['u-tia', 'Tia Sample']].forEach(function (p) { a.addMember('famA', p[0], p[1], 'member', true); });
    a.addMember('famA', 'u-riley', 'Riley Sample', 'member', false); a.addMember('famA', 'u-una', 'Una Sample', 'member', false); a.addMember('famA', 'u-quinn', 'Quinn Sample', 'member', true);
    a.addMember('famB', 'u-olive', 'Olive Example', 'member', true);
    a.removeMember('famA', 'u-quinn');
    var l1 = a.addList('famA', 'u-rae', 'Birthday ideas');
    var mug = a.addItem(l1.id, { title: 'Blue ceramic mug', notes: 'The big one, ~16 oz. Any shade of blue is Fine.', priority: 'high', url: 'https://shop.example.com/mugs/blue', priceCents: 2400, currency: 'USD', photo: 'mug' });
    a.addItem(l1.id, { title: 'The Long Winter (paperback)', notes: 'Hardcover is too heavy.', priority: 'medium', url: 'https://books.example.org/long-winter', priceCents: 1299, currency: 'EUR', photo: 'book' });
    a.addItem(l1.id, { title: 'fern for the window', notes: '', priority: 'low', priceCents: 1800, currency: 'USD', photo: 'plant' });
    a.addItem(l1.id, { title: 'Reading lamp', notes: 'Already got one, thank you all!', priority: 'medium', priceCents: 3500, currency: 'USD', photo: 'lamp', received: true });
    a.addList('famA', 'u-rae', 'Spring ideas');   // empty on purpose
    var l2 = a.addList('famA', 'u-sam', 'Home projects');
    a.addItem(l2.id, { title: 'Cordless drill', notes: 'Not too heavy.', priority: 'high', url: 'https://tools.example.com/drill', priceCents: 8900, currency: 'USD' });
    var tape = a.addItem(l2.id, { title: 'Tape measure', priority: 'low', priceCents: 1200, currency: 'CAD' });
    var l3 = a.addList('famA', 'u-riley', 'Riley’s wishes');   // a kid's own list: a link and no photo
    a.addItem(l3.id, { title: 'Bubble gun', notes: 'The kind that makes big bubbles. Batteries not needed.', priority: 'high', url: 'https://toys.example.com/bubble-gun', priceCents: 1599, currency: 'USD' });
    var l4 = a.addList('famA', 'u-tia', 'Riley’s birthday gifts', 'adults');   // adults only, so the surprise is safe
    a.addItem(l4.id, { title: 'Bike helmet (the green one)', notes: 'Size small. Hide it until the party.', priority: 'high', priceCents: 3200, currency: 'USD' });
    var rq1 = a.addRequest('famA', 'u-rae', { title: 'Help moving a couch on Saturday', details: 'Second floor, no elevator. Pizza after.', kind: 'time', needed: 3, neededBy: '2026-12-05' });
    a.addRequest('famA', 'u-sam', { title: 'Winter coat for Riley, size 8', details: 'Any colour. Used is fine.', kind: 'thing', needed: 1, amount: 'about $40', audience: 'adults' });
    a.addRequest('famA', 'u-riley', { title: 'Can someone take me to the library?', details: 'Saturday morning if possible.', kind: 'task', needed: 1 });   // a kid: waits for an adult to approve
    a.pledgeFor('u-sam', rq1.id, 'I can come after 10.'); a.clearNotices('u-rae');   // sample data starts with no notices
    a.reserveFor('u-sam', mug.id);   // Sam already reserved Rae's mug
    a.reserveFor('u-tia', tape.id);   // Tia reserved Sam's tape measure, so Rae sees one item as "Reserved" without a name
  }

  return { create: create, VIEWERS: VIEWERS };
});
