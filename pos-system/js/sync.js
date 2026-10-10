/* ==========================================================================
   sync.js — Sincronizare in timp real intre ECRANUL OPERATOR si ECRANUL CLIENT
   ----------------------------------------------------------------------------
   Transport 1: BroadcastChannel (aceeasi origine, tab-uri diferite) — rapid
   Transport 2: localStorage + evenimentul "storage" — fallback universal
   Functioneaza complet offline, fara server.
   ========================================================================== */

(function (global) {
  'use strict';

  var CHANNEL = 'pos-sync-channel';
  var LS_KEY = 'pos.sync.bus';
  var bc = null;
  var listeners = {};
  var _ready = false;

  /* --- Initializare transporturi --- */
  function init() {
    if (_ready) return;
    _ready = true;

    if (typeof global.BroadcastChannel === 'function') {
      bc = new global.BroadcastChannel(CHANNEL);
      bc.onmessage = function (ev) { receive(ev.data); };
    }

    // Fallback / redundanta pentru browsere fara BroadcastChannel
    global.addEventListener('storage', function (ev) {
      if (ev.key !== LS_KEY || !ev.newValue) return;
      try { receive(JSON.parse(ev.newValue)); } catch (e) { /* ignora */ }
    });
  }

  /* --- Trimitere mesaj catre celelalte ecrane --- */
  function publish(type, payload) {
    if (!_ready) init();
    var msg = { type: type, payload: payload || {}, ts: Date.now() };
    if (bc) { try { bc.postMessage(msg); } catch (e) { } }
    // Scriem si in localStorage ca sa prinda tab-urile deschise mai tarziu
    try { localStorage.setItem(LS_KEY, JSON.stringify(msg)); } catch (e) { }
  }

  /* --- Primire mesaj --- */
  function receive(msg) {
    if (!msg || !msg.type) return;
    (listeners[msg.type] || []).forEach(function (fn) {
      try { fn(msg.payload, msg); } catch (e) { console.error('[Sync]', e); }
    });
    (listeners['*'] || []).forEach(function (fn) {
      try { fn(msg.payload, msg); } catch (e) { }
    });
  }

  function on(type, fn) {
    if (!_ready) init();
    listeners[type] = listeners[type] || [];
    listeners[type].push(fn);
  }

  /* --- Mesaje standard ale sistemului --- */
  var M = {
    CART: 'cart:update',       // cos actualizat (produse, totaluri)
    PAYMENT: 'payment:select', // metoda de plata aleasa
    DONE: 'payment:done',      // plata finalizata
    CLEAR: 'cart:clear',       // cos golit / comanda anulata
    PING: 'sync:ping',         // verificare conexiune
    PONG: 'sync:pong'
  };

  /* Starea curenta a cosului — se salveaza pentru ecrane deschise ulterior */
  var STATE_KEY = 'pos.clientState';
  function saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(Object.assign({ ts: Date.now() }, state))); } catch (e) { }
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { return null; }
  }

  global.Sync = {
    init: init, publish: publish, on: on, M: M,
    saveState: saveState, loadState: loadState,
    supported: function () { return typeof global.BroadcastChannel === 'function'; }
  };
})(window);
