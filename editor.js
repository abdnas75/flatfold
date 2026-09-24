/* ============================================================
   FlatFold — Scanner engine + editor.
   - Auto edge detection (best-effort, optional sugar)
   - Perspective warp via homography
   - Filters: Original / Grayscale / B&W / Magic
   - Corner-drag editor with live flatten preview
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Linear algebra ---------------- */

  function solve8(A, b) {
    var n = 8, i, j, k;
    for (i = 0; i < n; i++) {
      var pivot = i;
      for (j = i + 1; j < n; j++) {
        if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
      }
      if (Math.abs(A[pivot][i]) < 1e-12) return null;
      var t0 = A[i]; A[i] = A[pivot]; A[pivot] = t0;
      var tb = b[i]; b[i] = b[pivot]; b[pivot] = tb;
      for (j = i + 1; j < n; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < n; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (k = i + 1; k < n; k++) s -= A[i][k] * x[k];
      x[i] = s / A[i][i];
    }
    return x;
  }

  function computeHomography(src, dst) {
    var A = [], b = [], i;
    for (i = 0; i < 8; i++) A.push(new Array(8).fill(0));
    for (i = 0; i < 8; i++) b.push(0);
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A[2 * i][0] = x; A[2 * i][1] = y; A[2 * i][2] = 1;
      A[2 * i][6] = -x * u; A[2 * i][7] = -y * u; b[2 * i] = u;
      A[2 * i + 1][3] = x; A[2 * i + 1][4] = y; A[2 * i + 1][5] = 1;
      A[2 * i + 1][6] = -x * v; A[2 * i + 1][7] = -y * v; b[2 * i + 1] = v;
    }
    var h = solve8(A, b);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function invert3x3(m) {
    var a = m[0], b = m[1], c = m[2],
        d = m[3], e = m[4], f = m[5],
        g = m[6], h = m[7], i = m[8];
    var det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null;
    det = 1 / det;
    return [
      (e * i - f * h) * det, (c * h - b * i) * det, (b * f - c * e) * det,
      (f * g - d * i) * det, (a * i - c * g) * det, (c * d - a * f) * det,
      (d * h - e * g) * det, (b * g - a * h) * det, (a * e - b * d) * det
    ];
  }

  function applyMap(m, x, y) {
    var w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  }

  /* ---------------- Auto edge detection ---------------- */

  // Returns quad corners in image pixel coords, or null if no confident quad.
  function detectQuad(imgData, w, h) {
    var n = w * h;
    var gray = new Float32Array(n);
    var data = imgData.data;
    var i, x, y;

    for (i = 0; i < n; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Sobel gradient magnitude
    var mag = new Float32Array(n);
    var max = 0;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        var p = y * w + x;
        var gx = -gray[p - 1 - w] - 2 * gray[p - 1] - gray[p - 1 + w]
               +  gray[p + 1 - w] + 2 * gray[p + 1] + gray[p + 1 + w];
        var gy = -gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1]
               +  gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1];
        var m = Math.sqrt(gx * gx + gy * gy);
        mag[p] = m;
        if (m > max) max = m;
      }
    }

    // Otsu threshold on gradient magnitude
    var hist = new Float32Array(1025);
    for (i = 0; i < n; i++) {
      var idx = Math.min(1024, Math.round(mag[i] / (max || 1) * 1024));
      hist[idx]++;
    }
    var total = 0;
    for (i = 0; i < 1025; i++) total += hist[i];
    var sumAll = 0;
    for (i = 0; i < 1025; i++) sumAll += i * hist[i];
    var sumB = 0, wB = 0, best = 0, bestT = 0;
    for (i = 0; i < 1025; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB;
      var mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; bestT = i; }
    }
    var T = bestT / 1024 * max;

    var edge = new Uint8Array(n);
    for (i = 0; i < n; i++) edge[i] = mag[i] > T ? 1 : 0;

    // Collect outermost edge points per column/row (within halves)
    function collect(pick) {
      var pts = [];
      for (var c = 0; c < w; c += 2) {
        var p = pick(c);
        if (p) pts.push(p);
      }
      return pts;
    }
    function topPx(c) {
      for (var y = 0; y < (h >> 1); y++) if (edge[y * w + c]) return [c, y];
      return null;
    }
    function bottomPx(c) {
      for (var y = h - 1; y >= (h >> 1); y--) if (edge[y * w + c]) return [c, y];
      return null;
    }
    function leftPx(r) {
      for (var x = 0; x < (w >> 1); x++) if (edge[r * w + x]) return [x, r];
      return null;
    }
    function rightPx(r) {
      for (var x = w - 1; x >= (w >> 1); x--) if (edge[r * w + x]) return [x, r];
      return null;
    }

    var topPts = collect(topPx);
    var bottomPts = collect(bottomPx);
    var leftPts = collect(leftPx);
    var rightPts = collect(rightPx);

    if (topPts.length < 6 || bottomPts.length < 6 || leftPts.length < 6 || rightPts.length < 6) return null;

    // Trim outliers against median, then TLS-fit the line
    function fitLine(pts, axis) {
      var vals = pts.map(function (p) { return p[axis]; });
      vals.sort(function (a, b) { return a - b; });
      var med = vals[vals.length >> 1];
      var spread = (axis === 0 ? w : h);
      var inliers = pts.filter(function (p) { return Math.abs(p[axis] - med) < spread * 0.4; });
      if (inliers.length < 4) return null;
      var cx = 0, cy = 0, m;
      for (m = 0; m < inliers.length; m++) { cx += inliers[m][0]; cy += inliers[m][1]; }
      cx /= inliers.length; cy /= inliers.length;
      var xx = 0, yy = 0, xy = 0;
      for (m = 0; m < inliers.length; m++) {
        var dx = inliers[m][0] - cx, dy = inliers[m][1] - cy;
        xx += dx * dx; yy += dy * dy; xy += dx * dy;
      }
      // eigenvector of smallest eigenvalue -> line normal
      var tr = xx + yy;
      var disc = Math.sqrt(Math.max(0, (xx - yy) * (xx - yy) + 4 * xy * xy));
      var l2 = (tr - disc) / 2;
      var A, B;
      if (Math.abs(xy) + Math.abs(l2 - xx) > 1e-9) {
        A = xy; B = l2 - xx;
      } else {
        A = l2 - yy; B = xy;
      }
      var len = Math.sqrt(A * A + B * B);
      A /= len; B /= len;
      var C = -(A * cx + B * cy);
      return [A, B, C];
    }

    function intersect(l1, l2) {
      if (!l1 || !l2) return null;
      var d = l1[0] * l2[1] - l2[0] * l1[1];
      if (Math.abs(d) < 1e-9) return null;
      return [
        (l1[1] * l2[2] - l2[1] * l1[2]) / d,
        (l1[2] * l2[0] - l2[2] * l1[0]) / d
      ];
    }

    var topLine = fitLine(topPts, 1);
    var bottomLine = fitLine(bottomPts, 1);
    var leftLine = fitLine(leftPts, 0);
    var rightLine = fitLine(rightPts, 0);
    if (!topLine || !bottomLine || !leftLine || !rightLine) return null;

    var tl = intersect(topLine, leftLine);
    var tr = intersect(topLine, rightLine);
    var br = intersect(bottomLine, rightLine);
    var bl = intersect(bottomLine, leftLine);
    if (!tl || !tr || !br || !bl) return null;

    var quad = [tl, tr, br, bl];

    // Validate: within bounds, enough area, convex, consistent order
    var minT = -w * 0.15, maxT = w * 1.15, minU = -h * 0.15, maxU = h * 1.15;
    for (var q = 0; q < 4; q++) {
      var px = quad[q][0], py = quad[q][1];
      if (px < minT || px > maxT || py < minU || py > maxU) return null;
    }

    function area(Q) {
      var s = 0;
      for (var t = 0; t < 4; t++) {
        var n = (t + 1) % 4;
        s += Q[t][0] * Q[n][1] - Q[n][0] * Q[t][1];
      }
      return Math.abs(s) / 2;
    }
    if (area(quad) < w * h * 0.10) return null;

    function cross(o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }
    var s0 = cross(quad[0], quad[1], quad[2]);
    for (var c2 = 1; c2 < 4; c2++) {
      var s1 = cross(quad[c2], quad[(c2 + 1) % 4], quad[(c2 + 2) % 4]);
      if (s0 * s1 < 0) return null;
    }

    // Corners should be roughly rectangular (reject skewed noise patches)
    for (var cc = 0; cc < 4; cc++) {
      var a = quad[(cc + 3) % 4], b = quad[cc], c = quad[(cc + 1) % 4];
      var v1x = a[0] - b[0], v1y = a[1] - b[1];
      var v2x = c[0] - b[0], v2y = c[1] - b[1];
      var m1 = Math.sqrt(v1x * v1x + v1y * v1y);
      var m2 = Math.sqrt(v2x * v2x + v2y * v2y);
      if (m1 < 8 || m2 < 8) return null;
      var dot = v1x * v2x + v1y * v2y;
      var deg = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
      if (deg < 55 || deg > 125) return null;
    }

    return quad;
  }

  /* ---------------- Filters ---------------- */

  function grayValue(data, i) {
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  function applyGray(img) {
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = grayValue(d, i);
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
  }

  function otsuThreshold(gray, n) {
    var hist = new Float32Array(256);
    for (var i = 0; i < n; i++) hist[Math.min(255, Math.round(gray[i]))]++;
    var total = n;
    var sumAll = 0;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var sumB = 0, wB = 0, best = 0, bestT = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB;
      var mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; bestT = i; }
    }
    return bestT;
  }

  function applyBW(img) {
    var d = img.data;
    var n = img.width * img.height;
    var gray = new Float32Array(n);
    for (var i = 0; i < n; i++) gray[i] = grayValue(d, i * 4);
    var t = otsuThreshold(gray, n);
    for (i = 0; i < n; i++) {
      var v = gray[i] >= t ? 255 : 0;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v;
    }
  }

  // Color-preserving "scan enhancement": whitens the paper, deepens ink,
  // boosts tone and saturation. Single pass, no blur -> fast on mobile.
  function applyEnhance(img) {
    var d = img.data;
    var w = img.width, h = img.height, n = w * h;
    // Coarse luminance histogram (1/4 sample) to find paper + ink levels.
    var hist = new Float32Array(32), i, j, k;
    for (i = 0; i < n; i += 4) {
      var L = grayValue(d, i * 4);
      var bi = (L / 8.22) | 0;
      if (bi > 31) bi = 31;
      hist[bi]++;
    }
    var total = 0;
    for (j = 0; j < 32; j++) total += hist[j];
    // paper level = luminance at ~86th percentile, ink level at ~2nd.
    function percentile(pct) {
      var acc = 0;
      for (k = 0; k < 32; k++) {
        acc += hist[k];
        if (acc / total >= pct) return k * 8.22 + 4;
      }
      return 255;
    }
    var ink = percentile(0.02);
    var paper = percentile(0.86);
    var span = Math.max(48, paper - ink);
    var white = Math.max(228, Math.min(255, paper + 10));

    for (i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      var t = Math.max(0, Math.min(1, (lum - ink) / span));
      // smoothstep for contrast without clipping ink to pure black
      var o = t * t * (3 - 2 * t) * white;
      var s = o / (lum < 6 ? 6 : lum);
      var nr = r * s, ng = g * s, nb = b * s;
      // gentle saturation lift so colored documents stay vivid
      var avg = (nr + ng + nb) / 3;
      var sat = 1.18;
      nr = avg + (nr - avg) * sat;
      ng = avg + (ng - avg) * sat;
      nb = avg + (nb - avg) * sat;
      if (nr < 0) nr = 0; if (nr > 255) nr = 255;
      if (ng < 0) ng = 0; if (ng > 255) ng = 255;
      if (nb < 0) nb = 0; if (nb > 255) nb = 255;
      d[i * 4] = nr; d[i * 4 + 1] = ng; d[i * 4 + 2] = nb;
    }
  }

  function boxBlur(gray, w, h, radius) {
    var r = Math.max(1, radius);
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var i, j;
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) {
        var s = 0, c = 0;
        for (var k = -r; k <= r; k++) {
          var x = i + k;
          if (x < 0 || x >= w) continue;
          s += gray[j * w + x]; c++;
        }
        tmp[j * w + i] = s / c;
      }
    }
    for (i = 0; i < w; i++) {
      for (j = 0; j < h; j++) {
        var s2 = 0, c2 = 0;
        for (var k2 = -r; k2 <= r; k2++) {
          var y = j + k2;
          if (y < 0 || y >= h) continue;
          s2 += tmp[y * w + i]; c2++;
        }
        out[j * w + i] = s2 / c2;
      }
    }
    return out;
  }

  function applyMagic(img) {
    var d = img.data;
    var w = img.width, h = img.height, n = w * h;
    var gray = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) gray[i] = grayValue(d, i * 4);
    var blur = boxBlur(gray, w, h, Math.max(3, Math.round(Math.min(w, h) / 40)));
    for (i = 0; i < n; i++) {
      var p = gray[i];
      var diff = p - blur[i];
      var v;
      if (diff <= -16) v = 0;
      else if (diff >= -6) v = 255;
      else v = Math.round((diff + 16) / 10 * 255);
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v;
    }
  }

  function applyFilter(canvas, filter) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (filter === 'original') return;
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (filter === 'gray') applyGray(img);
    else if (filter === 'bw') applyBW(img);
    else if (filter === 'magic') applyMagic(img);
    else applyEnhance(img);
    ctx.putImageData(img, 0, 0);
  }

  /* ---------------- Perspective warp ---------------- */

  function warpImage(srcCanvas, quad, outW, outH) {
    var srcData = srcCanvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    var sw = srcCanvas.width, sh = srcCanvas.height;
    var H = computeHomography(quad, [[0, 0], [outW, 0], [outW, outH], [0, outH]]);
    if (!H) return null;
    var Hi = invert3x3(H);
    if (!Hi) return null;

    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(outW));
    out.height = Math.max(1, Math.round(outH));
    var octx = out.getContext('2d');
    var img = octx.createImageData(out.width, out.height);
    var od = img.data;

    for (var y = 0; y < out.height; y++) {
      for (var x = 0; x < out.width; x++) {
        var pt = applyMap(Hi, x, y);
        var sx = pt[0], sy = pt[1];
        var oi = (y * out.width + x) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
          od[oi] = 255; od[oi + 1] = 255; od[oi + 2] = 255; od[oi + 3] = 255;
          continue;
        }
        var x0 = Math.floor(sx), y0 = Math.floor(sy);
        var fx = sx - x0, fy = sy - y0;
        var i00 = (y0 * sw + x0) * 4;
        var i10 = (y0 * sw + (x0 + 1)) * 4;
        var i01 = ((y0 + 1) * sw + x0) * 4;
        var i11 = ((y0 + 1) * sw + (x0 + 1)) * 4;
        for (var c = 0; c < 3; c++) {
          var t0 = srcData.data[i00 + c] * (1 - fx) + srcData.data[i10 + c] * fx;
          var t1 = srcData.data[i01 + c] * (1 - fx) + srcData.data[i11 + c] * fx;
          od[oi + c] = t0 * (1 - fy) + t1 * fy;
        }
        od[oi + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  function quadLengths(quad) {
    function d(a, b) {
      return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
    }
    var w = Math.max(d(quad[0], quad[1]), d(quad[2], quad[3]));
    var h = Math.max(d(quad[1], quad[2]), d(quad[0], quad[3]));
    return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
  }

  /* ---------------- Editor ---------------- */

  var EDITOR_STATE = {
    srcCanvas: null,      // full-res working canvas (source rotated)
    previewCanvas: null,  // downscaled working canvas
    quad: null,           // in working-image pixel coords
    imageW: 0, imageH: 0,
    rotation: 0,          // 0..3 (90deg steps)
    filter: 'original',
    dragIdx: -1,
    onDone: null
  };

  var stageEl, canvasEl, handleEls = [], MAX_DETECT_W = 360, MAX_PREVIEW_W = 700, MAX_SAVE_W = 1800;

  function setupEditorUI(stage, canvas, handles) {
    stageEl = stage;
    canvasEl = canvas;
    handleEls = handles;
  }

  function fullFrameQuad(w, h) {
    return [[0, 0], [w, 0], [w, h], [0, h]];
  }

  function downscaleCanvas(src, maxW) {
    var s = Math.min(1, maxW / Math.max(src.width, src.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s));
    c.height = Math.max(1, Math.round(src.height * s));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  // Build working canvas from source with rotation applied.
  function buildWorkingCtx(image, rotation) {
    var w = image.naturalWidth || image.width;
    var h = image.naturalHeight || image.height;
    var c = document.createElement('canvas');
    if (rotation === 1 || rotation === 3) { c.width = h; c.height = w; } else { c.width = w; c.height = h; }
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rotation * Math.PI / 2);
    ctx.drawImage(image, -w / 2, -h / 2);
    return c;
  }

  function rotateQuad(quad, w, h) {
    function R(p) { return [h - 1 - p[1], p[0]]; } // clockwise 90, dims become h x w
    return quad.map(R);
  }

  function autoDetect(canvas) {
    var small = downscaleCanvas(canvas, MAX_DETECT_W);
    var ctx = small.getContext('2d', { willReadFrequently: true });
    var imgData = ctx.getImageData(0, 0, small.width, small.height);
    var quad = detectQuad(imgData, small.width, small.height);
    if (!quad) return null;
    var sx = canvas.width / small.width;
    var sy = canvas.height / small.height;
    return quad.map(function (p) { return [p[0] * sx, p[1] * sy]; });
  }

  function rot90CW(x, y, cx, cy) { return [cx + (y - cy), cy - (x - cx)]; }

  EDITOR_STATE.rotate = function () {
    EDITOR_STATE.rotation = (EDITOR_STATE.rotation + 1) % 4;
    rebuildWorking();
  };

  EDITOR_STATE.selectFilter = function (filter) {
    EDITOR_STATE.filter = filter;
    render();
  };

  EDITOR_STATE.reset = function () {
    EDITOR_STATE.quad = fullFrameQuad(EDITOR_STATE.imageW, EDITOR_STATE.imageH);
    render();
  };

  EDITOR_STATE.resetCorners = EDITOR_STATE.reset;

  EDITOR_STATE.autoDetect = function () {
    if (!EDITOR_STATE.previewCanvas) return;
    var small = downscaleCanvas(EDITOR_STATE.previewCanvas, MAX_DETECT_W);
    var ctx = small.getContext('2d', { willReadFrequently: true });
    var imgData = ctx.getImageData(0, 0, small.width, small.height);
    var q = detectQuad(imgData, small.width, small.height);
    if (q) {
      var sx = EDITOR_STATE.imageW / small.width;
      var sy = EDITOR_STATE.imageH / small.height;
      EDITOR_STATE.quad = q.map(function (p) { return [p[0] * sx, p[1] * sy]; });
    }
    render();
    placeHandles();
  };

  EDITOR_STATE.save = function () {
    var src = EDITOR_STATE.srcCanvas;
    if (!src) return;
    var scale = Math.min(1, MAX_SAVE_W / Math.max(src.width, src.height));
    var saveC = document.createElement('canvas');
    saveC.width = Math.round(src.width * scale);
    saveC.height = Math.round(src.height * scale);
    var ctx = saveC.getContext('2d');
    ctx.drawImage(src, 0, 0, saveC.width, saveC.height);
    var q = EDITOR_STATE.quad.map(function (p) { return [p[0] * scale, p[1] * scale]; });
    var lens = quadLengths(q);
    var flat = warpImage(saveC, q, lens[0], lens[1]);
    if (!flat) flat = saveC;
    applyFilter(flat, EDITOR_STATE.filter);
    var cb = EDITOR_STATE.onDone;
    flat.toBlob(function (blob) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataURL = reader.result;
        if (cb) cb({ dataURL: dataURL, width: flat.width, height: flat.height });
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.85);
  };

  function render() {
    if (!EDITOR_STATE.previewCanvas) {
      canvasEl.width = 1; canvasEl.height = 1;
      handleEls.forEach(function (el) { el.hidden = true; });
      return;
    }
    var lens = quadLengths(EDITOR_STATE.quad);
    var scale = Math.min(1, MAX_PREVIEW_W / Math.max(lens[0], lens[1]));
    var outW = Math.max(1, Math.round(lens[0] * scale));
    var outH = Math.max(1, Math.round(lens[1] * scale));
    var flat = warpImage(EDITOR_STATE.previewCanvas, EDITOR_STATE.quad, outW, outH);
    if (!flat) return;
    applyFilter(flat, EDITOR_STATE.filter);
    canvasEl.width = flat.width;
    canvasEl.height = flat.height;
    canvasEl.getContext('2d').drawImage(flat, 0, 0);

    var corners = [[0, 0], [flat.width, 0], [flat.width, flat.height], [0, flat.height]];
    for (var i = 0; i < 4; i++) {
      handleEls[i].hidden = false;
      handleEls[i].dataset.corner = i;
      handleEls[i].style.left = corners[i][0] + 'px';
      handleEls[i].style.top = corners[i][1] + 'px';
    }
  }

  // Position handles relative to the canvas box (canvas uses CSS scaling).
  function placeHandles() {
    var rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var stageRect = stageEl.getBoundingClientRect();
    var sx = rect.width / canvasEl.width;
    var sy = rect.height / canvasEl.height;
    var corners = [[0, 0], [canvasEl.width, 0], [canvasEl.width, canvasEl.height], [0, canvasEl.height]];
    for (var i = 0; i < 4; i++) {
      var el = handleEls[i];
      if (el.hidden) continue;
      var x = rect.left - stageRect.left + corners[i][0] * sx;
      var y = rect.top - stageRect.top + corners[i][1] * sy;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
  }

  function rebuildWorking() {
    var image = EDITOR_STATE._image;
    if (!image) return;
    var oldW = EDITOR_STATE.imageW, oldH = EDITOR_STATE.imageH;
    EDITOR_STATE.srcCanvas = buildWorkingCtx(image, EDITOR_STATE.rotation);
    EDITOR_STATE.imageW = EDITOR_STATE.srcCanvas.width;
    EDITOR_STATE.imageH = EDITOR_STATE.srcCanvas.height;
    // rotate quad around old center into new coordinate space when dims change
    if (oldW !== EDITOR_STATE.imageW || oldH !== EDITOR_STATE.imageH) {
      var cx = (oldW - 1) / 2, cy = (oldH - 1) / 2;
      EDITOR_STATE.quad = EDITOR_STATE.quad.map(function (p) {
        var r = rot90CW(p[0], p[1], cx, cy);
        return [Math.max(0, Math.min(EDITOR_STATE.imageW - 1, r[0])), Math.max(0, Math.min(EDITOR_STATE.imageH - 1, r[1]))];
      });
    }
    EDITOR_STATE.previewCanvas = downscaleCanvas(EDITOR_STATE.srcCanvas, MAX_PREVIEW_W);
    render();
    placeHandles();
  }

  function openEditor(image, filter, rotateImage) {
    EDITOR_STATE._image = image;
    EDITOR_STATE.rotation = 0;
    EDITOR_STATE.filter = filter || 'original';
    EDITOR_STATE.srcCanvas = buildWorkingCtx(image, 0);
    EDITOR_STATE.imageW = EDITOR_STATE.srcCanvas.width;
    EDITOR_STATE.imageH = EDITOR_STATE.srcCanvas.height;
    EDITOR_STATE.quad = fullFrameQuad(EDITOR_STATE.imageW, EDITOR_STATE.imageH);
    EDITOR_STATE.previewCanvas = downscaleCanvas(EDITOR_STATE.srcCanvas, MAX_PREVIEW_W);

    // Best-effort auto detect on a downscaled copy (non-blocking, short).
    var small = downscaleCanvas(EDITOR_STATE.previewCanvas, MAX_DETECT_W);
    var ctx = small.getContext('2d', { willReadFrequently: true });
    var imgData = ctx.getImageData(0, 0, small.width, small.height);
    var q = detectQuad(imgData, small.width, small.height);
    if (q) {
      var sx = EDITOR_STATE.imageW / small.width;
      var sy = EDITOR_STATE.imageH / small.height;
      EDITOR_STATE.quad = q.map(function (p) { return [p[0] * sx, p[1] * sy]; });
    }
    render();
    placeHandles();
  }

  // Pointer drag logic (inverse homography mapping so dragging flat corners edits the quad)
  var dragRafPending = false;
  function scheduleDragRender() {
    if (dragRafPending) return;
    dragRafPending = true;
    requestAnimationFrame(function () {
      dragRafPending = false;
      render();
      placeHandles();
    });
  }

  function beginDrag(idx, clientX, clientY) {
    EDITOR_STATE.dragIdx = idx;
    dragTo(clientX, clientY);
  }
  function dragTo(clientX, clientY) {
    var idx = EDITOR_STATE.dragIdx;
    if (idx < 0 || !EDITOR_STATE.previewCanvas) return;
    var rect = canvasEl.getBoundingClientRect();
    if (!rect.width) return;
    var fx = (clientX - rect.left) / rect.width * canvasEl.width;
    var fy = (clientY - rect.top) / rect.height * canvasEl.height;
    var lens = quadLengths(EDITOR_STATE.quad);
    var H = computeHomography(EDITOR_STATE.quad, [[0, 0], [lens[0], 0], [lens[0], lens[1]], [0, lens[1]]]);
    if (!H) return;
    var Hi = invert3x3(H);
    if (!Hi) return;
    // map flat (fx,fy) -> working coords (fx in preview-canvas pixel space)
    var pt = applyMap(Hi, fx, fy);
    var q = EDITOR_STATE.quad.slice();
    q[idx] = [
      Math.max(-EDITOR_STATE.imageW * 0.2, Math.min(EDITOR_STATE.imageW * 1.2, pt[0])),
      Math.max(-EDITOR_STATE.imageH * 0.2, Math.min(EDITOR_STATE.imageH * 1.2, pt[1]))
    ];
    EDITOR_STATE.quad = q;
    scheduleDragRender();
  }
  function endDrag() { EDITOR_STATE.dragIdx = -1; }

  // Standalone batch processing: auto-detect (best effort) + warp + filter.
  function processImage(image, filter) {
    return new Promise(function (resolve) {
      var src = buildWorkingCtx(image, 0);
      var quad = fullFrameQuad(src.width, src.height);
      var auto = autoDetect(src);
      if (auto) quad = auto;
      var scale = Math.min(1, MAX_SAVE_W / Math.max(src.width, src.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * scale));
      c.height = Math.max(1, Math.round(src.height * scale));
      var ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, c.width, c.height);
      var q = quad.map(function (p) { return [p[0] * scale, p[1] * scale]; });
      var lens = quadLengths(q);
      var flat = warpImage(c, q, lens[0], lens[1]);
      if (!flat) flat = c;
      applyFilter(flat, filter || 'enhance');
      flat.toBlob(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve({ dataURL: reader.result, width: flat.width, height: flat.height });
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.85);
    });
  }

  var api = {
    setupEditorUI: setupEditorUI,
    open: openEditor,
    render: render,
    placeHandles: placeHandles,
    beginDrag: beginDrag,
    dragTo: dragTo,
    endDrag: endDrag,
    rotate: function () { EDITOR_STATE.rotate(); },
    selectFilter: function (f) { EDITOR_STATE.selectFilter(f); },
    resetCorners: function () { EDITOR_STATE.resetCorners(); },
    autoDetect: function () { EDITOR_STATE.autoDetect(); },
    getQuad: function () {
      return EDITOR_STATE.quad.map(function (p) { return [p[0], p[1]]; });
    },
    save: function (cb) { EDITOR_STATE.onDone = cb; EDITOR_STATE.save(); },
    process: processImage,
    detectQuad: detectQuad,
    applyFilter: applyFilter,
    warpImage: warpImage,
    fullFrameQuad: fullFrameQuad,
    computeHomography: computeHomography,
    invert3x3: invert3x3,
    rotateQuad: rotateQuad,
    MAX_SAVE_W: MAX_SAVE_W
  };

  window.FlatFoldEditor = api;
})();