/* ==========================================================================
   reports.js — Rapoarte si analitica
   Tab-uri: Dashboard | Raport Zi | Perioada | Operator | Stoc
   Grafice: SVG generate in JS (fara dependente externe)
   Export: CSV (date) + PDF (prin fereastra de print a browserului)
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var App = window.App;
  var S = {}; // setari (incarcate la init)

  var PAY_LABEL = { cash: 'Numerar', card: 'Card', check: 'Cec', voucher: 'Bilet valoric' };

  document.addEventListener('DOMContentLoaded', function () {
    App.init().then(function () {
      var user = App.requireAuth('reports.view');
      if (!user) return;
      App.renderHeader('reports.html');
      S = App.Coll.settings();

      // Butoane de export disponibile doar cu permisiune
      var canExport = App.can(user, 'reports.export') || user.role === 'admin' || user.role === 'manager';
      document.querySelectorAll('[data-export]').forEach(function (b) { b.classList.toggle('hidden', !canExport); });

      // Implicit: intervalul = luna curenta
      var d = new Date();
      document.getElementById('dateFrom').value = U.dateISO(new Date(d.getFullYear(), d.getMonth(), 1));
      document.getElementById('dateTo').value = U.dateISO(d);

      bindTabs();
      bindFilters();
      renderAll();
    });
  });

  function bindTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.getElementById('panel-' + t.dataset.tab).classList.add('active');
      });
    });
  }

  function bindFilters() {
    document.getElementById('btnApplyPeriod').addEventListener('click', function () { renderAll(); });
    document.getElementById('btnToday').addEventListener('click', function () {
      document.getElementById('dateFrom').value = U.dateISO();
      document.getElementById('dateTo').value = U.dateISO();
      renderAll();
    });
    document.getElementById('btnLast7').addEventListener('click', function () { setRange(7); });
    document.getElementById('btnLast30').addEventListener('click', function () { setRange(30); });
    document.getElementById('btnThisMonth').addEventListener('click', function () {
      var d = new Date();
      document.getElementById('dateFrom').value = U.dateISO(new Date(d.getFullYear(), d.getMonth(), 1));
      document.getElementById('dateTo').value = U.dateISO(d);
      renderAll();
    });

    document.getElementById('btnPdfDay').addEventListener('click', function () { printSection('dayReport'); });
    document.getElementById('btnPdfPeriod').addEventListener('click', function () { printSection('periodReport'); });
    document.getElementById('btnPdfOperator').addEventListener('click', function () { printSection('operatorReport'); });
    document.getElementById('btnPdfStock').addEventListener('click', function () { printSection('stockReport'); });

    document.getElementById('btnCsvDay').addEventListener('click', function () { csvDay(); });
    document.getElementById('btnCsvPeriod').addEventListener('click', function () { csvPeriod(); });
    document.getElementById('btnCsvOperator').addEventListener('click', function () { csvOperator(); });
    document.getElementById('btnCsvStock').addEventListener('click', function () { csvStock(); });
  }

  function setRange(days) {
    var to = new Date();
    var from = new Date();
    from.setDate(from.getDate() - (days - 1));
    document.getElementById('dateFrom').value = U.dateISO(from);
    document.getElementById('dateTo').value = U.dateISO(to);
    renderAll();
  }

  /* ========================================================================
     AGREGARE DATE
     ======================================================================== */
  function finalOrders() {
    return App.Coll.orders().filter(function (o) { return o.status === 'final'; });
  }

  function between(o, from, to) {
    var d = U.dateISO(o.createdAt);
    return d >= from && d <= to;
  }

  function range() {
    return {
      from: document.getElementById('dateFrom').value || U.dateISO(),
      to: document.getElementById('dateTo').value || U.dateISO()
    };
  }

  function summarize(orders) {
    var sales = orders.reduce(function (s, o) { return s + o.total; }, 0);
    var vat = orders.reduce(function (s, o) { return s + o.vatAmount; }, 0);
    var disc = orders.reduce(function (s, o) { return s + (o.discount ? o.discount.amount : 0); }, 0);
    return {
      count: orders.length,
      sales: Math.round(sales * 100) / 100,
      vat: Math.round(vat * 100) / 100,
      discount: Math.round(disc * 100) / 100,
      avg: orders.length ? Math.round((sales / orders.length) * 100) / 100 : 0,
      items: orders.reduce(function (s, o) { return s + o.items.reduce(function (a, i) { return a + i.qty; }, 0); }, 0)
    };
  }

  /* Top produse dupa cantitate si dupa incasari */
  function topProducts(orders, limit) {
    var map = {};
    orders.forEach(function (o) {
      o.items.forEach(function (i) {
        var k = i.sku || i.name;
        map[k] = map[k] || { name: i.name, sku: i.sku, qty: 0, revenue: 0 };
        map[k].qty += i.qty;
        map[k].revenue += i.lineTotal;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.revenue - a.revenue; })
      .slice(0, limit || 10);
  }

  function byDay(orders, from, to) {
    var map = {};
    var d = new Date(from + 'T00:00:00');
    var end = new Date(to + 'T00:00:00');
    while (d <= end) {
      var k = U.dateISO(d);
      map[k] = { date: k, sales: 0, count: 0 };
      d.setDate(d.getDate() + 1);
      if (Object.keys(map).length > 400) break; // siguranta
    }
    orders.forEach(function (o) {
      var k = U.dateISO(o.createdAt);
      if (!map[k]) map[k] = { date: k, sales: 0, count: 0 };
      map[k].sales += o.total;
      map[k].count += 1;
    });
    return Object.keys(map).sort().map(function (k) {
      map[k].sales = Math.round(map[k].sales * 100) / 100;
      return map[k];
    });
  }

  function byPayment(orders) {
    var map = {};
    orders.forEach(function (o) {
      map[o.paymentMethod] = map[o.paymentMethod] || { count: 0, sum: 0 };
      map[o.paymentMethod].count++;
      map[o.paymentMethod].sum += o.total;
    });
    return map;
  }

  /* ========================================================================
     GRAFICE SVG (fara dependente)
     ======================================================================== */
  function svgBar(data, opts) {
    opts = opts || {};
    var W = 900, H = 260, padL = 62, padR = 14, padT = 16, padB = 46;
    var cw = W - padL - padR, ch = H - padT - padB;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    max = niceCeil(max);
    var bw = cw / data.length;
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var y = padT + ch - (ch * g / 4);
      var val = max * g / 4;
      grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e6eaef" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#7f8c9b">' + shortNum(val) + '</text>';
    }
    var bars = data.map(function (d, i) {
      var h = (d.value / max) * ch;
      var x = padL + i * bw + bw * 0.18;
      var w = bw * 0.64;
      var y = padT + ch - h;
      var label = d.label.length > 6 ? d.label.slice(-5) : d.label;
      return '<g><title>' + U.esc(d.label) + ': ' + shortNum(d.value) + '</title>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + Math.max(h, 0) + '" rx="3" fill="' + (d.color || '#27ae60') + '">' +
        '<animate attributeName="height" from="0" to="' + Math.max(h, 0) + '" dur="0.4s" fill="freeze"/>' +
        '<animate attributeName="y" from="' + (padT + ch) + '" to="' + y + '" dur="0.4s" fill="freeze"/></rect>' +
        '<text x="' + (x + w / 2) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="10" fill="#7f8c9b">' + U.esc(label) + '</text></g>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' + grid + bars +
      '<line x1="' + padL + '" y1="' + (padT + ch) + '" x2="' + (W - padR) + '" y2="' + (padT + ch) + '" stroke="#c8d0d8"/></svg>';
  }

  function svgLine(data, opts) {
    opts = opts || {};
    var W = 900, H = 260, padL = 62, padR = 14, padT = 16, padB = 46;
    var cw = W - padL - padR, ch = H - padT - padB;
    if (data.length < 2) return '<p class="muted small">Perioada prea scurta pentru grafic liniar (minim 2 zile).</p>';
    var max = niceCeil(Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1])));
    var step = cw / (data.length - 1);
    var pts = data.map(function (d, i) {
      return [padL + i * step, padT + ch - (d.value / max) * ch];
    });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = path + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (padT + ch) + ' L' + pts[0][0].toFixed(1) + ' ' + (padT + ch) + ' Z';
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var y = padT + ch - (ch * g / 4);
      grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e6eaef"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#7f8c9b">' + shortNum(max * g / 4) + '</text>';
    }
    var labels = data.map(function (d, i) {
      if (data.length > 12 && i % Math.ceil(data.length / 10) !== 0) return '';
      return '<text x="' + (padL + i * step) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="10" fill="#7f8c9b">' +
        U.esc(d.label.slice(-5)) + '</text>';
    }).join('');
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#2c3e50"><title>' +
        U.esc(data[i].label) + ': ' + shortNum(data[i].value) + '</title></circle>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' + grid +
      '<path d="' + area + '" fill="rgba(39,174,96,.14)"/>' +
      '<path d="' + path + '" fill="none" stroke="#27ae60" stroke-width="2.5"/>' + dots + labels + '</svg>';
  }

  function niceCeil(v) {
    if (v <= 0) return 10;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / pow) * pow;
  }
  function shortNum(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
    return Math.round(v).toString();
  }

  /* ========================================================================
     RANDARE TOATE SECTIUNILE
     ======================================================================== */
  function renderAll() {
    var r = range();
    var all = finalOrders();
    var inRange = all.filter(function (o) { return between(o, r.from, r.to); });

    renderDashboard(all, inRange, r);
    renderDay(inRange);
    renderPeriod(inRange, r);
    renderOperators(inRange);
    renderStock();
  }

  /* ---------------- DASHBOARD (KPI) ---------------- */
  function renderDashboard(all, inRange, r) {
    var now = new Date();
    var monthFrom = U.dateISO(new Date(now.getFullYear(), now.getMonth(), 1));
    var monthTo = U.dateISO(now);
    var month = all.filter(function (o) { return between(o, monthFrom, monthTo); });
    var ms = summarize(month);

    var cancelled = App.Coll.orders().filter(function (o) { return o.status === 'cancelled' && between(o, monthFrom, monthTo); });
    var failRate = (ms.count + cancelled.length) ? (cancelled.length / (ms.count + cancelled.length) * 100) : 0;

    document.getElementById('kpiMonthSales').textContent = U.money(ms.sales, S.currency);
    document.getElementById('kpiMonthTx').textContent = ms.count;
    document.getElementById('kpiClients').textContent = ms.count;
    document.getElementById('kpiFail').textContent = failRate.toFixed(1) + '%';
    document.getElementById('kpiAvg').textContent = U.money(ms.avg, S.currency);
    document.getElementById('kpiItems').textContent = U.num(ms.items, 0);
    document.getElementById('kpiVat').textContent = U.money(ms.vat, S.currency);
    document.getElementById('kpiMonthRange').textContent = U.fmtDate(monthFrom) + ' – ' + U.fmtDate(monthTo);

    // Grafic vanzari zilnice (luna curenta)
    var days = byDay(month, monthFrom, monthTo);
    document.getElementById('chartMonth').innerHTML = svgBar(days.map(function (d) {
      return { label: d.date.slice(5), value: d.sales };
    }));

    // Top 10 produse luna
    document.getElementById('topMonth').innerHTML = topTable(topProducts(month, 10));

    // Metodi de plata (luna)
    document.getElementById('payMonth').innerHTML = payBars(byPayment(month));
  }

  function topTable(list) {
    if (!list.length) return '<div class="empty-state"><span class="big">📈</span>Nicio vanzare in perioada selectata.</div>';
    return '<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Produs</th><th class="num">Cant.</th><th class="num">Incasari</th></tr></thead><tbody>' +
      list.map(function (p, i) {
        return '<tr><td>' + (i + 1) + '</td><td data-label="Produs"><b>' + U.esc(p.name) + '</b><br><span class="small muted">' + U.esc(p.sku || '') + '</span></td>' +
          '<td class="num" data-label="Cant">' + U.num(p.qty, 2) + '</td>' +
          '<td class="num strong" data-label="Incasari">' + U.money(p.revenue, S.currency) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function payBars(map) {
    var keys = Object.keys(map);
    if (!keys.length) return '<p class="muted small">Nicio tranzactie.</p>';
    var max = Math.max.apply(null, keys.map(function (k) { return map[k].sum; }));
    var colors = { cash: '#27ae60', card: '#2980b9', check: '#8e44ad', voucher: '#f39c12' };
    return keys.map(function (k) {
      var pct = max ? (map[k].sum / max * 100) : 0;
      return '<div class="mb-2"><div class="spread small"><b>' + (PAY_LABEL[k] || k) + '</b>' +
        '<span class="mono">' + U.money(map[k].sum, S.currency) + ' · ' + map[k].count + ' tranz.</span></div>' +
        '<div style="height:10px;background:#eceff1;border-radius:5px;overflow:hidden;margin-top:4px">' +
        '<div style="width:' + pct.toFixed(1) + '%;height:100%;background:' + (colors[k] || '#2c3e50') + ';transition:width 200ms ease-in-out"></div></div></div>';
    }).join('');
  }

  /* ---------------- RAPORT ZI ---------------- */
  function renderDay() {
    var today = U.dateISO();
    var todays = finalOrders().filter(function (o) { return U.dateISO(o.createdAt) === today; });
    var s = summarize(todays);

    document.getElementById('dayDate').textContent = U.fmtDate(today);
    document.getElementById('daySales').textContent = U.money(s.sales, S.currency);
    document.getElementById('dayTx').textContent = s.count;
    document.getElementById('dayAvg').textContent = U.money(s.avg, S.currency);
    document.getElementById('dayVat').textContent = U.money(s.vat, S.currency);
    document.getElementById('dayItems').textContent = U.num(s.items, 0);
    document.getElementById('dayDisc').textContent = U.money(s.discount, S.currency);

    document.getElementById('dayTop').innerHTML = topTable(topProducts(todays, 10));
    document.getElementById('dayPay').innerHTML = payBars(byPayment(todays));

    // Detalii pe ore de lucru
    var hours = {};
    todays.forEach(function (o) {
      var h = new Date(o.createdAt).getHours();
      hours[h] = (hours[h] || 0) + o.total;
    });
    var start = parseInt((S.workdayStart || '08:00').split(':')[0], 10);
    var end = parseInt((S.workdayEnd || '20:00').split(':')[0], 10);
    var arr = [];
    for (var h = start; h <= Math.max(end, 23); h++) arr.push({ label: h + ':00', value: Math.round((hours[h] || 0) * 100) / 100 });
    document.getElementById('dayChart').innerHTML = arr.length > 1 ? svgBar(arr, {}) : '';

    // Lista tranzactii
    var body = document.getElementById('dayOrders');
    body.innerHTML = todays.length ? todays.slice(0, 60).map(function (o) {
      return '<tr><td data-label="Chitanta"><span class="mono">' + U.esc(o.number) + '</span></td>' +
        '<td data-label="Ora">' + U.fmtTime(o.createdAt) + '</td>' +
        '<td data-label="Operator">' + U.esc(o.operatorName) + '</td>' +
        '<td data-label="Produse" class="num">' + o.items.length + '</td>' +
        '<td data-label="Plata">' + (PAY_LABEL[o.paymentMethod] || o.paymentMethod) + '</td>' +
        '<td data-label="Total" class="num strong">' + U.money(o.total, S.currency) + '</td></tr>';
    }).join('') : '<tr><td colspan="6"><div class="empty-state">Nicio vanzare azi.</div></td></tr>';
  }

  /* ---------------- RAPORT PERIOADA ---------------- */
  function renderPeriod(orders, r) {
    var s = summarize(orders);
    document.getElementById('perRange').textContent = U.fmtDate(r.from) + ' – ' + U.fmtDate(r.to);
    document.getElementById('perSales').textContent = U.money(s.sales, S.currency);
    document.getElementById('perTx').textContent = s.count;
    document.getElementById('perAvg').textContent = U.money(s.avg, S.currency);
    document.getElementById('perVat').textContent = U.money(s.vat, S.currency);
    document.getElementById('perDisc').textContent = U.money(s.discount, S.currency);

    var days = byDay(orders, r.from, r.to);
    var type = document.getElementById('chartType').value;
    document.getElementById('periodChart').innerHTML = (type === 'line' ? svgLine : svgBar)(days.map(function (d) {
      return { label: d.date.slice(5), value: d.sales };
    }));

    document.getElementById('periodTop').innerHTML = topTable(topProducts(orders, 10));
    document.getElementById('periodPay').innerHTML = payBars(byPayment(orders));

    document.getElementById('periodTable').innerHTML =
      '<thead><tr><th>Data</th><th class="num">Tranzactii</th><th class="num">Vanzari</th><th class="num">Medie cos</th></tr></thead><tbody>' +
      days.map(function (d) {
        return '<tr><td data-label="Data">' + U.fmtDate(d.date) + '</td>' +
          '<td class="num" data-label="Tranzactii">' + d.count + '</td>' +
          '<td class="num" data-label="Vanzari">' + U.money(d.sales, S.currency) + '</td>' +
          '<td class="num" data-label="Medie">' + U.money(d.count ? d.sales / d.count : 0, S.currency) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  /* ---------------- RAPORT OPERATOR ---------------- */
  function renderOperators(orders) {
    var users = App.Coll.users();
    var rows = users.map(function (u) {
      var mine = orders.filter(function (o) { return o.operatorId === u.id; });
      var s = summarize(mine);
      return {
        user: u, count: s.count, sales: s.sales, avg: s.avg,
        items: s.items,
        share: orders.length ? (s.count / orders.length * 100) : 0
      };
    }).filter(function (r) { return r.count > 0 || r.user.active; })
      .sort(function (a, b) { return b.sales - a.sales; });

    document.getElementById('operatorTable').innerHTML =
      '<thead><tr><th>Operator</th><th class="num">Tranzactii</th><th class="num">Produse</th><th class="num">Medie cos</th><th class="num">Vanzari</th><th class="num">Ponderea</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        return '<tr><td data-label="Operator"><div class="row"><span class="avatar">' + U.esc(U.initials(r.user.name)) + '</span>' +
          '<div><b>' + U.esc(r.user.name) + '</b><br><span class="small muted">' + U.esc(App.ROLE_LABELS[r.user.role] || '') + '</span></div></div></td>' +
          '<td class="num" data-label="Tranzactii">' + r.count + '</td>' +
          '<td class="num" data-label="Produse">' + U.num(r.items, 0) + '</td>' +
          '<td class="num" data-label="Medie">' + U.money(r.avg, S.currency) + '</td>' +
          '<td class="num strong" data-label="Vanzari">' + U.money(r.sales, S.currency) + '</td>' +
          '<td class="num" data-label="Ponderea">' + r.share.toFixed(1) + '%</td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="empty-state">Nicio activitate in perioada.</div></td></tr>') + '</tbody>';

    document.getElementById('operatorChart').innerHTML = svgBar(rows.filter(function (r) { return r.sales > 0; }).slice(0, 10).map(function (r) {
      return { label: r.user.name.split(' ')[0], value: r.sales, color: '#2c3e50' };
    }));
  }

  /* ---------------- RAPORT STOC ---------------- */
  function renderStock() {
    var prods = App.Coll.products();
    var cats = App.Coll.categories();
    var totalValue = prods.reduce(function (s, p) { return s + p.price * p.stock; }, 0);
    var totalUnits = prods.reduce(function (s, p) { return s + p.stock; }, 0);
    var low = prods.filter(function (p) { return p.stock <= (p.minStock || S.stockAlertThreshold); });
    var out = prods.filter(function (p) { return p.stock <= 0; });

    document.getElementById('stockValue').textContent = U.money(totalValue, S.currency);
    document.getElementById('stockUnits').textContent = U.num(totalUnits, 0);
    document.getElementById('stockLow').textContent = low.length;
    document.getElementById('stockOut').textContent = out.length;

    document.getElementById('lowStockTable').innerHTML =
      '<thead><tr><th>Produs</th><th>SKU</th><th class="num">Stoc</th><th class="num">Minim</th><th class="num">De comandat</th><th class="num">Valoare</th></tr></thead><tbody>' +
      (low.length ? low.map(function (p) {
        var need = Math.max(0, (p.minStock || S.stockAlertThreshold) * 2 - p.stock);
        return '<tr><td data-label="Produs">' + U.productThumb(p, 26) + ' ' + U.esc(p.name) + '</td>' +
          '<td data-label="SKU" class="mono small">' + U.esc(p.sku) + '</td>' +
          '<td class="num" data-label="Stoc"><span class="badge ' + (p.stock <= 0 ? 'badge-danger' : 'badge-warning') + '">' + p.stock + '</span></td>' +
          '<td class="num" data-label="Minim">' + (p.minStock || S.stockAlertThreshold) + '</td>' +
          '<td class="num" data-label="Comandat">' + U.num(need, 0) + '</td>' +
          '<td class="num" data-label="Valoare">' + U.money(p.price * p.stock, S.currency) + '</td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="empty-state"><span class="big">✅</span>Niciun produs sub stocul minim.</div></td></tr>') + '</tbody>';

    // Valoare stoc pe categorii
    var byCat = {};
    cats.forEach(function (c) { byCat[c.id] = { name: c.name, value: 0, units: 0, count: 0 }; });
    prods.forEach(function (p) {
      if (!byCat[p.category]) byCat[p.category] = { name: 'Fara categorie', value: 0, units: 0, count: 0 };
      byCat[p.category].value += p.price * p.stock;
      byCat[p.category].units += p.stock;
      byCat[p.category].count++;
    });
    var arr = Object.keys(byCat).map(function (k) { return byCat[k]; });
    document.getElementById('stockCatTable').innerHTML =
      '<thead><tr><th>Categorie</th><th class="num">Produse</th><th class="num">Unitati</th><th class="num">Valoare</th></tr></thead><tbody>' +
      arr.map(function (c) {
        return '<tr><td data-label="Categorie"><b>' + U.esc(c.name) + '</b></td>' +
          '<td class="num" data-label="Produse">' + c.count + '</td>' +
          '<td class="num" data-label="Unitati">' + U.num(c.units, 0) + '</td>' +
          '<td class="num" data-label="Valoare">' + U.money(c.value, S.currency) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  document.getElementById('chartType') && document.getElementById('chartType').addEventListener('change', function () {
    var r = range();
    var orders = finalOrders().filter(function (o) { return between(o, r.from, r.to); });
    renderPeriod(orders, r);
  });

  /* ========================================================================
     EXPORT CSV
     ======================================================================== */
  function logExport(name, n) {
    App.log('report.export', 'Export CSV ' + name + ' (' + n + ' linii).');
    U.toast('Fisier CSV descarcat.', 'success');
  }

  function csvDay() {
    var today = U.dateISO();
    var list = finalOrders().filter(function (o) { return U.dateISO(o.createdAt) === today; });
    var rows = list.map(function (o) {
      return [o.number, U.fmtDateTime(o.createdAt), o.operatorName, o.items.length,
      o.subtotal, o.vatAmount, o.total, PAY_LABEL[o.paymentMethod] || o.paymentMethod];
    });
    U.download('raport-zi-' + today + '.csv',
      U.toCSV(['Chitanta', 'Data', 'Operator', 'Produse', 'Subtotal', 'TVA', 'Total', 'Metoda plata'], rows), 'text/csv;charset=utf-8');
    logExport('raport zi', rows.length);
  }

  function csvPeriod() {
    var r = range();
    var days = byDay(finalOrders().filter(function (o) { return between(o, r.from, r.to); }), r.from, r.to);
    var rows = days.map(function (d) {
      return [U.fmtDate(d.date), d.count, d.sales, d.count ? Math.round(d.sales / d.count * 100) / 100 : 0];
    });
    U.download('raport-perioada-' + r.from + '_' + r.to + '.csv',
      U.toCSV(['Data', 'Tranzactii', 'Vanzari', 'Medie cos'], rows), 'text/csv;charset=utf-8');
    logExport('raport perioada', rows.length);
  }

  function csvOperator() {
    var r = range();
    var orders = finalOrders().filter(function (o) { return between(o, r.from, r.to); });
    var rows = App.Coll.users().map(function (u) {
      var mine = orders.filter(function (o) { return o.operatorId === u.id; });
      var s = summarize(mine);
      return [u.name, App.ROLE_LABELS[u.role] || '', s.count, U.num(s.items, 0), s.avg, s.sales];
    });
    U.download('raport-operatori-' + U.dateISO() + '.csv',
      U.toCSV(['Operator', 'Rol', 'Tranzactii', 'Produse', 'Medie cos', 'Vanzari'], rows), 'text/csv;charset=utf-8');
    logExport('raport operatori', rows.length);
  }

  function csvStock() {
    var cats = App.Coll.categories();
    var rows = App.Coll.products().map(function (p) {
      var c = cats.filter(function (x) { return x.id === p.category; })[0];
      return [p.sku, p.name, c ? c.name : '', p.stock, p.minStock || S.stockAlertThreshold,
      p.price, Math.round(p.price * p.stock * 100) / 100,
      p.stock <= (p.minStock || S.stockAlertThreshold) ? 'SUB MINIM' : 'OK'];
    });
    U.download('raport-stoc-' + U.dateISO() + '.csv',
      U.toCSV(['SKU', 'Produs', 'Categorie', 'Stoc', 'Stoc minim', 'Pret', 'Valoare stoc', 'Alerta'], rows), 'text/csv;charset=utf-8');
    logExport('raport stoc', rows.length);
  }

  /* ========================================================================
     EXPORT PDF (print)
     ======================================================================== */
  function printSection(id) {
    var src = document.getElementById(id);
    if (!src) return;
    var host = document.getElementById('printArea');
    host.innerHTML =
      '<div style="font-family:Segoe UI,sans-serif">' +
      '<h2 style="margin:0">' + U.esc(S.companyName) + ' — Raport</h2>' +
      '<p style="margin:4px 0 16px;color:#666">Generat la ' + U.fmtDateTime(new Date()) +
      ' de ' + U.esc((App.Session.currentUser() || {}).name || '-') + '</p>' +
      src.innerHTML + '</div>';
    document.body.classList.add('printing');
    App.log('report.export', 'Export PDF (print) pentru sectiunea: ' + id + '.');
    setTimeout(function () {
      window.print();
      document.body.classList.remove('printing');
    }, 120);
  }
})();
