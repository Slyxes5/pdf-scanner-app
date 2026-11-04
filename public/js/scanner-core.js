/**
 * scanner-core.js
 * Algoritma Auto-Edge Detection, Perspective Transform (Homography), dan Filter Dokumen
 */

export class ScannerCore {
  /**
   * Menemukan perkiraan 4 sudut dokumen otomatis (Auto Edge Detection)
   * Menggunakan analisis kontras dan bounding box dokumen
   */
  static detectDocumentCorners(width, height, imageData) {
    // Default fallback: 85% area tengah jika kontras background rendah
    const insetX = width * 0.08;
    const insetY = height * 0.08;

    let corners = [
      { x: insetX, y: insetY },                     // Top-Left
      { x: width - insetX, y: insetY },             // Top-Right
      { x: width - insetX, y: height - insetY },     // Bottom-Right
      { x: insetX, y: height - insetY }              // Bottom-Left
    ];

    if (!imageData) return corners;

    try {
      // Analisis Luminansi untuk mencari tepian kertas
      const data = imageData.data;
      const step = 4;
      const gray = new Uint8Array((width * height) / (step * step));
      const gw = Math.floor(width / step);
      const gh = Math.floor(height / step);

      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const idx = (y * step * width + x * step) * 4;
          // Luminance formula
          gray[y * gw + x] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        }
      }

      // Deteksi bounding threshold kertas (kertas dokumen umumnya lebih terang dibanding meja)
      let minX = gw, maxX = 0, minY = gh, maxY = 0;
      let sumLum = 0;
      for (let i = 0; i < gray.length; i++) sumLum += gray[i];
      const avgLum = sumLum / gray.length;
      const paperThreshold = Math.min(220, Math.max(120, avgLum * 1.15));

      for (let y = Math.floor(gh * 0.05); y < gh * 0.95; y++) {
        for (let x = Math.floor(gw * 0.05); x < gw * 0.95; x++) {
          if (gray[y * gw + x] > paperThreshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // Jika area kertas terdeteksi cukup wajar (> 30% layar)
      const detectedW = (maxX - minX) * step;
      const detectedH = (maxY - minY) * step;
      if (detectedW > width * 0.35 && detectedH > height * 0.35) {
        corners = [
          { x: Math.max(0, minX * step), y: Math.max(0, minY * step) },
          { x: Math.min(width, maxX * step), y: Math.max(0, minY * step) },
          { x: Math.min(width, maxX * step), y: Math.min(height, maxY * step) },
          { x: Math.max(0, minX * step), y: Math.min(height, maxY * step) }
        ];
      }
    } catch (e) {
      console.warn("Auto detection fallback:", e);
    }

    return corners;
  }

  /**
   * Menghitung matriks transformasi perspektif (Homography 3x3)
   */
  static getPerspectiveTransformMatrix(src, dst) {
    // Menyelesaikan sistem persamaan 8 linear untuk homography
    const a = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
      const sx = src[i].x;
      const sy = src[i].y;
      const dx = dst[i].x;
      const dy = dst[i].y;

      a.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
      b.push(dx);

      a.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
      b.push(dy);
    }

    // Eliminasi Gaussian
    const h = this.solveGaussian(a, b);
    h.push(1); // h33 = 1
    return h;
  }

  static solveGaussian(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }
      for (let k = i; k < n; k++) {
        const tmp = A[maxRow][k];
        A[maxRow][k] = A[i][k];
        A[i][k] = tmp;
      }
      const tmp = b[maxRow];
      b[maxRow] = b[i];
      b[i] = tmp;

      for (let k = i + 1; k < n; k++) {
        const c = -A[k][i] / A[i][i];
        for (let j = i; j < n; j++) {
          if (i === j) A[k][j] = 0;
          else A[k][j] += c * A[i][j];
        }
        b[k] += c * b[i];
      }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = b[i] / A[i][i];
      for (let k = i - 1; k >= 0; k--) {
        b[k] -= A[k][i] * x[i];
      }
    }
    return x;
  }

  /**
   * Meluruskan sudut dokumen foto ke bidang datar persegi (Perspective Warp)
   */
  static warpPerspective(sourceCanvas, corners, outWidth = 1200, outHeight = 1697) {
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = outWidth;
    targetCanvas.height = outHeight;
    const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });

    const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const srcData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const dstData = targetCtx.createImageData(outWidth, outHeight);

    const dstCorners = [
      { x: 0, y: 0 },
      { x: outWidth, y: 0 },
      { x: outWidth, y: outHeight },
      { x: 0, y: outHeight }
    ];

    // Matriks invers dari target ke source (Backward mapping untuk menghindari celah piksel kosong)
    const H = this.getPerspectiveTransformMatrix(dstCorners, corners);

    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const sPixels = srcData.data;
    const dPixels = dstData.data;

    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < outWidth; x++) {
        const denominator = H[6] * x + H[7] * y + H[8];
        const srcX = (H[0] * x + H[1] * y + H[2]) / denominator;
        const srcY = (H[3] * x + H[4] * y + H[5]) / denominator;

        if (srcX >= 0 && srcX < sw - 1 && srcY >= 0 && srcY < sh - 1) {
          // Bilinear Interpolation
          const x0 = Math.floor(srcX);
          const x1 = x0 + 1;
          const y0 = Math.floor(srcY);
          const y1 = y0 + 1;

          const dx = srcX - x0;
          const dy = srcY - y0;

          const idx00 = (y0 * sw + x0) * 4;
          const idx10 = (y0 * sw + x1) * 4;
          const idx01 = (y1 * sw + x0) * 4;
          const idx11 = (y1 * sw + x1) * 4;

          const dstIdx = (y * outWidth + x) * 4;

          for (let c = 0; c < 3; c++) {
            const v0 = sPixels[idx00 + c] * (1 - dx) + sPixels[idx10 + c] * dx;
            const v1 = sPixels[idx01 + c] * (1 - dx) + sPixels[idx11 + c] * dx;
            dPixels[dstIdx + c] = v0 * (1 - dy) + v1 * dy;
          }
          dPixels[dstIdx + 3] = 255;
        } else {
          // Putih di luar batas
          const dstIdx = (y * outWidth + x) * 4;
          dPixels[dstIdx] = 255;
          dPixels[dstIdx + 1] = 255;
          dPixels[dstIdx + 2] = 255;
          dPixels[dstIdx + 3] = 255;
        }
      }
    }

    targetCtx.putImageData(dstData, 0, 0);
    return targetCanvas;
  }

  /**
   * Filter Dokumen: Magic Color, B&W Dokumen, Grayscale, Asli
   */
  static applyDocumentFilter(canvas, filterType = 'magic', brightness = 0, contrast = 0) {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = canvas.width;
    outputCanvas.height = canvas.height;
    const ctx = outputCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);

    if (filterType === 'original' && brightness === 0 && contrast === 0) {
      return outputCanvas;
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // Hitung rata-rata luminansi untuk auto-thresholding
    let avg = 0;
    if (filterType === 'magic' || filterType === 'bw') {
      let sum = 0;
      for (let i = 0; i < data.length; i += 16) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      avg = sum / (data.length / 16);
    }

    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (filterType === 'magic') {
        // MAGIC COLOR: Putihkan background kertas, pekatkan tulisan teks
        const paperBoost = Math.max(0, lum - avg * 0.85) * 1.45;
        r = Math.min(255, Math.max(0, (r * 1.15 + paperBoost - 35)));
        g = Math.min(255, Math.max(0, (g * 1.15 + paperBoost - 35)));
        b = Math.min(255, Math.max(0, (b * 1.15 + paperBoost - 35)));

        // Kontras tambahan untuk tulisan
        if (lum < avg * 0.95) {
          r *= 0.75;
          g *= 0.75;
          b *= 0.75;
        }
      } else if (filterType === 'bw') {
        // HITAM PUTIH FOTOKOPI: Adaptive threshold
        const threshold = avg * 0.92;
        const val = lum > threshold ? 255 : 0;
        r = g = b = val;
      } else if (filterType === 'grayscale') {
        // GRAYSCALE HALUS
        r = g = b = lum;
      }

      // Terapkan Brightness & Contrast manual jika ada
      if (brightness !== 0) {
        r = Math.min(255, Math.max(0, r + brightness));
        g = Math.min(255, Math.max(0, g + brightness));
        b = Math.min(255, Math.max(0, b + brightness));
      }
      if (contrast !== 0) {
        r = Math.min(255, Math.max(0, factor * (r - 128) + 128));
        g = Math.min(255, Math.max(0, factor * (g - 128) + 128));
        b = Math.min(255, Math.max(0, factor * (b - 128) + 128));
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }

    ctx.putImageData(imgData, 0, 0);
    return outputCanvas;
  }
}
