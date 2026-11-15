/*
  Giving Center for Family Circle: connects the Giving screens (giving-ui.js) to the family-api function.
  Copyright (C) 2026 Leia. GNU GPL v3 or later (see LICENSE-GPL-3.0.txt).

  This file only translates. Every rule (who is an adult, who can reserve, what the list owner may see) is enforced by the function
  (function/src/giving.js), never here. The screens are reachable at #/giving; the Hub card still says "Planned" and does not link here.
  Giving Center is OFF for a family until its owner turns it on, and the function answers "not available" until then.
*/
(function () {
  'use strict';

  function install(X) {
    var current = null;   // the screen that is showing; its late replies are dropped when a new one replaces it

    // The preview's action names become the function's action names: home -> givingHome, reserve -> givingReserve, and so on.
    function serverFor() {
      return {
        call: function (userId, action, body) {
          var b = Object.assign({}, body || {});
          if (action === 'reportResolve') { b.resolution = b.action; delete b.action; }   // the function's own word for this; "action" names the call itself
          var name = 'giving' + action.charAt(0).toUpperCase() + action.slice(1);
          return X.api(name, b).then(function (json) {
            var out = Object.assign({}, json); out.ok = true; return out;
          }, function (e) {
            if (e && e.apiCode === undefined && e.code === undefined) return { ok: false, error: 'network', message: 'Could not reach the server. Check your connection and try again.' };
            var code = e && e.apiCode ? e.apiCode : 'server';
            return { ok: false, error: code === 'server_error' ? 'server' : code, message: (e && e.message) || 'Something went wrong. Try again.' };
          });
        }
      };
    }

    X.VIEWS.giving = function (main) {
      if (current) current.destroy();
      // The screens read the hash themselves (list ids and forms live in it), so this view only has to start them for the family on screen.
      var toasts = document.getElementById('toasts');
      current = window.GivingUI.mount({
        real: true, server: serverFor(), main: main, toasts: toasts || document.body,
        famId: function () { return X.S.familyId; },
        toast: X.toast
      });
    };
  }

  window.FCGiving = { install: install };
})();
