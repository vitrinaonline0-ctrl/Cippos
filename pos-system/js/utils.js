/* ==========================================================================
   utils.js — Functii auxiliare: formatare, hash parole, CSV, toast, modale
   ========================================================================== */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* Escape HTML — previne XSS la randarea datelor din localStorage */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 200);
    };
  }

  function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

  /* ------------------------------------------------------------------------
     Formatare (locale RO)
     ------------------------------------------------------------------------ */
  var _moneyFmt = null;
  function money(n, currency) {
    var cur = currency || 'RON';
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    try {
      if (!_moneyFmt || _moneyFmt.__cur !== cur) {
        _moneyFmt = new Intl.NumberFormat('ro-RO', { style: 'currency', currency: cur });
        _moneyFmt.__cur = cur;
      }
      return _moneyFmt.format(v);
    } catch (e) {
      return v.toFixed(2) + ' ' + cur;
    }
  }

  function num(n, dec) {
    var v = Number(n) || 0;
    return v.toLocaleString('ro-RO', { minimumFractionDigits: dec === undefined ? 2 : dec, maximumFractionDigits: dec === undefined ? 2 : dec });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function dateISO(d) {
    var x = d ? new Date(d) : new Date();
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return fmtDate(iso) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* ------------------------------------------------------------------------
     Identificatori
     ------------------------------------------------------------------------ */
  function uid(prefix) {
    var s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return (prefix ? prefix + '-' : '') + s;
  }

  /* ------------------------------------------------------------------------
     HASH PAROLE — SHA-256 + salt (Web Crypto API)
     Necesita context securizat (HTTPS sau localhost). Netlify serveste HTTPS.
     Fallback: SHA-256 implementat in JS pentru medii non-securizate.
     ------------------------------------------------------------------------ */
  function randomSalt(len) {
    len = len || 16;
    var arr = new Uint8Array(len);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(arr, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /* SHA-256 in JS pur (folosit doar daca crypto.subtle lipseste) */
  function sha256Fallback(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow, maxWord = mathPow(2, 32), lengthProperty = 'length';
    var i, j, result = '';
    var words = [], asciiBitLength = ascii[lengthProperty] * 8;
    var hash = sha256Fallback.h = sha256Fallback.h || [];
    var k = sha256Fallback.k = sha256Fallback.k || [];
    var primeCounter = k[lengthProperty];
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return ''; // doar ASCII
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
    words[words[lengthProperty]] = (asciiBitLength);
    for (j = 0; j < words[lengthProperty];) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function subtleAvailable() {
    return !!(global.crypto && global.crypto.subtle && typeof global.crypto.subtle.digest === 'function');
  }

  /* Hash async: returneaza { hash, algo } */
  function hashPassword(password, salt) {
    var payload = String(salt || '') + '::' + String(password || '');
    if (subtleAvailable()) {
      var enc = new TextEncoder().encode(payload);
      return global.crypto.subtle.digest('SHA-256', enc).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      }).then(function (h) { return { hash: h, algo: 'sha256' }; })
        .catch(function () { return { hash: sha256Fallback(payload), algo: 'sha256-js' }; });
    }
    return Promise.resolve({ hash: sha256Fallback(payload), algo: 'sha256-js' });
  }

  /* ------------------------------------------------------------------------
     CSV — generare si parsare
     ------------------------------------------------------------------------ */
  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",;\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(headers, rows) {
    var out = [headers.map(csvCell).join(',')];
    rows.forEach(function (r) { out.push(r.map(csvCell).join(',')); });
    return '\uFEFF' + out.join('\r\n'); // BOM pentru diacritice in Excel
  }

  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', inQuotes = false;
    var sep = text.indexOf(';') > text.indexOf(',') && text.indexOf(',') === -1 ? ';' : ',';
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.join('').trim() !== ''; });
  }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 300);
  }

  /* ------------------------------------------------------------------------
     Normalizare text pentru cautare (ignora diacriticele)
     ------------------------------------------------------------------------ */
  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  /* ------------------------------------------------------------------------
     Notificari (toast)
     ------------------------------------------------------------------------ */
  function toast(msg, type, ms) {
    var host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    var icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
    t.innerHTML = '<span>' + icon + '</span><span>' + esc(msg) + '</span>';
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('hide');
      setTimeout(function () { t.remove(); }, 220);
    }, ms || 3200);
  }

  /* ------------------------------------------------------------------------
     Dialog de confirmare (Promise)
     ------------------------------------------------------------------------ */
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'modal-backdrop show';
      back.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        '  <div class="modal-head"><h3>' + esc(opts.title || 'Confirmare') + '</h3></div>' +
        '  <div class="modal-body">' + (opts.html || '<p>' + esc(opts.message || 'Sigur continui?') + '</p>') + '</div>' +
        '  <div class="modal-foot">' +
        '    <button class="btn btn-outline" data-act="no">' + esc(opts.cancelText || 'Anuleaza') + '</button>' +
        '    <button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-success') + '" data-act="yes">' + esc(opts.okText || 'Confirma') + '</button>' +
        '  </div>' +
        '</div>';
      document.body.appendChild(back);
      var done = function (v) { back.remove(); resolve(v); };
      back.querySelector('[data-act="yes"]').onclick = function () { done(true); };
      back.querySelector('[data-act="no"]').onclick = function () { done(false); };
      back.addEventListener('click', function (e) { if (e.target === back) done(false); });
      setTimeout(function () { back.querySelector('[data-act="yes"]').focus(); }, 50);
    });
  }

  /* ------------------------------------------------------------------------
     Modale simple (deschidere/inchidere prin id)
     ------------------------------------------------------------------------ */
  function openModal(id) {
    var m = document.getElementById(id);
    if (m) { m.classList.add('show'); document.body.style.overflow = 'hidden'; }
  }
  function closeModal(id) {
    var m = document.getElementById(id);
    if (m) { m.classList.remove('show'); document.body.style.overflow = ''; }
  }

  /* ------------------------------------------------------------------------
     Imagine produs: imagine base64 sau emoji pe fundal colorat
     ------------------------------------------------------------------------ */
  function productThumb(p, size) {
    size = size || 34;
    if (p.image) {
      return '<img class="thumb" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" style="width:' + size + 'px;height:' + size + 'px">';
    }
    var bg = p.color || '#2c3e50';
    return '<span class="thumb" style="width:' + size + 'px;height:' + size + 'px;background:' + esc(bg) + ';color:#fff;font-size:' + Math.round(size * 0.55) + 'px">' + esc(p.emoji || '📦') + '</span>';
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  /* ------------------------------------------------------------------------
     Export
     ------------------------------------------------------------------------ */
  global.Utils = {
    qs: qs, qsa: qsa, esc: esc, debounce: debounce, clamp: clamp,
    money: money, num: num, dateISO: dateISO,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtTime: fmtTime,
    uid: uid, randomSalt: randomSalt, hashPassword: hashPassword, subtleAvailable: subtleAvailable,
    toCSV: toCSV, parseCSV: parseCSV, download: download, normalize: normalize,
    toast: toast, confirmDialog: confirmDialog, openModal: openModal, closeModal: closeModal,
    productThumb: productThumb, initials: initials
  };
})(window);
