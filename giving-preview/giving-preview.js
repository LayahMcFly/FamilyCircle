/* Giving Center preview: starts the screens on the FAKE server with invented people (PREVIEW CODE, not wired into the live app).
 * No Appwrite SDK, no config.js, no account, no storage: everything lives in memory and is gone on reload. */
(function () {
  'use strict';
  var main = document.getElementById('main'), controls = document.getElementById('pv-controls'), toasts = document.getElementById('toasts');
  /* Network condition: lets you see slow, failing and refused requests. It only changes what this page does with the fake server's answer. */
  var net = { mode: 'normal', wrap: function (run) {
    var m = net.mode;
    if (m === 'failonce') { net.mode = 'normal'; var sel = document.getElementById('pv-net'); if (sel) sel.value = 'normal'; return Promise.reject(new Error('offline')); }
    if (m === 'error') return Promise.resolve({ ok: false, error: 'server', message: 'Something went wrong on our side. Try again in a moment.' });
    if (m === 'denied') return Promise.resolve({ ok: false, error: 'no_access', message: 'Giving Center is not available for this account.' });
    if (m === 'slow') return new Promise(function (res) { setTimeout(function () { res(run()); }, 1500); });
    return Promise.resolve(run());
  } };
  if (!location.hash) location.hash = '#/giving';
  var server = GivingFake.create();
  GivingUI.mount({ server: server, viewers: GivingFake.VIEWERS, main: main, controls: controls, toasts: toasts, net: net,
    onReset: function () { location.hash = '#/giving'; location.reload(); } });
})();
