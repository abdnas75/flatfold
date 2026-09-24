/* ============================================================
   FlatFold — App shell: navigation, documents, capture, editor,
   pages, export, theming.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Basic helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function uid() {
    return 'ff-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function todayLabel() {
    var d = new Date();
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return 'Scan ' + mon + ' ' + d.getDate();
  }

  /* ---------------- State ---------------- */

  var docs = [];
  var localDirty = false;
  var currentDoc = null;

  /* ---------------- Views ---------------- */

  var viewIds = ['view-home', 'view-capture', 'view-editor', 'view-pages'];
  function showView(id) {
    viewIds.forEach(function (v) { $(v).hidden = (v !== id); });
    if (id === 'view-pages') renderPages();
    if (id === 'view-home') renderHome();
    window.scrollTo(0, 0);
    if (id === 'view-editor') setTimeout(FlatFoldEditor.placeHandles, 10);
  }

  /* ---------------- Image helpers ---------------- */

  function imgFromDataURL(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('Could not load image')); };
      im.src = src;
    });
  }

  function imgFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read ' + file.name)); };
      im.src = url;
    });
  }

  /* ---------------- Documents ---------------- */

  function makeDoc() {
    return { id: uid(), name: todayLabel(), createdAt: Date.now(), updatedAt: Date.now(), pages: [] };
  }

function ensureDoc() {
    if (!currentDoc) {
      currentDoc = makeDoc();
      localDirty = true;
      docs.unshift(currentDoc);
      FlatFoldDB.putDoc(currentDoc);
    }
    return currentDoc;
  }

  function saveDoc(docRef) {
    var doc = docRef || currentDoc;
    if (!doc) return;
    doc.updatedAt = Date.now();
    FlatFoldDB.putDoc(doc);
  }

function deleteDoc(id) {
    localDirty = true;
    docs = docs.filter(function (d) { return d.id !== id; });
    FlatFoldDB.deleteDoc(id);
    if (currentDoc && currentDoc.id === id) { currentDoc = null; }
    renderHome();
  }

  function removeCurrentIfEmpty() {
    if (currentDoc && currentDoc.pages.length === 0) {
      var id = currentDoc.id;
      localDirty = true;
      docs = docs.filter(function (d) { return d.id !== id; });
      FlatFoldDB.deleteDoc(id);
      currentDoc = null;
    }
  }

  /* ---------------- Home ---------------- */

  function renderHome() {
    var list = $('doc-list');
    var empty = $('doc-empty');
    list.innerHTML = '';
    docs.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    if (!docs.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    docs.forEach(function (doc) {
      var card = document.createElement('div');
      card.className = 'doc-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'Open ' + (doc.name || 'Scan'));

      var thumb = document.createElement('div');
      thumb.className = 'doc-thumb';
      if (doc.pages && doc.pages.length) {
        var img = document.createElement('img');
        img.className = 'doc-thumb';
        img.src = doc.pages[0].dataURL;
        img.alt = '';
        thumb = img;
      } else {
        thumb.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        thumb.classList.add('ph');
      }

      var meta = document.createElement('span');
      meta.className = 'doc-meta';

      var nm = document.createElement('p');
      nm.className = 'doc-name';
      nm.textContent = doc.name || 'Scan';

      var sub = document.createElement('p');
      sub.className = 'doc-sub';
      var n = doc.pages ? doc.pages.length : 0;
      var when = doc.updatedAt ? new Date(doc.updatedAt) : null;
      var whenTxt = when ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      sub.textContent = n + ' page' + (n === 1 ? '' : 's') + (whenTxt ? ' \u00b7 ' + whenTxt : '');

      meta.appendChild(nm);
      meta.appendChild(sub);

      var del = document.createElement('button');
      del.className = 'doc-delete';
      del.title = 'Delete document';
      del.setAttribute('aria-label', 'Delete document');
      del.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteDoc(doc.id);
      });

      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(del);
      card.addEventListener('click', function () {
        currentDoc = doc;
        showView('view-pages');
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          currentDoc = doc;
          showView('view-pages');
        }
      });

      list.appendChild(card);
    });
  }

  /* ---------------- Capture ---------------- */

  function openCamera() {
    showView('view-capture');
    FlatFoldCamera.start($('cam-video'), $('cam-overlay')).catch(function (err) {
      console.error(err);
      FlatFoldCamera.stop();
      toast('Camera unavailable. Use Import instead.');
      showView(currentDoc && currentDoc.pages.length ? 'view-pages' : 'view-home');
    });
  }

  function closeCamera() {
    FlatFoldCamera.stop();
    if (currentDoc && currentDoc.pages.length) showView('view-pages');
    else showView('view-home');
  }

  function onShutter() {
    var dataURL = FlatFoldCamera.grab();
    FlatFoldCamera.stop();
    if (currentDoc && currentDoc.pages.length === 0) {
      // new doc, fine
    }
imgFromDataURL(dataURL).then(function (image) {
      openEditor(image, 'enhance');
    }).catch(function () {
      toast('Could not capture frame');
      closeCamera();
    });
  }

  /* ---------------- Editor ---------------- */

  function openEditor(image, filter) {
    showView('view-editor');
    FlatFoldEditor.open(image, filter || 'original');
  }

  function cancelEditor() {
    removeCurrentIfEmpty();
    showView(currentDoc && currentDoc.pages.length ? 'view-pages' : 'view-home');
  }

  function savePageFromEditor() {
    FlatFoldEditor.save(function (page) {
      ensureDoc().pages.push(page);
      saveDoc();
      toast('Page added');
      showView('view-pages');
    });
  }

  /* ---------------- Import ---------------- */

  function processFiles(files) {
    if (!files || !files.length) return;
    var doc = ensureDoc();
    currentDoc = doc;
    showView('view-pages');
    var list = Array.prototype.slice.call(files).slice(0, 25);
    var i = 0;

    function next() {
      if (i >= list.length) {
        toast('Imported ' + list.length + ' page' + (list.length === 1 ? '' : 's'));
        renderPages();
        return;
      }
      toast('Processing ' + (i + 1) + '/' + list.length + '...');
      var f = list[i];
imgFromFile(f).then(function (im) {
        return FlatFoldEditor.process(im, 'enhance');
      }).then(function (page) {
        doc.pages.push(page);
        saveDoc(doc);
        i++;
        next();
      }).catch(function (e) {
        console.error(e);
        i++;
        next();
      });
    }
    next();
  }

  /* ---------------- Pages ---------------- */

  function renderPages() {
    if (!currentDoc) { showView('view-home'); return; }
    $('doc-name').value = currentDoc.name || 'Scan';
    var n = currentDoc.pages.length;
    $('doc-pages-count').textContent = n + ' page' + (n === 1 ? '' : 's');
    $('pages-empty').hidden = n > 0;

    var grid = $('pages-grid');
    grid.innerHTML = '';

    currentDoc.pages.forEach(function (page, idx) {
      var card = document.createElement('div');
      card.className = 'page-card';

      var wrap = document.createElement('div');
      wrap.className = 'page-thumb-wrap';
      var img = document.createElement('img');
      img.className = 'page-thumb';
      img.src = page.dataURL;
      img.alt = 'Page ' + (idx + 1);
      var num = document.createElement('span');
      num.className = 'page-num';
      num.textContent = idx + 1;
      wrap.appendChild(img);
      wrap.appendChild(num);

      var acts = document.createElement('div');
      acts.className = 'page-actions';

      function actBtn(html, label, fn) {
        var b = document.createElement('button');
        b.className = 'page-act';
        b.innerHTML = html;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
        return b;
      }

      acts.appendChild(actBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>', 'Move up', function () {
        if (idx > 0) {
          var t = currentDoc.pages[idx];
          currentDoc.pages[idx] = currentDoc.pages[idx - 1];
          currentDoc.pages[idx - 1] = t;
          saveDoc(); renderPages();
        }
      }));

      acts.appendChild(actBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>', 'Move down', function () {
        if (idx < currentDoc.pages.length - 1) {
          var t = currentDoc.pages[idx];
          currentDoc.pages[idx] = currentDoc.pages[idx + 1];
          currentDoc.pages[idx + 1] = t;
          saveDoc(); renderPages();
        }
      }));

      acts.appendChild(actBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>', 'Rotate clockwise', function () {
        rotateStored(page);
      }));

      acts.appendChild(actBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>', 'Download JPG', function () {
        var a = document.createElement('a');
        a.href = page.dataURL;
        a.download = (currentDoc.name || 'scan') + '-page-' + (idx + 1) + '.jpg';
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast('JPG downloaded');
      }));

      acts.appendChild(actBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', 'Delete page', function () {
        currentDoc.pages.splice(idx, 1);
        if (!currentDoc.pages.length) removeCurrentIfEmpty();
        saveDoc(); renderPages();
      }, 'danger'));

      card.appendChild(wrap);
      card.appendChild(acts);
      grid.appendChild(card);
    });
  }

  function rotateStored(page) {
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas');
      c.width = im.naturalHeight;
      c.height = im.naturalWidth;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
      c.toBlob(function (blob) {
        var r = new FileReader();
        r.onload = function () {
          page.dataURL = r.result;
          page.width = c.width;
          page.height = c.height;
          saveDoc();
          renderPages();
        };
        r.readAsDataURL(blob);
      }, 'image/jpeg', 0.88);
    };
    im.src = page.dataURL;
  }

  /* ---------------- Export ---------------- */

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportPDF() {
    if (!currentDoc || !currentDoc.pages.length) {
      toast('Add at least one page first');
      return;
    }
    toast('Building PDF...');
    setTimeout(function () {
      try {
        var blob = FlatFoldPDF.generate(currentDoc.pages);
        var name = (currentDoc.name || 'scan').replace(/[\\/:*?"<>|]/g, '-') + '.pdf';
        var file = new File([blob], name, { type: 'application/pdf' });
        if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).catch(function () { downloadBlob(blob, name); });
        } else {
          downloadBlob(blob, name);
        }
        toast('PDF ready');
      } catch (e) {
        console.error(e);
        toast('PDF failed. Try re-saving pages.');
      }
    }, 30);
  }

  /* ---------------- Theme ---------------- */

  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem('ff_theme', name); } catch (e) {}
    qsa('.theme-option').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-theme') === name);
    });
  }

  /* ---------------- Wiring ---------------- */

  function wire() {
    // Theme
    $('theme-toggle').addEventListener('click', function (e) {
      e.stopPropagation();
      $('theme-dropdown').classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.theme-picker')) $('theme-dropdown').classList.remove('open');
    });
    qsa('.theme-option').forEach(function (el) {
      el.addEventListener('click', function () {
        applyTheme(el.getAttribute('data-theme'));
        $('theme-dropdown').classList.remove('open');
      });
    });

    // Home
    $('new-scan-btn').addEventListener('click', openCamera);
    $('import-btn').addEventListener('click', function () { $('import-file-hidden').click(); });

    // Capture
    $('capture-close').addEventListener('click', closeCamera);
    $('shutter-btn').addEventListener('click', onShutter);
    $('cam-import-btn').addEventListener('click', function () { $('import-file-hidden').click(); });

    // File inputs
    function onFilesSelected(e) {
      processFiles(e.target.files);
      e.target.value = '';
    }
    $('import-file-hidden').addEventListener('change', onFilesSelected);

    // Editor
    var handles = qsa('.corner-handle');
    FlatFoldEditor.setupEditorUI($('editor-stage'), $('editor-canvas'), handles);
    handles.forEach(function (el) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var idx = parseInt(el.getAttribute('data-corner') || '0', 10);
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        FlatFoldEditor.beginDrag(idx, e.clientX, e.clientY);
      });
      el.addEventListener('pointermove', function (e) {
        if (e.buttons === 0) return;
        FlatFoldEditor.dragTo(e.clientX, e.clientY);
      });
      var endDrag = function () { FlatFoldEditor.endDrag(); };
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
    });

    $('editor-cancel').addEventListener('click', cancelEditor);
    $('editor-save').addEventListener('click', savePageFromEditor);
    $('rotate-btn').addEventListener('click', function () { FlatFoldEditor.rotate(); });
    $('auto-btn').addEventListener('click', function () {
      FlatFoldEditor.autoDetect();
      toast('Corners re-detected');
    });
    $('reset-btn').addEventListener('click', function () { FlatFoldEditor.resetCorners(); });
    qsa('.filter-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        qsa('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        FlatFoldEditor.selectFilter(chip.getAttribute('data-filter'));
      });
    });

    // Pages
    $('pages-back').addEventListener('click', function () { currentDoc = null; showView('view-home'); });
    $('export-btn').addEventListener('click', exportPDF);
    $('add-scan-btn').addEventListener('click', openCamera);
    $('add-import-btn').addEventListener('click', function () { $('import-file-hidden').click(); });
    $('doc-name').addEventListener('change', function (e) {
      if (currentDoc) {
        currentDoc.name = e.target.value || currentDoc.name;
        saveDoc();
      }
    });
$('clear-btn').addEventListener('click', function () {
      if (!docs.length) return;
      if (!confirm('Delete ALL documents? This cannot be undone.')) return;
      localDirty = true;
      docs = [];
      currentDoc = null;
      FlatFoldDB.clear();
      renderHome();
      toast('All documents deleted');
    });

    window.addEventListener('resize', function () { FlatFoldEditor.placeHandles(); });
    window.addEventListener('orientationchange', function () { setTimeout(FlatFoldEditor.placeHandles, 150); });
  }

  /* ---------------- Init ---------------- */

function init() {
    var savedTheme = 'dark';
    try {
      var raw = localStorage.getItem('ff_theme');
      // legacy 5-theme names -> dark/light
      if (raw === 'light' || raw === 'minimal' || raw === 'brutalist' || raw === 'clay') savedTheme = 'light';
      else if (raw === 'dark' || raw === 'liquid' || raw === 'skeuo') savedTheme = 'dark';
    } catch (e) {}
    applyTheme(savedTheme);

    wire();

FlatFoldDB.getAllDocs().then(function (list) {
      if (!localDirty) {
        docs = Array.isArray(list) ? list : [];
      }
      renderHome();
    }).catch(function (err) {
      console.error(err);
      renderHome();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    init();
  }
})();


