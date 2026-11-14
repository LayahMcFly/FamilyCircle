/*
  Calendar and chores for Family Circle
  Copyright (C) 2026 Leia

  Adapted from the Family Board in the ZenfulOutput project (also by Leia).
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  The license text is in LICENSE-GPL-3.0.txt next to this file.

  What this is: the family calendar, chore list, shopping list and change requests, built into Family Circle's own
  pages and sign-in. Everything is read and written through the family-api function (see function/src/board.js),
  which checks that you are a member of the family and writes "checked off by" from your own account.
*/
(function () {
  'use strict';

  function install(X) {
    var h = X.h, icon = X.icon, toast = X.toast;
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var REPEATS = [['', 'Does not repeat'], ['d1', 'Every day'], ['d2', 'Every 2 days'], ['d3', 'Every 3 days'], ['d4', 'Every 4 days'], ['d5', 'Every 5 days'], ['d6', 'Every 6 days'], ['w1', 'Every week'], ['w2', 'Every 2 weeks'], ['m1', 'Every month'], ['m2', 'Every 2 months'], ['m3', 'Every 3 months'], ['m6', 'Every 6 months'], ['y1', 'Every year'], ['y2', 'Every 2 years'], ['y3', 'Every 3 years'], ['y4', 'Every 4 years'], ['y5', 'Every 5 years'], ['y10', 'Every 10 years']];
    var PER_DAY = [[0, 'Not set'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']];
    var PALETTE = ['#b4556a', '#c0773d', '#a38a1f', '#4f8a5b', '#2f8a8a', '#4a6fb5', '#7b5cb5', '#8a5a44'];
    var TABS = [['month', 'Month'], ['week', 'Week'], ['tasks', 'Tasks'], ['shop', 'Shopping'], ['groups', 'Groups'], ['requests', 'Requests']];

    var B = { fid: '', data: null, tab: 'month', cur: null, day: '', week: '', filter: { group: '', mine: false, done: false }, busy: false, root: null, token: 0 };

    /* ---------- dates (all local, as YYYY-MM-DD text) ---------- */
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var ymd = function (d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
    var parseYmd = function (s) { var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2], 12); };
    var addDays = function (s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
    var today = function () { return ymd(new Date()); };
    var weekStart = function (s) { return addDays(s, -parseYmd(s).getDay()); };
    var nice = function (s) { if (!s) return ''; var d = parseYmd(s); return DOW[d.getDay()] + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); };
    var time12 = function (t) { if (!t) return ''; var a = t.split(':'), hh = +a[0]; return (hh % 12 || 12) + ':' + a[1] + (hh < 12 ? ' am' : ' pm'); };
    var occurs = function (t, day) { return !!t.due && (t.start ? (t.start <= day && day <= t.due) : t.due === day); };

    /* ---------- data ---------- */
    function call(action, extra) { return X.api(action, Object.assign({ familyId: B.fid }, extra || {})); }
    async function load() { B.data = await call('boardLoad'); }
    function guard(fn) {
      return async function () {
        if (B.busy) return;
        B.busy = true;
        try { return await fn.apply(null, arguments); }
        catch (e) { toast(e && e.message ? e.message : 'Something went wrong.'); }
        finally { B.busy = false; }
      };
    }
    async function refresh() { await load(); paint(); }
    var me = function () { return B.data.me; };
    var nameOf = function (id) { var m = B.data.members.filter(function (x) { return x.userId === id; })[0]; return m ? m.name : 'Someone'; };
    var groupOf = function (id) { return B.data.groups.filter(function (g) { return g.id === id; })[0] || null; };
    var unread = function () { return B.data.notes.filter(function (n) { return !n.read; }).length; };
    var pendingReqs = function () { return B.data.requests.filter(function (r) { return r.status === 'pending'; }); };

    function visibleTasks() {
      var f = B.filter;
      return B.data.tasks.filter(function (t) {
        if (f.group === '__none' ? !!t.groupId : (f.group && t.groupId !== f.group)) return false;
        if (f.mine && (t.assigneeIds || []).indexOf(me().userId) < 0) return false;
        return true;
      });
    }
    var byTime = function (a, b) { return (a.time || '99:99').localeCompare(b.time || '99:99') || String(a.title).localeCompare(String(b.title)); };
    var tasksOn = function (day) { return visibleTasks().filter(function (t) { return occurs(t, day); }).sort(byTime); };

    /* ---------- small builders ---------- */
    function tint(el, color) { if (color) el.style.setProperty('--g', color); return el; }
    function chip(text, cls, color) { return tint(h('span', { class: 'bd-chip' + (cls ? ' ' + cls : ''), text: text }), color); }
    function labelled(text, control, hint) { return h('label', { class: 'bd-field' }, h('span', { class: 'bd-lab', text: text }), control, hint ? h('span', { class: 'small muted', text: hint }) : null); }
    function option(v, label, sel) { var o = h('option', { value: String(v), text: label }); if (sel) o.selected = true; return o; }
    function select(opts, val) { var s = h('select', null, opts.map(function (o) { return option(o[0], o[1], String(o[0]) === String(val)); })); return s; }

    function dialog(title, build) {
      var dlg = h('dialog', { class: 'bd-dialog', 'aria-label': title });
      var close = function () { try { dlg.close(); } catch (e) { /* already closed */ } if (dlg.parentNode) dlg.parentNode.removeChild(dlg); };
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      dlg.appendChild(h('div', { class: 'bd-dlg-head' }, h('h2', { text: title }), h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Close', onclick: close }, icon('x'))));
      dlg.appendChild(build(close));
      document.body.appendChild(dlg);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      return close;
    }

    /* ---------- task row ---------- */
    function taskRow(t, opts) {
      opts = opts || {};
      var done = t.status === 'complete';
      var box = h('input', { type: 'checkbox', 'aria-label': (done ? 'Mark not done: ' : 'Mark done: ') + t.title });
      box.checked = done;
      box.addEventListener('change', guard(async function () { await call('boardTaskComplete', { taskId: t.id, done: box.checked, today: today() }); await refresh(); }));
      var g = groupOf(t.groupId);
      var steps = t.steps || [], stepsDone = steps.filter(function (s) { return s.done; }).length;
      var who = (t.assigneeIds || []).map(nameOf).join(', ');
      var main = h('button', { type: 'button', class: 'bd-task-main', onclick: function () { openTask(t.id); } },
        h('span', { class: 'bd-task-title' + (done ? ' is-done' : ''), text: (t.special ? '★ ' : '') + t.title }),
        h('span', { class: 'bd-task-meta small muted', text: [opts.noDate ? '' : (t.start ? nice(t.start) + ' to ' + nice(t.due) : nice(t.due)), time12(t.time), who ? 'For ' + who : 'Unassigned', steps.length ? stepsDone + '/' + steps.length + ' steps' : '', t.repeat ? 'Repeats' : ''].filter(Boolean).join(' · ') }));
      return h('li', { class: 'bd-task' + (done ? ' done' : '') }, box, main, g ? chip(g.name, 'bd-group', g.color) : null);
    }
    function taskList(list, empty) {
      if (!list.length) return h('p', { class: 'muted bd-empty', text: empty });
      return h('ul', { class: 'bd-list' }, list.map(function (t) { return taskRow(t, {}); }));
    }

    /* ---------- month and week ---------- */
    function filters() {
      var gs = [['', 'All groups'], ['__none', 'No group']].concat(B.data.groups.map(function (g) { return [g.id, g.name]; }));
      var sel = select(gs, B.filter.group); sel.setAttribute('aria-label', 'Show group');
      sel.addEventListener('change', function () { B.filter.group = sel.value; paint(); });
      var mine = h('input', { type: 'checkbox', 'aria-label': 'Only my tasks' }); mine.checked = B.filter.mine;
      mine.addEventListener('change', function () { B.filter.mine = mine.checked; paint(); });
      return h('div', { class: 'bd-filters' }, sel, h('label', { class: 'bd-check' }, mine, h('span', { text: 'Only mine' })));
    }
    function monthView() {
      var cur = B.cur, y = cur.getFullYear(), m = cur.getMonth();
      var first = new Date(y, m, 1, 12), lead = first.getDay(), n = new Date(y, m + 1, 0).getDate();
      var cells = [];
      for (var i = 0; i < lead; i++) cells.push(h('span', { class: 'bd-cell blank', 'aria-hidden': 'true' }));
      for (var d = 1; d <= n; d++) {
        (function (day) {
          var list = tasksOn(day), open = list.filter(function (t) { return t.status !== 'complete'; }).length;
          var cls = 'bd-cell' + (day === today() ? ' today' : '') + (day === B.day ? ' picked' : '') + (list.some(function (t) { return t.special; }) ? ' special' : '');
          cells.push(h('button', { type: 'button', class: cls, 'aria-label': nice(day) + (list.length ? ', ' + list.length + ' tasks' : ''), 'aria-pressed': String(day === B.day), onclick: function () { B.day = day; paint(); } },
            h('span', { class: 'bd-num', text: String(+day.slice(8)) }),
            list.length ? h('span', { class: 'bd-dots' }, list.slice(0, 3).map(function (t) { var g = groupOf(t.groupId); return tint(h('i', { class: 'bd-dot' + (t.status === 'complete' ? ' done' : '') }), g ? g.color : ''); }), list.length > 3 ? h('span', { class: 'bd-more', text: '+' + (list.length - 3) }) : null) : null,
            open ? h('span', { class: 'bd-sr', text: open + ' open' }) : null));
        })(y + '-' + p2(m + 1) + '-' + p2(d));
      }
      var nav = h('div', { class: 'bd-nav' },
        h('button', { type: 'button', class: 'btn secondary small', 'aria-label': 'Previous month', onclick: function () { B.cur = new Date(y, m - 1, 1, 12); paint(); } }, h('span', { 'aria-hidden': 'true', text: '‹' })),
        h('h2', { class: 'bd-title', text: MONTHS[m] + ' ' + y }),
        h('button', { type: 'button', class: 'btn secondary small', 'aria-label': 'Next month', onclick: function () { B.cur = new Date(y, m + 1, 1, 12); paint(); } }, h('span', { 'aria-hidden': 'true', text: '›' })),
        h('button', { type: 'button', class: 'btn ghost small', onclick: function () { B.cur = new Date(); B.day = today(); paint(); } }, 'Today'));
      var panel = dayPanel(B.day || today());
      return h('div', null, nav, h('div', { class: 'bd-dow', 'aria-hidden': 'true' }, DOW.map(function (x) { return h('span', { text: x }); })), h('div', { class: 'bd-grid' }, cells), panel);
    }
    function dayPanel(day) {
      return h('section', { class: 'card bd-day' },
        h('div', { class: 'row bd-day-head' }, h('h3', { text: nice(day) + (day === today() ? ' (today)' : '') }), h('button', { type: 'button', class: 'btn small', onclick: function () { editTask(null, day); } }, icon('plus'), h('span', { text: 'Add a task' }))),
        taskList(tasksOn(day), 'Nothing planned for this day.'));
    }
    function weekView() {
      var start = B.week || weekStart(today()), days = [];
      for (var i = 0; i < 7; i++) days.push(addDays(start, i));
      var nav = h('div', { class: 'bd-nav' },
        h('button', { type: 'button', class: 'btn secondary small', 'aria-label': 'Previous week', onclick: function () { B.week = addDays(start, -7); paint(); } }, h('span', { 'aria-hidden': 'true', text: '‹' })),
        h('h2', { class: 'bd-title', text: nice(days[0]) + ' to ' + nice(days[6]) }),
        h('button', { type: 'button', class: 'btn secondary small', 'aria-label': 'Next week', onclick: function () { B.week = addDays(start, 7); paint(); } }, h('span', { 'aria-hidden': 'true', text: '›' })),
        h('button', { type: 'button', class: 'btn ghost small', onclick: function () { B.week = weekStart(today()); paint(); } }, 'This week'));
      return h('div', null, nav, days.map(function (d) { return dayPanel(d); }));
    }
    function tasksView() {
      var open = visibleTasks().filter(function (t) { return t.status !== 'complete'; }).sort(function (a, b) { return String(a.due || '9999').localeCompare(String(b.due || '9999')) || byTime(a, b); });
      var done = visibleTasks().filter(function (t) { return t.status === 'complete'; }).sort(function (a, b) { return String(b.completedAt || '').localeCompare(String(a.completedAt || '')); });
      var showDone = h('button', { type: 'button', class: 'btn secondary small', 'aria-expanded': String(B.filter.done), onclick: function () { B.filter.done = !B.filter.done; paint(); } }, (B.filter.done ? 'Hide' : 'Show') + ' finished (' + done.length + ')');
      return h('div', null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { editTask(null, B.day || today()); } }, icon('plus'), h('span', { text: 'Add a task' })), showDone),
        h('section', { class: 'card' }, h('h3', { text: 'To do' }), taskList(open, 'Nothing to do. Add a task to get started.')),
        B.filter.done ? h('section', { class: 'card' }, h('h3', { text: 'Finished' }), done.length ? h('ul', { class: 'bd-list' }, done.map(function (t) { return taskRow(t, {}); })) : h('p', { class: 'muted bd-empty', text: 'Nothing finished yet.' })) : null);
    }

    /* ---------- task form ---------- */
    function editTask(task, day) {
      var t = task || { title: '', due: day || '', time: '', start: '', repeat: '', perDay: 0, assigneeIds: [], groupId: '', special: false, description: '', steps: [] };
      var title = h('input', { type: 'text', maxlength: 120, value: t.title, placeholder: 'For example: Take out the trash' });
      var due = h('input', { type: 'date', value: t.due || '' }), start = h('input', { type: 'date', value: t.start || '' }), time = h('input', { type: 'time', value: t.time || '' });
      var repeat = select(REPEATS, t.repeat || ''), perDay = select(PER_DAY, t.perDay || 0);
      var group = select([['', 'No group']].concat(B.data.groups.map(function (g) { return [g.id, g.name]; })), t.groupId || '');
      var desc = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Details (optional)' }); desc.value = t.description || '';
      var special = h('input', { type: 'checkbox' }); special.checked = !!t.special;
      var picks = {};
      var people = h('div', { class: 'bd-people' }, B.data.members.map(function (m) {
        var c = h('input', { type: 'checkbox' }); c.checked = (t.assigneeIds || []).indexOf(m.userId) >= 0; picks[m.userId] = c;
        return h('label', { class: 'bd-check' }, c, h('span', { text: m.name + (m.userId === me().userId ? ' (me)' : '') }));
      }));
      var steps = (t.steps || []).map(function (s) { return { id: s.id, text: s.text, done: s.done }; });
      var stepBox = h('div', { class: 'bd-steps-edit' });
      function paintSteps() {
        stepBox.textContent = '';
        steps.forEach(function (s, i) {
          var inp = h('input', { type: 'text', maxlength: 120, value: s.text, 'aria-label': 'Step ' + (i + 1) });
          inp.addEventListener('input', function () { s.text = inp.value; });
          stepBox.appendChild(h('div', { class: 'row bd-step-row' }, inp, h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Remove step ' + (i + 1), onclick: function () { steps.splice(i, 1); paintSteps(); } }, icon('x'))));
        });
        stepBox.appendChild(h('button', { type: 'button', class: 'btn secondary small', onclick: function () { steps.push({ text: '', done: false }); paintSteps(); var all = stepBox.querySelectorAll('input[type="text"]'); if (all.length) all[all.length - 1].focus(); } }, icon('plus'), h('span', { text: 'Add a step' })));
      }
      paintSteps();
      var err = h('p', { class: 'bd-error', role: 'alert', hidden: '' });
      var form = h('form', { class: 'bd-form', novalidate: '' },
        labelled('Task', title), labelled('Due date', due), labelled('Time', time, 'Needs a due date.'),
        labelled('Starts on', start, 'For a task that takes several days. It runs from this date to the due date.'),
        labelled('Repeats', repeat, 'The next one appears when you finish this one.'),
        labelled('Time per day', perDay, 'For tasks with a start date.'),
        labelled('Group', group), h('fieldset', { class: 'bd-fieldset' }, h('legend', { text: 'Who does it' }), people),
        h('label', { class: 'bd-check' }, special, h('span', { text: 'Special day (birthday, holiday, trip)' })),
        labelled('Description', desc), h('fieldset', { class: 'bd-fieldset' }, h('legend', { text: 'Steps' }), stepBox), err);
      return dialog(task ? 'Edit task' : 'New task', function (close) {
        var save = h('button', { type: 'submit', class: 'btn' }, task ? 'Save changes' : 'Add task');
        form.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: close }, 'Cancel'), save));
        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          if (B.busy) return;
          B.busy = true; save.setAttribute('aria-busy', 'true'); err.hidden = true;
          try {
            await call('boardTaskSave', { task: { id: task ? task.id : undefined, title: title.value, due: due.value, start: start.value, time: time.value, repeat: repeat.value, perDay: Number(perDay.value), groupId: group.value, special: special.checked, description: desc.value,
              assigneeIds: Object.keys(picks).filter(function (k) { return picks[k].checked; }), steps: steps } });
            close(); B.busy = false; if (due.value) { B.day = due.value; B.cur = parseYmd(due.value); } await refresh(); toast(task ? 'Task saved.' : 'Task added.');
          } catch (ex) { err.textContent = ex.message || 'Could not save.'; err.hidden = false; }
          finally { B.busy = false; save.removeAttribute('aria-busy'); }
        });
        setTimeout(function () { title.focus(); }, 30);
        return form;
      });
    }

    /* ---------- task details ---------- */
    function openTask(id) {
      var t = B.data.tasks.filter(function (x) { return x.id === id; })[0];
      if (!t) return;
      var mineMade = t.createdBy === me().userId, canDelete = me().manager || mineMade;
      dialog(t.title, function (close) {
        var g = groupOf(t.groupId), done = t.status === 'complete';
        var stepList = (t.steps || []).length ? h('ul', { class: 'bd-list' }, t.steps.map(function (s) {
          var c = h('input', { type: 'checkbox', 'aria-label': s.text }); c.checked = !!s.done;
          c.addEventListener('change', guard(async function () { await call('boardStep', { taskId: t.id, stepId: s.id, done: c.checked }); close(); await refresh(); openTask(t.id); }));
          return h('li', { class: 'bd-step' }, h('label', { class: 'bd-check' }, c, h('span', { class: s.done ? 'is-done' : '', text: s.text })));
        })) : null;
        var hist = (t.history || []).slice().reverse().map(function (e) { return h('li', { class: 'small muted', text: historyText(e) }); });
        var facts = [
          t.due ? 'Due ' + (t.start ? nice(t.start) + ' to ' : '') + nice(t.due) + (t.time ? ' at ' + time12(t.time) : '') : 'No due date',
          'For ' + ((t.assigneeIds || []).length ? t.assigneeIds.map(nameOf).join(', ') : 'nobody yet'),
          t.perDay ? 'About ' + (PER_DAY.filter(function (p) { return p[0] === t.perDay; })[0] || [0, ''])[1] + ' a day' : '',
          t.repeat ? (REPEATS.filter(function (r) { return r[0] === t.repeat; })[0] || [0, 'Repeats'])[1] : ''
        ].filter(Boolean);
        var toggle = h('button', { type: 'button', class: 'btn' + (done ? ' secondary' : ''), onclick: guard(async function () { await call('boardTaskComplete', { taskId: t.id, done: !done, today: today() }); close(); await refresh(); }) }, icon('check'), h('span', { text: done ? 'Mark not done' : 'Mark done' }));
        var del = canDelete
          ? h('button', { type: 'button', class: 'btn danger', onclick: async function () { if (await X.confirmDialog('Delete this task?', t.title, 'Delete')) guard(async function () { await call('boardTaskDelete', { taskId: t.id }); close(); await refresh(); toast('Task deleted.'); })(); } }, icon('trash'), h('span', { text: 'Delete' }))
          : h('button', { type: 'button', class: 'btn secondary', onclick: guard(async function () { await call('boardRequest', { kind: 'deleteTask', taskId: t.id }); close(); await refresh(); toast('Request sent to the owners and admins.'); }) }, 'Ask to delete');
        return h('div', { class: 'bd-detail' },
          h('p', { class: 'muted', text: facts.join(' · ') }),
          g ? h('p', null, chip(g.name, 'bd-group', g.color)) : null,
          done ? h('p', { class: 'bd-record' }, icon('check'), h('span', { text: 'Done by ' + (t.completedByName || 'someone') + (t.completedForName ? ' for ' + t.completedForName : '') + (t.completedAt ? ' on ' + nice(t.completedAt.slice(0, 10)) : '') })) : null,
          t.description ? h('p', { class: 'bd-desc', text: t.description }) : null,
          stepList ? h('div', null, h('h3', { text: 'Steps' }), stepList) : null,
          h('div', { class: 'row' }, toggle, h('button', { type: 'button', class: 'btn secondary', onclick: function () { close(); editTask(t); } }, icon('pencil'), h('span', { text: 'Edit' })), del),
          hist.length ? h('details', { class: 'bd-hist' }, h('summary', { text: 'History' }), h('ul', null, hist)) : null);
      });
    }
    function historyText(e) {
      var who = e.actorName || 'Someone', day = e.at ? nice(e.at.slice(0, 10)) : '';
      var what = { created: 'added this task' + (e.assigneeName ? ' for ' + e.assigneeName : ''), edited: 'changed ' + (e.fields || 'details'), assigned: 'moved it from ' + (e.fromName || 'Unassigned') + ' to ' + (e.toName || 'Unassigned'),
        group: 'moved it from ' + (e.fromName || 'No group') + ' to ' + (e.toName || 'No group'), completed: 'finished it' + (e.forName ? ' for ' + e.forName : ''), reopened: 'marked it not done' }[e.type] || e.type;
      return who + ' ' + what + (day ? ' on ' + day : '') + '.';
    }

    /* ---------- shopping ---------- */
    function shopView() {
      var items = B.data.products.slice().sort(function (a, b) { return (b.low ? 1 : 0) - (a.low ? 1 : 0) || String(a.name).localeCompare(String(b.name)); });
      var low = items.filter(function (p) { return p.low; });
      var list = items.length ? h('ul', { class: 'bd-list' }, items.map(productRow)) : h('p', { class: 'muted bd-empty', text: 'No products yet. Add the things your family buys again and again.' });
      return h('div', null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { editProduct(null); } }, icon('plus'), h('span', { text: 'Add a product' }))),
        low.length ? h('section', { class: 'card' }, h('h3', { text: 'Running low (' + low.length + ')' }), h('ul', { class: 'bd-list' }, low.map(function (p) { return h('li', { class: 'bd-prod low' }, h('span', { class: 'bd-task-title', text: p.name }), h('span', { class: 'small muted', text: lowText(p) })); }))) : null,
        h('section', { class: 'card' }, h('h3', { text: 'All products' }), list));
    }
    var lowText = function (p) { return p.qty + ' left' + (p.opened ? ', one opened' : '') + (p.goneBy ? ', gone by ' + nice(p.goneBy) : '') + (p.by ? ' (' + p.by + ')' : ''); };
    function productRow(p) {
      var acts = p.low
        ? h('button', { type: 'button', class: 'btn small', onclick: guard(async function () { await call('boardProductBought', { productId: p.id }); await refresh(); toast('Marked as bought.'); }) }, 'Bought it')
        : h('button', { type: 'button', class: 'btn secondary small', onclick: function () { lowDialog(p); } }, 'Running low');
      return h('li', { class: 'bd-prod' + (p.low ? ' low' : '') },
        h('div', { class: 'bd-prod-main' }, p.url ? h('a', { class: 'bd-task-title', href: p.url, target: '_blank', rel: 'noopener noreferrer', text: p.name }) : h('span', { class: 'bd-task-title', text: p.name }),
          h('span', { class: 'small muted', text: [p.cat, p.low ? lowText(p) : ''].filter(Boolean).join(' · ') })),
        h('div', { class: 'row' }, acts, h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Edit ' + p.name, onclick: function () { editProduct(p); } }, icon('pencil')),
          h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Delete ' + p.name, onclick: async function () { if (await X.confirmDialog('Delete this product?', p.name, 'Delete')) guard(async function () { await call('boardProductDelete', { productId: p.id }); await refresh(); })(); } }, icon('trash'))));
    }
    function editProduct(p) {
      var name = h('input', { type: 'text', maxlength: 80, value: p ? p.name : '', placeholder: 'For example: Milk' });
      var cat = h('input', { type: 'text', maxlength: 40, value: p ? p.cat : '', placeholder: 'For example: Dairy' });
      var url = h('input', { type: 'url', maxlength: 500, value: p ? p.url : '', placeholder: 'https://' });
      var err = h('p', { class: 'bd-error', role: 'alert', hidden: '' });
      dialog(p ? 'Edit product' : 'New product', function (close) {
        var form = h('form', { class: 'bd-form', novalidate: '' }, labelled('Product', name), labelled('Category', cat, 'Optional.'), labelled('Link', url, 'Optional. Where you usually buy it.'), err,
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: close }, 'Cancel'), h('button', { type: 'submit', class: 'btn' }, 'Save')));
        form.addEventListener('submit', async function (e) {
          e.preventDefault(); if (B.busy) return; B.busy = true; err.hidden = true;
          try { await call('boardProductSave', { product: { id: p ? p.id : undefined, name: name.value, cat: cat.value, url: url.value } }); close(); B.busy = false; await refresh(); }
          catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { B.busy = false; }
        });
        setTimeout(function () { name.focus(); }, 30);
        return form;
      });
    }
    function lowDialog(p) {
      var qty = h('input', { type: 'number', min: 0, max: 999, value: '1', inputmode: 'numeric' }), opened = h('input', { type: 'checkbox' }), gone = h('input', { type: 'date' });
      var err = h('p', { class: 'bd-error', role: 'alert', hidden: '' });
      dialog('Running low: ' + p.name, function (close) {
        var form = h('form', { class: 'bd-form', novalidate: '' }, labelled('How many are left', qty), h('label', { class: 'bd-check' }, opened, h('span', { text: 'One is already opened' })), labelled('Gone by', gone, 'Optional.'), err,
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: close }, 'Cancel'), h('button', { type: 'submit', class: 'btn' }, 'Tell the family')));
        form.addEventListener('submit', async function (e) {
          e.preventDefault(); if (B.busy) return; B.busy = true; err.hidden = true;
          try { await call('boardProductLow', { productId: p.id, qty: Number(qty.value), opened: opened.checked, goneBy: gone.value }); close(); B.busy = false; await refresh(); toast('The family has been told.'); }
          catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { B.busy = false; }
        });
        return form;
      });
    }

    /* ---------- groups and requests ---------- */
    function groupForm(g, asRequest) {
      var name = h('input', { type: 'text', maxlength: 80, value: g ? g.name : '', placeholder: 'For example: Chores' });
      var desc = h('textarea', { rows: 2, maxlength: 400, placeholder: 'What this group is for (optional)' }); desc.value = g ? g.description || '' : '';
      var color = g && g.color || PALETTE[B.data.groups.length % PALETTE.length];
      var swatches = h('div', { class: 'bd-swatches', role: 'radiogroup', 'aria-label': 'Group color' }, PALETTE.map(function (c) {
        var b = tint(h('button', { type: 'button', class: 'bd-swatch' + (c === color ? ' on' : ''), role: 'radio', 'aria-checked': String(c === color), 'aria-label': c, onclick: function () { color = c; Array.prototype.forEach.call(swatches.children, function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); } }), c);
        return b;
      }));
      var err = h('p', { class: 'bd-error', role: 'alert', hidden: '' });
      dialog(asRequest ? 'Ask for a group' : (g ? 'Edit group' : 'New group'), function (close) {
        var form = h('form', { class: 'bd-form', novalidate: '' }, labelled('Group name', name), labelled('Description', desc), h('div', { class: 'bd-field' }, h('span', { class: 'bd-lab', text: 'Color' }), swatches), err,
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: close }, 'Cancel'), h('button', { type: 'submit', class: 'btn' }, asRequest ? 'Send request' : 'Save')));
        form.addEventListener('submit', async function (e) {
          e.preventDefault(); if (B.busy) return; B.busy = true; err.hidden = true;
          try {
            if (asRequest) await call('boardRequest', { kind: 'newGroup', name: name.value, description: desc.value, color: color });
            else await call('boardGroupSave', { group: { id: g ? g.id : undefined, name: name.value, description: desc.value, color: color } });
            close(); B.busy = false; await refresh(); toast(asRequest ? 'Request sent.' : 'Group saved.');
          } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { B.busy = false; }
        });
        setTimeout(function () { name.focus(); }, 30);
        return form;
      });
    }
    function groupsView() {
      var mgr = me().manager;
      var list = B.data.groups.length ? h('ul', { class: 'bd-list' }, B.data.groups.map(function (g) {
        var n = B.data.tasks.filter(function (t) { return t.groupId === g.id; }).length;
        return h('li', { class: 'bd-prod' }, h('div', { class: 'bd-prod-main' }, chip(g.name, 'bd-group', g.color), h('span', { class: 'small muted', text: (g.description ? g.description + ' · ' : '') + n + (n === 1 ? ' task' : ' tasks') })),
          mgr ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Edit ' + g.name, onclick: function () { groupForm(g); } }, icon('pencil')), h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Delete ' + g.name, onclick: function () { deleteGroup(g, n); } }, icon('trash'))) : null);
      })) : h('p', { class: 'muted bd-empty', text: 'No groups yet. Groups sort tasks, like Chores or School.' });
      return h('div', null, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { groupForm(null, !mgr); } }, icon('plus'), h('span', { text: mgr ? 'New group' : 'Ask for a group' }))),
        mgr ? null : h('p', { class: 'small muted', text: 'Owners and admins manage groups. You can send them a request.' }), h('section', { class: 'card' }, list));
    }
    function deleteGroup(g, n) {
      dialog('Delete “' + g.name + '”?', function (close) {
        var act = function (mode) { return guard(async function () { await call('boardGroupDelete', { groupId: g.id, mode: mode }); close(); await refresh(); toast('Group deleted.'); }); };
        return h('div', { class: 'bd-form' }, h('p', { text: n ? 'It has ' + n + (n === 1 ? ' task.' : ' tasks.') + ' Keep them without a group, or delete them too?' : 'This group has no tasks.' }),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn secondary', onclick: close }, 'Cancel'), h('button', { type: 'button', class: 'btn' + (n ? ' secondary' : ' danger'), onclick: act('keep') }, n ? 'Keep the tasks' : 'Delete'), n ? h('button', { type: 'button', class: 'btn danger', onclick: act('delete') }, 'Delete the tasks too') : null));
      });
    }
    function requestsView() {
      var mgr = me().manager, list = B.data.requests;
      var label = function (r) { return r.kind === 'newGroup' ? 'Add the group “' + r.name + '”' : 'Delete the task “' + r.title + '”'; };
      var body = list.length ? h('ul', { class: 'bd-list' }, list.map(function (r) {
        var pend = r.status === 'pending';
        return h('li', { class: 'bd-prod' }, h('div', { class: 'bd-prod-main' }, h('span', { class: 'bd-task-title', text: label(r) }), h('span', { class: 'small muted', text: 'From ' + (r.byName || 'someone') + ' · ' + (pend ? 'Waiting' : r.status[0].toUpperCase() + r.status.slice(1)) })),
          mgr && pend ? h('div', { class: 'row' }, ['approve', 'reject', 'ignore'].map(function (d) { return h('button', { type: 'button', class: 'btn small' + (d === 'approve' ? '' : ' secondary'), onclick: guard(async function () { await call('boardDecide', { requestId: r.id, decision: d }); await refresh(); }) }, d === 'approve' ? 'Accept' : d === 'reject' ? 'Reject' : 'Ignore'); })) : null);
      })) : h('p', { class: 'muted bd-empty', text: mgr ? 'No requests right now.' : 'You have not asked for anything. Use Ask to delete on a task, or Ask for a group.' });
      return h('section', { class: 'card' }, h('h3', { text: mgr ? 'Requests from the family' : 'Your requests' }), body);
    }

    /* ---------- the bell ---------- */
    function noteText(n) {
      var who = n.actorName || 'Someone';
      switch (n.kind) {
        case 'assigned': return who + ' gave you “' + n.title + '”' + (n.due ? ', due ' + nice(n.due) : '') + '.';
        case 'completed': return who + ' finished “' + n.title + '”' + (n.forName ? ' for ' + n.forName : '') + '.';
        case 'low': return who + ' says ' + n.title + ' is running low (' + (n.outcome || '') + ').';
        case 'request': return who + ' would like to ' + n.title + '.';
        case 'request_result': return 'Your request to ' + n.title + ' was ' + (n.outcome || 'answered') + '.';
        default: return who + ' updated the calendar.';
      }
    }
    function openBell() {
      var notes = B.data.notes;
      dialog('Alerts', function () {
        return h('div', null, notes.length ? h('ul', { class: 'bd-list' }, notes.map(function (n) { return h('li', { class: 'bd-note' + (n.read ? '' : ' new') }, h('span', { text: noteText(n) }), h('span', { class: 'small muted', text: n.at ? nice(n.at.slice(0, 10)) : '' })); })) : h('p', { class: 'muted bd-empty', text: 'No alerts from the last 7 days.' }));
      });
      if (unread()) guard(async function () { await call('boardNotesRead'); B.data.notes.forEach(function (n) { n.read = true; }); paint(); })();
    }

    /* ---------- page ---------- */
    function paint() {
      var root = B.root;
      if (!root || !root.isConnected) return;
      var oldTabs = root.querySelector('.bd-tabs'), keep = oldTabs ? oldTabs.scrollLeft : 0, keepY = window.pageYOffset;   // the section row scrolls sideways on a phone: keep it where it was
      root.textContent = '';
      var u = unread();
      var bell = h('button', { type: 'button', class: 'btn secondary small bd-bell', 'aria-label': 'Alerts' + (u ? ', ' + u + ' new' : ''), onclick: openBell }, icon('bell'), u ? h('span', { class: 'bd-badge', text: String(u > 99 ? '99+' : u) }) : null);
      root.appendChild(h('header', { class: 'bd-head' }, h('h1', { text: 'Calendar & chores' }), bell));
      var tabs = h('div', { class: 'bd-tabs', role: 'tablist', 'aria-label': 'Calendar sections' }, TABS.map(function (t) {
        var on = B.tab === t[0], n = t[0] === 'requests' ? pendingReqs().length : 0;
        return h('button', { type: 'button', role: 'tab', class: 'bd-tab' + (on ? ' on' : ''), 'aria-selected': String(on), onclick: function () { B.tab = t[0]; paint(); } }, t[1] + (n && me().manager ? ' (' + n + ')' : ''));
      }));
      root.appendChild(tabs);
      tabs.scrollLeft = keep;
      var on = tabs.querySelector('.bd-tab.on');
      if (on && (on.offsetLeft < keep || on.offsetLeft + on.offsetWidth > keep + tabs.clientWidth)) tabs.scrollLeft = Math.max(0, on.offsetLeft - 12);   // the chosen section is always in view
      if (B.tab === 'month' || B.tab === 'week' || B.tab === 'tasks') root.appendChild(filters());
      var body = (B.tab === 'month' ? monthView() : B.tab === 'week' ? weekView() : B.tab === 'tasks' ? tasksView() : B.tab === 'shop' ? shopView() : B.tab === 'groups' ? groupsView() : requestsView());
      root.appendChild(body);
      if (keepY && Math.abs(window.pageYOffset - keepY) > 2) window.scrollTo(0, keepY);
    }

    X.VIEWS.calendar = async function (main, token) {
      var fid = X.S.familyId;
      if (B.fid !== fid) { B.data = null; B.filter = { group: '', mine: false, done: false }; }
      B.fid = fid; B.token = token;
      B.cur = B.cur || new Date(); B.day = B.day || today(); B.week = B.week || weekStart(today());
      B.root = h('div', { class: 'bd-page' });
      main.appendChild(B.root);
      B.root.appendChild(h('p', { class: 'muted', text: 'Loading the calendar…' }));
      try { await load(); }
      catch (e) { B.root.textContent = ''; B.root.appendChild(h('div', { class: 'card' }, h('h2', { text: 'The calendar could not load' }), h('p', { class: 'muted', text: e && e.message ? e.message : 'Please try again.' }), h('button', { type: 'button', class: 'btn', onclick: function () { X.route(false); } }, 'Try again'))); return; }
      paint();
    };
  }

  window.FCBoard = { install: install };
})();
