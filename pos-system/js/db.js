/* ==========================================================================
   db.js — Strat de persistenta
   localStorage = sursa primara (rapid, sincron)
   IndexedDB    = backup rezilient (suprafata mare, imagini base64)
   ========================================================================== */

(function (global) {
  'use strict';

  var DB_NAME = 'pos_system_db';
  var DB_VERSION = 1;
  var STORE = 'kv';
  var _db = null;

  /* ------------------------------------------------------------------------
     Deschide (sau creeaza) baza IndexedDB
     ------------------------------------------------------------------------ */
  function open() {
    return new Promise(function (resolve, reject) {
      if (_db) return resolve(_db);
      if (!('indexedDB' in global)) return reject(new Error('IndexedDB indisponibil'));

      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return reject(e);
      }

      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = function (ev) { _db = ev.target.result; resolve(_db); };
      req.onerror = function (ev) { reject(ev.target.error || new Error('Eroare IndexedDB')); };
      req.onblocked = function () { reject(new Error('IndexedDB blocat de alt tab')); };
    });
  }

  /* ------------------------------------------------------------------------
     Operatii de baza pe IndexedDB
     ------------------------------------------------------------------------ */
  function tx(mode) {
    return open().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); });
  }

  function idbSet(key, value) {
    return tx('readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var r = store.put(value, key);
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbGet(key) {
    return tx('readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var r = store.get(key);
        r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbDel(key) {
    return tx('readwrite').then(function (store) {
      return new Promise(function (resolve) {
        var r = store.delete(key);
        r.onsuccess = r.onerror = function () { resolve(true); };
      });
    });
  }

  function idbKeys() {
    return tx('readonly').then(function (store) {
      return new Promise(function (resolve) {
        var r = store.getAllKeys();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      });
    });
  }

  function idbClear() {
    return tx('readwrite').then(function (store) {
      return new Promise(function (resolve) {
        var r = store.clear();
        r.onsuccess = r.onerror = function () { resolve(true); };
      });
    });
  }

  /* ------------------------------------------------------------------------
     Export public
     ------------------------------------------------------------------------ */
  global.POSDB = {
    available: function () { return 'indexedDB' in global; },
    open: open,
    set: idbSet,
    get: idbGet,
    del: idbDel,
    keys: idbKeys,
    clear: idbClear
  };
})(window);
