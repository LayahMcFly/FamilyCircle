/* Giving Center preview: shared rules (PREVIEW CODE, not wired into the live app).
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).
 * Used by the fake server, the screens and the Node tests. Everything the user types is kept exactly as typed (no case changes);
 * only leading and trailing spaces are trimmed. Limits here are PROPOSED, not approved. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GivingCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMITS = { lists: 10, items: 100, listName: 60, title: 120, notes: 1000, url: 500, maxPrice: 100000 };
  var PRIORITIES = ['low', 'medium', 'high'];
  var PRIORITY_LABEL = { low: 'Nice to have', medium: 'Would like', high: 'Really want' };
  /* Two-decimal currencies only for now. Currencies with no cents (for example JPY and KRW) need their own handling and are not offered yet. */
  var CURRENCIES = { USD: { symbol: '$', name: 'US dollar' }, CAD: { symbol: 'CA$', name: 'Canadian dollar' }, GBP: { symbol: '\u00a3', name: 'British pound' }, EUR: { symbol: '\u20ac', name: 'Euro' }, AUD: { symbol: 'A$', name: 'Australian dollar' },
    NZD: { symbol: 'NZ$', name: 'New Zealand dollar' }, MXN: { symbol: 'MX$', name: 'Mexican peso' }, BRL: { symbol: 'R$', name: 'Brazilian real' }, INR: { symbol: '\u20b9', name: 'Indian rupee' }, PKR: { symbol: 'Rs ', name: 'Pakistani rupee' },
    PHP: { symbol: '\u20b1', name: 'Philippine peso' }, NGN: { symbol: '\u20a6', name: 'Nigerian naira' }, ZAR: { symbol: 'R ', name: 'South African rand' }, KES: { symbol: 'KSh ', name: 'Kenyan shilling' }, AED: { symbol: 'AED ', name: 'UAE dirham' },
    SGD: { symbol: 'S$', name: 'Singapore dollar' }, HKD: { symbol: 'HK$', name: 'Hong Kong dollar' }, CHF: { symbol: 'CHF ', name: 'Swiss franc' }, SEK: { symbol: 'kr ', name: 'Swedish krona' }, NOK: { symbol: 'kr ', name: 'Norwegian krone' },
    DKK: { symbol: 'kr ', name: 'Danish krone' }, PLN: { symbol: 'z\u0142 ', name: 'Polish zloty' } };
  var SAFE_SCHEMES = ['https:', 'http:'];

  var trim = function (s) { return typeof s === 'string' ? s.replace(/^\s+|\s+$/g, '') : ''; };

  /** A retailer link. Only http and https, no embedded passwords, no spaces, no script or data links. Returns '' when blank, null when not allowed. */
  function cleanUrl(raw) {
    var s = trim(raw);
    if (!s) return '';
    if (/\s/.test(s) || s.length > 4000) return null;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (SAFE_SCHEMES.indexOf(u.protocol) === -1) return null;
    if (u.username || u.password) return null;
    if (!u.hostname || u.hostname.indexOf('.') === -1) return null;
    stripTracking(u);
    return u.href.length > LIMITS.url ? null : u.href;
  }
  /** Advertising and tracking parts of a pasted link (utm_*, gclid, wl0..wl12, and so on) are dropped so the saved link is short and shares nothing about who clicked what. */
  var TRACKING = /^(utm_.*|gclid|gbraid|wbraid|gad_.*|fbclid|msclkid|dclid|twclid|ttclid|mc_cid|mc_eid|igshid|adid|wmlspartner|veh|sid|wl\d+|cmpid|ref_|_encoding|pd_rd_.*|pf_rd_.*|content-id|qid|sr|spLa)$/i;
  function stripTracking(u) {
    var keep = [];
    u.searchParams.forEach(function (v, k) { if (!TRACKING.test(k)) keep.push([k, v]); });
    u.search = '';
    keep.forEach(function (kv) { u.searchParams.append(kv[0], kv[1]); });
  }
  /** The part of a link that is safe to show as text: just the site name. */
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  /** An estimated price typed as "25", "25.5" or "1,250.00". Returns whole cents, '' when blank, null when not a valid amount. */
  function parseAmount(raw) {
    var s = trim(String(raw === null || raw === undefined ? '' : raw));
    if (!s) return '';
    if (s.indexOf(',') !== -1) { if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return null; s = s.replace(/,/g, ''); }   // "1,250.00" is fine; "1,5" is refused, never read as 15
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
    var cents = Math.round(parseFloat(s) * 100);
    if (cents <= 0 || cents > LIMITS.maxPrice * 100) return null;
    return cents;
  }
  function fmtMoney(cents, cur) {
    var c = CURRENCIES[cur]; if (!c) return '';
    return c.symbol + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + cur;
  }
  /** Totals per currency. Different currencies are never added together. */
  function totalsByCurrency(items) {
    var t = {};
    items.forEach(function (i) { if (i.priceCents && i.currency && !i.received) t[i.currency] = (t[i.currency] || 0) + i.priceCents; });
    return Object.keys(t).sort().map(function (cur) { return { currency: cur, cents: t[cur], text: fmtMoney(t[cur], cur) }; });
  }

  function validateList(b) {
    var errors = {}, name = trim(b && b.name);
    if (!name) errors.name = 'Give the wishlist a name.';
    else if (name.length > LIMITS.listName) errors.name = 'Wishlist names can be up to ' + LIMITS.listName + ' characters.';
    return { ok: !Object.keys(errors).length, errors: errors, value: { name: name } };
  }
  function validateItem(b) {
    var errors = {}; b = b || {};
    var title = trim(b.title), notes = trim(b.notes);
    if (!title) errors.title = 'Add a title for the item.';
    else if (title.length > LIMITS.title) errors.title = 'Titles can be up to ' + LIMITS.title + ' characters.';
    if (notes.length > LIMITS.notes) errors.notes = 'Notes can be up to ' + LIMITS.notes + ' characters.';
    var priority = b.priority || 'medium';
    if (PRIORITIES.indexOf(priority) === -1) errors.priority = 'Choose one of the priorities.';
    var url = cleanUrl(b.url);
    if (url === null) errors.url = 'Use a web address that starts with https:// or http:// (no spaces, no passwords in it).';
    var cents = parseAmount(b.price), currency = b.currency || '';
    if (cents === null) errors.price = 'Enter an amount like 25 or 24.99 (up to ' + LIMITS.maxPrice + ').';
    if (cents && !CURRENCIES[currency]) errors.currency = 'Choose a currency for the estimated price.';
    if (!cents && cents !== null && currency && !CURRENCIES[currency]) errors.currency = 'Choose one of the currencies.';
    return { ok: !Object.keys(errors).length, errors: errors, value: { title: title, notes: notes, priority: priority, url: url || '', priceCents: cents || 0, currency: cents ? currency : '' } };
  }

  var REPORT_REASONS = { inappropriate: 'Inappropriate or not kind', unsafe: 'Unsafe or suspicious link', private: 'Shares something private', other: 'Something else' };
  var AUDIENCES = { everyone: 'Everyone in the family', adults: 'Adults only' };
  function validateReport(b) {
    var errors = {}; b = b || {};
    var note = trim(b.note);
    if (!REPORT_REASONS[b.reason]) errors.reason = 'Choose a reason.';
    if (note.length > 500) errors.note = 'Notes can be up to 500 characters.';
    return { ok: !Object.keys(errors).length, errors: errors, value: { reason: b.reason, note: note } };
  }

  /* ---------- Requests and pledges (Phase A). Limits are PROPOSED. ---------- */
  var REQ = { open: 10, pledges: 20, title: 120, details: 1000, note: 300, needed: 20, amount: 60 };
  var REQUEST_KINDS = { thing: 'A thing', time: 'Someone\u2019s time', task: 'A task' };
  function validateRequest(b) {
    var errors = {}; b = b || {};
    var title = trim(b.title), details = trim(b.details), amount = trim(b.amount), kind = b.kind || 'thing';
    if (!title) errors.title = 'Add a short title for the request.';
    else if (title.length > REQ.title) errors.title = 'Titles can be up to ' + REQ.title + ' characters.';
    if (details.length > REQ.details) errors.details = 'Details can be up to ' + REQ.details + ' characters.';
    if (!REQUEST_KINDS[kind]) errors.kind = 'Choose what you need.';
    var needed = b.needed === undefined || b.needed === '' ? 1 : Number(b.needed);
    if (!(needed >= 1 && needed <= REQ.needed && Math.floor(needed) === needed)) errors.needed = 'How many helpers or items: a whole number from 1 to ' + REQ.needed + '.';
    if (amount.length > REQ.amount) errors.amount = 'Keep the amount note under ' + REQ.amount + ' characters, for example "about $40".';
    var by = trim(b.neededBy);
    if (by && !/^\d{4}-\d{2}-\d{2}$/.test(by)) errors.neededBy = 'Use a date like 2026-12-24, or leave it empty.';
    var audience = b.audience === 'adults' ? 'adults' : 'everyone';
    return { ok: !Object.keys(errors).length, errors: errors, value: { title: title, details: details, kind: kind, needed: needed, amount: amount, neededBy: by, audience: audience } };
  }
  function validatePledge(b) {
    var errors = {}, note = trim(b && b.note);
    if (note.length > REQ.note) errors.note = 'Notes can be up to ' + REQ.note + ' characters.';
    var eta = trim(b && b.eta);
    if (eta && !ETA[eta]) errors.eta = 'Choose one of the times shown.';
    var val = { note: note }; if (eta) val.eta = eta;
    return { ok: !Object.keys(errors).length, errors: errors, value: val };
  }

  /* ---------- Emergency requests (Phase B). Numbers are the recommended defaults. ---------- */
  var EMERGENCY = { helpers: 8, hours: 48, title: 120, details: 500, place: 100 };
  var EMERGENCY_TYPES = { ride: 'A ride', stay: 'A place to stay', care: 'Childcare', cost: 'Help with a small cost', other: 'Something else' };
  var ETA = { '10': 'About 10 minutes', '30': 'About 30 minutes', today: 'Later today', tomorrow: 'Tomorrow' };
  var EMERGENCY_911 = 'For a life-threatening emergency, call 911 (or your local emergency number) first. Family Circle is not an emergency service and nobody is watching it in real time.';
  var EMERGENCY_PRIVACY = 'Do not put medical details, account numbers or passwords here. Helpers are only told that you need help.';
  function validateEmergency(b) {
    var errors = {}; b = b || {};
    var title = trim(b.title), details = trim(b.details);
    if (!title) errors.title = 'Say what you need, for example "Car broke down, need a ride".';
    else if (title.length > EMERGENCY.title) errors.title = 'Keep it under ' + EMERGENCY.title + ' characters.';
    if (details.length > EMERGENCY.details) errors.details = 'Details can be up to ' + EMERGENCY.details + ' characters.';
    var hs = Array.isArray(b.helpers) ? b.helpers.filter(function (x, i, a) { return typeof x === 'string' && x && a.indexOf(x) === i; }) : [];
    if (!hs.length) errors.helpers = 'Choose at least one adult to ask.';
    else if (hs.length > EMERGENCY.helpers) errors.helpers = 'You can ask up to ' + EMERGENCY.helpers + ' adults.';
    var type = EMERGENCY_TYPES[b.type] ? b.type : 'other';
    var where = trim(b.where), pickup = trim(b.pickup), dropoff = trim(b.dropoff);
    ['where', 'pickup', 'dropoff'].forEach(function (k) { if ({ where: where, pickup: pickup, dropoff: dropoff }[k].length > EMERGENCY.place) errors[k] = 'Keep it under ' + EMERGENCY.place + ' characters.'; });
    var loc = null;
    if (b.lat !== undefined && b.lat !== null && b.lat !== '') {
      var la = Number(b.lat), lo = Number(b.lng);
      if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180)) errors.loc = 'That location could not be used.';
      else loc = { lat: Math.round(la * 1e5) / 1e5, lng: Math.round(lo * 1e5) / 1e5 };
    }
    return { ok: !Object.keys(errors).length, errors: errors, value: { title: title, details: details, helpers: hs, type: type, where: where, pickup: pickup, dropoff: dropoff, loc: loc } };
  }

  /* ---------- Gift exchanges (Phase C). Nobody in the app, the organiser included, ever sees who drew whom. ---------- */
  var EXCHANGE = { name: 60, note: 300, limit: 30, members: 30, exclusions: 20, min: 3 };
  var EXCHANGE_NO_DRAW = 'These names cannot be drawn with the rules you set. Remove an exclusion or add another person and try again.';
  function validateExchange(b, memberIds) {
    var errors = {}; b = b || {};
    var name = trim(b.name), note = trim(b.note), limit = trim(b.limit), date = trim(b.date);
    if (!name) errors.name = 'Give the exchange a name, for example "Holiday gift exchange".';
    else if (name.length > EXCHANGE.name) errors.name = 'Names can be up to ' + EXCHANGE.name + ' characters.';
    if (note.length > EXCHANGE.note) errors.note = 'Notes can be up to ' + EXCHANGE.note + ' characters.';
    if (limit.length > EXCHANGE.limit) errors.limit = 'Keep the spending limit under ' + EXCHANGE.limit + ' characters, for example "about $25".';
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Use a date like 2026-12-24, or leave it empty.';
    var ex = [];
    if (Array.isArray(b.exclusions)) b.exclusions.forEach(function (p) {
      if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0] === p[1]) { errors.exclusions = 'Each exclusion needs two different people.'; return; }
      if (memberIds && (memberIds.indexOf(p[0]) < 0 || memberIds.indexOf(p[1]) < 0)) { errors.exclusions = 'Exclusions can only name people who joined.'; return; }
      if (!ex.some(function (q) { return (q[0] === p[0] && q[1] === p[1]) || (q[0] === p[1] && q[1] === p[0]); })) ex.push([p[0], p[1]]);
    });
    if (ex.length > EXCHANGE.exclusions) errors.exclusions = 'You can set up to ' + EXCHANGE.exclusions + ' exclusions.';
    return { ok: !Object.keys(errors).length, errors: errors, value: { name: name, note: note, limit: limit, date: date, exclusions: ex } };
  }
  /** Gives each person exactly one other person: no one draws themselves or an excluded person (excluded pairs cannot draw each other in either direction).
   *  rand is injectable so tests are repeatable. Returns { ok, pairs: { giverId: receiverId } }. A search with a step cap, so a bad set of rules fails fast instead of hanging. */
  function drawPairs(ids, exclusions, rand) {
    rand = rand || Math.random;
    var list = (ids || []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (list.length < EXCHANGE.min) return { ok: false, pairs: null };
    var bad = {}; (exclusions || []).forEach(function (p) { bad[p[0] + '>' + p[1]] = 1; bad[p[1] + '>' + p[0]] = 1; });
    function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    var givers = shuffle(list), pairs = {}, used = {}, steps = 0, CAP = 50000;
    function place(i) {
      if (i === givers.length) return true;
      if (++steps > CAP) return false;
      var g = givers[i], cands = shuffle(list);
      for (var k = 0; k < cands.length; k++) {
        var r = cands[k];
        if (r === g || used[r] || bad[g + '>' + r]) continue;
        pairs[g] = r; used[r] = 1;
        if (place(i + 1)) return true;
        delete pairs[g]; delete used[r];
      }
      return false;
    }
    return place(0) ? { ok: true, pairs: pairs } : { ok: false, pairs: null };
  }

  /* ---------- Group gifts (Phase D1: a tracker only. No money is taken, held or sent.) ---------- */
  var GIFT = { title: 80, note: 300, contribNote: 100, contributions: 40, open: 5 };
  var GIFT_MONEY = 'Family Circle never takes, holds or sends money. Everyone pays however they normally would, then marks it here.';
  function validateGift(b, memberIds) {
    var errors = {}; b = b || {};
    var title = trim(b.title), note = trim(b.note), forId = trim(b.forId), cur = trim(b.currency);
    if (!title) errors.title = 'Give the gift a name, for example "Gran’s birthday present".'; else if (title.length > GIFT.title) errors.title = 'Names can be up to ' + GIFT.title + ' characters.';
    if (note.length > GIFT.note) errors.note = 'Notes can be up to ' + GIFT.note + ' characters.';
    var goal = parseAmount(b.goal); if (goal === '') errors.goal = 'Enter the goal amount, for example 120.'; else if (goal === null) errors.goal = 'Use a plain amount like 120 or 120.50.';
    var each = parseAmount(b.each); if (each === null) errors.each = 'Use a plain amount like 20, or leave it empty.';
    if (!CURRENCIES[cur]) errors.currency = 'Choose a currency.';
    if (forId && memberIds && memberIds.indexOf(forId) < 0) errors.forId = 'Choose someone in the family, or leave it empty.';
    return { ok: !Object.keys(errors).length, errors: errors, value: { title: title, note: note, forId: forId, goalCents: typeof goal === 'number' ? goal : 0, eachCents: typeof each === 'number' ? each : 0, currency: cur } };
  }
  function validateContribution(b) {
    var errors = {}; b = b || {}; var note = trim(b.note);
    var cents = parseAmount(b.amount); if (cents === '') errors.amount = 'Enter the amount you put in, for example 20.'; else if (cents === null) errors.amount = 'Use a plain amount like 20 or 20.50.';
    if (note.length > GIFT.contribNote) errors.note = 'Notes can be up to ' + GIFT.contribNote + ' characters.';
    return { ok: !Object.keys(errors).length, errors: errors, value: { cents: typeof cents === 'number' ? cents : 0, note: note } };
  }

  return { GIFT: GIFT, GIFT_MONEY: GIFT_MONEY, validateGift: validateGift, validateContribution: validateContribution, EXCHANGE: EXCHANGE, EXCHANGE_NO_DRAW: EXCHANGE_NO_DRAW, validateExchange: validateExchange, drawPairs: drawPairs, EMERGENCY: EMERGENCY, EMERGENCY_TYPES: EMERGENCY_TYPES, ETA: ETA, EMERGENCY_911: EMERGENCY_911, EMERGENCY_PRIVACY: EMERGENCY_PRIVACY, validateEmergency: validateEmergency, REQ: REQ, REQUEST_KINDS: REQUEST_KINDS, validateRequest: validateRequest, validatePledge: validatePledge, REPORT_REASONS: REPORT_REASONS, AUDIENCES: AUDIENCES, validateReport: validateReport, LIMITS: LIMITS, PRIORITIES: PRIORITIES, PRIORITY_LABEL: PRIORITY_LABEL, CURRENCIES: CURRENCIES, cleanUrl: cleanUrl, hostOf: hostOf, parseAmount: parseAmount, fmtMoney: fmtMoney,
    totalsByCurrency: totalsByCurrency, validateList: validateList, validateItem: validateItem };
});
