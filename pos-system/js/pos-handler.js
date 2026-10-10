/* ==========================================================================
   pos-handler.js — Logica ecranului OPERATOR (vanzare, cos, discount, plata)
   Layout: 3 coloane → 25% cautare/istoric | 50% cos | 25% plata
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var App = window.App;
  var Sync = window.Sync;

  var PAY_METHODS = {
    cash: { label: 'Numerar', icon: '💵' },
    card: { label: 'Card', icon: '💳' },
    check: { label: 'Cec', icon: '📄' },
    voucher: { label: 'Bilet valoric', icon: '🎫' }
  };

  var state = {
    user: null,
    products: [],
    categories: [],
    cart: emptyCart(),
    activeCategory: 'all',
    searchIndex: -1,
    paymentMethod: 'cash',
    cashReceived: 0
  };

  function emptyCart() {
    return {
      items: [],
      discount: { type: 'none', value: 0, code: '', amount: 0 },
      note: '',
      createdAt: new Date().toISOString()
    };
  }

  /* ========================================================================
     1. INCARCARE PAGINA
     ======================================================================== */
  document.addEventListener('DOMContentLoaded', function () {
    Sync.init();

    // Un ecran client nou conectat (telefon) cere cosul curent → il retrimitem
    Sync.on(Sync.M.HELLO, function () { publishCart(); });

    App.init().then(function () {
      state.user = App.requireAuth('pos.sale');
      if (!state.user) return;

      App.renderHeader('pos.html');
      reload();

      // Cos salvat anterior (recuperare dupa refresh accidental)
      var saved = App.Store.get(App.KEYS.cart, null);
      if (saved && saved.items && saved.items.length) {
        state.cart = saved;
        U.toast('Cosul nefinalizat a fost recuperat.', 'warning');
      }

      bindUI();
      renderAll();
      publishCart();
      checkLowStock();
      setInterval(checkLowStock, 60000);
    });
  });

  function reload() {
    state.products = App.Coll.products().filter(function (p) { return p.active !== false; });
    state.categories = App.Coll.categories();
  }

  /* ========================================================================
     2. BINDINGS
     ======================================================================== */
  function bindUI() {
    var search = document.getElementById('searchInput');

    // Cautare rapida (nume / SKU / cod de bare) + scaner hardware (tasteaza + Enter)
    search.addEventListener('input', U.debounce(onSearch, 140));
    search.addEventListener('focus', function () { document.getElementById('scanBox').classList.add('scanning'); });
    search.addEventListener('blur', function () {
      document.getElementById('scanBox').classList.remove('scanning');
      setTimeout(function () { hideResults(); }, 180);
    });
    search.addEventListener('keydown', function (e) {
      var items = document.querySelectorAll('#searchResults .search-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        state.searchIndex = U.clamp(state.searchIndex + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
        highlightResult(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (state.searchIndex >= 0 && items[state.searchIndex]) {
          addById(items[state.searchIndex].dataset.id, 1);
        } else if (items.length === 1) {
          addById(items[0].dataset.id, 1);
        } else {
          U.toast('Niciun produs gasit. Verifica codul sau numele.', 'warning');
        }
        hideResults();
        search.value = '';
        search.focus();
      } else if (e.key === 'Escape') {
        hideResults();
      }
    });

    // Click pe rezultat
    document.getElementById('searchResults').addEventListener('click', function (e) {
      var it = e.target.closest('.search-item');
      if (!it) return;
      addById(it.dataset.id, 1);
      hideResults();
      search.value = '';
      search.focus();
    });

    // Chips categorii
    document.getElementById('catChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      state.activeCategory = c.dataset.cat;
      renderChips();
      renderQuickGrid();
    });

    // Grid produse rapide
    document.getElementById('quickGrid').addEventListener('click', function (e) {
      var t = e.target.closest('.quick-tile');
      if (!t) return;
      addById(t.dataset.id, 1);
    });

    // Actiuni cos (delegare: +, -, sterge, editare cantitate)
    document.getElementById('cartBody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.dataset.id;
      var act = btn.dataset.act;
      if (act === 'inc') changeQty(id, 1);
      if (act === 'dec') changeQty(id, -1);
      if (act === 'del') removeItem(id);
    });
    document.getElementById('cartBody').addEventListener('change', function (e) {
      if (e.target.matches('.qty-input')) {
        var v = parseFloat(e.target.value);
        setQty(e.target.dataset.id, isNaN(v) ? 0 : v);
      }
    });

    // Note comanda
    document.getElementById('orderNote').addEventListener('input', U.debounce(function (e) {
      state.cart.note = e.target.value;
      saveCart();
    }, 300));

    // Discount
    document.querySelectorAll('.disc-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.disc-tabs button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        document.querySelectorAll('.disc-pane').forEach(function (p) { p.classList.add('hidden'); });
        document.getElementById('pane-' + b.dataset.pane).classList.remove('hidden');
      });
    });

    document.getElementById('btnApplyDiscount').addEventListener('click', function () {
      var mode = document.querySelector('.disc-tabs button.active').dataset.pane;
      if (mode === 'fixed') applyFixedDiscount(parseFloat(document.getElementById('discFixed').value));
      if (mode === 'percent') applyPercentDiscount(parseFloat(document.getElementById('discPercent').value));
    });

    document.getElementById('btnApplyVoucher').addEventListener('click', function () {
      applyVoucher(document.getElementById('discVoucher').value);
    });

    document.getElementById('btnClearDiscount').addEventListener('click', function () {
      state.cart.discount = { type: 'none', value: 0, code: '', amount: 0 };
      document.getElementById('discFixed').value = '';
      document.getElementById('discPercent').value = '';
      document.getElementById('discVoucher').value = '';
      saveCart(); renderTotals(); publishCart();
      U.toast('Discount eliminat.', 'success');
    });

    // Metode de plata
    document.getElementById('payMethods').addEventListener('click', function (e) {
      var m = e.target.closest('.pay-method');
      if (!m) return;
      state.paymentMethod = m.dataset.method;
      renderPayMethods();
      publishCart();
    });

    // Butoane principale
    document.getElementById('btnPay').addEventListener('click', openPayModal);
    document.getElementById('btnCancel').addEventListener('click', cancelOrder);
    document.getElementById('btnSuspend').addEventListener('click', suspendOrder);
    document.getElementById('btnResume').addEventListener('click', openResumeModal);
    document.getElementById('btnClearCart').addEventListener('click', function () { clearCart(true); });

    // Modal plata
    document.getElementById('keypad').addEventListener('click', function (e) {
      var k = e.target.closest('button');
      if (!k) return;
      keypadPress(k.dataset.key);
    });
    document.getElementById('btnConfirmPay').addEventListener('click', finalizePayment);
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { U.closeModal(b.dataset.close); });
    });

    // Scurtaturi tastatura (F2 = plata, F4 = anulare, F8 = suspendare)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'F2') { e.preventDefault(); openPayModal(); }
      if (e.key === 'F4') { e.preventDefault(); cancelOrder(); }
      if (e.key === 'F8') { e.preventDefault(); suspendOrder(); }
    });

    // Inainte de inchidere — salveaza cosul
    window.addEventListener('beforeunload', function () { saveCart(); });

    // Reincarca datele daca alt tab le-a modificat (produse noi etc.)
    window.addEventListener('pos:store', function (e) {
      if (e.detail.key === App.KEYS.products || e.detail.key === App.KEYS.categories) {
        reload(); renderChips(); renderQuickGrid();
      }
    });
  }

  /* ========================================================================
     3. CAUTARE PRODUS
     ======================================================================== */
  function onSearch() {
    var q = U.normalize(document.getElementById('searchInput').value);
    state.searchIndex = -1;
    if (!q) return hideResults();

    // Potrivire exacta pe cod de bare sau SKU → adauga direct (mod scaner)
    var exact = state.products.filter(function (p) {
      return p.barcode === q || U.normalize(p.sku) === q;
    })[0];
    if (exact) { addById(exact.id, 1); hideResults(); document.getElementById('searchInput').value = ''; return; }

    var res = state.products.filter(function (p) {
      return U.normalize(p.name).indexOf(q) !== -1 ||
        U.normalize(p.sku).indexOf(q) !== -1 ||
        String(p.barcode).indexOf(q) !== -1;
    }).slice(0, 12);

    renderResults(res);
  }

  function renderResults(list) {
    var host = document.getElementById('searchResults');
    if (!list.length) {
      host.innerHTML = '<div class="search-item"><div class="info"><b class="muted">Niciun rezultat</b><span>Verifica codul de bare sau numele</span></div></div>';
      host.classList.add('show');
      return;
    }
    var s = App.Coll.settings();
    host.innerHTML = list.map(function (p, i) {
      return '<div class="search-item' + (i === 0 ? ' selected' : '') + '" data-id="' + p.id + '">' +
        U.productThumb(p, 40) +
        '<div class="info"><b>' + U.esc(p.name) + '</b>' +
        '<span>' + U.esc(p.sku) + ' · ' + U.esc(p.barcode) + ' · stoc ' + p.stock + '</span></div>' +
        '<div class="price">' + U.money(p.price, s.currency) + '</div></div>';
    }).join('');
    state.searchIndex = 0;
    host.classList.add('show');
  }

  function highlightResult(items) {
    items.forEach(function (it, i) { it.classList.toggle('selected', i === state.searchIndex); });
  }

  function hideResults() {
    document.getElementById('searchResults').classList.remove('show');
  }

  /* ========================================================================
     4. COS — adaugare / modificare
     ======================================================================== */
  function addById(id, qty) {
    var p = state.products.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var inCart = state.cart.items.filter(function (i) { return i.productId === id; })[0];
    var current = inCart ? inCart.qty : 0;

    if (current + qty > p.stock) {
      U.toast('Stoc insuficient pentru "' + p.name + '" (disponibil: ' + p.stock + ').', 'error');
      return;
    }

    if (inCart) {
      inCart.qty = Math.round((inCart.qty + qty) * 1000) / 1000;
    } else {
      state.cart.items.push({
        productId: p.id, sku: p.sku, barcode: p.barcode, name: p.name,
        price: p.price, unit: p.unit || 'buc', qty: qty,
        emoji: p.emoji, color: p.color, image: p.image
      });
    }
    afterChange();
    U.toast(p.name + ' adaugat in cos.', 'success', 1500);
  }

  function changeQty(id, delta) {
    var it = state.cart.items.filter(function (i) { return i.productId === id; })[0];
    if (!it) return;
    setQty(id, it.qty + delta);
  }

  function setQty(id, qty) {
    var it = state.cart.items.filter(function (i) { return i.productId === id; })[0];
    if (!it) return;
    var p = state.products.filter(function (x) { return x.id === id; })[0];
    if (p && qty > p.stock) {
      U.toast('Stoc maxim: ' + p.stock, 'warning');
      qty = p.stock;
    }
    if (qty <= 0) return removeItem(id);
    it.qty = Math.round(qty * 1000) / 1000;
    afterChange();
  }

  function removeItem(id) {
    state.cart.items = state.cart.items.filter(function (i) { return i.productId !== id; });
    afterChange();
  }

  function afterChange() {
    saveCart();
    renderCart();
    renderTotals();
    publishCart();
  }

  function saveCart() {
    App.Store.set(App.KEYS.cart, state.cart);
  }

  function clearCart(ask) {
    var doIt = function () {
      state.cart = emptyCart();
      document.getElementById('orderNote').value = '';
      document.getElementById('discFixed').value = '';
      document.getElementById('discPercent').value = '';
      document.getElementById('discVoucher').value = '';
      App.Store.remove(App.KEYS.cart);
      renderCart(); renderTotals(); publishCart();
      Sync.publish(Sync.M.CLEAR, {});
    };
    if (!ask || !state.cart.items.length) return doIt();
    U.confirmDialog({
      title: 'Goleste cosul', danger: true, okText: 'Da, goleste',
      message: 'Se elimina toate produsele din cosul curent.'
    }).then(function (ok) { if (ok) doIt(); });
  }

  /* ========================================================================
     5. CALCUL TOTALURI (subtotal, TVA, total)
     ======================================================================== */
  function computeTotals(cart, settings) {
    settings = settings || App.Coll.settings();
    var rate = Number(settings.vatRate) || 0;
    var gross = cart.items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);

    // Valoarea discount-ului
    var d = cart.discount || { type: 'none', value: 0 };
    var discAmount = 0;
    if (d.type === 'fixed') discAmount = Math.min(Number(d.value) || 0, gross);
    if (d.type === 'percent') discAmount = gross * (U.clamp(Number(d.value) || 0, 0, 100) / 100);
    discAmount = Math.round(discAmount * 100) / 100;

    var subtotal, vat, total;
    if (settings.pricesIncludeVat) {
      // Preturile includ TVA: total = gross - discount ; TVA extras din total
      total = gross - discAmount;
      vat = total - total / (1 + rate);
      subtotal = total - vat;
    } else {
      // Preturile NU includ TVA: subtotal + TVA = total (caiet de sarcini)
      subtotal = gross - discAmount;
      vat = subtotal * rate;
      total = subtotal + vat;
    }
    return {
      gross: r2(gross), discAmount: r2(discAmount),
      subtotal: r2(subtotal), vatAmount: r2(vat), total: r2(total),
      vatRate: rate,
      itemCount: cart.items.reduce(function (s, i) { return s + i.qty; }, 0)
    };
  }

  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ========================================================================
     6. DISCOUNTURI
     ======================================================================== */
  function applyFixedDiscount(v) {
    if (!state.cart.items.length) return U.toast('Cosul este gol.', 'warning');
    if (!v || v <= 0) return U.toast('Introdu o valoare valida.', 'warning');
    var t = computeTotals(state.cart);
    if (v > t.gross) return U.toast('Discountul nu poate depasi valoarea cosului.', 'error');
    state.cart.discount = { type: 'fixed', value: v, code: '', amount: v };
    App.log('pos.discount', 'Discount fix aplicat: ' + U.money(v) + '.');
    afterChange();
    U.toast('Discount fix aplicat: ' + U.money(v), 'success');
  }

  function applyPercentDiscount(v) {
    if (!state.cart.items.length) return U.toast('Cosul este gol.', 'warning');
    if (!v || v <= 0 || v > 100) return U.toast('Procent intre 1 si 100.', 'warning');
    state.cart.discount = { type: 'percent', value: v, code: '', amount: 0 };
    App.log('pos.discount', 'Discount procentual aplicat: ' + v + '%.');
    afterChange();
    U.toast('Discount ' + v + '% aplicat.', 'success');
  }

  function applyVoucher(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return U.toast('Introdu codul voucherului.', 'warning');
    var v = App.Coll.vouchers().filter(function (x) { return x.code.toUpperCase() === code; })[0];
    if (!v) return U.toast('Voucher inexistent: ' + code, 'error');
    if (!v.active) return U.toast('Voucherul este dezactivat.', 'error');
    if (v.validUntil && new Date(v.validUntil) < new Date()) return U.toast('Voucherul a expirat.', 'error');
    state.cart.discount = { type: v.type, value: Number(v.value), code: v.code, amount: 0 };
    App.log('pos.discount', 'Voucher aplicat: ' + v.code + ' (' + v.value + (v.type === 'percent' ? '%' : ' RON') + ').');
    afterChange();
    U.toast('Voucher ' + v.code + ' aplicat cu succes.', 'success');
  }

  /* ========================================================================
     7. RANDARE
     ======================================================================== */
  function renderAll() {
    renderChips();
    renderQuickGrid();
    renderCart();
    renderTotals();
    renderPayMethods();
    renderOperatorCard();
    renderMiniReport();
    renderSessionHistory();
    renderOperatorInfo();
  }

  function renderChips() {
    var host = document.getElementById('catChips');
    var all = [{ id: 'all', name: 'Toate' }].concat(state.categories);
    host.innerHTML = all.map(function (c) {
      return '<button class="chip' + (state.activeCategory === c.id ? ' active' : '') + '" data-cat="' + c.id + '">' + U.esc(c.name) + '</button>';
    }).join('');
  }

  function renderQuickGrid() {
    var host = document.getElementById('quickGrid');
    var s = App.Coll.settings();
    var list = state.products.filter(function (p) {
      return state.activeCategory === 'all' || p.category === state.activeCategory;
    });
    if (!list.length) {
      host.innerHTML = '<div class="muted small" style="grid-column:1/-1;text-align:center;padding:16px">Niciun produs in aceasta categorie.</div>';
      return;
    }
    host.innerHTML = list.map(function (p) {
      var low = p.stock <= (p.minStock || s.stockAlertThreshold);
      return '<button class="quick-tile' + (p.stock <= 0 ? ' out' : '') + '" data-id="' + p.id + '" title="' + U.esc(p.name) + '">' +
        '<span class="ico" style="background:' + U.esc(p.color || '#2c3e50') + '">' + (p.image ? '<img src="' + U.esc(p.image) + '" style="width:100%;height:100%;object-fit:cover;border-radius:6px">' : U.esc(p.emoji || '📦')) + '</span>' +
        '<span class="nm">' + U.esc(p.name) + '</span>' +
        '<span class="pr">' + U.money(p.price, s.currency) + '</span>' +
        (low ? '<span class="stockflag">stoc ' + p.stock + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function renderCart() {
    var body = document.getElementById('cartBody');
    var s = App.Coll.settings();
    if (!state.cart.items.length) {
      body.innerHTML = '<tr><td colspan="6"><div class="cart-empty"><span class="big">🛒</span>' +
        'Cosul este gol<br><span class="small">Scaneaza codul de bare sau cauta un produs</span></div></td></tr>';
      document.getElementById('cartCount').textContent = '0 produse';
      return;
    }
    body.innerHTML = state.cart.items.map(function (i) {
      return '<tr>' +
        '<td><div class="prod">' + U.productThumb(i, 32) +
        '<div><b>' + U.esc(i.name) + '</b><span>' + U.esc(i.sku) + '</span></div></div></td>' +
        '<td><div class="qty-ctrl">' +
        '<button data-act="dec" data-id="' + i.productId + '" title="Scade">−</button>' +
        '<input class="qty-input" type="number" step="0.001" min="0.001" value="' + i.qty + '" data-id="' + i.productId + '">' +
        '<button data-act="inc" data-id="' + i.productId + '" title="Adauga">+</button>' +
        '</div></td>' +
        '<td class="num">' + U.money(i.price, s.currency) + '</td>' +
        '<td class="num strong">' + U.money(i.price * i.qty, s.currency) + '</td>' +
        '<td class="actions"><button class="icon-btn" data-act="del" data-id="' + i.productId + '" title="Sterge">🗑</button></td>' +
        '</tr>';
    }).join('');
    var t = computeTotals(state.cart, s);
    document.getElementById('cartCount').textContent = state.cart.items.length + ' linii · ' + U.num(t.itemCount, 0) + ' buc';
  }

  function renderTotals() {
    var s = App.Coll.settings();
    var t = computeTotals(state.cart, s);
    document.getElementById('tSubtotal').textContent = U.money(t.subtotal, s.currency);
    document.getElementById('tDiscount').textContent = '− ' + U.money(t.discAmount, s.currency);
    document.getElementById('tVat').textContent = U.money(t.vatAmount, s.currency);
    document.getElementById('tVatLabel').textContent = 'TVA ' + Math.round(t.vatRate * 100) + '%';
    document.getElementById('tTotal').textContent = U.money(t.total, s.currency);
    document.getElementById('btnPay').disabled = !state.cart.items.length;
    document.getElementById('btnSuspend').disabled = !state.cart.items.length;
    document.getElementById('btnCancel').disabled = !state.cart.items.length;
  }

  function renderPayMethods() {
    var host = document.getElementById('payMethods');
    host.innerHTML = Object.keys(PAY_METHODS).map(function (k) {
      var m = PAY_METHODS[k];
      return '<button class="pay-method' + (state.paymentMethod === k ? ' active' : '') + '" data-method="' + k + '">' +
        '<span class="ico">' + m.icon + '</span>' + m.label + '</button>';
    }).join('');
  }

  function renderOperatorCard() {
    var u = state.user;
    document.getElementById('opCard').innerHTML =
      '<div class="row"><span class="avatar" style="width:42px;height:42px;font-size:15px">' + U.esc(U.initials(u.name)) + '</span>' +
      '<div><b>' + U.esc(u.name) + '</b><br><span class="badge badge-info">' + U.esc(App.ROLE_LABELS[u.role]) + '</span></div></div>' +
      '<div class="small muted mt-2">Conectat la ' + U.fmtTime(u.lastLogin || Date.now()) + '</div>';
  }

  function renderOperatorInfo() {
    var el = document.getElementById('opInfoLine');
    if (el) el.textContent = state.user.name;
  }

  /* Mini-raport zi: vanzari, tranzactii, medie cos */
  function dayStats() {
    var today = U.dateISO();
    var orders = App.Coll.orders().filter(function (o) {
      return o.status === 'final' && U.dateISO(o.createdAt) === today;
    });
    var sales = orders.reduce(function (s, o) { return s + o.total; }, 0);
    return {
      count: orders.length,
      sales: r2(sales),
      avg: orders.length ? r2(sales / orders.length) : 0,
      orders: orders
    };
  }

  function renderMiniReport() {
    var s = App.Coll.settings();
    var d = dayStats();
    document.getElementById('miniSales').textContent = U.money(d.sales, s.currency);
    document.getElementById('miniTx').textContent = d.count;
    document.getElementById('miniAvg').textContent = U.money(d.avg, s.currency);
    var sus = App.Coll.orders().filter(function (o) { return o.status === 'suspended'; }).length;
    document.getElementById('miniSuspended').textContent = sus;
    document.getElementById('btnResume').disabled = sus === 0;
  }

  function renderSessionHistory() {
    var host = document.getElementById('sessionOrders');
    var s = App.Coll.settings();
    var list = App.Coll.orders().filter(function (o) {
      return o.operatorId === state.user.id && U.dateISO(o.createdAt) === U.dateISO();
    }).slice(0, 12);

    if (!list.length) {
      host.innerHTML = '<li class="muted">Nicio tranzactie in sesiunea de azi.</li>';
      return;
    }
    host.innerHTML = list.map(function (o) {
      var badge = o.status === 'final' ? '<span class="badge badge-success">' + PAY_METHODS[o.paymentMethod].icon + '</span>'
        : o.status === 'suspended' ? '<span class="badge badge-warning">⏸</span>'
          : '<span class="badge badge-danger">✕</span>';
      return '<li>' + badge + '<span class="no">' + U.esc(o.number) + '</span>' +
        '<span class="muted small">' + U.fmtTime(o.createdAt) + '</span>' +
        '<span class="amt">' + U.money(o.total, s.currency) + '</span></li>';
    }).join('');
  }

  /* ========================================================================
     8. SINCRONIZARE CU ECRANUL CLIENT
     ======================================================================== */
  function publishCart() {
    var s = App.Coll.settings();
    var t = computeTotals(state.cart, s);
    var payload = {
      company: s.companyName,
      operator: state.user ? state.user.name : '',
      items: state.cart.items.map(function (i) {
        return {
          name: i.name, qty: i.qty, unit: i.unit, price: i.price,
          line: r2(i.price * i.qty), emoji: i.emoji, color: i.color, image: i.image
        };
      }),
      subtotal: t.subtotal, vat: t.vatAmount, vatRate: t.vatRate,
      discount: t.discAmount, total: t.total, currency: s.currency,
      payment: PAY_METHODS[state.paymentMethod],
      ts: Date.now()
    };
    Sync.saveState(payload);
    Sync.publish(Sync.M.CART, payload);
  }

  /* ========================================================================
     9. MODAL PLATA
     ======================================================================== */
  function openPayModal() {
    if (!state.cart.items.length) return U.toast('Cosul este gol.', 'warning');
    var s = App.Coll.settings();
    var t = computeTotals(state.cart, s);
    state.cashReceived = 0;

    document.getElementById('payModalTitle').textContent = 'Incasare — ' + PAY_METHODS[state.paymentMethod].label;
    document.getElementById('payTotal').textContent = U.money(t.total, s.currency);
    document.getElementById('payReceived').value = '';
    document.getElementById('payChange').textContent = U.money(0, s.currency);
    document.getElementById('btnConfirmPay').disabled = true;
    document.getElementById('payMethodRow').textContent = PAY_METHODS[state.paymentMethod].icon + ' ' + PAY_METHODS[state.paymentMethod].label;

    // Butoane rapide cu bancnote uzuale
    var quick = [t.total, 50, 100, 200, 500];
    document.getElementById('quickCash').innerHTML = quick.map(function (v) {
      return '<button class="btn btn-outline btn-sm" data-quick="' + v + '">' +
        (v === t.total ? 'Exact' : U.money(v, s.currency)) + '</button>';
    }).join('');
    document.getElementById('quickCash').onclick = function (e) {
      var b = e.target.closest('[data-quick]');
      if (!b) return;
      state.cashReceived = r2(parseFloat(b.dataset.quick));
      updateCash();
    };

    // Pentru metode non-numerar nu e nevoie de suma primita
    if (state.paymentMethod !== 'cash') {
      state.cashReceived = t.total;
      document.getElementById('btnConfirmPay').disabled = false;
    }

    U.openModal('payModal');
    setTimeout(function () { document.getElementById('payReceived').focus(); }, 60);
  }

  function keypadPress(k) {
    var el = document.getElementById('payReceived');
    var cur = el.value.replace(',', '.');
    if (k === 'C') cur = '';
    else if (k === '⌫') cur = cur.slice(0, -1);
    else if (k === '.') { if (cur.indexOf('.') === -1) cur = (cur || '0') + '.'; }
    else cur += k;
    el.value = cur;
    state.cashReceived = parseFloat(cur) || 0;
    updateCash();
  }

  function updateCash() {
    var s = App.Coll.settings();
    var t = computeTotals(state.cart, s);
    var change = state.cashReceived - t.total;
    document.getElementById('payChange').textContent = U.money(Math.max(0, change), s.currency);
    document.getElementById('btnConfirmPay').disabled = state.cashReceived + 0.001 < t.total;
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'payReceived') {
      state.cashReceived = parseFloat(e.target.value) || 0;
      updateCash();
    }
  });

  /* Finalizare plata → creeaza comanda, scade stocul, log, chitanta */
  function finalizePayment() {
    var s = App.Coll.settings();
    var t = computeTotals(state.cart, s);
    var btn = document.getElementById('btnConfirmPay');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:3px"></span> Se proceseaza...';

    var order = {
      id: U.uid('o'),
      number: App.nextReceiptNumber(),
      createdAt: new Date().toISOString(),
      operatorId: state.user.id,
      operatorName: state.user.name,
      items: state.cart.items.map(function (i) {
        return {
          productId: i.productId, sku: i.sku, name: i.name, qty: i.qty, unit: i.unit,
          unitPrice: i.price, lineTotal: r2(i.price * i.qty)
        };
      }),
      discount: Object.assign({}, state.cart.discount, { amount: t.discAmount }),
      subtotal: t.subtotal,
      vatRate: t.vatRate,
      vatAmount: t.vatAmount,
      total: t.total,
      currency: s.currency,
      paymentMethod: state.paymentMethod,
      amountPaid: state.paymentMethod === 'cash' ? state.cashReceived : t.total,
      change: state.paymentMethod === 'cash' ? r2(state.cashReceived - t.total) : 0,
      note: state.cart.note || '',
      status: 'final'
    };

    // Salvare comanda
    var orders = App.Coll.orders();
    orders.unshift(order);
    App.Store.set(App.KEYS.orders, orders);

    // Scadere stoc
    var prods = App.Coll.products();
    order.items.forEach(function (it) {
      var p = prods.filter(function (x) { return x.id === it.productId; })[0];
      if (p) p.stock = Math.max(0, Math.round((p.stock - it.qty) * 1000) / 1000);
    });
    App.Store.set(App.KEYS.products, prods);

    App.log('pos.sale', 'Comanda ' + order.number + ' · ' + U.money(order.total, s.currency) + ' · ' + PAY_METHODS[order.paymentMethod].label + '.');

    // Notifica ecranul client
    Sync.publish(Sync.M.DONE, {
      number: order.number, total: order.total, currency: s.currency,
      payment: PAY_METHODS[order.paymentMethod], change: order.change
    });

    // Curata cosul
    state.cart = emptyCart();
    App.Store.remove(App.KEYS.cart);
    document.getElementById('orderNote').value = '';

    reload();
    renderAll();
    publishCart();

    U.closeModal('payModal');
    btn.disabled = false;
    btn.textContent = 'Confirma plata';

    U.toast('Plata finalizata · ' + order.number + ' · rest ' + U.money(order.change, s.currency), 'success', 4000);
    showReceipt(order);
  }

  /* Bon fiscal — previzualizare + print (export PDF din browser) */
  function showReceipt(order) {
    var s = App.Coll.settings();
    document.getElementById('receiptBody').innerHTML =
      '<div class="receipt-print">' +
      '<h4>' + U.esc(s.companyName) + '</h4>' +
      '<div style="text-align:center">' + U.esc(s.address) + '<br>CUI: ' + U.esc(s.fiscalCode) + '</div>' +
      '<div class="sep"></div>' +
      '<div>Chitanta: <b>' + U.esc(order.number) + '</b></div>' +
      '<div>Data: ' + U.fmtDateTime(order.createdAt) + '</div>' +
      '<div>Operator: ' + U.esc(order.operatorName) + '</div>' +
      '<div class="sep"></div><table>';

    var tbl = '';
    order.items.forEach(function (i) {
      tbl += '<tr><td>' + U.esc(i.name) + '</td><td style="text-align:right">' + i.qty + '</td>' +
        '<td style="text-align:right">' + U.money(i.lineTotal, s.currency) + '</td></tr>';
    });
    document.getElementById('receiptBody').innerHTML += tbl + '</table><div class="sep"></div>' +
      '<table>' +
      '<tr><td>Subtotal</td><td style="text-align:right">' + U.money(order.subtotal, s.currency) + '</td></tr>' +
      (order.discount.amount ? '<tr><td>Discount</td><td style="text-align:right">-' + U.money(order.discount.amount, s.currency) + '</td></tr>' : '') +
      '<tr><td>TVA ' + Math.round(order.vatRate * 100) + '%</td><td style="text-align:right">' + U.money(order.vatAmount, s.currency) + '</td></tr>' +
      '<tr><td><b>TOTAL</b></td><td style="text-align:right"><b>' + U.money(order.total, s.currency) + '</b></td></tr>' +
      '<tr><td>Plata (' + PAY_METHODS[order.paymentMethod].label + ')</td><td style="text-align:right">' + U.money(order.amountPaid, s.currency) + '</td></tr>' +
      '<tr><td>Rest</td><td style="text-align:right">' + U.money(order.change, s.currency) + '</td></tr>' +
      '</table><div class="sep"></div>' +
      '<div style="text-align:center">Va multumim!</div></div>';
    U.openModal('receiptModal');
  }

  window.printReceipt = function () {
    var host = document.getElementById('printArea');
    host.innerHTML = document.getElementById('receiptBody').innerHTML;
    window.print();
  };

  /* ========================================================================
     10. ANULARE / SUSPENDARE / RELUARE
     ======================================================================== */
  function cancelOrder() {
    if (!state.cart.items.length) return;
    U.confirmDialog({
      title: 'Anuleaza comanda', danger: true, okText: 'Da, anuleaza',
      message: 'Comanda curenta va fi eliminata. Actiunea ramane in jurnalul de audit.'
    }).then(function (ok) {
      if (!ok) return;
      var s = App.Coll.settings();
      var t = computeTotals(state.cart, s);
      var orders = App.Coll.orders();
      orders.unshift({
        id: U.uid('o'), number: App.nextReceiptNumber() + '/ANULAT',
        createdAt: new Date().toISOString(),
        operatorId: state.user.id, operatorName: state.user.name,
        items: state.cart.items, discount: state.cart.discount,
        subtotal: t.subtotal, vatRate: t.vatRate, vatAmount: t.vatAmount,
        total: 0, currency: s.currency, paymentMethod: state.paymentMethod,
        amountPaid: 0, change: 0, note: 'Comanda anulata', status: 'cancelled'
      });
      App.Store.set(App.KEYS.orders, orders);
      App.log('pos.cancel', 'Comanda anulata in valoare de ' + U.money(t.total, s.currency) + '.');
      clearCart(false);
      renderSessionHistory();
      U.toast('Comanda a fost anulata.', 'warning');
    });
  }

  function suspendOrder() {
    if (!state.cart.items.length) return;
    var s = App.Coll.settings();
    var t = computeTotals(state.cart, s);
    var orders = App.Coll.orders();
    var order = {
      id: U.uid('o'), number: 'SUS-' + String(Date.now()).slice(-6),
      createdAt: new Date().toISOString(),
      operatorId: state.user.id, operatorName: state.user.name,
      items: state.cart.items, discount: state.cart.discount, note: state.cart.note || '',
      subtotal: t.subtotal, vatRate: t.vatRate, vatAmount: t.vatAmount,
      total: t.total, currency: s.currency, paymentMethod: state.paymentMethod,
      amountPaid: 0, change: 0, status: 'suspended'
    };
    orders.unshift(order);
    App.Store.set(App.KEYS.orders, orders);
    App.log('pos.suspend', 'Comanda suspendata: ' + order.number + ' (' + U.money(t.total, s.currency) + ').');
    clearCart(false);
    renderMiniReport();
    renderSessionHistory();
    U.toast('Comanda a fost suspendata. O poti relua din lista.', 'success');
  }

  function openResumeModal() {
    var s = App.Coll.settings();
    var list = App.Coll.orders().filter(function (o) { return o.status === 'suspended'; });
    if (!list.length) return U.toast('Nu exista comenzi suspendate.', 'warning');
    document.getElementById('resumeList').innerHTML = list.map(function (o) {
      return '<div class="card mb-2"><div class="spread">' +
        '<div><b>' + U.esc(o.number) + '</b><br><span class="small muted">' + U.esc(o.operatorName) + ' · ' +
        U.fmtDateTime(o.createdAt) + ' · ' + o.items.length + ' produse</span></div>' +
        '<div class="right"><b>' + U.money(o.total, s.currency) + '</b><br>' +
        '<button class="btn btn-sm btn-success mt-2" data-resume="' + o.id + '">Relua</button> ' +
        '<button class="btn btn-sm btn-outline" data-drop="' + o.id + '">Sterge</button></div>' +
        '</div></div>';
    }).join('');
    U.openModal('resumeModal');
  }

  document.addEventListener('click', function (e) {
    var r = e.target.closest('[data-resume]');
    if (r) {
      var orders = App.Coll.orders();
      var o = orders.filter(function (x) { return x.id === r.dataset.resume; })[0];
      if (!o) return;
      if (state.cart.items.length) {
        U.toast('Goleste sau suspendeaza cosul curent inainte.', 'warning');
        return;
      }
      state.cart = {
        items: o.items, discount: o.discount || { type: 'none', value: 0, code: '', amount: 0 },
        note: o.note || '', createdAt: new Date().toISOString()
      };
      App.Store.set(App.KEYS.orders, orders.filter(function (x) { return x.id !== o.id; }));
      App.log('pos.resume', 'Comanda reluata: ' + o.number + '.');
      U.closeModal('resumeModal');
      document.getElementById('orderNote').value = state.cart.note;
      afterChange();
      renderMiniReport();
      renderSessionHistory();
      U.toast('Comanda a fost reluata.', 'success');
    }
    var d = e.target.closest('[data-drop]');
    if (d) {
      U.confirmDialog({ title: 'Sterge comanda suspendata', danger: true }).then(function (ok) {
        if (!ok) return;
        App.Store.set(App.KEYS.orders, App.Coll.orders().filter(function (x) { return x.id !== d.dataset.drop; }));
        renderMiniReport();
        openResumeModal();
      });
    }
  });

  /* ========================================================================
     11. ALERTA STOC MINIM
     ======================================================================== */
  function checkLowStock() {
    var s = App.Coll.settings();
    if (!s.stockAlertEnabled) return;
    var low = App.Coll.products().filter(function (p) {
      return p.active !== false && p.stock <= (p.minStock || s.stockAlertThreshold);
    });
    var el = document.getElementById('stockAlert');
    if (!low.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '⚠ <b>' + low.length + '</b> produse sub stocul minim: ' +
      low.slice(0, 3).map(function (p) { return U.esc(p.name) + ' (' + p.stock + ')'; }).join(', ') +
      (low.length > 3 ? ' ...' : '');
  }

  /* Expunerea pentru testare / consola */
  window.POS = {
    state: state,
    computeTotals: computeTotals,
    addById: addById,
    clearCart: clearCart
  };
})();
