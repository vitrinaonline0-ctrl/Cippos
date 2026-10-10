/* ==========================================================================
   settings.js — Setari si configurare sistem
   Parametri TVA/moneda/program, backup & restore, jurnal audit, alerte stoc
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var App = window.App;

  document.addEventListener('DOMContentLoaded', function () {
    App.init().then(function () {
      var user = App.requireAuth('settings.view');
      if (!user) return;
      App.renderHeader('settings.html');

      var canEdit = App.can(user, 'settings.edit') || user.role === 'admin';
      document.querySelectorAll('#settingsForm input, #settingsForm select').forEach(function (el) {
        el.disabled = !canEdit;
      });
      document.getElementById('btnSaveSettings').classList.toggle('hidden', !canEdit);
      document.getElementById('dangerZone').classList.toggle('hidden', user.role !== 'admin');

      load();
      bind(canEdit);
      renderVouchers(canEdit);
      renderLog();
      renderStorageInfo();
    });
  });

  /* ========================================================================
     INCARCARE / SALVARE SETARI
     ======================================================================== */
  function load() {
    var s = App.Coll.settings();
    set('setCompany', s.companyName);
    set('setFiscal', s.fiscalCode);
    set('setAddress', s.address);
    set('setPhone', s.phone);
    set('setCurrency', s.currency);
    set('setVat', Math.round(s.vatRate * 10000) / 100);
    set('setVatMode', s.pricesIncludeVat ? 'incl' : 'excl');
    set('setStart', s.workdayStart);
    set('setEnd', s.workdayEnd);
    set('setPrefix', s.receiptPrefix);
    set('setTimeout', s.sessionTimeoutMin);
    set('setStockThreshold', s.stockAlertThreshold);
    document.getElementById('setStockAlert').checked = !!s.stockAlertEnabled;
    document.getElementById('setClientDisplay').checked = !!s.showClientDisplay;
  }

  function set(id, v) { var el = document.getElementById(id); if (el) el.value = v; }

  function bind(canEdit) {
    if (canEdit) {
      document.getElementById('settingsForm').addEventListener('submit', function (e) {
        e.preventDefault(); save();
      });
    }

    document.getElementById('btnBackup').addEventListener('click', backup);
    document.getElementById('btnRestoreFile').addEventListener('click', function () {
      document.getElementById('restoreFile').click();
    });
    document.getElementById('restoreFile').addEventListener('change', restore);
    document.getElementById('btnRestoreIdb').addEventListener('click', restoreFromIdb);
    document.getElementById('btnExportLog').addEventListener('click', exportLog);
    document.getElementById('logFilter').addEventListener('input', U.debounce(renderLog, 200));
    document.getElementById('btnClearLog').addEventListener('click', clearLog);
    document.getElementById('btnResetAll').addEventListener('click', resetAll);

    document.getElementById('btnAddVoucher').addEventListener('click', addVoucher);
  }

  function save() {
    var s = App.Coll.settings();
    var vat = parseFloat(document.getElementById('setVat').value);
    if (isNaN(vat) || vat < 0 || vat > 100) return U.toast('Cota TVA invalida (0-100).', 'error');

    var tMin = parseInt(document.getElementById('setTimeout').value, 10);
    if (isNaN(tMin) || tMin < 1 || tMin > 480) return U.toast('Timeout sesiune: intre 1 si 480 minute.', 'error');

    var start = document.getElementById('setStart').value;
    var end = document.getElementById('setEnd').value;
    if (start && end && start >= end) return U.toast('Ora de inceput trebuie sa fie inainte de cea de sfarsit.', 'error');

    var updated = Object.assign({}, s, {
      companyName: document.getElementById('setCompany').value.trim() || s.companyName,
      fiscalCode: document.getElementById('setFiscal').value.trim(),
      address: document.getElementById('setAddress').value.trim(),
      phone: document.getElementById('setPhone').value.trim(),
      currency: document.getElementById('setCurrency').value,
      vatRate: vat / 100,
      pricesIncludeVat: document.getElementById('setVatMode').value === 'incl',
      workdayStart: start || s.workdayStart,
      workdayEnd: end || s.workdayEnd,
      receiptPrefix: document.getElementById('setPrefix').value.trim().toUpperCase() || 'CH',
      sessionTimeoutMin: tMin,
      stockAlertEnabled: document.getElementById('setStockAlert').checked,
      stockAlertThreshold: parseInt(document.getElementById('setStockThreshold').value, 10) || 0,
      showClientDisplay: document.getElementById('setClientDisplay').checked
    });

    App.Store.set(App.KEYS.settings, updated);
    App.log('settings.update', 'Setari sistem actualizate (TVA ' + vat + '%, moneda ' + updated.currency + ').');
    U.toast('Setarile au fost salvate.', 'success');
    App.renderHeader('settings.html');
  }

  /* ========================================================================
     VOUCHERE (folosite la discount in POS)
     ======================================================================== */
  function renderVouchers(canEdit) {
    var host = document.getElementById('voucherList');
    var list = App.Coll.vouchers();
    if (!list.length) { host.innerHTML = '<p class="muted small">Niciun voucher definit.</p>'; return; }
    host.innerHTML = list.map(function (v) {
      return '<tr><td data-label="Cod"><b class="mono">' + U.esc(v.code) + '</b></td>' +
        '<td data-label="Tip">' + (v.type === 'percent' ? v.value + '%' : U.money(v.value)) + '</td>' +
        '<td data-label="Descriere">' + U.esc(v.description || '') + '</td>' +
        '<td data-label="Status">' + (v.active ? '<span class="badge badge-success">Activ</span>' : '<span class="badge badge-muted">Inactiv</span>') + '</td>' +
        '<td data-label="Actiuni" class="actions">' +
        (canEdit ? '<button class="btn btn-sm btn-outline" data-vtoggle="' + U.esc(v.code) + '">Comuta</button> ' +
          '<button class="btn btn-sm btn-danger" data-vdel="' + U.esc(v.code) + '">Sterge</button>' : '-') +
        '</td></tr>';
    }).join('');

    host.onclick = function (e) {
      var t = e.target.closest('[data-vtoggle]');
      var d = e.target.closest('[data-vdel]');
      var arr = App.Coll.vouchers();
      if (t) {
        var i = arr.findIndex(function (x) { return x.code === t.dataset.vtoggle; });
        arr[i].active = !arr[i].active;
        App.Store.set(App.KEYS.vouchers, arr);
        renderVouchers(canEdit);
      }
      if (d) {
        App.Store.set(App.KEYS.vouchers, arr.filter(function (x) { return x.code !== d.dataset.vdel; }));
        renderVouchers(canEdit);
        U.toast('Voucher sters.', 'success');
      }
    };
  }

  function addVoucher() {
    var code = document.getElementById('newVoucherCode').value.trim().toUpperCase();
    var type = document.getElementById('newVoucherType').value;
    var val = parseFloat(document.getElementById('newVoucherValue').value);
    if (!code) return U.toast('Scrie codul voucherului.', 'error');
    if (isNaN(val) || val <= 0) return U.toast('Valoare invalida.', 'error');
    if (type === 'percent' && val > 100) return U.toast('Procentul nu poate depasi 100.', 'error');
    var arr = App.Coll.vouchers();
    if (arr.filter(function (x) { return x.code === code; })[0]) return U.toast('Codul exista deja.', 'error');
    arr.push({ code: code, type: type, value: val, active: true, description: document.getElementById('newVoucherDesc').value.trim() });
    App.Store.set(App.KEYS.vouchers, arr);
    document.getElementById('newVoucherCode').value = '';
    document.getElementById('newVoucherValue').value = '';
    document.getElementById('newVoucherDesc').value = '';
    renderVouchers(true);
    U.toast('Voucher adaugat.', 'success');
  }

  /* ========================================================================
     BACKUP / RESTORE
     ======================================================================== */
  function collectData() {
    return {
      _meta: { app: 'POS System', version: App.version, exportedAt: new Date().toISOString(), exportedBy: (App.Session.currentUser() || {}).name || '-' },
      settings: App.Coll.settings(),
      users: App.Coll.users(),
      products: App.Coll.products(),
      categories: App.Coll.categories(),
      vouchers: App.Coll.vouchers(),
      orders: App.Coll.orders(),
      activity: App.Coll.activity()
    };
  }

  function backup() {
    var data = collectData();
    var blob = JSON.stringify(data, null, 2);
    U.download('backup-pos-' + U.dateISO() + '.json', blob, 'application/json');
    App.log('settings.backup', 'Backup exportat (' + Math.round(blob.length / 1024) + ' KB).');
    U.toast('Backup descarcat (' + Math.round(blob.length / 1024) + ' KB).', 'success');
  }

  function restore(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { return U.toast('Fisier JSON invalid.', 'error'); }
      if (!data.products || !data.users) return U.toast('Structura de backup invalida.', 'error');

      U.confirmDialog({
        title: 'Restaureaza backup', danger: true, okText: 'Restaureaza si suprascrie',
        html: '<p>Se vor inlocui datele curente cu backup-ul din <b>' + U.fmtDateTime(data._meta && data._meta.exportedAt) + '</b>.</p>' +
          '<ul class="small muted"><li>Produse: ' + data.products.length + '</li><li>Operatori: ' + data.users.length + '</li>' +
          '<li>Comenzi: ' + (data.orders || []).length + '</li></ul>'
      }).then(function (ok) {
        if (!ok) return;
        App.Store.set(App.KEYS.settings, data.settings || App.DEFAULT_SETTINGS);
        App.Store.set(App.KEYS.users, data.users);
        App.Store.set(App.KEYS.products, data.products);
        App.Store.set(App.KEYS.categories, data.categories || []);
        App.Store.set(App.KEYS.vouchers, data.vouchers || []);
        App.Store.set(App.KEYS.orders, data.orders || []);
        App.Store.set(App.KEYS.activity, data.activity || []);
        App.log('settings.restore', 'Backup restaurat din fisier.');
        U.toast('Backup restaurat cu succes.', 'success');
        setTimeout(function () { location.reload(); }, 1200);
      });
    };
    reader.readAsText(file, 'utf-8');
    ev.target.value = '';
  }

  function restoreFromIdb() {
    if (!window.POSDB) return U.toast('IndexedDB nu este disponibil in acest browser.', 'error');
    U.confirmDialog({
      title: 'Restaureaza din IndexedDB', danger: true, okText: 'Restaureaza',
      message: 'Se copieaza datele din backup-ul IndexedDB peste cele din localStorage.'
    }).then(function (ok) {
      if (!ok) return;
      window.POSDB.keys().then(function (keys) {
        var keys2 = keys.filter(function (k) { return String(k).indexOf('pos.') === 0; });
        if (!keys2.length) return U.toast('Nu exista backup in IndexedDB.', 'warning');
        return Promise.all(keys2.map(function (k) {
          return window.POSDB.get(k).then(function (v) { localStorage.setItem(k, JSON.stringify(v)); });
        })).then(function () {
          App.log('settings.restore', 'Restaurat ' + keys2.length + ' colectii din IndexedDB.');
          U.toast('Date restaurate din IndexedDB.', 'success');
          setTimeout(function () { location.reload(); }, 1200);
        });
      }).catch(function () { U.toast('Eroare la restaurare.', 'error'); });
    });
  }

  /* Informatii despre spatiul ocupat */
  function renderStorageInfo() {
    var host = document.getElementById('storageInfo');
    if (!host) return;
    var total = 0;
    var lines = Object.keys(App.KEYS).map(function (k) {
      var key = App.KEYS[k];
      var raw = localStorage.getItem(key) || '';
      total += raw.length;
      return { name: key, kb: raw.length / 1024 };
    }).sort(function (a, b) { return b.kb - a.kb; });

    // Estimarea cotei disponibile (Storage Manager API, unde exista)
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        var el = document.getElementById('storageQuota');
        if (el && est.quota) {
          el.textContent = 'Utilizat ~' + (est.usage / 1048576).toFixed(2) + ' MB din ' +
            (est.quota / 1048576).toFixed(0) + ' MB disponibili';
        }
      }).catch(function () { });
    }

    host.innerHTML = '<div class="small muted mb-2">Total localStorage: <b>' + (total / 1024).toFixed(1) + ' KB</b></div>' +
      lines.slice(0, 8).map(function (l) {
        return '<div class="spread small"><span class="mono">' + l.name + '</span><span class="mono">' + l.kb.toFixed(1) + ' KB</span></div>';
      }).join('') + '<div class="small muted mt-2" id="storageQuota"></div>';
  }

  /* ========================================================================
     JURNAL AUDIT
     ======================================================================== */
  function renderLog() {
    var host = document.getElementById('logList');
    var q = U.normalize(document.getElementById('logFilter').value);
    var list = App.Coll.activity().filter(function (l) {
      if (!q) return true;
      return U.normalize(l.userName).indexOf(q) !== -1 ||
        U.normalize(l.action).indexOf(q) !== -1 ||
        U.normalize(l.details).indexOf(q) !== -1;
    }).slice(0, 300);

    if (!list.length) { host.innerHTML = '<p class="muted small">Nicio intrare in jurnal.</p>'; return; }
    host.innerHTML = list.map(function (l) {
      return '<div class="log-row"><span class="ts">' + U.fmtDateTime(l.ts) + '</span>' +
        '<span><span class="who">' + U.esc(l.userName) + '</span> · ' +
        '<span class="badge badge-muted">' + U.esc(App.ACTION_LABELS[l.action] || l.action) + '</span><br>' +
        '<span class="muted">' + U.esc(l.details) + '</span></span></div>';
    }).join('');
  }

  function exportLog() {
    var rows = App.Coll.activity().map(function (l) {
      return [U.fmtDateTime(l.ts), l.userName, l.role || '', App.ACTION_LABELS[l.action] || l.action, l.details];
    });
    U.download('jurnal-audit-' + U.dateISO() + '.csv',
      U.toCSV(['Data/Ora', 'Utilizator', 'Rol', 'Actiune', 'Detalii'], rows), 'text/csv;charset=utf-8');
    U.toast('Jurnal exportat.', 'success');
  }

  function clearLog() {
    U.confirmDialog({ title: 'Goleste jurnalul', danger: true, okText: 'Goleste' }).then(function (ok) {
      if (!ok) return;
      App.Store.set(App.KEYS.activity, []);
      App.log('settings.update', 'Jurnalul de audit a fost golit.');
      renderLog();
    });
  }

  /* ========================================================================
     RESETARE COMPLETA (doar Admin)
     ======================================================================== */
  function resetAll() {
    U.confirmDialog({
      title: 'Resetare completa', danger: true, okText: 'Da, reseteaza tot',
      html: '<p style="color:var(--danger);font-weight:700">ATENTIE: se sterg toate datele!</p>' +
        '<p>Produse, comenzi, operatori si setari revin la valorile demo. Iti recomandam sa faci un backup inainte.</p>'
    }).then(function (ok) {
      if (!ok) return;
      App.resetAll().then(function () {
        App.Session.destroy();
        location.href = 'index.html';
      });
    });
  }
})();
