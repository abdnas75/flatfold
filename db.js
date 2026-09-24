/* ============================================================
   FlatFold — IndexedDB layer for document drafts
   Stores full documents (pages as JPEG data URLs) locally only.
   ============================================================ */
(function () {
  'use strict';

  var DB_NAME = 'flatfold-db';
  var DB_VERSION = 1;
  var STORE = 'docs';

  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var FlatFoldDB = {
    putDoc: function (doc) {
      return tx('readwrite', function (store) {
        store.put(doc);
      });
    },
    getDoc: function (id) {
      return tx('readonly', function (store) {
        return store.get(id);
      });
    },
    getAllDocs: function () {
      return tx('readonly', function (store) {
        return store.getAll();
      });
    },
    deleteDoc: function (id) {
      return tx('readwrite', function (store) {
        store.delete(id);
      });
    },
    clear: function () {
      return tx('readwrite', function (store) {
        store.clear();
      });
    }
  };

  window.FlatFoldDB = FlatFoldDB;
})();