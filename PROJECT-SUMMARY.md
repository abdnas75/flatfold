# FlatFold — Master Project Summary

**Project Owner:** Abdullah Nasir
**Project Status:** Completed and Ready for Deployment / Paused
**Last Updated:** September 24, 2026

---

## 1. Project Identity

**Name:** FlatFold — Free Document Scanner
**Type:** Progressive Web App (PWA) — works fully offline
**Purpose:** A free, no-subscription alternative to CamScanner
**Tech Stack:** HTML + CSS + Vanilla JavaScript (zero dependencies, no frameworks, no CDNs)
**Hosting:** Not deployed yet (Vercel only when owner explicitly requests)
**Repository:** Local project at `C:\PERSONAL\Mine\flatfold`
**Preview:** Dev-server available at `http://localhost:8123/`

---

## 2. Current Status

| Component | Status |
|-----------|--------|
| Core scanner engine (auto-detect, warp, filters) | ✅ Completed and tested |
| Multi-page documents + drafts (IndexedDB) | ✅ Completed and tested |
| PDF / JPG export | ✅ Completed and tested |
| Full app UI flow (import → pages → home → reopen) | ✅ Completed and tested |
| PWA (manifest + service worker) | ✅ Completed |
| Camera capture (`getUserMedia`) | ✅ Implemented, ⚠️ not device-tested (headless env has no camera; graceful fallback verified) |
| 5 themes | ✅ Completed |
| Vercel deployment | ⬜ Not done — only on explicit request |

---

## 3. Core Completed Features

### Capture
- `getUserMedia` camera with mirrored live preview and auto-frame overlay
- Snapshot button (shutter) sends frame to editor
- Camera unavailable → graceful toast ("Use Import instead"), returns to home

### Import
- Import photos (camera roll) via file picker (multiple selection, up to 25 per batch)
- Each imported image auto-processed with "Magic" (edge detection + perspective flatten + enhancement)

### Document Scanner Engine (`editor.js`)
- `detectQuad` — auto page edge detection:
  - Grayscale → Sobel edges → Otsu threshold → Hough line accumulation → TLS fit with eigenvector fix
  - Corner-angle validation (55°–125°) rejects noise quads, returns null → falls back to full frame
- Manual 4-corner handles (draggable) always work as reliable fallback
- Homography perspective warp (with NaN-safety guard for extreme geometries)
- Filters: **Original**, **Grayscale**, **B&W**, **Magic** (auto-detect + soft-edge binarization + blur + contrast)
- Live flattened preview while dragging, rotation (90°)

### Documents
- Multi-page documents (JPEG data URLs stored per page)
- Drafts auto-saved to IndexedDB
- Home grid with thumbnail cards, page count; rename input; delete; clear all
- Page actions per page: rotate, delete
- Re-open existing documents from home

### Export
- **PDF** — hand-written minimal PDF writer (`pdfwriter.js`): multi-page, DCTDecode JPEG embedding, correct xref (fixed `%PDF-1.4` header bug)
- **JPG** — per-page image download
- Web Share API when available (falls back to download)

### PWA
- `manifest.json` (name, icons) + `sw.js` service worker
- Icons generated in `icons/`: 16, 32, 180, 192, 512 (512 master + GDI+ downscales)
- Works fully offline

---

## 4. Themes (5 Total)

Same 5-theme system + design language as Finance Tracker for brand consistency (liquid glass / neobrutalism / claymorphism / skeuomorphism / minimalism). Theme lives in `styles.css` via CSS variables and persists in `localStorage` under key `ff_theme`.

---

## 5. Important Fixes Completed

1. **`editor.js` auto-detect returned NULL** — `fitLine` used the largest eigenvector instead of the smallest; corrected to `l2 = (tr − disc)/2`. Verified: near-perfect detection on 7×11 rect and 48°-slanted quads.
2. **Magic filter soft-edge formula bug** — rewritten band logic (`(diff+16)/10*255`, range −16..−6) with blur radius bumped to `max(3, round(min(w,h)/40))`.
3. **`pdfwriter.js` missing `%PDF-1.4` header** — PDFs were malformed; fixed by writing the binary header comment before the first object. Verify regex: `/^%PDF-1\.4/`, ends with `%%EOF`.
4. **`app.js` invalid nesting** — doc card was `<button>` inside `<button>`; changed to `<div role="button">` (valid HTML).
5. **Import race (most important):** `init()`'s `getAllDocs()` could resolve *after* the user had already created/imported a doc, clobbering in-memory `docs` with a stale snapshot → home showed empty while data existed in IndexedDB. Fixed with a `localDirty` guard: snapshot only applied when no local edits have happened.
6. **Camera-failure cleanup race:** opening the camera created a phantom empty doc; failure cleanup could delete it mid-import. Removed `ensureDoc()` from `openCamera()` and made import path use a local doc reference.
7. Probably-critical beware — **debugging `-replace` footgun:** while instrumenting, a sed that duplicated `im.onload` with a log line silently overwrote the real handler (two assignments), faking "image never loaded". Not a product bug, but never re-add double `onload` assignments.

---

## 6. Technical Architecture

### Files
| File | Purpose |
|------|---------|
| `index.html` | App shell: 4 views (home / capture / editor / pages), corner-handle divs, theme dropdown, hidden import-input |
| `styles.css` | All CSS incl. 5 themes; editor uses fixed dark surface |
| `app.js` | App orchestration: views, docs lifecycle, import (`processFiles` → `FlatFoldEditor.process` magic), pages grid, export/share, theme |
| `editor.js` | Scanner engine: `detectQuad`, `computeHomography`/`invert3x3`/`warpImage`, filters, editor state + `open/rotate/autoDetect/reset/save/process/getQuad` |
| `camera.js` | `getUserMedia`, mirrored live overlay + auto-frame, `grab()` |
| `pdfwriter.js` | Zero-dependency multi-page PDF writer (DCTDecode JPEG embedding) |
| `db.js` | IndexedDB layer, store `docs` (keyPath `id`), DB `flatfold-db` v1 |
| `sw.js` | Service worker |
| `manifest.json` | PWA manifest |
| `icons/` | `icon-16/32/180/192/512.png` |

### Storage
- **IndexedDB** → full documents (pages as JPEG data URLs). DB `flatfold-db`, store `docs`.
- **localStorage** → theme only (`ff_theme`).

### Script load order (in `index.html`)
`db.js` → `pdfwriter.js` → `camera.js` → `editor.js` → `app.js` (db must precede app).

---

## 7. Verification Results (headless Chrome harnesses)

- **Unit engine:** rect auto-detect near-perfect, slanted quad pass, warp pass, gray/bw/magic filters pass, PDF header/xref/DCTDecode pass (±20-byte file-size tolerance).
- **Editor pipeline:** auto-detect → save → decode → rotate+grey save → PDF generation → drag ops, ALL PASS.
- **`process()` + arbitrary resize:** NaN-safety pass on extreme warp.
- **Full app UI drive (CDP, real Chrome):** import 1 image → pages view shows "1 page" + 1 grid card → back home shows 1 doc-card with rendered thumbnail + empty-state hidden → reopen shows 1 page → Export produces "PDF ready" (valid PDF) → theme switch to brutalism applies → IndexedDB holds 1 doc. **Zero console errors.**

---

## 8. Important Rules for Future Development

### DO NOT:
- Re-introduce `ensureDoc()` on camera open (causes phantom-doc race)
- Remove the `localDirty` guard in `init()`'s `getAllDocs` callback
- Change the IndexedDB schema (`flatfold-db` / store `docs` / keyPath `id`)
- Alter the auto-detect eigenvector math or the corner-angle validation
- Remove the double `im.onload` assignment footgun (only ever ONE `onload` handler per `Image`)
- Replace the app icons or change the minimal rough-flat design language
- Deploy to Vercel unless the owner explicitly asks

### DO:
- Prefer "engine tested independently + app UI driven headlessly" as the verification standard (owner cannot view images — results must be text)
- Test at mobile breakpoints (480px, 360px) after any CSS change
- Keep the app 100% offline-capable and zero-dependency
- When editing camera flows, remember headless cannot use a real camera; verify the graceful fallback path instead

---

## 9. Development Environment & Tooling

- **Chrome:** at `C:\Program Files\Google\Chrome\Application\chrome.exe` (headless test runs)
- **Node.js:** v24.16.0 (used for harness tooling + `node --check`)
- **OS:** Windows (win32), PowerShell 5.1
- **Dev server:** local Node static server on `http://localhost:8123/` (serves app root + test harnesses from `C:\Users\ABDULL~1\AppData\Local\Temp\opencode\flatfold-harness\`)

### Test harness files (temp, NOT part of the app)
- `server.js` (static server + harness routes), `run.js` (dump-dom + virtual-time), `cdp.js` (real-timer CDP driver, no virtual-time flakiness), `shot.js`, `harness.html` / `harness2.html` / `harness3.html` / `harness4.html`, `dbg-import.html`, `drive-index.html` (full app UI drive).
- Lesson: `--virtual-time-budget` + iframe + blob/image loads is flaky → prefer `cdp.js` (CDP over WebSocket, real wall-clock timers, poll `window.__DONE`).

---

## 10. Known Future Considerations / Next Steps

- **Camera capture** still untested on a real device (permissions + shutter + editor round-trip). Test on an actual phone.
- Offer **Vercel deploy** only if the owner asks.
- Optional future features (not started): batch-export ZIP, scan-later queue, auto-crop on import without full editor each time.

---

## 11. Session History

Developed across two sessions: engine + unit harnesses (1st), full-app UI verification, race fixes, and this summary (2nd). The harness0→4 progression routed: engine unit tests → editor pipeline → `process()`/NaN → iframe app drive → top-level CDP drive. This document is the single source of truth for future development.

---

**Project Owner:** Abdullah Nasir
**Status:** Completed, not deployed
**Next Action:** None unless explicitly requested by owner