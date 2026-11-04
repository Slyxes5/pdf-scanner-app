/**
 * pdf-exporter.js
 * Generator PDF multi-halaman berstandar A4 menggunakan jsPDF
 */

export class PdfExporter {
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
    
    // Dimensi A4 dalam milimeter: 210 x 297 mm
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSize === 'letter' ? 'letter' : 'a4',
      compress: true
    });

    const pdfPageWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }

      const canvas = pages[i].canvas;
      const imgData = canvas.toDataURL('image/jpeg', quality);

      // Skala gambar agar pas ke halaman PDF dengan margin bersih 5mm
      const margin = 5;
      const usableWidth = pdfPageWidth - margin * 2;
      const usableHeight = pdfPageHeight - margin * 2;

      const imgRatio = canvas.width / canvas.height;
      const pageRatio = usableWidth / usableHeight;

      let renderW = usableWidth;
      let renderH = usableHeight;
      let posX = margin;
      let posY = margin;

      if (imgRatio > pageRatio) {
        // Gambar lebih lebar
        renderH = usableWidth / imgRatio;
        posY = margin + (usableHeight - renderH) / 2;
      } else {
        // Gambar lebih tinggi
        renderW = usableHeight * imgRatio;
        posX = margin + (usableWidth - renderW) / 2;
      }

      pdf.addImage(imgData, 'JPEG', posX, posY, renderW, renderH, undefined, 'FAST');
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
