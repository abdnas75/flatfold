/* ============================================================
   FlatFold — Minimal dependency-free PDF writer.
   Embeds JPEG pages (DCTDecode) into a multi-page PDF.
   ============================================================ */
(function () {
  'use strict';

  function dataURLToBytes(dataURL) {
    var b64 = dataURL.indexOf('base64,') > -1 ? dataURL.split('base64,')[1] : dataURL;
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function pad10(n) { n = String(n); while (n.length < 10) n = '0' + n; return n; }

  function assemble(objects) {
    var encoder = new TextEncoder();
    var parts = [];
    var offsets = new Array(objects.length);
    var offset = 0;

    function pushBytes(b) { parts.push(b); offset += b.length; }
    function pushStr(s) { pushBytes(encoder.encode(s)); }

    pushStr('%PDF-1.4\n');
    pushBytes(encoder.encode('%\u00e2\u00e3\u00cf\u00d3\n')); // binary comment line
    pushStr('\n');

    for (var id = 1; id < objects.length; id++) {
      offsets[id] = offset;
      var obj = objects[id];
      pushStr(id + ' 0 obj\n');
      if (obj.stream) {
        pushStr(obj.stream.head);
        pushStr('\nstream\n');
        pushBytes(obj.stream.bytes);
        pushStr('\nendstream\n');
      } else {
        pushStr(obj.text);
        pushStr('\n');
      }
      pushStr('endobj\n');
    }

    var xrefOffset = offset;
    var body = 'xref\n0 ' + objects.length + '\n';
    body += '0000000000 65535 f \n';
    for (var j = 1; j < objects.length; j++) {
      body += pad10(offsets[j]) + ' 00000 n \n';
    }
    body += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\n';
    body += 'startxref\n' + xrefOffset + '\n%%EOF';

    pushStr(body);

    var total = 0;
    for (var k = 0; k < parts.length; k++) total += parts[k].length;
    var buf = new Uint8Array(total);
    var p = 0;
    for (var m = 0; m < parts.length; m++) { buf.set(parts[m], p); p += parts[m].length; }
    return buf;
  }

  /**
   * @param {Array<{dataURL:string,width:number,height:number}>} pages
   * @returns {Blob} application/pdf
   */
  function generatePDF(pages) {
    var n = pages.length;
    if (!n) return new Blob([], { type: 'application/pdf' });

    var objects = [{ text: '' }]; // index 0 unused (free entry)

    objects.push({ text: '<< /Type /Catalog /Pages 2 0 R >>' }); // obj 1
    var kids = [];
    for (var i = 0; i < n; i++) {
      kids.push(((3 + i * 3)) + ' 0 R');
    }
    objects.push({ text: '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>' }); // obj 2

    for (i = 0; i < n; i++) {
      var page = pages[i];
      var pageId = 3 + i * 3;
      var contentId = 4 + i * 3;
      var imgId = 5 + i * 3;
      var bytes = dataURLToBytes(page.dataURL);
      var w = Math.max(1, Math.round(page.width));
      var h = Math.max(1, Math.round(page.height));

      objects.push({ // page object
        text: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] ' +
              '/Resources << /XObject << /Im0 ' + imgId + ' 0 R >> /Font << >> >> ' +
              '/Contents ' + contentId + ' 0 R >>'
      });

      var content = 'q\n' + w + ' 0 0 ' + h + ' 0 0 cm\n/Im0 Do\nQ';
      objects.push({
        stream: {
          head: '<< /Length ' + content.length + ' >>',
          bytes: new TextEncoder().encode(content)
        }
      });

      objects.push({
        stream: {
          head: '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
                ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>',
          bytes: bytes
        }
      });
    }

    var buf = assemble(objects);
    return new Blob([buf], { type: 'application/pdf' });
  }

  window.FlatFoldPDF = { generate: generatePDF };
})();