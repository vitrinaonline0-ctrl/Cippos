/* ==========================================================================
   app.js — MANAGEMENTUL STĂRII (state management)
   ----------------------------------------------------------------------------
   Responsabilitati:
     • Store   : citire/scriere localStorage + backup automat in IndexedDB
     • Seed    : incarcare date demo la prima rulare (din /data/*.json)
     • Permisiuni pe roluri (admin / manager / operator / viewer)
     • Sesiune : login state, timeout automat 15 minute, log de activitate
     • Shell   : header + navigare comuna, guard de autentificare
   ========================================================================== */

(function (global) {
  'use strict';

  var U = global.Utils;

  /* ========================================================================
     1. CHEI DE STOCARE
     ======================================================================== */
  var KEYS = {
    users: 'pos.users',
    products: 'pos.products',
    categories: 'pos.categories',
    vouchers: 'pos.vouchers',
    orders: 'pos.orders',
    activity: 'pos.activity',
    settings: 'pos.settings',
    session: 'pos.session',
    cart: 'pos.cart',
    initialized: 'pos.initialized',
    seq: 'pos.seq'
  };

  /* ========================================================================
     2. STORE — localStorage primar, IndexedDB backup
     ======================================================================== */
  var Store = {
    /* Citeste o valoare. Daca localStorage e gol dar exista backup in IDB,
       il restaureaza (util dupa curatarea cache-ului). */
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.warn('[Store] Eroare la citirea ' + key, e);
        return fallback;
      }
    },

    /* Scrie in localStorage si programa backup in IndexedDB (debounced) */
    set: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        Store._scheduleBackup(key, value);
        Store._notify(key);
      } catch (e) {
        // Cel mai frecvent: quota depasita din cauza imaginilor base64
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          U.toast('Stocare locala plina! Sterge imaginile vechi sau exporta un backup.', 'error', 6000);
        } else {
          console.error('[Store] Eroare la scriere', e);
        }
      }
    },

    remove: function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
      if (global.POSDB) global.POSDB.del(key).catch(function () { });
      Store._notify(key);
    },

    /* Backup diferat (250ms) ca sa nu scriem in IDB la fiecare tastare */
    _backupQueue: {},
    _scheduleBackup: function (key, value) {
      clearTimeout(Store._backupQueue[key]);
      Store._backupQueue[key] = setTimeout(function () {
        if (global.POSDB) {
          global.POSDB.set(key, value).catch(function (e) {
            console.warn('[Store] Backup IDB esuat pentru ' + key, e);
          });
        }
      }, 250);
    },

    /* Notifica celelalte tab-uri (folosit de sync.js si de ecranul client) */
    _notify: function (key) {
      try {
        global.dispatchEvent(new CustomEvent('pos:store', { detail: { key: key } }));
      } catch (e) { /* browsere vechi */ }
    },

    /* Restoreaza din IndexedDB tot ce lipseste din localStorage */
    restoreFromIDB: function () {
      if (!global.POSDB) return Promise.resolve(false);
      var keys = Object.keys(KEYS).map(function (k) { return KEYS[k]; });
      return global.POSDB.keys().then(function (idbKeys) {
        var missing = keys.filter(function (k) {
          return localStorage.getItem(k) === null && idbKeys.indexOf(k) !== -1;
        });
        if (!missing.length) return false;
        return Promise.all(missing.map(function (k) {
          return global.POSDB.get(k).then(function (v) {
            if (v !== null && v !== undefined) localStorage.setItem(k, JSON.stringify(v));
          });
        })).then(function () {
          console.info('[Store] Restaurat din IndexedDB:', missing.join(', '));
          return true;
        });
      }).catch(function () { return false; });
    }
  };

  /* ========================================================================
     3. SETARI IMPLICITE
     ======================================================================== */
  var DEFAULT_SETTINGS = {
    companyName: 'Magazinul Central SRL',
    fiscalCode: 'RO12345678',
    address: 'Str. Stefan cel Mare nr. 12, Iasi',
    phone: '0232 123 456',
    currency: 'RON',
    vatRate: 0.19,               // TVA 19%
    pricesIncludeVat: false,     // false = preturile sunt fara TVA (subtotal + TVA = total)
    workdayStart: '08:00',
    workdayEnd: '20:00',
    receiptPrefix: 'CH',
    sessionTimeoutMin: 15,       // timeout automat sesiune
    stockAlertEnabled: true,
    stockAlertThreshold: 10,
    showClientDisplay: true,
    lowStockNotifyRoles: ['admin', 'manager']
  };

  /* ========================================================================
     4. PERMISIUNI PE ROLURI
     ======================================================================== */
  var ROLE_LABELS = {
    admin: 'Administrator',
    manager: 'Manager',
    operator: 'Operator',
    viewer: 'Vizualizare'
  };

  var ROLE_PERMS = {
    admin: ['*'],
    manager: [
      'pos.*', 'products.*', 'reports.*',
      'settings.view', 'settings.edit',
      'operators.view'
    ],
    operator: ['pos.sale', 'pos.discount', 'pos.suspend', 'pos.pay', 'pos.cancel', 'products.view'],
    viewer: ['reports.view']
  };

  /* Verifica daca utilizatorul are o anumita permisiune */
  function can(user, perm) {
    if (!user) return false;
    var list = ROLE_PERMS[user.role] || [];
    if (list.indexOf('*') !== -1) return true;
    if (list.indexOf(perm) !== -1) return true;
    // potrivire cu wildcard pe segment: 'products.*' acopera 'products.edit'
    var seg = perm.split('.');
    return list.indexOf(seg[0] + '.*') !== -1;
  }

  /* ========================================================================
     5. SEMINTE (date demo) — minim de rezerva daca /data/*.json nu se incarca
     ======================================================================== */
  var FALLBACK = {
    categories: [{ id: 'cat-general', name: 'General' }],
    products: [
      { id: 'p-fb1', sku: 'GEN-001', barcode: '5941234099990', name: 'Produs demo', price: 10, category: 'cat-general', stock: 100, minStock: 10, unit: 'buc', emoji: '📦', color: '#2c3e50', active: true }
    ],
    vouchers: [{ code: 'DEMO10', type: 'percent', value: 10, active: true, description: 'Voucher demo' }],
    users: [{ id: 'u-admin', name: 'Administrator', email: 'admin@local', username: 'admin', password: 'admin123', role: 'admin', active: true }]
  };

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* Creeaza un utilizator cu parola hash-uita (nu stocam niciodata in clar) */
  function makeUser(u) {
    var salt = U.randomSalt(16);
    return U.hashPassword(u.password, salt).then(function (h) {
      return {
        id: u.id || U.uid('u'),
        name: u.name,
        email: u.email || '',
        username: (u.username || '').toLowerCase().trim(),
        passwordHash: h.hash,
        salt: salt,
        algo: h.algo,
        role: u.role || 'operator',
        active: u.active !== false,
        phone: u.phone || '',
        createdAt: u.createdAt || new Date().toISOString(),
        lastLogin: null
      };
    });
  }

  /* ========================================================================
     6. INITIALIZARE APLICATIE
     ======================================================================== */
  function init() {
    return Store.restoreFromIDB()
      .then(function (restored) {
        if (Store.get(KEYS.initialized)) return restored ? 'restored' : 'ready';
        return seed().then(function () { return 'seeded'; });
      })
      .then(function (status) {
        // Asigura ca setarile au toate campurile (compatibilitate versiuni)
        var s = Object.assign({}, DEFAULT_SETTINGS, Store.get(KEYS.settings, {}));
        Store.set(KEYS.settings, s);
        return status;
      });
  }

  function seed() {
    return Promise.all([
      fetchJSON('data/sample-products.json').catch(function () { return FALLBACK; }),
      fetchJSON('data/sample-operators.json').catch(function () { return { users: FALLBACK.users }; })
    ]).then(function (res) {
      var pdata = res[0] && res[0].products ? res[0] : FALLBACK;
      var odata = res[1] && res[1].users ? res[1] : { users: FALLBACK.users };

      var now = Date.now();
      var products = (pdata.products || FALLBACK.products).map(function (p, i) {
        return Object.assign({ active: true, createdAt: new Date(now - i * 86400000).toISOString() }, p);
      });

      Store.set(KEYS.categories, pdata.categories || FALLBACK.categories);
      Store.set(KEYS.products, products);
      Store.set(KEYS.vouchers, pdata.vouchers || FALLBACK.vouchers);
      Store.set(KEYS.settings, Object.assign({}, DEFAULT_SETTINGS));
      Store.set(KEYS.orders, []);
      Store.set(KEYS.activity, []);

      return Promise.all((odata.users || FALLBACK.users).map(makeUser))
        .then(function (users) {
          Store.set(KEYS.users, users);
          Store.set(KEYS.initialized, { at: new Date().toISOString(), version: 1 });
          Store.set(KEYS.activity, [{
            id: U.uid('log'), ts: new Date().toISOString(),
            userId: 'system', userName: 'Sistem',
            action: 'system.seed', details: 'Baza de date initializata cu date demo (' + products.length + ' produse, ' + users.length + ' utilizatori).'
          }]);
          console.info('[App] Seed complet:', products.length, 'produse,', users.length, 'utilizatori');
        });
    });
  }

  /* Resetare completa la datele demo */
  function resetAll() {
    var keys = Object.keys(KEYS).map(function (k) { return KEYS[k]; });
    keys.forEach(function (k) { Store.remove(k); });
    if (global.POSDB) return global.POSDB.clear().then(seed);
    return seed();
  }

  /* ========================================================================
     7. COLECTII (accesori CRUD generici)
     ======================================================================== */
  var Coll = {
    users: function () { return Store.get(KEYS.users, []); },
    products: function () { return Store.get(KEYS.products, []); },
    categories: function () { return Store.get(KEYS.categories, []); },
    vouchers: function () { return Store.get(KEYS.vouchers, []); },
    orders: function () { return Store.get(KEYS.orders, []); },
    activity: function () { return Store.get(KEYS.activity, []); },
    settings: function () { return Object.assign({}, DEFAULT_SETTINGS, Store.get(KEYS.settings, {})); }
  };

  /* ========================================================================
     8. JURNAL DE ACTIVITATE (audit log)
     ======================================================================== */
  var MAX_LOG = 1000;

  function log(action, details, userOverride) {
    var u = userOverride || Session.currentUser();
    var entry = {
      id: U.uid('log'),
      ts: new Date().toISOString(),
      userId: u ? u.id : 'anonymous',
      userName: u ? u.name : 'Neautentificat',
      role: u ? u.role : '-',
      action: action,
      details: details || ''
    };
    var list = Coll.activity();
    list.unshift(entry);
    if (list.length > MAX_LOG) list = list.slice(0, MAX_LOG);
    Store.set(KEYS.activity, list);
    return entry;
  }

  var ACTION_LABELS = {
    'auth.login': 'Autentificare',
    'auth.logout': 'Deconectare',
    'auth.timeout': 'Sesiune expirata',
    'auth.failed': 'Autentificare esuata',
    'pos.sale': 'Vanzare finalizata',
    'pos.cancel': 'Comanda anulata',
    'pos.suspend': 'Comanda suspendata',
    'pos.resume': 'Comanda reluata',
    'pos.discount': 'Discount aplicat',
    'product.create': 'Produs adaugat',
    'product.update': 'Produs modificat',
    'product.delete': 'Produs sters',
    'product.import': 'Import CSV produse',
    'operator.create': 'Operator creat',
    'operator.update': 'Operator modificat',
    'operator.delete': 'Operator sters',
    'operator.resetpwd': 'Parola resetata',
    'operator.toggle': 'Cont activat/dezactivat',
    'settings.update': 'Setari modificate',
    'settings.backup': 'Backup exportat',
    'settings.restore': 'Backup restaurat',
    'report.export': 'Raport exportat',
    'system.seed': 'Initializare',
    'system.reset': 'Resetare date'
  };

  /* ========================================================================
     9. SESIUNE + TIMEOUT AUTOMAT
     ======================================================================== */
  var Session = {
    _timer: null,
    _touchTimer: null,

    current: function () { return Store.get(KEYS.session, null); },

    currentUser: function () {
      var s = this.current();
      if (!s) return null;
      var u = Coll.users().filter(function (x) { return x.id === s.userId; })[0];
      return u && u.active ? u : null;
    },

    isLoggedIn: function () {
      var s = this.current();
      if (!s) return false;
      if (Date.now() > s.expiresAt) { this.destroy(true); return false; }
      return !!this.currentUser();
    },

    start: function (user) {
      var timeout = (Coll.settings().sessionTimeoutMin || 15) * 60 * 1000;
      var now = Date.now();
      Store.set(KEYS.session, {
        userId: user.id,
        loginAt: now,
        lastActivity: now,
        expiresAt: now + timeout,
        timeoutMs: timeout
      });
      this._bindActivity();
      this._startTicker();
    },

    /* Prelungeste sesiunea la fiecare interactiune a utilizatorului */
    touch: function () {
      var s = this._lastSession || this.current();
      if (!s) return;
      var now = Date.now();
      s.lastActivity = now;
      s.expiresAt = now + (s.timeoutMs || (Coll.settings().sessionTimeoutMin || 15) * 60000);
      this._lastSession = s;
      // Actualizare imediata in memorie (pentru cronometru) si scriere diferata
      // in localStorage, ca sa nu uzam mediul de stocare la fiecare clic.
      try { localStorage.setItem(KEYS.session, JSON.stringify(s)); } catch (e) { /* quota */ }
      clearTimeout(this._touchTimer);
      this._touchTimer = setTimeout(function () { Store.set(KEYS.session, s); }, 200);
    },

    remainingMs: function () {
      var s = this._lastSession || this.current();
      return s ? Math.max(0, s.expiresAt - Date.now()) : 0;
    },

    /* Asculta evenimentele de interactiune pentru a reseta timeout-ul */
    _bindActivity: function () {
      if (this._bound) return;
      this._bound = true;
      var self = this;
      var handler = U.debounce(function () { self.touch(); }, 1000);
      ['click', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, handler, { passive: true });
      });
    },

    /* Cronometru vizibil + deconectare automata */
    _startTicker: function () {
      var self = this;
      clearInterval(this._timer);
      this._timer = setInterval(function () {
        var el = document.getElementById('sessionTimer');
        var ms = self.remainingMs();
        if (el) {
          var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
          el.textContent = '⏱ ' + m + ':' + String(s).padStart(2, '0');
          el.classList.toggle('warn', ms < 60000);
        }
        if (ms <= 0) self.expire();
      }, 1000);
    },

    expire: function () {
      var u = this.currentUser();
      log('auth.timeout', 'Sesiunea a expirat automat (inactivitate).', u);
      this.destroy();
      U.toast('Sesiunea a expirat din cauza inactivitatii.', 'warning', 5000);
      setTimeout(function () {
        global.location.href = 'index.html?reason=timeout';
      }, 1200);
    },

    destroy: function (silent) {
      clearInterval(this._timer);
      clearTimeout(this._touchTimer);
      this._bound = false;
      this._lastSession = null;
      Store.remove(KEYS.session);
      if (!silent) {
        try { global.dispatchEvent(new CustomEvent('pos:logout')); } catch (e) { }
      }
    }
  };

  /* ========================================================================
     10. GUARD DE AUTENTIFICARE + SHELL (header/nav)
     ======================================================================== */
  var NAV = [
    { href: 'pos.html', label: 'Vanzare', icon: '🛒', perm: 'pos.sale' },
    { href: 'products.html', label: 'Produse', icon: '📦', perm: 'products.view' },
    { href: 'operators.html', label: 'Operatori', icon: '👥', perm: 'operators.view' },
    { href: 'reports.html', label: 'Rapoarte', icon: '📊', perm: 'reports.view' },
    { href: 'settings.html', label: 'Setari', icon: '⚙️', perm: 'settings.view' }
  ];

  /* Verifica accesul; redirecteaza la login daca e cazul */
  function requireAuth(perm) {
    if (!Session.isLoggedIn()) {
      global.location.replace('index.html?reason=expired');
      return null;
    }
    var u = Session.currentUser();
    if (perm && !can(u, perm)) {
      U.toast('Nu ai permisiuni pentru aceasta sectiune.', 'error');
      setTimeout(function () { global.history.back(); }, 900);
      return null;
    }
    return u;
  }

  /* Randare header comun */
  function renderHeader(activeHref) {
    var host = document.getElementById('appHeader');
    if (!host) return;
    var u = Session.currentUser();
    if (!u) return;
    var s = Coll.settings();

    var navHtml = NAV.filter(function (n) { return can(u, n.perm); }).map(function (n) {
      return '<a href="' + n.href + '" class="' + (n.href === activeHref ? 'active' : '') + '">' +
        '<span class="nav-ico">' + n.icon + '</span><span class="nav-label">' + n.label + '</span></a>';
    }).join('');

    host.innerHTML =
      '<div class="brand"><span class="brand-mark">₺</span><span>POS System<small>' + U.esc(s.companyName) + '</small></span></div>' +
      '<nav class="main-nav">' + navHtml + '</nav>' +
      '<div class="header-right">' +
      '  <a href="client-display.html" target="_blank" class="btn btn-sm btn-outline" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.25)" title="Deschide ecranul client">📱 <span class="nav-label">Ecran client</span></a>' +
      '  <span id="netStatus" class="net-status"><span class="dot"></span>Online</span>' +
      '  <span id="sessionTimer" class="session-timer">⏱ 15:00</span>' +
      '  <div class="user-chip"><span class="avatar">' + U.esc(U.initials(u.name)) + '</span>' +
      '    <span class="meta"><b>' + U.esc(u.name) + '</b><span>' + U.esc(ROLE_LABELS[u.role] || u.role) + '</span></span></div>' +
      '  <button class="btn btn-sm btn-danger" id="btnLogout" title="Deconectare">Iesire</button>' +
      '</div>';

    var btn = document.getElementById('btnLogout');
    if (btn) btn.addEventListener('click', function () {
      U.confirmDialog({
        title: 'Deconectare',
        message: 'Sigur vrei sa inchizi sesiunea curenta?',
        okText: 'Da, ies'
      }).then(function (ok) {
        if (!ok) return;
        log('auth.logout', 'Deconectare manuala.');
        Session.destroy();
        global.location.href = 'index.html';
      });
    });

    Session._startTicker();
    Session.touch();
    watchNetwork();
  }

  /* Indicator online / offline */
  function watchNetwork() {
    var el = document.getElementById('netStatus');
    if (!el) return;
    function upd() {
      var on = navigator.onLine;
      el.classList.toggle('offline', !on);
      el.innerHTML = '<span class="dot"></span>' + (on ? 'Online' : 'Offline');
    }
    upd();
    global.addEventListener('online', upd);
    global.addEventListener('offline', upd);
  }

  /* ========================================================================
     11. NUMAR DE CHITANTA
     ======================================================================== */
  function nextReceiptNumber() {
    var s = Coll.settings();
    var today = U.dateISO();
    var compact = today.replace(/-/g, '');
    var seqKey = KEYS.seq + '.' + compact;
    var n = (Store.get(seqKey, 0) || 0) + 1;
    Store.set(seqKey, n);
    return (s.receiptPrefix || 'CH') + '-' + compact + '-' + String(n).padStart(4, '0');
  }

  /* ========================================================================
     12. EXPORT
     ======================================================================== */
  global.App = {
    KEYS: KEYS,
    Store: Store,
    Coll: Coll,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    ROLE_LABELS: ROLE_LABELS,
    ROLE_PERMS: ROLE_PERMS,
    ACTION_LABELS: ACTION_LABELS,
    NAV: NAV,
    can: can,
    init: init,
    seed: seed,
    resetAll: resetAll,
    makeUser: makeUser,
    log: log,
    Session: Session,
    requireAuth: requireAuth,
    renderHeader: renderHeader,
    watchNetwork: watchNetwork,
    nextReceiptNumber: nextReceiptNumber,
    version: '1.0.0'
  };
})(window);
