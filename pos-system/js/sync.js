/* ==========================================================================
   sync.js — Sincronizare in timp real intre ECRANUL OPERATOR si ECRANUL CLIENT
   ----------------------------------------------------------------------------
   Transport 1: BroadcastChannel (aceeasi origine, tab-uri diferite) — rapid
   Transport 2: localStorage + evenimentul "storage" — fallback universal
   Transport 3: WebSocket relay (server dedicat) — FUNCTIONEAZA CROSS-DISPOZITIV
               (ex: laptopul operator + telefonul client pe retele diferite)

   Toate cele 3 transporturi sunt active in paralel. Pentru dispozitive
   diferite e necesar Transport 3 (relay). Vezi server/relay-server.js.
   ========================================================================== */

(function (global) {
  'use strict';

  /* 🔧 CONFIG: seteaza aici daca nu folosesti pagina de Setari.
     Lasă relayUrl gol ('') pentru a dezactiva relay-ul (ramane BC+localStorage,
     adică doar tab-uri din acelasi browser). */
  var CHANNEL = 'pos-sync-channel';
  var LS_KEY = 'pos.sync.bus';
  var LS_RELAY_URL = 'pos.relayUrl';     // overlay runtime (setat din Setari)
  var LS_RELAY_ROOM = 'pos.relayRoom';   // overlay runtime (setat din Setari)

  var bc = null;
  var listeners = {};
  var _ready = false;

  /* --- Transport 3: Relay WebSocket --- */
  var ws = null;
  var wsUrl = '';
  var wsRoom = 'default';
  var wsOpen = false;
  var wsClosedByUs = false;
  var wsPersistent = true;     // true = reconecteaza la infinit; false = incearca o data (auto same-origin)
  var wsRetry = 0;
  var wsReconnectTimer = null;
  var relayStatusCbs = [];

  /* ========================================================================
     INIT
     ======================================================================== */
  function init() {
    if (_ready) return;
    _ready = true;

    if (typeof global.BroadcastChannel === 'function') {
      bc = new global.BroadcastChannel(CHANNEL);
      bc.onmessage = function (ev) { receive(ev.data); };
    }

    global.addEventListener('storage', function (ev) {
      if (ev.key !== LS_KEY || !ev.newValue) return;
      try { receive(JSON.parse(ev.newValue)); } catch (e) { /* ignora */ }
    });

    // Porneste relay-ul daca e configurat
    autoConnect();
  }

  /* ========================================================================
     TRIMITERE MESAJ (toate transporturile)
     ======================================================================== */
  function publish(type, payload) {
    if (!_ready) init();
    var msg = { type: type, payload: payload || {}, ts: Date.now(), room: currentRoom() };

    if (bc) { try { bc.postMessage(msg); } catch (e) { } }
    try { localStorage.setItem(LS_KEY, JSON.stringify(msg)); } catch (e) { }

    relaySend(msg);
  }

  /* ========================================================================
     PRIMIRE MESAJ
     ======================================================================== */
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

  /* ========================================================================
     MESAJE STANDARD
     ======================================================================== */
  var M = {
    CART: 'cart:update',
    PAYMENT: 'payment:select',
    DONE: 'payment:done',
    CLEAR: 'cart:clear',
    HELLO: 'client:hello',     // clientul cere operatorului sa retrimita cosul
    PING: 'sync:ping',
    PONG: 'sync:pong'
  };

  /* Starea curenta a cosului — salvata pentru ecrane deschise ulterior */
  var STATE_KEY = 'pos.clientState';
  function saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(Object.assign({ ts: Date.now() }, state))); } catch (e) { }
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { return null; }
  }

  /* ========================================================================
     CONFIG RELAY (din Setari sau localStorage overlay)
     ======================================================================== */
  function readCfg() {
    var lsUrl = null, lsRoom = null;
    try { lsUrl = localStorage.getItem(LS_RELAY_URL); lsRoom = localStorage.getItem(LS_RELAY_ROOM); } catch (e) { }

    if (lsUrl && lsUrl.trim()) {
      return { url: lsUrl.trim(), room: sanitize((lsRoom || 'default').trim() || 'default') };
    }
    var app = (global.App && global.App.Coll && global.App.Coll.settings) ? global.App.Coll.settings() : null;
    if (app && app.relayUrl && app.relayUrl.trim()) {
      return { url: app.relayUrl.trim(), room: sanitize((app.relayRoom || 'default').trim() || 'default') };
    }
    return { url: '', room: 'default' };
  }

  function currentRoom() {
    if (wsUrl) return wsRoom;
    return readCfg().room || 'default';
  }

  function autoConnect() {
    var c = readCfg();
    if (c.url) { connectRelay(c.url, c.room, true); return; }
    // Fara relay configurat -> incearca relay-ul de pe ACEEASI origine
    // (serverul combinat local serveste simultan static + WebSocket).
    var same = autoRelayUrl();
    if (same) connectRelay(same, c.room, false);
  }

  /* URL-ul relay-ului de pe aceeasi origine (ex: ws://localhost:8080/) */
  function autoRelayUrl() {
    try {
      if (!global.location || !global.location.host) return '';
      var proto = (global.location.protocol === 'https:') ? 'wss:' : 'ws:';
      return proto + '//' + global.location.host + '/';
    } catch (e) { return ''; }
  }

  /* Seteaza relay-ul din pagina de Setari (persista in localStorage + reconnect) */
  function configure(url, room) {
    try { localStorage.setItem(LS_RELAY_URL, (url || '').trim()); } catch (e) { }
    try { localStorage.setItem(LS_RELAY_ROOM, (room || 'default').trim()); } catch (e) { }
    wsRoom = sanitize((room || 'default').trim() || 'default');
    if (url && url.trim()) connectRelay(url.trim(), wsRoom);
    else disconnectRelay();
    return relayStatus();
  }

  function sanitize(r) {
    r = (r || '').trim().slice(0, 64);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(r)) return 'default';
    return r;
  }

  /* ========================================================================
     RELAY WEBSOCKET
     ======================================================================== */
  function connectRelay(url, room, persistent) {
    wsPersistent = (persistent !== false);
    if (typeof global.WebSocket === 'undefined') return;
    if (!/^wss?:\/\//i.test(url)) { console.warn('[Sync] relayUrl invalid:', url); return; }

    wsRoom = room || 'default';
    if (ws && (ws.readyState === global.WebSocket.OPEN || ws.readyState === global.WebSocket.CONNECTING) && wsUrl === url) {
      return; // deja conectat la acelasi URL
    }
    wsUrl = url;
    if (ws) { try { ws.close(); } catch (e) { } }
    openWs();
  }

  function openWs() {
    if (typeof global.WebSocket === 'undefined') return;
    wsClosedByUs = false;
    try { ws = new global.WebSocket(wsUrl); }
    catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () {
      wsOpen = true; wsRetry = 0; emitRelayStatus('open');
      // (Re)alătură camera și cere ultima stare (util pentru clientul nou conectat)
      relaySend({ type: M.HELLO, payload: {}, ts: Date.now(), room: wsRoom });
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.type) receive(m);
    };
    ws.onclose = function () {
      wsOpen = false;
      if (!wsClosedByUs && wsPersistent) { emitRelayStatus('closed'); scheduleReconnect(); }
      else emitRelayStatus('disabled');
    };
    ws.onerror = function () { try { ws.close(); } catch (e) { } };
  }

  function relaySend(msg) {
    if (!ws || ws.readyState !== global.WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(msg)); } catch (e) { }
  }

  function scheduleReconnect() {
    if (wsClosedByUs) return;
    wsRetry = Math.min(wsRetry + 1, 6);
    var delay = Math.min(1000 * Math.pow(2, wsRetry - 1), 15000) + Math.floor(Math.random() * 500);
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(function () { if (!wsClosedByUs) openWs(); }, delay);
  }

  function disconnectRelay() {
    wsClosedByUs = true;
    clearTimeout(wsReconnectTimer);
    if (ws) { try { ws.close(); } catch (e) { } }
    ws = null; wsUrl = ''; wsOpen = false;
    emitRelayStatus('disabled');
  }

  function relayStatus() {
    if (!wsUrl) return 'disabled';
    if (wsOpen) return 'open';
    return wsPersistent ? 'connecting' : 'disabled';
  }

  function onRelayStatus(cb) { relayStatusCbs.push(cb); }
  function emitRelayStatus(s) {
    relayStatusCbs.forEach(function (cb) { try { cb(s, wsUrl); } catch (e) { } });
  }

  /* ========================================================================
     API PUBLICĂ
     ======================================================================== */
  global.Sync = {
    init: init,
    publish: publish,
    on: on,
    M: M,
    saveState: saveState,
    loadState: loadState,
    supported: function () { return typeof global.BroadcastChannel === 'function'; },
    /* Relay */
    configure: configure,
    connectRelay: connectRelay,
    disconnectRelay: disconnectRelay,
    relayStatus: relayStatus,
    onRelayStatus: onRelayStatus
  };
})(window);
