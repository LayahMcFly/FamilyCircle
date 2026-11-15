/* Giving Center rules for the real backend. Copied from giving-core.js (the version you tested on your phone) and
 * converted to a module. function/test/giving.test.js checks that both copies give the same answers, so they cannot drift apart.
 * Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt). */
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
    if (s.length > LIMITS.url || /\s/.test(s)) return null;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (SAFE_SCHEMES.indexOf(u.protocol) === -1) return null;
    if (u.username || u.password) return null;
    if (!u.hostname || u.hostname.indexOf('.') === -1) return null;
    return u.href;
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

export { REPORT_REASONS, AUDIENCES, validateReport, LIMITS, PRIORITIES, PRIORITY_LABEL, CURRENCIES, cleanUrl, hostOf, parseAmount, fmtMoney, totalsByCurrency, validateList, validateItem, trim };
