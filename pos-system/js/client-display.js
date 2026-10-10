/* ==========================================================================
   client-display.js — ECRANUL CLIENT (telefon 540x960)
   Primeste in timp real cosul de la ecranul operator si afiseaza
   produsele, subtotalul, TVA, totalul, metoda de plata si mesajul final.
   Nu necesita autentificare (afisaj public, doar citire).
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var Sync = window.Sync;

  var lastMsg = 0;
  var thanksTimer = null;
  var cur = null; // ultima stare primita

  document.addEventListener('DOMContentLoaded', function () {
    Sync.init();

    // Mesaje de la ecranul operator
    Sync.on(Sync.M.CART, function (p) { lastMsg = Date.now(); render(p); });
    Sync.on(Sync.M.PAYMENT, function (p) { lastMsg = Date.now(); if (p.payment) setPayment(p.payment); });
    Sync.on(Sync.M.DONE, function (p) { lastMsg = Date.now(); showThanks(p); });
    Sync.on(Sync.M.CLEAR, function () { lastMsg = Date.now(); clearItems(); });

    // Daca pagina se deschide dupa ce cosul a fost deja incarcat,
    // preia ultima stare salvata in localStorage
    var saved = Sync.loadState();
    if (saved && saved.items) {
      render(saved);
      // Daca starea e foarte veche, afisam ecranul de asteptare
      if (Date.now() - saved.ts > 10 * 60 * 1000) clearItems();
    }

    // Indicator de conexiune: fara mesaj de 8 secunde = "in asteptare"
    setInterval(function () {
      var el = document.getElementById('connState');
      var fresh = lastMsg && (Date.now() - lastMsg < 8000);
      var r = (typeof Sync.relayStatus === 'function') ? Sync.relayStatus() : 'disabled';

      if (r === 'open') {
        el.classList.toggle('ok', true);
        el.textContent = fresh ? '● conectat (relay)' : '● relay OK · astept comanda';
      } else if (r === 'connecting') {
        el.classList.toggle('ok', false);
        el.textContent = '● reconectare relay…';
      } else {
        // Fara relay (doar BroadcastChannel/localStorage, acelasi browser)
        el.classList.toggle('ok', !!fresh);
        el.textContent = fresh ? '● conectat' : 'in asteptare…';
      }
    }, 1000);

    // Solicita operatorului sa retrimita cosul (daca e deschis in alt tab / alt dispozitiv)
    Sync.publish(Sync.M.HELLO, {});
  });

  /* ========================================================================
     RANDARE COS
     ======================================================================== */
  function render(state) {
    cur = state;
    var cur0 = state.currency || 'RON';

    document.getElementById('cCompany').textContent = state.company || 'Magazin';
    document.getElementById('cOperator').textContent = 'Operator: ' + (state.operator || '—');

    var host = document.getElementById('cItems');
    if (!state.items || !state.items.length) { clearItems(); }
    else {
      host.innerHTML = state.items.map(function (i) {
        var pic = i.image
          ? '<img src="' + U.esc(i.image) + '" alt="">'
          : '<span style="display:grid;place-items:center;width:100%;height:100%;background:' + U.esc(i.color || '#34495e') + ';border-radius:6px">' + U.esc(i.emoji || '📦') + '</span>';
        return '<div class="client-item">' +
          '<div class="pic">' + pic + '</div>' +
          '<div class="txt"><b>' + U.esc(i.name) + '</b>' +
          '<span>' + U.num(i.qty, i.qty % 1 === 0 ? 0 : 2) + ' × ' + U.money(i.price, cur0) + '</span></div>' +
          '<div class="sum"><div class="p">' + U.money(i.line, cur0) + '</div>' +
          '<div class="q">subtotal linie</div></div></div>';
      }).join('');
    }

    document.getElementById('cSubtotal').textContent = U.money(state.subtotal, cur0);
    document.getElementById('cVat').textContent = U.money(state.vat, cur0);
    document.getElementById('cVatLabel').textContent = 'TVA ' + Math.round((state.vatRate || 0.19) * 100) + '%';
    document.getElementById('cTotal').textContent = U.money(state.total, cur0);

    var discRow = document.getElementById('cDiscRow');
    if (state.discount > 0) {
      discRow.style.display = '';
      document.getElementById('cDiscount').textContent = '− ' + U.money(state.discount, cur0);
    } else {
      discRow.style.display = 'none';
    }

    setPayment(state.payment);
  }

  function setPayment(p) {
    if (!p) return;
    var el = document.getElementById('cPay');
    el.innerHTML = (p.icon || '💵') + ' Metoda de plata: <b>' + U.esc(p.label) + '</b>';
  }

  function clearItems() {
    document.getElementById('cItems').innerHTML =
      '<div class="client-waiting"><span class="big">🛒</span>' +
      '<p>Se pregateste comanda…<br><span class="small">Produsele vor aparea aici pe masura ce sunt scanate.</span></p></div>';
    ['cSubtotal', 'cVat', 'cTotal'].forEach(function (id) {
      document.getElementById(id).textContent = U.money(0, (cur && cur.currency) || 'RON');
    });
    document.getElementById('cDiscRow').style.display = 'none';
  }

  /* ========================================================================
     MESAJ FINAL DUPA PLATA
     ======================================================================== */
  function showThanks(p) {
    var cur0 = p.currency || (cur && cur.currency) || 'RON';
    document.getElementById('tReceiptNo').textContent = p.number || '';
    document.getElementById('tThanksTotal').textContent = U.money(p.total, cur0) +
      (p.payment ? ' · ' + (p.payment.icon || '') + ' ' + p.payment.label : '');
    document.getElementById('tThanksHint').textContent = p.change > 0
      ? 'Rest de returnat: ' + U.money(p.change, cur0) + ' — Va mai asteptam! 🎉'
      : 'Va mai asteptam cu drag! 🎉';

    var scr = document.getElementById('thanksScreen');
    scr.classList.add('show');
    clearTimeout(thanksTimer);
    // Revine automat la ecranul de asteptare dupa 8 secunde
    thanksTimer = setTimeout(function () {
      scr.classList.remove('show');
      clearItems();
    }, 8000);
  }
})();
