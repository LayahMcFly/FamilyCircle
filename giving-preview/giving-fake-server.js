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
 * Surprise rule modelled here: the OWNER of a list never receives any reservation field at all (not hidden, not present).
 * The buyer sees their own reservation. Other eligible members see only "reserved", never who. */
(function (root, factory) {
  var C = typeof module === 'object' && module.exports ? require('./giving-core.js') : root.GivingCore;
  var api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GivingFake = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var L = C.LIMITS;
  var PHOTOS = ['', 'mug', 'book', 'plant', 'lamp'];
  function fail(error, message) { return { ok: false, error: error, message: message }; }
  var NA = function () { return fail('not_available', 'That is not available.'); };

  /* options: seed:false for an empty world (tests). */
  function create(options) {
    options = options || {};
    var families = {}, members = [], eligible = {}, lists = {}, items = {}, notices = {};
    var reservations = {};   // itemId -> row. One key per item = "unique index on itemId": a second insert for the same item is refused.
    var seq = 0, gens = {};
    var nid = function (p) { return p + (++seq); };

    /* the unique-key insert the real backend would get from a unique index; returns false on conflict */
    function insertUnique(itemId, row) { if (Object.prototype.hasOwnProperty.call(reservations, itemId)) return false; reservations[itemId] = row; return true; }

    function membership(userId, familyId) { return members.filter(function (m) { return m.userId === userId && m.familyId === familyId && m.active; })[0] || null; }
    function nameOf(familyId, userId) { var m = members.filter(function (x) { return x.userId === userId && x.familyId === familyId; })[0]; return m ? m.name : 'Family member'; }

    /** Every action starts here: current membership, then eligibility. A non-member gets the same answer as for something that does not exist. */
    function gate(userId, familyId) {
      if (!families[familyId] || !membership(userId, familyId)) return NA();
      if (!eligible[userId]) return fail('no_access', 'Giving Center is not available for this account.');
      return null;
    }
    function listFor(userId, familyId, listId) {
      var l = lists[listId];
      if (!l || l.familyId !== familyId || l.archived) return null;
      var om = membership(l.ownerId, familyId);
      if (!om) return null;
      return l;
    }
    function notify(userId, text) { (notices[userId] = notices[userId] || []).push({ id: nid('n'), text: text }); }

    function itemView(viewer, it, list) {
      var v = { id: it.id, listId: it.listId, title: it.title, notes: it.notes, priority: it.priority, url: it.url, priceCents: it.priceCents, currency: it.currency, photo: it.photo, received: it.received, mine: list.ownerId === viewer };
      if (v.mine) return v;   // the owner gets NO reservation fields of any kind
      var r = reservations[it.id];
      v.reserved = !!r;
      if (r && r.buyerId === viewer) { v.reservedByMe = true; v.changedSinceReserved = r.version !== it.version; }
      return v;
    }
    function listSummary(viewer, l) {
      var its = Object.keys(items).map(function (k) { return items[k]; }).filter(function (i) { return i.listId === l.id; });
      var s = { id: l.id, name: l.name, ownerId: l.ownerId, ownerName: nameOf(l.familyId, l.ownerId), mine: l.ownerId === viewer, itemCount: its.filter(function (i) { return !i.received; }).length, receivedCount: its.filter(function (i) { return i.received; }).length };
      if (!s.mine) s.availableCount = its.filter(function (i) { return !i.received && !reservations[i.id]; }).length;
      return s;
    }
    function itemsOf(listId) { return Object.keys(items).map(function (k) { return items[k]; }).filter(function (i) { return i.listId === listId; }).sort(function (a, b) { return a.n - b.n; }); }
    function dropReservation(itemId, reason) {
      var r = reservations[itemId]; if (!r) return;
      delete reservations[itemId];
      var it = items[itemId];
      if (reason && it) notify(r.buyerId, reason.replace('{item}', it.title));
    }

    /* ---------- actions ---------- */
    var actions = {
      families: function (u) {
        var out = [];
        Object.keys(families).forEach(function (id) { if (membership(u, id)) out.push({ id: id, name: families[id].name }); });
        return { ok: true, families: out };
      },
      home: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var ls = Object.keys(lists).map(function (k) { return lists[k]; }).filter(function (l) { return listFor(u, b.familyId, l.id); }).sort(function (a, c) { return (a.ownerId === u ? 0 : 1) - (c.ownerId === u ? 0 : 1) || a.n - c.n; }).map(function (l) { return listSummary(u, l); });
        var mine = Object.keys(reservations).map(function (k) { return reservations[k]; }).filter(function (r) { return r.buyerId === u && r.familyId === b.familyId && items[r.itemId] && lists[items[r.itemId].listId] && listFor(u, b.familyId, items[r.itemId].listId); })
          .map(function (r) { var it = items[r.itemId], l = lists[it.listId]; return { itemId: it.id, title: it.title, listId: l.id, ownerName: nameOf(b.familyId, l.ownerId), changedSinceReserved: r.version !== it.version }; });
        return { ok: true, lists: ls, reservations: mine, notices: (notices[u] || []).slice(), canCreateList: ls.filter(function (x) { return x.mine; }).length < L.lists };
      },
      noticeDismiss: function (u, b) { notices[u] = (notices[u] || []).filter(function (n) { return n.id !== b.noticeId; }); return { ok: true }; },
      listGet: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var l = listFor(u, b.familyId, b.listId); if (!l) return NA();
        var its = itemsOf(l.id).map(function (i) { return itemView(u, i, l); });
        return { ok: true, list: listSummary(u, l), items: its, totals: l.ownerId === u ? C.totalsByCurrency(its) : undefined };
      },
      listSave: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var v = C.validateList(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted field.', fields: v.errors };
        if (b.listId) {
          var l = listFor(u, b.familyId, b.listId); if (!l || l.ownerId !== u) return NA();
          l.name = v.value.name; return { ok: true, list: listSummary(u, l) };
        }
        var mineCount = Object.keys(lists).map(function (k) { return lists[k]; }).filter(function (x) { return x.familyId === b.familyId && x.ownerId === u && !x.archived; }).length;
        if (mineCount >= L.lists) return fail('limit', 'You can have up to ' + L.lists + ' wishlists. Delete one to add another.');
        var nl = { id: nid('l'), n: seq, familyId: b.familyId, ownerId: u, name: v.value.name, archived: false };
        lists[nl.id] = nl; return { ok: true, list: listSummary(u, nl) };
      },
      listDelete: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var l = listFor(u, b.familyId, b.listId); if (!l || l.ownerId !== u) return NA();
        itemsOf(l.id).forEach(function (i) { dropReservation(i.id, 'A wishlist with an item you reserved ({item}) was removed.'); delete items[i.id]; });
        delete lists[l.id]; return { ok: true };
      },
      itemSave: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var l = listFor(u, b.familyId, b.listId); if (!l || l.ownerId !== u) return NA();
        var v = C.validateItem(b); if (!v.ok) return { ok: false, error: 'invalid', message: 'Check the highlighted fields.', fields: v.errors };
        var photo = PHOTOS.indexOf(b.photo || '') === -1 ? '' : (b.photo || '');
        if (b.itemId) {
          var it = items[b.itemId]; if (!it || it.listId !== l.id) return NA();
          var material = it.title !== v.value.title || it.url !== v.value.url || it.priceCents !== v.value.priceCents || it.currency !== v.value.currency;
          Object.assign(it, v.value, { photo: photo }); if (material) it.version++;   // notes and priority do not count as a change the buyer needs to know about
          return { ok: true, item: itemView(u, it, l) };
        }
        if (itemsOf(l.id).length >= L.items) return fail('limit', 'A wishlist can have up to ' + L.items + ' items.');
        var ni = Object.assign({ id: nid('i'), n: seq, listId: l.id, familyId: b.familyId, photo: photo, received: false, version: 1 }, v.value);
        items[ni.id] = ni; return { ok: true, item: itemView(u, ni, l) };
      },
      itemDelete: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var it = items[b.itemId], l = it && listFor(u, b.familyId, it.listId); if (!it || !l || l.ownerId !== u) return NA();
        dropReservation(it.id, 'An item you reserved ({item}) is no longer on the wishlist.');
        delete items[it.id]; return { ok: true };
      },
      itemReceived: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var it = items[b.itemId], l = it && listFor(u, b.familyId, it.listId); if (!it || !l || l.ownerId !== u) return NA();
        it.received = b.received !== false;
        if (it.received) dropReservation(it.id, 'An item you reserved ({item}) was marked received.');
        return { ok: true, item: itemView(u, it, l) };
      },
      reserve: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var it = items[b.itemId], l = it && listFor(u, b.familyId, it.listId); if (!it || !l) return NA();
        if (l.ownerId === u) return fail('own_item', 'You cannot reserve something from your own wishlist.');   // same answer whatever the reservation state
        if (it.received) return fail('unavailable', 'This item is no longer available.');
        var row = { id: nid('r'), itemId: it.id, familyId: b.familyId, buyerId: u, version: it.version };
        if (!insertUnique(it.id, row)) {
          var cur = reservations[it.id];
          if (cur.buyerId === u) return { ok: true, already: true, item: itemView(u, it, l) };   // the same person asking twice is safe
          return fail('taken', 'Someone has already reserved this item.');
        }
        return { ok: true, item: itemView(u, it, l) };
      },
      release: function (u, b) {
        var g = gate(u, b.familyId); if (g) return g;
        var r = reservations[b.itemId];
        if (!r || r.buyerId !== u || r.familyId !== b.familyId) return NA();   // someone else's reservation looks exactly like none
        delete reservations[b.itemId];
        var it = items[b.itemId], l = lists[it.listId];
        return { ok: true, item: itemView(u, it, l) };
      }
    };

    /* ---------- set-up and scenario controls (the preview's own buttons and the tests; not actions a person can call) ---------- */
    var admin = {
      addFamily: function (id, name) { families[id] = { name: name }; gens[id] = {}; },
      addMember: function (familyId, userId, name) { members.push({ familyId: familyId, userId: userId, name: name, active: true }); gens[familyId][userId] = 1; },
      setEligible: function (userId, yes) { eligible[userId] = !!yes; },
      /** A removed member: the person's reservations are released, and their wishlists stop being reachable. */
      removeMember: function (familyId, userId) {
        members.forEach(function (m) { if (m.familyId === familyId && m.userId === userId) m.active = false; });
        Object.keys(reservations).forEach(function (k) { var r = reservations[k]; if (r.familyId === familyId && r.buyerId === userId) delete reservations[k]; });
        Object.keys(lists).forEach(function (k) {
          var l = lists[k]; if (l.familyId !== familyId || l.ownerId !== userId) return;
          l.archived = true;
          itemsOf(l.id).forEach(function (i) { dropReservation(i.id, 'An item you reserved ({item}) is no longer available.'); });
        });
      },
      /** A re-invitation is a fresh membership: nothing from before is revived, and the old wishlists stay archived. */
      reinvite: function (familyId, userId) {
        members.forEach(function (m) { if (m.familyId === familyId && m.userId === userId) m.active = true; });
        gens[familyId][userId] = (gens[familyId][userId] || 0) + 1;
      },
      addList: function (familyId, ownerId, name) { var l = { id: nid('l'), n: seq, familyId: familyId, ownerId: ownerId, name: name, archived: false }; lists[l.id] = l; return l; },
      addItem: function (listId, fields) { var l = lists[listId]; var it = Object.assign({ id: nid('i'), n: seq, listId: listId, familyId: l.familyId, notes: '', priority: 'medium', url: '', priceCents: 0, currency: '', photo: '', received: false, version: 1 }, fields); items[it.id] = it; return it; },
      reserveFor: function (userId, itemId) { var it = items[itemId]; return actions.reserve(userId, { familyId: it.familyId, itemId: itemId }); },
      /** For tests only: everything the server holds. */
      dump: function () { return JSON.stringify({ lists: lists, items: items, reservations: reservations, notices: notices }); }
    };

    function call(userId, action, body) {
      var fn = actions[action];
      if (!fn || typeof userId !== 'string' || !userId) return fail('bad_request', 'Unknown request.');
      return fn(userId, body || {});
    }

    if (options.seed !== false) seed(admin);
    return { call: call, admin: admin, familiesOf: function (u) { return actions.families(u).families; }, PHOTOS: PHOTOS };
  }

  var VIEWERS = [
    { userId: 'u-rae', name: 'Rae Sample', note: 'Has wishlists and can add gifts. Cannot see anything about who reserved her items.' },
    { userId: 'u-sam', name: 'Sam Sample', note: 'A gift-giver. Has reserved one of Rae’s items.' },
    { userId: 'u-tia', name: 'Tia Sample', note: 'A gift-giver with no reservations yet.' },
    { userId: 'u-riley', name: 'Riley Sample', note: 'A member whose account does not have Giving Center access (a stand-in switch, not an age rule).' },
    { userId: 'u-una', name: 'Una Sample', note: 'Another member without Giving Center access (account not yet classified).' },
    { userId: 'u-quinn', name: 'Quinn Sample', note: 'Removed from Family A. Every request is refused.' },
    { userId: 'u-olive', name: 'Olive Example', note: 'Family B only. Cannot see anything in Family A.' }
  ];

  function seed(a) {
    a.addFamily('famA', 'Sample Family A'); a.addFamily('famB', 'Sample Family B');
    [['u-rae', 'Rae Sample'], ['u-sam', 'Sam Sample'], ['u-tia', 'Tia Sample'], ['u-riley', 'Riley Sample'], ['u-una', 'Una Sample'], ['u-quinn', 'Quinn Sample']].forEach(function (p) { a.addMember('famA', p[0], p[1]); });
    a.addMember('famB', 'u-olive', 'Olive Example');
    ['u-rae', 'u-sam', 'u-tia', 'u-olive', 'u-quinn'].forEach(function (u) { a.setEligible(u, true); });   // Riley and Una stay without access
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
    a.reserveFor('u-sam', mug.id);   // Sam already reserved Rae's mug
    var l3 = a.addList('famA', 'u-tia', 'Kid wishes');
    a.addItem(l3.id, { title: 'Bubble gun', notes: 'The kind that makes big bubbles. Batteries not needed.', priority: 'high', url: 'https://toys.example.com/bubble-gun', priceCents: 1599, currency: 'USD' });   // a link and no photo
    a.reserveFor('u-tia', tape.id);   // Tia reserved Sam's tape measure, so Rae sees one item as "Reserved" without a name
  }

  return { create: create, VIEWERS: VIEWERS };
});
