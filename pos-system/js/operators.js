/* ==========================================================================
   operators.js — Gestiune operatori / utilizatori (doar Admin, vizibil pt Manager)
   CRUD, resetare parola, activare/dezactivare, permisiuni pe rol, export CSV
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var App = window.App;

  var ui = { filter: '', role: 'all', editing: null, canManage: false };

  document.addEventListener('DOMContentLoaded', function () {
    App.init().then(function () {
      var user = App.requireAuth('operators.view');
      if (!user) return;
      App.renderHeader('operators.html');

      ui.canManage = App.can(user, 'operators.manage') || user.role === 'admin';
      document.querySelectorAll('[data-manage]').forEach(function (el) {
        el.classList.toggle('hidden', !ui.canManage);
      });

      bind();
      renderPermissions();
      render();
    });
  });

  function bind() {
    document.getElementById('oSearch').addEventListener('input', U.debounce(function (e) {
      ui.filter = e.target.value; render();
    }, 200));
    document.getElementById('oRole').addEventListener('change', function (e) {
      ui.role = e.target.value; render();
    });
    document.getElementById('btnNewOperator').addEventListener('click', function () { openForm(null); });
    document.getElementById('btnExportOperators').addEventListener('click', exportCsv);

    document.getElementById('oBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var id = b.dataset.id;
      if (b.dataset.act === 'edit') openForm(id);
      if (b.dataset.act === 'reset') resetPassword(id);
      if (b.dataset.act === 'toggle') toggleActive(id);
      if (b.dataset.act === 'del') removeUser(id);
    });

    document.getElementById('opForm').addEventListener('submit', function (e) {
      e.preventDefault(); saveUser();
    });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { U.closeModal(b.dataset.close); });
    });
  }

  /* ========================================================================
     TABEL
     ======================================================================== */
  function render() {
    var list = App.Coll.users().filter(function (u) {
      if (ui.role !== 'all' && u.role !== ui.role) return false;
      if (ui.filter) {
        var q = U.normalize(ui.filter);
        return U.normalize(u.name).indexOf(q) !== -1 ||
          U.normalize(u.username).indexOf(q) !== -1 ||
          U.normalize(u.email).indexOf(q) !== -1;
      }
      return true;
    });

    var body = document.getElementById('oBody');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="big">👥</span>Niciun operator gasit.</div></td></tr>';
    } else {
      body.innerHTML = list.map(function (u) {
        return '<tr>' +
          '<td data-label="Nume"><div class="row"><span class="avatar">' + U.esc(U.initials(u.name)) + '</span>' +
          '<div><b>' + U.esc(u.name) + '</b><br><span class="small muted">@' + U.esc(u.username) + '</span></div></div></td>' +
          '<td data-label="Email">' + U.esc(u.email || '-') + '</td>' +
          '<td data-label="Rol"><span class="badge ' + roleBadge(u.role) + '">' + U.esc(App.ROLE_LABELS[u.role] || u.role) + '</span></td>' +
          '<td data-label="Ultima logare"><span class="small">' + U.fmtDateTime(u.lastLogin) + '</span></td>' +
          '<td data-label="Status">' + (u.active
            ? '<span class="badge badge-success">● Activ</span>'
            : '<span class="badge badge-muted">○ Inactiv</span>') + '</td>' +
          '<td data-label="Creat"><span class="small muted">' + U.fmtDate(u.createdAt) + '</span></td>' +
          '<td data-label="Actiuni" class="actions">' +
          '<button class="btn btn-sm btn-outline" data-act="edit" data-id="' + u.id + '" data-manage>Editeaza</button> ' +
          '<button class="btn btn-sm btn-info" data-act="reset" data-id="' + u.id + '" data-manage>Reset parola</button> ' +
          '<button class="btn btn-sm ' + (u.active ? 'btn-warning' : 'btn-success') + '" data-act="toggle" data-id="' + u.id + '" data-manage>' +
          (u.active ? 'Dezactiveaza' : 'Activeaza') + '</button> ' +
          '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + u.id + '" data-manage>Sterge</button>' +
          '</td></tr>';
      }).join('');
    }

    var all = App.Coll.users();
    document.getElementById('statTotal').textContent = all.length;
    document.getElementById('statActive').textContent = all.filter(function (u) { return u.active; }).length;
    document.getElementById('statOnline').textContent = App.Session.isLoggedIn() ? 1 : 0;

    if (!ui.canManage) document.querySelectorAll('#oBody [data-manage]').forEach(function (b) { b.remove(); });
  }

  function roleBadge(role) {
    return { admin: 'badge-danger', manager: 'badge-info', operator: 'badge-success', viewer: 'badge-muted' }[role] || 'badge-muted';
  }

  /* ========================================================================
     MATRICE DE PERMISIUNI
     ======================================================================== */
  function renderPermissions() {
    var areas = ['pos', 'products', 'operators', 'reports', 'settings'];
    var host = document.getElementById('permMatrix');
    if (!host) return;
    var head = '<tr><th>Modul</th>' + Object.keys(App.ROLE_PERMS).map(function (r) {
      return '<th>' + App.ROLE_LABELS[r] + '</th>';
    }).join('') + '</tr>';
    var body = areas.map(function (a) {
      return '<tr><td><b>' + a.charAt(0).toUpperCase() + a.slice(1) + '</b></td>' +
        Object.keys(App.ROLE_PERMS).map(function (r) {
          var fake = { role: r };
          var full = App.can(fake, a + '.edit') || App.can(fake, a + '.*');
          var view = App.can(fake, a + '.view');
          return '<td>' + (full ? '<span class="badge badge-success">Deplin</span>'
            : view ? '<span class="badge badge-info">Vizualizare</span>'
              : '<span class="badge badge-muted">Fara acces</span>') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    host.innerHTML = head + body;
  }

  /* ========================================================================
     FORMULAR
     ======================================================================== */
  function openForm(id) {
    var sel = document.getElementById('opRole');
    sel.innerHTML = Object.keys(App.ROLE_LABELS).map(function (r) {
      return '<option value="' + r + '">' + App.ROLE_LABELS[r] + '</option>';
    }).join('');

    if (id) {
      var u = App.Coll.users().filter(function (x) { return x.id === id; })[0];
      if (!u) return;
      ui.editing = JSON.parse(JSON.stringify(u));
      document.getElementById('opFormTitle').textContent = 'Editeaza operator';
    } else {
      ui.editing = { id: U.uid('u'), name: '', email: '', username: '', role: 'operator', active: true, phone: '' };
      document.getElementById('opFormTitle').textContent = 'Operator nou';
    }
    var e = ui.editing;
    document.getElementById('opName').value = e.name;
    document.getElementById('opEmail').value = e.email;
    document.getElementById('opUsername').value = e.username;
    document.getElementById('opRole').value = e.role;
    document.getElementById('opPhone').value = e.phone || '';
    document.getElementById('opActive').checked = e.active !== false;

    // Parola obligatorie doar la creare
    var passRow = document.getElementById('opPassRow');
    passRow.classList.toggle('hidden', !!id);
    document.getElementById('opPassword').value = '';
    document.getElementById('opPassword2').value = '';

    U.openModal('opModal');
    setTimeout(function () { document.getElementById('opName').focus(); }, 60);
  }

  function saveUser() {
    var e = ui.editing;
    var name = document.getElementById('opName').value.trim();
    var email = document.getElementById('opEmail').value.trim();
    var username = document.getElementById('opUsername').value.trim().toLowerCase();
    var role = document.getElementById('opRole').value;
    var pass = document.getElementById('opPassword').value;
    var pass2 = document.getElementById('opPassword2').value;
    var isNew = !App.Coll.users().filter(function (x) { return x.id === e.id; })[0];

    // --- Validari ---
    var errs = [];
    if (name.length < 3) errs.push('Numele are minim 3 caractere.');
    if (username.length < 3) errs.push('Utilizatorul are minim 3 caractere.');
    if (!/^[a-z0-9._-]+$/.test(username)) errs.push('Utilizatorul contine doar litere mici, cifre, punct, liniuta.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.push('Email invalid.');
    if (isNew && pass.length < 6) errs.push('Parola are minim 6 caractere.');
    if (pass && pass !== pass2) errs.push('Parolele nu coincid.');
    if (errs.length) return U.toast(errs[0], 'error');

    var list = App.Coll.users();
    var dup = list.filter(function (x) { return x.id !== e.id && x.username === username; })[0];
    if (dup) return U.toast('Numele de utilizator "' + username + '" este deja folosit.', 'error');

    e.name = name; e.email = email; e.username = username; e.role = role;
    e.phone = document.getElementById('opPhone').value.trim();
    e.active = document.getElementById('opActive').checked;
    if (!e.createdAt) e.createdAt = new Date().toISOString();

    var commit = function (userObj) {
      var l = App.Coll.users();
      if (isNew) l.push(userObj);
      else l[l.findIndex(function (x) { return x.id === userObj.id; })] = userObj;
      App.Store.set(App.KEYS.users, l);
      App.log(isNew ? 'operator.create' : 'operator.update',
        (isNew ? 'Creat' : 'Modificat') + ' operator: ' + userObj.name + ' (' + App.ROLE_LABELS[userObj.role] + ').');
      U.closeModal('opModal');
      render();
      U.toast('Operator salvat.', 'success');
    };

    if (isNew) {
      // Parola se hash-uieste cu salt aleator — nu se stocheaza in clar
      var salt = U.randomSalt(16);
      U.hashPassword(pass, salt).then(function (h) {
        e.salt = salt; e.passwordHash = h.hash; e.algo = h.algo; e.lastLogin = null;
        commit(e);
      });
    } else {
      commit(e);
    }
  }

  function resetPassword(id) {
    var list = App.Coll.users();
    var u = list.filter(function (x) { return x.id === id; })[0];
    if (!u) return;

    var back = document.createElement('div');
    back.className = 'modal-backdrop show';
    back.innerHTML =
      '<div class="modal"><div class="modal-head"><h3>Resetare parola — ' + U.esc(u.name) + '</h3></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Parola noua (min 6 caractere)</label><input class="input" id="rp1" type="text" autocomplete="off"></div>' +
      '<div class="field"><label>Repeta parola</label><input class="input" id="rp2" type="text" autocomplete="off"></div>' +
      '<button class="btn btn-outline btn-sm" id="rpGen">Genereaza parola aleatorie</button>' +
      '</div><div class="modal-foot">' +
      '<button class="btn btn-outline" id="rpCancel">Anuleaza</button>' +
      '<button class="btn btn-success" id="rpOk">Reseteaza</button></div></div>';
    document.body.appendChild(back);

    back.querySelector('#rpGen').onclick = function () {
      var p = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 5).toUpperCase();
      back.querySelector('#rp1').value = p;
      back.querySelector('#rp2').value = p;
    };
    back.querySelector('#rpCancel').onclick = function () { back.remove(); };
    back.querySelector('#rpOk').onclick = function () {
      var p1 = back.querySelector('#rp1').value, p2 = back.querySelector('#rp2').value;
      if (p1.length < 6) return U.toast('Minim 6 caractere.', 'error');
      if (p1 !== p2) return U.toast('Parolele nu coincid.', 'error');
      var salt = U.randomSalt(16);
      U.hashPassword(p1, salt).then(function (h) {
        var l = App.Coll.users();
        var idx = l.findIndex(function (x) { return x.id === id; });
        l[idx].salt = salt; l[idx].passwordHash = h.hash; l[idx].algo = h.algo;
        App.Store.set(App.KEYS.users, l);
        App.log('operator.resetpwd', 'Parola resetata pentru: ' + u.name + '.');
        back.remove();
        U.toast('Parola a fost resetata.', 'success');
      });
    };
    setTimeout(function () { back.querySelector('#rp1').focus(); }, 60);
  }

  function toggleActive(id) {
    var l = App.Coll.users();
    var idx = l.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    var me = App.Session.currentUser();
    if (l[idx].id === me.id) return U.toast('Nu iti poti dezactiva propriul cont.', 'error');

    l[idx].active = !l[idx].active;
    App.Store.set(App.KEYS.users, l);
    App.log('operator.toggle', (l[idx].active ? 'Activat' : 'Dezactivat') + ' cont: ' + l[idx].name + '.');
    render();
    U.toast('Cont ' + (l[idx].active ? 'activat' : 'dezactivat') + '.', 'success');
  }

  function removeUser(id) {
    var l = App.Coll.users();
    var u = l.filter(function (x) { return x.id === id; })[0];
    var me = App.Session.currentUser();
    if (!u) return;
    if (u.id === me.id) return U.toast('Nu te poti sterge pe tine insuti.', 'error');
    var admins = l.filter(function (x) { return x.role === 'admin' && x.active; });
    if (u.role === 'admin' && admins.length <= 1) return U.toast('Trebuie sa ramana cel putin un administrator activ.', 'error');

    U.confirmDialog({
      title: 'Sterge operator', danger: true, okText: 'Sterge definitiv',
      message: 'Se sterge contul "' + u.name + '". Vanzarile efectuate raman in rapoarte.'
    }).then(function (ok) {
      if (!ok) return;
      App.Store.set(App.KEYS.users, l.filter(function (x) { return x.id !== id; }));
      App.log('operator.delete', 'Sters operator: ' + u.name + '.');
      render();
      U.toast('Operator sters.', 'success');
    });
  }

  /* ========================================================================
     EXPORT CSV
     ======================================================================== */
  function exportCsv() {
    var rows = App.Coll.users().map(function (u) {
      return [u.name, u.email, u.username, App.ROLE_LABELS[u.role], u.active ? 'activ' : 'inactiv',
      U.fmtDateTime(u.lastLogin), U.fmtDate(u.createdAt), u.phone || ''];
    });
    U.download('operatori-' + U.dateISO() + '.csv',
      U.toCSV(['Nume', 'Email', 'Utilizator', 'Rol', 'Status', 'Ultima logare', 'Creat la', 'Telefon'], rows),
      'text/csv;charset=utf-8');
    App.log('report.export', 'Export CSV operatori (' + rows.length + ').');
    U.toast('Fisier CSV descarcat.', 'success');
  }
})();
