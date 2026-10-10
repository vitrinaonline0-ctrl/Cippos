/* ==========================================================================
   products.js — Gestiune produse (Admin / Manager)
   CRUD complet, import CSV, imagini base64, categorii dinamice, alerta stoc
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var App = window.App;

  var ui = { filter: '', category: 'all', onlyLow: false, sort: 'name', editing: null };

  document.addEventListener('DOMContentLoaded', function () {
    App.init().then(function () {
      var user = App.requireAuth('products.view');
      if (!user) return;
      App.renderHeader('products.html');

      var canEdit = App.can(user, 'products.edit');
      document.querySelectorAll('[data-requires-edit]').forEach(function (el) {
        el.classList.toggle('hidden', !canEdit);
      });

      bind();
      render();
    });
  });

  function bind() {
    document.getElementById('pSearch').addEventListener('input', U.debounce(function (e) {
      ui.filter = e.target.value; render();
    }, 200));

    document.getElementById('pCategory').addEventListener('change', function (e) {
      ui.category = e.target.value; render();
    });

    document.getElementById('pOnlyLow').addEventListener('change', function (e) {
      ui.onlyLow = e.target.checked; render();
    });

    document.getElementById('btnNewProduct').addEventListener('click', function () { openForm(null); });
    document.getElementById('btnCategories').addEventListener('click', openCategories);
    document.getElementById('btnImportCsv').addEventListener('click', function () { U.openModal('importModal'); });
    document.getElementById('btnExportCsv').addEventListener('click', exportCsv);

    // Delegare actiuni din tabel
    document.getElementById('pBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var id = b.dataset.id;
      if (b.dataset.act === 'edit') openForm(id);
      if (b.dataset.act === 'del') removeProduct(id);
    });

    // Formular produs
    document.getElementById('prodForm').addEventListener('submit', function (e) {
      e.preventDefault();
      saveProduct();
    });
    document.getElementById('prodImage').addEventListener('change', onImagePick);
    document.getElementById('btnRemoveImage').addEventListener('click', function () {
      ui.editing.image = '';
      document.getElementById('imgPreview').innerHTML = '';
      U.toast('Imagine eliminata. Salveaza pentru a confirma.', 'warning');
    });

    // Import CSV
    document.getElementById('csvFile').addEventListener('change', onCsvFile);
    document.getElementById('csvText').addEventListener('input', U.debounce(previewCsv, 400));
    document.getElementById('btnRunImport').addEventListener('click', runImport);
    document.getElementById('btnDownloadTemplate').addEventListener('click', function () {
      U.download('template-produse.csv',
        'sku,barcode,name,price,category,stock,minStock,unit\n' +
        'EX-001,5941234000000,Produs exemplu,19.90,Cafea,50,10,buc\n',
        'text/csv;charset=utf-8');
    });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { U.closeModal(b.dataset.close); });
    });
  }

  /* ========================================================================
     RANDARE TABEL
     ======================================================================== */
  function render() {
    renderCategorySelect();
    var s = App.Coll.settings();
    var list = App.Coll.products().filter(function (p) {
      if (ui.category !== 'all' && p.category !== ui.category) return false;
      if (ui.onlyLow && p.stock > (p.minStock || s.stockAlertThreshold)) return false;
      if (ui.filter) {
        var q = U.normalize(ui.filter);
        return U.normalize(p.name).indexOf(q) !== -1 ||
          U.normalize(p.sku).indexOf(q) !== -1 ||
          String(p.barcode).indexOf(q) !== -1;
      }
      return true;
    });

    list.sort(function (a, b) {
      if (ui.sort === 'name') return a.name.localeCompare(b.name, 'ro');
      if (ui.sort === 'price') return b.price - a.price;
      return a.stock - b.stock;
    });

    var cats = App.Coll.categories();
    var catName = function (id) {
      var c = cats.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : '-';
    };

    var body = document.getElementById('pBody');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><span class="big">📦</span>Niciun produs gasit.</div></td></tr>';
    } else {
      body.innerHTML = list.map(function (p) {
        var low = p.stock <= (p.minStock || s.stockAlertThreshold);
        return '<tr>' +
          '<td data-label="ID"><span class="mono small">' + U.esc(p.id) + '</span></td>' +
          '<td data-label="Produs"><div class="row">' + U.productThumb(p, 34) +
          '<div><b>' + U.esc(p.name) + '</b><br><span class="small muted">' + U.esc(p.sku) + '</span></div></div></td>' +
          '<td data-label="Cod bare"><span class="mono small">' + U.esc(p.barcode) + '</span></td>' +
          '<td data-label="Pret" class="num strong">' + U.money(p.price, s.currency) + '</td>' +
          '<td data-label="Stoc" class="num">' +
          (low ? '<span class="badge ' + (p.stock <= 0 ? 'badge-danger' : 'badge-warning') + '">' + p.stock + ' ' + U.esc(p.unit || 'buc') + '</span>'
            : p.stock + ' ' + U.esc(p.unit || 'buc')) + '</td>' +
          '<td data-label="Categorie"><span class="badge badge-info">' + U.esc(catName(p.category)) + '</span></td>' +
          '<td data-label="Status">' + (p.active === false ? '<span class="badge badge-muted">Inactiv</span>' : '<span class="badge badge-success">Activ</span>') + '</td>' +
          '<td data-label="Actiuni" class="actions">' +
          '<button class="btn btn-sm btn-outline" data-act="edit" data-id="' + p.id + '">Editeaza</button> ' +
          '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + p.id + '" data-requires-edit>Sterge</button>' +
          '</td></tr>';
      }).join('');
    }

    // Statistici sumar
    var all = App.Coll.products();
    document.getElementById('statCount').textContent = all.length;
    document.getElementById('statValue').textContent = U.money(all.reduce(function (s2, p) { return s2 + p.price * p.stock; }, 0), s.currency);
    document.getElementById('statLow').textContent = all.filter(function (p) { return p.stock <= (p.minStock || s.stockAlertThreshold); }).length;

    // Permisiuni butoane stergere din tabel
    var user = App.Session.currentUser();
    if (user && !App.can(user, 'products.delete')) {
      document.querySelectorAll('#pBody [data-act="del"]').forEach(function (b) { b.remove(); });
    }
  }

  function renderCategorySelect() {
    var sel = document.getElementById('pCategory');
    var cur = sel.value || 'all';
    var cats = App.Coll.categories();
    sel.innerHTML = '<option value="all">Toate categoriile</option>' + cats.map(function (c) {
      return '<option value="' + c.id + '">' + U.esc(c.name) + '</option>';
    }).join('');
    sel.value = cur;
  }

  /* ========================================================================
     FORMULAR PRODUS (adaugare / editare)
     ======================================================================== */
  function openForm(id) {
    var cats = App.Coll.categories();
    document.getElementById('prodCategory').innerHTML = cats.map(function (c) {
      return '<option value="' + c.id + '">' + U.esc(c.name) + '</option>';
    }).join('');

    if (id) {
      var p = App.Coll.products().filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      ui.editing = JSON.parse(JSON.stringify(p));
      document.getElementById('prodFormTitle').textContent = 'Editeaza produs';
    } else {
      ui.editing = {
        id: U.uid('p'), sku: '', barcode: '', name: '', price: 0,
        category: cats.length ? cats[0].id : '', stock: 0, minStock: 10,
        unit: 'buc', emoji: '📦', color: '#2c3e50', image: '', active: true
      };
      document.getElementById('prodFormTitle').textContent = 'Produs nou';
    }

    var e = ui.editing;
    document.getElementById('prodName').value = e.name;
    document.getElementById('prodSku').value = e.sku;
    document.getElementById('prodBarcode').value = e.barcode;
    document.getElementById('prodPrice').value = e.price;
    document.getElementById('prodStock').value = e.stock;
    document.getElementById('prodMinStock').value = e.minStock;
    document.getElementById('prodCategory').value = e.category;
    document.getElementById('prodUnit').value = e.unit || 'buc';
    document.getElementById('prodEmoji').value = e.emoji || '';
    document.getElementById('prodColor').value = e.color || '#2c3e50';
    document.getElementById('prodActive').checked = e.active !== false;
    renderImagePreview();
    U.openModal('prodModal');
    setTimeout(function () { document.getElementById('prodName').focus(); }, 60);
  }

  function renderImagePreview() {
    var host = document.getElementById('imgPreview');
    host.innerHTML = ui.editing.image
      ? '<img src="' + ui.editing.image + '" style="max-width:120px;max-height:120px;border-radius:8px;border:1px solid var(--border)">'
      : '<span class="muted small">Fara imagine — se foloseste emoji + culoare.</span>';
  }

  /* Upload imagine → redimensionare in canvas → base64 in localStorage */
  function onImagePick(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return U.toast('Fisierul trebuie sa fie o imagine.', 'error');
    if (file.size > 4 * 1024 * 1024) return U.toast('Imagine prea mare (max 4 MB).', 'error');

    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 320;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        ui.editing.image = cv.toDataURL('image/jpeg', 0.82); // JPEG comprimat
        renderImagePreview();
        U.toast('Imagine incarcata (' + Math.round(ui.editing.image.length / 1024) + ' KB).', 'success');
      };
      img.onerror = function () { U.toast('Imagine invalida.', 'error'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* Validare + salvare produs */
  function saveProduct() {
    var e = ui.editing;
    var name = document.getElementById('prodName').value.trim();
    var sku = document.getElementById('prodSku').value.trim();
    var barcode = document.getElementById('prodBarcode').value.trim();
    var price = parseFloat(document.getElementById('prodPrice').value);
    var stock = parseFloat(document.getElementById('prodStock').value);
    var minStock = parseFloat(document.getElementById('prodMinStock').value);

    // --- Validari client-side ---
    var ok = true;
    function mark(id, cond, msg) {
      var el = document.getElementById(id);
      el.classList.toggle('invalid', !cond);
      var err = document.getElementById(id + 'Err');
      if (err) { err.textContent = msg; err.classList.toggle('show', !cond); }
      if (!cond) ok = false;
    }
    mark('prodName', name.length >= 2, 'Minim 2 caractere');
    mark('prodPrice', !isNaN(price) && price >= 0, 'Pret invalid');
    mark('prodStock', !isNaN(stock) && stock >= 0, 'Stoc invalid');
    mark('prodMinStock', !isNaN(minStock) && minStock >= 0, 'Valoare invalida');
    if (!ok) return U.toast('Corecteaza campurile marcate.', 'error');

    // Unicitate SKU / cod de bare
    var list = App.Coll.products();
    var dupSku = list.filter(function (x) { return x.id !== e.id && x.sku && x.sku === sku; })[0];
    if (sku && dupSku) return U.toast('SKU-ul exista deja la produsul "' + dupSku.name + '".', 'error');
    var dupBar = list.filter(function (x) { return x.id !== e.id && x.barcode && x.barcode === barcode; })[0];
    if (barcode && dupBar) return U.toast('Codul de bare exista deja la "' + dupBar.name + '".', 'error');

    e.name = name; e.sku = sku; e.barcode = barcode;
    e.price = Math.round(price * 100) / 100;
    e.stock = stock; e.minStock = minStock;
    e.category = document.getElementById('prodCategory').value;
    e.unit = document.getElementById('prodUnit').value;
    e.emoji = document.getElementById('prodEmoji').value.trim() || '📦';
    e.color = document.getElementById('prodColor').value;
    e.active = document.getElementById('prodActive').checked;
    if (!e.createdAt) e.createdAt = new Date().toISOString();

    var isNew = !list.filter(function (x) { return x.id === e.id; })[0];
    if (isNew) list.push(e);
    else list[list.findIndex(function (x) { return x.id === e.id; })] = e;

    App.Store.set(App.KEYS.products, list);
    App.log(isNew ? 'product.create' : 'product.update',
      (isNew ? 'Adaugat' : 'Modificat') + ' produs: ' + e.name + ' (SKU ' + e.sku + ').');

    U.closeModal('prodModal');
    render();
    U.toast('Produs salvat cu succes.', 'success');
  }

  function removeProduct(id) {
    var list = App.Coll.products();
    var p = list.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    U.confirmDialog({
      title: 'Sterge produs', danger: true, okText: 'Sterge definitiv',
      message: 'Se sterge produsul "' + p.name + '". Comenzile istorice nu sunt afectate.'
    }).then(function (ok) {
      if (!ok) return;
      App.Store.set(App.KEYS.products, list.filter(function (x) { return x.id !== id; }));
      App.log('product.delete', 'Sters produs: ' + p.name + '.');
      render();
      U.toast('Produs sters.', 'success');
    });
  }

  /* ========================================================================
     CATEGORII
     ======================================================================== */
  function openCategories() {
    var cats = App.Coll.categories();
    document.getElementById('catList').innerHTML = cats.map(function (c) {
      var count = App.Coll.products().filter(function (p) { return p.category === c.id; }).length;
      return '<div class="row mb-2">' +
        '<input class="input grow" value="' + U.esc(c.name) + '" data-catid="' + c.id + '">' +
        '<span class="badge badge-muted">' + count + '</span>' +
        '<button class="btn btn-sm btn-outline" data-catsave="' + c.id + '">Salveaza</button>' +
        '<button class="btn btn-sm btn-danger" data-catdel="' + c.id + '">Sterge</button>' +
        '</div>';
    }).join('') || '<p class="muted">Nicio categorie.</p>';
    U.openModal('catModal');

    var host = document.getElementById('catList');
    host.onclick = function (e) {
      var s = e.target.closest('[data-catsave]');
      var d = e.target.closest('[data-catdel]');
      var cats2 = App.Coll.categories();
      if (s) {
        var input = host.querySelector('[data-catid="' + s.dataset.catsave + '"]');
        var nm = input.value.trim();
        if (!nm) return U.toast('Numele nu poate fi gol.', 'error');
        cats2[cats2.findIndex(function (c) { return c.id === s.dataset.catsave; })].name = nm;
        App.Store.set(App.KEYS.categories, cats2);
        render(); openCategories();
        U.toast('Categorie actualizata.', 'success');
      }
      if (d) {
        var used = App.Coll.products().filter(function (p) { return p.category === d.dataset.catdel; }).length;
        if (used) return U.toast('Categoria are ' + used + ' produse. Muta-le intai.', 'error');
        U.confirmDialog({ title: 'Sterge categoria', danger: true }).then(function (ok2) {
          if (!ok2) return;
          App.Store.set(App.KEYS.categories, cats2.filter(function (c) { return c.id !== d.dataset.catdel; }));
          render(); openCategories();
          U.toast('Categorie stearsa.', 'success');
        });
      }
    };
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'btnAddCategory') {
      var nm = document.getElementById('newCatName').value.trim();
      if (!nm) return U.toast('Scrie numele categoriei.', 'error');
      var cats = App.Coll.categories();
      if (cats.filter(function (c) { return U.normalize(c.name) === U.normalize(nm); })[0]) {
        return U.toast('Categoria exista deja.', 'error');
      }
      cats.push({ id: U.uid('cat'), name: nm });
      App.Store.set(App.KEYS.categories, cats);
      document.getElementById('newCatName').value = '';
      render(); openCategories();
      U.toast('Categorie adaugata.', 'success');
    }
  });

  /* ========================================================================
     IMPORT CSV
     ======================================================================== */
  function onCsvFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      document.getElementById('csvText').value = reader.result;
      previewCsv();
    };
    reader.readAsText(file, 'utf-8');
  }

  function parseImport() {
    var rows = U.parseCSV(document.getElementById('csvText').value);
    if (rows.length < 2) return { headers: [], data: [] };
    var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    return {
      headers: headers,
      data: rows.slice(1).map(function (r) {
        var o = {};
        headers.forEach(function (h, i) { o[h] = (r[i] || '').trim(); });
        return o;
      })
    };
  }

  function previewCsv() {
    var p = parseImport();
    var host = document.getElementById('csvPreview');
    if (!p.data.length) { host.innerHTML = '<p class="muted small">Incarca un fisier sau lipeste continutul CSV.</p>'; return; }
    var req = ['name', 'price'];
    var missing = req.filter(function (k) { return p.headers.indexOf(k) === -1; });
    host.innerHTML =
      (missing.length ? '<p class="small" style="color:var(--danger)">Lipsesc coloane obligatorii: ' + missing.join(', ') + '</p>' : '') +
      '<p class="small muted">' + p.data.length + ' linii detectate. Coloane: ' + p.headers.join(', ') + '</p>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      p.headers.map(function (h) { return '<th>' + U.esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      p.data.slice(0, 8).map(function (r) {
        return '<tr>' + p.headers.map(function (h) { return '<td>' + U.esc(r[h]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function runImport() {
    var p = parseImport();
    if (!p.data.length) return U.toast('Nu exista date de importat.', 'error');

    var list = App.Coll.products();
    var cats = App.Coll.categories();
    var added = 0, updated = 0, failed = 0;

    p.data.forEach(function (row) {
      var name = row.name || row.nume;
      var price = parseFloat(String(row.price || row.pret || '').replace(',', '.'));
      if (!name || isNaN(price)) { failed++; return; }

      // Rezolva categoria: daca nu exista, o creeaza
      var catName = row.category || row.categorie || 'General';
      var cat = cats.filter(function (c) { return U.normalize(c.name) === U.normalize(catName); })[0];
      if (!cat) { cat = { id: U.uid('cat'), name: catName }; cats.push(cat); }

      var sku = row.sku || '';
      var existing = list.filter(function (x) { return sku && x.sku === sku; })[0];
      var prod = existing || { id: U.uid('p'), createdAt: new Date().toISOString(), emoji: '📦', color: '#2c3e50' };

      prod.sku = sku || prod.sku || ('IMP-' + String(Date.now()).slice(-5));
      prod.barcode = row.barcode || row.cod || prod.barcode || '';
      prod.name = name;
      prod.price = Math.round(price * 100) / 100;
      prod.category = cat.id;
      prod.stock = parseFloat(String(row.stock || row.stoc || '0').replace(',', '.')) || 0;
      prod.minStock = parseFloat(String(row.minstock || row.stocminim || '0').replace(',', '.')) || 0;
      prod.unit = row.unit || row.um || 'buc';
      prod.active = true;

      if (existing) updated++; else { list.push(prod); added++; }
    });

    App.Store.set(App.KEYS.products, list);
    App.Store.set(App.KEYS.categories, cats);
    App.log('product.import', 'Import CSV: ' + added + ' adaugate, ' + updated + ' actualizate, ' + failed + ' esuate.');

    U.closeModal('importModal');
    document.getElementById('csvText').value = '';
    render();
    U.toast('Import finalizat: ' + added + ' noi, ' + updated + ' actualizate' + (failed ? ', ' + failed + ' erori' : '') + '.', failed ? 'warning' : 'success');
  }

  /* ========================================================================
     EXPORT CSV
     ======================================================================== */
  function exportCsv() {
    var cats = App.Coll.categories();
    var rows = App.Coll.products().map(function (p) {
      var c = cats.filter(function (x) { return x.id === p.category; })[0];
      return [p.sku, p.barcode, p.name, p.price, c ? c.name : '', p.stock, p.minStock, p.unit || 'buc', p.active === false ? 'inactiv' : 'activ'];
    });
    var csv = U.toCSV(['sku', 'barcode', 'name', 'price', 'category', 'stock', 'minStock', 'unit', 'status'], rows);
    U.download('produse-' + U.dateISO() + '.csv', csv, 'text/csv;charset=utf-8');
    App.log('report.export', 'Export CSV produse (' + rows.length + ' inregistrari).');
    U.toast('Fisier CSV descarcat.', 'success');
  }
})();
