/**
 * pdf-exporter.js
 * Generator PDF multi-halaman berstandar A4 menggunakan jsPDF
 */

export class PdfExporter {
  static pageLayout(page, defaultSize = 'a4') {
    const { width, height } = page.canvas;
    if (!(width > 0 && height > 0)) throw new Error('Gambar halaman kosong.');
    const size = page.pageSize || defaultSize;
    const landscape = width > height;
    let dimensions;
    if (size === 'original') {
      // Photos have no reliable physical paper size. Preserve their aspect ratio at 150 DPI.
      const scale = Math.min(25.4 / 150, 500 / Math.max(width, height));
      dimensions = [width * scale, height * scale];
    } else {
      dimensions = size === 'letter' ? [215.9, 279.4] : [210, 297];
      if (landscape) dimensions.reverse();
    }
    const [pageWidth, pageHeight] = dimensions;
    const margin = size === 'original' ? 0 : 5;
    const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
    return {
      dimensions, orientation: landscape ? 'landscape' : 'portrait',
      width: width * scale, height: height * scale,
      x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2,
    };
  }

  static async exportToPdf(pages, options = {}) {
    if (!pages || pages.length === 0) {
      throw new Error("Tidak ada halaman dokumen untuk diekspor.");
    }

    const {
      filename = `Scan-Dokumen-${new Date().toISOString().slice(0, 10)}.pdf`,
      pageSize = 'a4',
      quality = 0.88
    } = options;

    // Load jsPDF dynamically jika belum ada
    if (!window.jspdf) {
      await this.loadJsPdf();
    }

    const { jsPDF } = window.jspdf;
    
    const firstLayout = this.pageLayout(pages[0], pageSize);
    const pdf = new jsPDF({
      orientation: firstLayout.orientation,
      unit: 'mm',
      format: firstLayout.dimensions,
      compress: true
    });

    for (let i = 0; i < pages.length; i++) {
      const layout = this.pageLayout(pages[i], pageSize);
      if (i > 0) pdf.addPage(layout.dimensions, layout.orientation);

      const canvas = pages[i].canvas;
      const imgData = canvas.toDataURL('image/jpeg', quality);

      pdf.addImage(imgData, 'JPEG', layout.x, layout.y, layout.width, layout.height, undefined, 'FAST');
      for (const word of pages[i].ocr?.words || []) {
        const { x0, y0, x1, y1 } = word.bbox;
        const text = word.text.replace(/[\u0000-\u001f]/g, '').trim();
        if (!text || x1 <= x0 || y1 <= y0) continue;
        const wordWidth = (x1 - x0) / canvas.width * layout.width;
        const wordHeight = (y1 - y0) / canvas.height * layout.height;
        pdf.setFontSize(wordHeight * 72 / 25.4);
        const measuredWidth = pdf.getTextWidth(text);
        pdf.text(text, layout.x + x0 / canvas.width * layout.width,
          layout.y + y0 / canvas.height * layout.height, {
            baseline: 'top', renderingMode: 'invisible',
            horizontalScale: measuredWidth > 0 ? wordWidth / measuredWidth : 1,
          });
      }
    }

    return {
      pdf,
      filename,
      blob: pdf.output('blob')
    };
  }

  static downloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  static async sharePdf(blob, filename) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: filename,
        text: 'Dokumen hasil scan kamera HP'
      });
      return true;
    }
    return false;
  }

  static loadJsPdf() {
    return new Promise((resolve, reject) => {
      if (window.jspdf) return resolve();
      const script = document.createElement('script');
      script.src = '/assets/jspdf.umd.min.js';
      script.onload = () => resolve();
      script.onerror = () => {
        // Fallback to CDN jika asset lokal gagal
        const fallbackScript = document.createElement('script');
        fallbackScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        fallbackScript.onload = () => resolve();
        fallbackScript.onerror = () => reject(new Error('Gagal memuat pustaka jsPDF. Periksa koneksi internet.'));
        document.head.appendChild(fallbackScript);
      };
      document.head.appendChild(script);
    });
  }
}
