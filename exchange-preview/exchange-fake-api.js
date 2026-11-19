/* Family Exchange preview: the fake "server" for reports (PREVIEW CODE, sample only).
 * Copyright Leia. Licence for this file: not yet marked; it follows the repository licensing decision, which is still open.
 * The screen must only ever draw what this layer returns for the signed-in sample account, the same way the real server answers each caller.
 * It returns a JSON string, like a network response, so tests can inspect exactly what an account would receive. No request is made. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ExchangeFakeApi = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
  /** Reports a moderator may review. A report about the caller's own listing is not in the answer at all: not its text, not its reporter, not a count, not a placeholder.
   *  A caller who is not a moderator gets the same "not available" answer as for a missing page. */
  function listReports(db, viewers, viewerId) {
    var v = byId(viewers, viewerId);
    if (!v || !v.moderator) return JSON.stringify({ ok: false, status: 404, error: 'not_available' });
    var out = [];
    db.reports.forEach(function (r) {
      var l = byId(db.listings, r.listing);
      if (l && l.owner === viewerId) return;
      var by = byId(viewers, r.by);
      out.push({ id: r.id, listingId: r.listing, title: l ? l.title : 'Removed listing', status: r.status, reason: r.reason, detail: r.detail || '', reporter: by ? by.name : 'Someone', ago: r.ago });
    });
    return JSON.stringify({ ok: true, reports: out });
  }
  /** May this caller decide this report? Never for a report about their own listing, never for a non-moderator, and an unknown report looks the same as one they may not see. */
  function canResolve(db, viewers, viewerId, reportId) {
    var v = byId(viewers, viewerId), r = byId(db.reports, reportId), l = r && byId(db.listings, r.listing);
    return !!(v && v.moderator && r && l && l.owner !== viewerId);
  }
  return { listReports: listReports, canResolve: canResolve };
});
