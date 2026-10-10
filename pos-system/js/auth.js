/* ==========================================================================
   auth.js — Autentificare, validare client-side, gestionare sesiune de login
   ========================================================================== */

(function () {
  'use strict';

  var U = window.Utils;
  var App = window.App;

  /* Limite de validare */
  var MAX_ATTEMPTS = 5;
  var LOCK_MS = 60 * 1000; // blocare 1 minut dupa 5 incercari esuate

  var els = {};

  document.addEventListener('DOMContentLoaded', function () {
    els = {
      form: document.getElementById('loginForm'),
      user: document.getElementById('username'),
      pass: document.getElementById('password'),
      show: document.getElementById('showPass'),
      btn: document.getElementById('btnLogin'),
      alert: document.getElementById('loginAlert'),
      demo: document.getElementById('demoAccounts'),
      status: document.getElementById('bootStatus')
    };

    // Daca exista deja o sesiune valida, intra direct in aplicatie
    App.init().then(function (status) {
      if (els.status) els.status.remove();
      if (status === 'seeded') console.info('[Auth] Date demo instalate.');
      if (App.Session.isLoggedIn()) {
        var u = App.Session.currentUser();
        redirectFor(u);
        return;
      }
      bindUI();
      var reason = new URLSearchParams(location.search).get('reason');
      if (reason === 'timeout') show('Sesiunea a expirat dupa 15 minute de inactivitate.', 'warning');
      if (reason === 'expired') show('Te rugam sa te autentifici.', 'info');
      if (els.user) els.user.focus();
    }).catch(function (e) {
      console.error(e);
      show('Eroare la initializarea aplicatiei: ' + e.message, 'error');
    });
  });

  function bindUI() {
    els.form.addEventListener('submit', onSubmit);

    if (els.show) {
      els.show.addEventListener('change', function () {
        els.pass.type = els.show.checked ? 'text' : 'password';
      });
    }

    // Butoane demo — completeaza automat campurile
    if (els.demo) {
      els.demo.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-user]');
        if (!b) return;
        els.user.value = b.dataset.user;
        els.pass.value = b.dataset.pass;
        els.pass.focus();
      });
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    hide();

    var username = (els.user.value || '').trim().toLowerCase();
    var password = els.pass.value || '';

    /* --- Validari client-side --- */
    if (!username) return fail(els.user, 'Introdu numele de utilizator.');
    if (username.length < 3) return fail(els.user, 'Numele de utilizator are minim 3 caractere.');
    if (!password) return fail(els.pass, 'Introdu parola.');
    if (password.length < 6) return fail(els.pass, 'Parola are minim 6 caractere.');

    /* --- Protectie impotriva fortarii parolei --- */
    var guard = App.Store.get('pos.loginGuard', { count: 0, until: 0 });
    if (guard.until && Date.now() < guard.until) {
      var sec = Math.ceil((guard.until - Date.now()) / 1000);
      show('Prea multe incercari esuate. Reincearca in ' + sec + ' secunde.', 'error');
      return;
    }

    els.btn.disabled = true;
    els.btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:3px"></span> Se verifica...';

    var users = App.Coll.users();
    var user = users.filter(function (x) {
      return x.username === username || String(x.email).toLowerCase() === username;
    })[0];

    if (!user) {
      App.log('auth.failed', 'Incercare cu utilizator inexistent: ' + username, null);
      return rejectAttempt('Utilizator sau parola incorecte.');
    }

    if (!user.active) {
      App.log('auth.failed', 'Incercare cu cont dezactivat: ' + username, null);
      return rejectAttempt('Contul este dezactivat. Contacteaza administratorul.');
    }

    // Verificarea parolei: SHA-256(salt + parola) comparat cu hash-ul stocat
    U.hashPassword(password, user.salt).then(function (res) {
      if (res.hash !== user.passwordHash) {
        App.log('auth.failed', 'Parola gresita pentru: ' + username, null);
        return rejectAttempt('Utilizator sau parola incorecte.');
      }
      // Autentificare reusita
      App.Store.set('pos.loginGuard', { count: 0, until: 0 });

      var idx = users.findIndex(function (x) { return x.id === user.id; });
      users[idx].lastLogin = new Date().toISOString();
      App.Store.set(App.KEYS.users, users);

      App.log('auth.login', 'Autentificare reusita (rol: ' + App.ROLE_LABELS[user.role] + ').', user);
      App.Session.start(user);

      show('Bine ai venit, ' + user.name + '!', 'success');
      setTimeout(function () { redirectFor(user); }, 450);
    }).catch(function (err) {
      console.error(err);
      els.btn.disabled = false;
      els.btn.textContent = 'Autentificare';
      show('Eroare tehnica la verificarea parolei.', 'error');
    });
  }

  function rejectAttempt(msg) {
    var guard = App.Store.get('pos.loginGuard', { count: 0, until: 0 });
    guard.count = (guard.count || 0) + 1;
    if (guard.count >= MAX_ATTEMPTS) {
      guard.until = Date.now() + LOCK_MS;
      guard.count = 0;
      show('Prea multe incercari esuate. Contul de login e blocat 1 minut.', 'error', 5000);
    } else {
      show(msg + ' (incercari ramase: ' + (MAX_ATTEMPTS - guard.count) + ')', 'error');
    }
    App.Store.set('pos.loginGuard', guard);
    els.btn.disabled = false;
    els.btn.textContent = 'Autentificare';
    els.pass.value = '';
    els.pass.focus();
  }

  /* Redirectionare in functie de rol */
  function redirectFor(user) {
    var target = 'pos.html';
    if (user.role === 'viewer') target = 'reports.html';
    location.href = target;
  }

  function fail(input, msg) {
    if (input) {
      input.classList.add('invalid');
      setTimeout(function () { input.classList.remove('invalid'); }, 2000);
      input.focus();
    }
    show(msg, 'error');
  }

  function show(msg, type) {
    if (!els.alert) return;
    els.alert.className = 'login-alert show';
    els.alert.style.background = type === 'success' ? 'var(--success-soft)' : type === 'warning' ? 'var(--warning-soft)' : type === 'info' ? 'var(--info-soft)' : '';
    els.alert.style.color = type === 'success' ? 'var(--success-dark)' : type === 'warning' ? '#9c640c' : type === 'info' ? 'var(--info)' : '';
    els.alert.textContent = msg;
  }

  function hide() {
    if (els.alert) els.alert.classList.remove('show');
  }
})();
