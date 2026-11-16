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
    var gifts = {};       // Phase D1: group gifts (a tracker, no money moves). contribs: userId -> { cents, status: marked|confirmed, note }
    var exchanges = {};   // Phase C: gift exchanges. Each holds its draw in `pairs` (giverId -> receiverId); no action ever returns that map.
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


    /* ---------- Gift exchanges (Phase C) ---------- */
    var EX = C.EXCHANGE;
    function exchangeFor(m, id) { var x = exchanges[id]; return x && x.familyId === m.familyId && !x.gone && m.adult ? x : null; }
    function exchangeMembers(x) { return x.members.filter(function (u) { return membership(u, x.familyId) && membership(u, x.familyId).adult; }); }
    function exchangeCount(m) { return m.adult ? Object.keys(exchanges).filter(function (k) { var x = exchanges[k]; return x.familyId === m.familyId && !x.gone && x.members.indexOf(m.userId) >= 0; }).length : 0; }
    function exchangeRow(m, x) { return { id: x.id, name: x.name, date: x.date, limit: x.limit, status: x.drawn ? 'drawn' : 'open', organiserName: nameOf(x.familyId, x.organiserId), mine: x.organiserId === m.userId, joined: x.members.indexOf(m.userId) >= 0, count: exchangeMembers(x).length }; }
    function exchangeView(m, x) {
      var v = exchangeRow(m, x); v.note = x.note; v.round = x.round;
      v.members = exchangeMembers(x).map(function (u) { return { userId: u, name: nameOf(x.familyId, u), organiser: u === x.organiserId, me: u === m.userId }; });
      if (x.organiserId === m.userId) {
        v.exclusions = x.exclusions.map(function (p) { return [{ userId: p[0], name: nameOf(x.familyId, p[0]) }, { userId: p[1], name: nameOf(x.familyId, p[1]) }]; });
        v.canAdd = x.drawn ? [] : members.filter(function (o) { return o.familyId === x.familyId && o.active && o.adult && x.members.indexOf(o.userId) < 0; }).map(function (o) { return { userId: o.userId, name: o.name }; });
      }
      if (x.drawn && x.members.indexOf(m.userId) >= 0) {
        var r = x.pairs[m.userId];
        if (r && membership(r, x.familyId)) {
          v.match = { name: nameOf(x.familyId, r), lists: Object.keys(lists).map(function (k) { return lists[k]; }).filter(function (l) { return l.ownerId === r && listFor(m, l.id); }).map(function (l) { return { id: l.id, name: l.name, count: itemsOf(l.id).filter(function (i) { return !i.received; }).length }; }) };
        } else v.matchLeft = true;
      }
      return v;
    }
    function dropFromExchange(x, userId, why) {
      var wasGiverOf = Object.keys(x.pairs).filter(function (g) { return x.pairs[g] === userId; });
      x.members = x.members.filter(function (u) { return u !== userId; });
      x.exclusions = x.exclusions.filter(function (p) { return p[0] !== userId && p[1] !== userId; });
      if (!x.drawn) return;
      delete x.pairs[userId];
      wasGiverOf.forEach(function (g) { delete x.pairs[g]; notify(g, 'Your match for ' + x.name + ' left the exchange. ' + nameOf(x.familyId, x.organiserId) + ' can draw again.'); });
      if (userId !== x.organiserId) notify(x.organiserId, nameOf(x.familyId, userId) + ' ' + why + ' ' + x.name + '. You can draw again for everyone, or leave it as it is.');
    }
    function runDraw(m, x, again) {
      var ids = exchangeMembers(x);
      if (ids.length < EX.min) return fail('too_few', 'You need at least ' + EX.min + ' people to draw names.');
      var d = C.drawPairs(ids, x.exclusions, admin.rand); if (!d.ok) return fail('cannot_draw', C.EXCHANGE_NO_DRAW);
      x.pairs = d.pairs; x.drawn = true; x.round = (x.round || 0) + 1;
      ids.forEach(function (u) { if (u !== m.userId) notify(u, x.name + (again ? ' was drawn again. Tap to see who you have now.' : ' has been drawn. Tap to see who you have.')); });
      return { ok: true, exchange: exchangeView(m, x) };
    }

    /* ---------- Group gifts (Phase D1) ---------- */
    var GF = C.GIFT;
    function giftFor(m, id) { var g = gifts[id]; return g && g.familyId === m.familyId && !g.gone && m.adult && g.forId !== m.userId && membership(g.organiserId, g.familyId) ? g : null; }   // the person it is for never reaches it
    function giftTotals(g) { var conf = 0, pend = 0; Object.keys(g.contribs).forEach(function (u) { var c = g.contribs[u]; if (membership(u, g.familyId)) { if (c.status === 'confirmed') conf += c.cents; else pend += c.cents; } }); return { confirmedCents: conf, pendingCents: pend }; }
    function giftRow(m, g) {
      var t = giftTotals(g), mine = g.contribs[m.userId], r = { id: g.id, title: g.title, forName: g.forId ? nameOf(g.familyId, g.forId) : '', status: g.status, currency: g.currency, goalCents: g.goalCents, confirmedCents: t.confirmedCents, organiserName: nameOf(g.familyId, g.organiserId), mine: g.organiserId === m.userId, reached: t.confirmedCents >= g.goalCents };
      if (mine) { r.myCents = mine.cents; r.myStatus = mine.status; }
      if (r.mine) r.pendingCents = t.pendingCents;
      return r;
    }
    function giftView(m, g) {
      var v = giftRow(m, g); v.note = g.note; v.eachCents = g.eachCents;
      if (g.contribs[m.userId]) v.myNote = g.contribs[m.userId].note;
      if (v.mine) {
        v.contributions = Object.keys(g.contribs).filter(function (u) { return membership(u, g.familyId); }).map(function (u) { var c = g.contribs[u]; return { userId: u, name: nameOf(g.familyId, u), cents: c.cents, status: c.status, note: c.note }; });
        v.canRecord = members.filter(function (o) { return o.familyId === g.familyId && o.active && o.adult && o.userId !== g.forId && o.userId !== m.userId && !g.contribs[o.userId]; }).map(function (o) { return { userId: o.userId, name: o.name }; });
      }
      return v;
    }
    function giftSet(m, g, userId, cents, note, status) {
      if (Object.keys(g.contribs).length >= GF.contributions && !g.contribs[userId]) return fail('full', 'This group gift already has ' + GF.contributions + ' contributions.');
      g.contribs[userId] = { cents: cents, note: note || '', status: status }; return null;
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
        v.urgent = true; v.etype = r.etype; v.etypeLabel = C.EMERGENCY_TYPES[r.etype] || ''; v.where = r.where; v.pickup = r.pickup; v.dropoff = r.dropoff; v.loc = r.loc || null;
        v.hoursLeft = r.status === 'open' ? Math.max(0, Math.ceil((r.expiresAt - clockMs) / HOUR)) : 0;
        if (r.ownerId === m.userId) v.helperNames = r.helpers.map(function (id) { return nameOf(r.familyId, id); });
      }
      if (full) {
        v.pledges = active.map(function (p) { return { id: p.id, userId: p.userId, name: nameOf(r.familyId, p.userId), note: p.note, eta: p.eta || '', etaLabel: C.ETA[p.eta] || '', status: p.status, mine: p.userId === m.userId }; });
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
        out.exchanges = exchangeCount(m);
        if (m.adult) out.gifts = Object.keys(gifts).filter(function (k) { return giftFor(m, k) && gifts[k].status === 'open'; }).length;
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
        var nr = { id: nid('q'), n: seq, familyId: m.familyId, ownerId: m.userId, status: 'open', archived: false, approval: 'approved', audience: 'chosen', urgent: true, kind: 'time', needed: v.value.helpers.length, amount: '', neededBy: '', title: v.value.title, details: v.value.details, helpers: v.value.helpers, etype: v.value.type, where: v.value.where, pickup: v.value.pickup, dropoff: v.value.dropoff, loc: v.value.loc, expiresAt: clockMs + C.EMERGENCY.hours * HOUR };
        requests[nr.id] = nr;
        v.value.helpers.forEach(function (id) { notify(id, nameOf(m.familyId, m.userId) + ' needs help. Tap to open.'); });
        return { ok: true, request: requestView(m, nr, true) };
      },
      emergencyHelpers: function (m) {
        return { ok: true, helpers: members.filter(function (x) { return x.familyId === m.familyId && x.active && x.adult && x.userId !== m.userId; }).map(function (x) { return { userId: x.userId, name: nameOf(m.familyId, x.userId) }; }), max: C.EMERGENCY.helpers };
      },
      emergencyAllSet: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r || !r.urgent || r.ownerId !== m.userId) return NA();
        if (r.status === 'open') { r.status = 'closed'; r.helpers.forEach(function (id) { notify(id, 'No longer needed: "' + r.title + '". Thank you.'); }); }
        return { ok: true, request: requestView(m, r, true) };
      },
      emergencyKeepOpen: function (m, b) {
        var r = requestFor(m, b.requestId); if (!r || !r.urgent || r.ownerId !== m.userId) return NA();
        r.status = 'open'; r.expiresAt = clockMs + C.EMERGENCY.hours * HOUR;
        return { ok: true, request: requestView(m, r, true) };
      },

      /* ----- Gift exchanges (Phase C). Adults only. The draw is never returned except as the one person you drew, to you alone. ----- */
      exchangesHome: function (m) {
        if (!m.adult) return NA();
        var ls = Object.keys(exchanges).map(function (k) { return exchanges[k]; }).filter(function (x) { return exchangeFor(m, x.id); }).sort(function (a, b) { return b.n - a.n; });
        return { ok: true, exchanges: ls.map(function (x) { return exchangeRow(m, x); }) };
      },
      exchangeGet: function (m, b) { var x = exchangeFor(m, b.exchangeId); if (!x) return NA(); return { ok: true, exchange: exchangeView(m, x) }; },
      exchangeSave: function (m, b) {
        if (!m.adult) return NA();
        var x = b.exchangeId ? exchangeFor(m, b.exchangeId) : null;
        if (b.exchangeId && (!x || x.organiserId !== m.userId || x.drawn)) return NA();
        var v = C.validateExchange(b, x ? x.members : [m.userId]); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        if (!x) {
          var mine = Object.keys(exchanges).filter(function (k) { var e = exchanges[k]; return e.familyId === m.familyId && !e.gone && e.organiserId === m.userId; }).length;
          if (mine >= 5) return fail('limit', 'You can organise up to 5 exchanges at a time. Delete one to add another.');
          x = exchanges[('x' + (++seq))] = { id: 'x' + seq, n: seq, familyId: m.familyId, organiserId: m.userId, members: [m.userId], exclusions: [], pairs: {}, drawn: false, round: 0 };
        }
        x.name = v.value.name; x.note = v.value.note; x.limit = v.value.limit; x.date = v.value.date; if (b.exchangeId) x.exclusions = v.value.exclusions;
        return { ok: true, exchange: exchangeView(m, x) };
      },
      exchangeJoin: function (m, b) {
        var x = exchangeFor(m, b.exchangeId); if (!x || x.drawn) return x ? fail('already_drawn', 'Names were already drawn, so no one can join now. Ask the organiser.') : NA();
        if (x.members.length >= EX.members) return fail('full', 'This exchange is full.');
        if (x.members.indexOf(m.userId) < 0) x.members.push(m.userId); return { ok: true, exchange: exchangeView(m, x) };
      },
      exchangeLeave: function (m, b) {
        var x = exchangeFor(m, b.exchangeId); if (!x || x.members.indexOf(m.userId) < 0) return NA();
        if (x.organiserId === m.userId) return fail('organiser', 'You organise this one. Delete it instead of leaving.');
        dropFromExchange(x, m.userId, 'left'); return { ok: true, exchange: exchangeView(m, x) };
      },
      exchangeAddMember: function (m, b) {
        var x = exchangeFor(m, b.exchangeId); if (!x || x.organiserId !== m.userId || x.drawn) return NA();
        var t = membership(b.userId, m.familyId); if (!t || !t.adult) return NA();
        if (x.members.length >= EX.members) return fail('full', 'This exchange is full.');
        if (x.members.indexOf(t.userId) < 0) { x.members.push(t.userId); notify(t.userId, m.name + ' added you to ' + x.name + '.'); }
        return { ok: true, exchange: exchangeView(m, x) };
      },
      exchangeRemoveMember: function (m, b) {
        var x = exchangeFor(m, b.exchangeId); if (!x || x.organiserId !== m.userId || x.members.indexOf(b.userId) < 0) return NA();
        if (b.userId === m.userId) return fail('organiser', 'You organise this one. Delete it instead.');
        dropFromExchange(x, b.userId, 'was removed from'); notify(b.userId, 'You were removed from ' + x.name + '.');
        return { ok: true, exchange: exchangeView(m, x) };
      },
      exchangeDraw: function (m, b) { var x = exchangeFor(m, b.exchangeId); if (!x || x.organiserId !== m.userId) return NA(); if (x.drawn) return fail('already_drawn', 'Names were already drawn. Use Draw again to start over.'); return runDraw(m, x, false); },
      exchangeRedraw: function (m, b) { var x = exchangeFor(m, b.exchangeId); if (!x || x.organiserId !== m.userId || !x.drawn) return NA(); return runDraw(m, x, true); },
      exchangeDelete: function (m, b) {
        var x = exchangeFor(m, b.exchangeId); if (!x || x.organiserId !== m.userId) return NA();
        x.members.forEach(function (u) { if (u !== m.userId) notify(u, x.name + ' was deleted by ' + m.name + '.'); });
        x.gone = true; x.pairs = {}; return { ok: true };
      },

      /* ----- Group gifts (Phase D1). Adults only; the person a gift is for never sees it. ----- */
      giftsHome: function (m) {
        if (!m.adult) return NA();
        var ls = Object.keys(gifts).map(function (k) { return gifts[k]; }).filter(function (g) { return giftFor(m, g.id); }).sort(function (a, b) { return b.n - a.n; });
        return { ok: true, gifts: ls.map(function (g) { return giftRow(m, g); }), who: members.filter(function (o) { return o.familyId === m.familyId && o.active && o.userId !== m.userId; }).map(function (o) { return { userId: o.userId, name: o.name }; }) };
      },
      giftGet: function (m, b) { var g = giftFor(m, b.giftId); if (!g) return NA(); return { ok: true, gift: giftView(m, g) }; },
      giftSave: function (m, b) {
        if (!m.adult) return NA();
        var g = b.giftId ? giftFor(m, b.giftId) : null; if (b.giftId && (!g || g.organiserId !== m.userId || g.status === 'closed')) return NA();
        var ids = members.filter(function (o) { return o.familyId === m.familyId && o.active && o.userId !== m.userId; }).map(function (o) { return o.userId; });
        var v = C.validateGift(b, ids); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        if (!g) {
          var open = Object.keys(gifts).filter(function (k) { var e = gifts[k]; return e.familyId === m.familyId && !e.gone && e.organiserId === m.userId && e.status === 'open'; }).length;
          if (open >= GF.open) return fail('limit', 'You can run up to ' + GF.open + ' open group gifts. Close one to start another.');
          g = gifts['g' + (++seq)] = { id: 'g' + seq, n: seq, familyId: m.familyId, organiserId: m.userId, contribs: {}, status: 'open', gone: false };
          g.fresh = true;
        }
        var wasFor = g.forId; g.title = v.value.title; g.note = v.value.note; g.forId = v.value.forId; g.goalCents = v.value.goalCents; g.eachCents = v.value.eachCents; g.currency = v.value.currency;
        if (g.forId && g.contribs[g.forId]) delete g.contribs[g.forId];   // the person it is for cannot have contributed to it
        if (g.fresh) { g.fresh = false; members.forEach(function (o) { if (o.familyId === m.familyId && o.active && o.adult && o.userId !== m.userId && o.userId !== g.forId) notify(o.userId, m.name + ' started a group gift: ' + g.title + '. Tap to open.'); }); }
        return { ok: true, gift: giftView(m, g) };
      },
      giftContribute: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g) return NA();
        if (g.status === 'closed') return fail('closed', 'This group gift is closed.');
        var cur = g.contribs[m.userId]; if (cur && cur.status === 'confirmed') return fail('confirmed', 'Your contribution was already confirmed. Ask ' + nameOf(g.familyId, g.organiserId) + ' if it needs to change.');
        var v = C.validateContribution(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        var mine = g.organiserId === m.userId, e = giftSet(m, g, m.userId, v.value.cents, v.value.note, mine ? 'confirmed' : 'marked'); if (e) return e;
        if (!mine) notify(g.organiserId, m.name + ' marked a contribution to ' + g.title + '. Confirm it when you have it.');
        return { ok: true, gift: giftView(m, g) };
      },
      giftWithdraw: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g || !g.contribs[m.userId]) return NA();
        if (g.contribs[m.userId].status === 'confirmed' && g.organiserId !== m.userId) return fail('confirmed', 'Your contribution was already confirmed. Ask ' + nameOf(g.familyId, g.organiserId) + ' if it needs to change.');
        delete g.contribs[m.userId]; return { ok: true, gift: giftView(m, g) };
      },
      giftConfirm: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g || g.organiserId !== m.userId || !g.contribs[b.userId]) return NA();
        g.contribs[b.userId].status = 'confirmed'; notify(b.userId, 'Your contribution to ' + g.title + ' was confirmed. Thank you.'); return { ok: true, gift: giftView(m, g) };
      },
      giftDecline: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g || g.organiserId !== m.userId || !g.contribs[b.userId]) return NA();
        delete g.contribs[b.userId]; notify(b.userId, m.name + ' could not confirm your contribution to ' + g.title + '. Please check with them.'); return { ok: true, gift: giftView(m, g) };
      },
      giftRecord: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g || g.organiserId !== m.userId) return NA();
        var t = membership(b.userId, m.familyId); if (!t || !t.adult || t.userId === g.forId || t.userId === m.userId) return NA();
        if (g.status === 'closed') return fail('closed', 'This group gift is closed.');
        var v = C.validateContribution(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        var e = giftSet(m, g, t.userId, v.value.cents, v.value.note, 'confirmed'); if (e) return e;
        notify(t.userId, m.name + ' recorded your contribution to ' + g.title + '. Thank you.'); return { ok: true, gift: giftView(m, g) };
      },
      giftSetStatus: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g || g.organiserId !== m.userId) return NA();
        g.status = b.closed ? 'closed' : 'open'; return { ok: true, gift: giftView(m, g) };
      },
      giftDelete: function (m, b) {
        var g = giftFor(m, b.giftId); if (!g || g.organiserId !== m.userId) return NA();
        Object.keys(g.contribs).forEach(function (u) { if (u !== m.userId) notify(u, g.title + ' was deleted by ' + m.name + '.'); });
        g.gone = true; g.contribs = {}; return { ok: true };
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
        if (mine) { if (mine.status === 'done') return fail('done', 'Your pledge is already marked done.'); mine.note = v.value.note; mine.eta = v.value.eta || ''; return { ok: true, request: requestView(m, r, true) }; }
        if (pledgesOf(r.id).filter(function (p) { return p.status !== 'withdrawn'; }).length >= RQ.pledges) return fail('limit', 'This request already has ' + RQ.pledges + ' pledges.');
        var np = { id: nid('g'), n: seq, requestId: r.id, familyId: m.familyId, userId: m.userId, note: v.value.note, eta: v.value.eta || '', status: 'pledged' }; pledges[np.id] = np;
        notify(r.ownerId, nameOf(m.familyId, m.userId) + (r.urgent ? ' can help' + (np.eta ? ' (' + C.ETA[np.eta].toLowerCase() + ')' : '') + ' with "' : ' pledged to help with "') + r.title + '".');
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
        Object.keys(exchanges).forEach(function (k) { var x = exchanges[k]; if (x.familyId !== familyId || x.gone) return; if (x.organiserId === userId) { x.gone = true; x.pairs = {}; x.members.forEach(function (u) { if (u !== userId) notify(u, x.name + ' was cancelled because its organiser left the family.'); }); } else if (x.members.indexOf(userId) >= 0) dropFromExchange(x, userId, 'left'); });
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
      rand: Math.random,   // tests replace it with a seeded generator
      addExchange: function (familyId, organiserId, name, others, fields) { var r = call(organiserId, 'exchangeSave', Object.assign({ familyId: familyId, name: name }, fields || {})); (others || []).forEach(function (u) { call(u, 'exchangeJoin', { familyId: familyId, exchangeId: r.exchange.id }); }); return r.exchange; },
      addGift: function (familyId, organiserId, fields, contribs) { var g = call(organiserId, 'giftSave', Object.assign({ familyId: familyId }, fields)).gift; (contribs || []).forEach(function (c) { call(c[0], 'giftContribute', { familyId: familyId, giftId: g.id, amount: c[1] }); if (c[2]) call(organiserId, 'giftConfirm', { familyId: familyId, giftId: g.id, userId: c[0] }); }); return g; },
      clearNotices: function (userId) { notices[userId] = []; },
      advanceHours: function (h) { clockMs += h * 36e5; },
      pledgeFor: function (userId, requestId, note) { var r = requests[requestId]; return call(userId, 'pledgeSave', { familyId: r.familyId, requestId: requestId, note: note || '' }); },
      /** For tests only: everything the server holds. */
      dump: function () { return JSON.stringify({ lists: lists, items: items, reservations: reservations, notices: notices, reports: reports, requests: requests, pledges: pledges, exchanges: exchanges, gifts: gifts }); }
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
    a.addExchange('famA', 'u-rae', 'Holiday gift exchange', ['u-sam', 'u-tia'], { date: '2026-12-20', limit: 'about $25', note: 'Wrap it and bring it to the party.' }); a.clearNotices('u-sam'); a.clearNotices('u-tia'); a.clearNotices('u-rae');
    a.addGift('famA', 'u-rae', { title: 'Gran\u2019s birthday present', note: 'Pay Rae by cash or Venmo, then mark it here.', forId: 'u-una', goal: '120', each: '20', currency: 'USD' }, [['u-sam', '20', true]]); ['u-sam', 'u-tia', 'u-rae'].forEach(function (u) { a.clearNotices(u); });
    a.reserveFor('u-sam', mug.id);   // Sam already reserved Rae's mug
    a.reserveFor('u-tia', tape.id);   // Tia reserved Sam's tape measure, so Rae sees one item as "Reserved" without a name
  }

  return { create: create, VIEWERS: VIEWERS };
});
