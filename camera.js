/* ============================================================
   FlatFold — Camera capture with live auto-frame overlay.
   ============================================================ */
(function () {
  'use strict';

  var videoEl = null, overlayEl = null;
  var stream = null;
  var timer = null;
  var detectMode = true;

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (videoEl) { videoEl.srcObject = null; }
  }

  async function start(video, overlay) {
    videoEl = video;
    overlayEl = overlay;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported here. Use "Import Images" instead.');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1920 }
      }
    });
    video.srcObject = stream;
    await video.play().catch(function () {});
    overlayEl.width = video.videoWidth || 1;
    overlayEl.height = video.videoHeight || 1;
    startOverlayLoop();
  }

  function setDetect(on) { detectMode = !!on; }

  function drawFrame() {
    if (!videoEl || !overlayEl || !detectMode) {
      if (overlayEl) {
        var octx = overlayEl.getContext('2d');
        octx.clearRect(0, 0, overlayEl.width, overlayEl.height);
      }
      return;
    }
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw) return;

    var small = document.createElement('canvas');
    var s = 0.35;
    small.width = Math.round(vw * s);
    small.height = Math.round(vh * s);
    var sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(videoEl, 0, 0, small.width, small.height);
    var imgData = sctx.getImageData(0, 0, small.width, small.height);

    var q = FlatFoldEditor.detectQuad(imgData, small.width, small.height);

    var octx2 = overlayEl.getContext('2d');
    octx2.setTransform(1, 0, 0, 1, 0, 0);
    octx2.clearRect(0, 0, overlayEl.width, overlayEl.height);
    var w = overlayEl.width, h = overlayEl.height;

    if (q) {
      // dim the whole frame first
      octx2.fillStyle = 'rgba(0,0,0,0.42)';
      octx2.fillRect(0, 0, w, h);

      // mirror to match the flipped video preview

      var sx = w / small.width, sy = h / small.height;
      var pts = q.map(function (p) { return [p[0] * sx, p[1] * sy]; });
      var path = new Path2D('M' + pts[0][0] + ',' + pts[0][1] +
        ' L' + pts[1][0] + ',' + pts[1][1] +
        ' L' + pts[2][0] + ',' + pts[2][1] +
        ' L' + pts[3][0] + ',' + pts[3][1] + ' Z');

      // punch the document area back out of the dim
      octx2.globalCompositeOperation = 'destination-out';
      octx2.beginPath();
      octx2.moveTo(pts[0][0], pts[0][1]);
      octx2.lineTo(pts[1][0], pts[1][1]);
      octx2.lineTo(pts[2][0], pts[2][1]);
      octx2.lineTo(pts[3][0], pts[3][1]);
      octx2.closePath();
      octx2.fill();
      octx2.globalCompositeOperation = 'source-over';

      // bright border
      octx2.strokeStyle = 'rgba(34,211,238,0.95)';
      octx2.lineWidth = Math.max(2, Math.round(w / 200));
      octx2.stroke(path);

      octx2.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  function startOverlayLoop() {
    if (timer) clearInterval(timer);
    timer = setInterval(drawFrame, 320);
  }

  function grab() {
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    var c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    var ctx = c.getContext('2d');
    ctx.drawImage(videoEl, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }

  window.FlatFoldCamera = {
    start: start,
    stop: stop,
    grab: grab,
    setDetect: setDetect
  };
})();