/* Family Exchange preview: input rules (PREVIEW CODE, sample only).
 * Copyright Leia. Licence for this file: not yet marked; it follows the repository licensing decision, which is still open.
 * These limits are sample values for the preview. They are not approved production rules. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ExchangeRules = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMITS = { title: 80, description: 1000, area: 60, photos: 3, photoEdge: 600, photoKB: 110, note: 300 };
  var CATEGORIES = ['Furniture', 'Kids and baby', 'Books and media', 'Clothing', 'Kitchen and home', 'Garden and outdoor', 'Sports and toys', 'Other'];
  var CONDITIONS = ['Like new', 'Good', 'Worn but usable', 'For parts or repair'];
  var STREET = /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){0,3}(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|pl|place|cir|circle|hwy|highway)\b/i;
  function looksLikeAddress(s) { return STREET.test(String(s || '')); }
  function looksLikeContact(s) { s = String(s || ''); return /@/.test(s) || /(?:\d[\s().-]*){7,}/.test(s) || /https?:\/\/|www\./i.test(s); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  /* draft: { kind: 'free'|'wanted', title, category, condition, description, area, photos: [ids] } */
  function validate(d) {
    var e = {}, title = clean(d.title), desc = String(d.description || '').trim(), area = clean(d.area);
    if (d.kind !== 'free' && d.kind !== 'wanted') e.kind = 'Choose free item or wanted.';
    if (!title) e.title = 'Add a short title.'; else if (title.length > LIMITS.title) e.title = 'Keep the title to ' + LIMITS.title + ' characters or fewer.';
    if (CATEGORIES.indexOf(d.category) < 0) e.category = 'Choose a category.';
    if (d.kind === 'free' && CONDITIONS.indexOf(d.condition) < 0) e.condition = 'Choose the condition.';
    if (!desc) e.description = 'Add a description so people know what this is.'; else if (desc.length > LIMITS.description) e.description = 'Keep the description to ' + LIMITS.description + ' characters or fewer.';
    if (area.length > LIMITS.area) e.area = 'Keep the area to ' + LIMITS.area + ' characters or fewer.';
    else if (looksLikeAddress(area) || looksLikeContact(area)) e.area = 'Use a broad area such as "near the library". Street addresses, phone numbers, emails and links are not allowed here.';
    if (looksLikeContact(title + ' ' + desc) && !e.description) e.description = 'Please leave phone numbers, emails and links out. Use Messages for pickup details.';
    if (looksLikeAddress(desc) && !e.description) e.description = 'Please leave street addresses out. Use Messages for pickup details.';
    if ((d.photos || []).length > LIMITS.photos) e.photos = 'Choose up to ' + LIMITS.photos + ' photos.';
    if (d.kind === 'wanted' && (d.photos || []).length) e.photos = 'Wanted posts do not have photos in this preview.';
    return { ok: !Object.keys(e).length, errors: e };
  }
  return { LIMITS: LIMITS, CATEGORIES: CATEGORIES, CONDITIONS: CONDITIONS, validate: validate, looksLikeAddress: looksLikeAddress, looksLikeContact: looksLikeContact, clean: clean };
});
