/* TEST HARNESS ONLY. Stands in for app.js: provides the small `X` object that giving.js needs, and sends each call to the test's own
 * server, which runs the REAL function code (function/src) on an in-memory database. The signed-in person comes from window.__as. */
(function () {
  'use strict';
  window.__as = new URLSearchParams(location.search).get('as') || 'owner';
  var S = { familyId: 'famA' };
  var VIEWS = {};
  var main = document.getElementById('main');
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.getElementById('toasts').appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
  async function api(action, payload) {
    var res = await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': window.__as }, body: JSON.stringify(Object.assign({ action: action }, payload || {})) });
    var json = await res.json();
    if (!json.ok) { var err = new Error(json.message || 'Something went wrong.'); err.code = res.status; err.apiCode = json.error; throw err; }
    return json;
  }
  window.FCGiving.install({ S: S, VIEWS: VIEWS, toast: toast, api: api });
  function route() { main.textContent = ''; VIEWS.giving(main); }
  window.addEventListener('hashchange', route);
  window.__route = route; window.__S = S;
  if (!location.hash) location.hash = '#/giving'; else route();
})();
