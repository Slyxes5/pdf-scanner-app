/**
 * scanner-core.js
 * Industrial-grade Document Scanning Engine (Real CamScanner Computer Vision)
 * 
 * Fitur Utama:
 * 1. Multi-Stage Auto Edge Detection:
 *    - Otsu Optimal Binarization + Connected Component Analysis (BFS Blob Tracing)
 *    - Sobel Edge Fallback for low-contrast backgrounds
 *    - Andrew's Monotone Chain Convex Hull
 *    - 4-Corner Quadrilateral Area Maximizer
 * 2. Perspective Transform (3x3 Homography Matrix Solver + Bilinear Backward Mapping)
 * 3. CamScanner Filter Suite:
 *    - Magic Color: Local Illumination Normalization (Shadow Eraser) + S-Curve + Color Stamp Retention + Unsharp Mask
 *    - B&W: Bradley-Roth Local Adaptive Thresholding (Crisp Photocopier Text)
 *    - Grayscale: Normalized Gray Tone
 */

export class ScannerCore {
  /**
   * Deteksi 4 Sudut Dokumen Otomatis (Auto Edge Detection Pro)
   * Berbasis Multi-Scale Color & Gradient Boundary Detection, Morphological Closing,
   * Andrew's Convex Hull, dan Edge-Alignment Quadrilateral Scoring.
   * Sangat andal membedakan kertas bahkan di atas meja kayu terang / lantai krem / background minim kontras.
   */
  static detectDocumentCorners(width, height, imageData) {
    const fallbackCorners = [
      { x: Math.round(width * 0.08), y: Math.round(height * 0.08) },
      { x: Math.round(width * 0.92), y: Math.round(height * 0.08) },
      { x: Math.round(width * 0.92), y: Math.round(height * 0.92) },
      { x: Math.round(width * 0.08), y: Math.round(height * 0.92) }
    ];

    if (!imageData || !imageData.data) return fallbackCorners;

    try {
      const data = imageData.data;
      const targetDim = 360;
      const scale = targetDim / Math.max(width, height);
      const aw = Math.max(10, Math.round(width * scale));
      const ah = Math.max(10, Math.round(height * scale));
      const totalPixels = aw * ah;

      // 1. Downsample dan hitung Luminansi + Saluran Warna (RGB)
      const lum = new Uint8Array(totalPixels);
      const rChan = new Uint8Array(totalPixels);
      const gChan = new Uint8Array(totalPixels);
      const bChan = new Uint8Array(totalPixels);

      for (let y = 0; y < ah; y++) {
        const srcY = Math.min(height - 1, Math.floor(y / scale));
        const row = y * aw;
        for (let x = 0; x < aw; x++) {
          const srcX = Math.min(width - 1, Math.floor(x / scale));
          const idx = (srcY * width + srcX) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          rChan[row + x] = r;
          gChan[row + x] = g;
          bChan[row + x] = b;
          lum[row + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
      }

      // 2. Pre-filter 3x3 untuk meredam noise serat kertas dan teks di dalam dokumen
      const bLum = new Uint8Array(totalPixels);
      for (let y = 1; y < ah - 1; y++) {
        const row = y * aw;
        for (let x = 1; x < aw - 1; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const rOffset = (y + dy) * aw;
            for (let dx = -1; dx <= 1; dx++) {
              sum += lum[rOffset + (x + dx)];
            }
          }
          bLum[row + x] = Math.round(sum / 9);
        }
      }

      // 3. Multi-Channel Color & Luminance Gradient
      // Mendeteksi batas fisik kertas walaupun berada di atas meja kayu terang / putih / lantai krem
      const grad = new Float32Array(totalPixels);
      let maxGrad = 0;
      for (let y = 1; y < ah - 1; y++) {
        const row = y * aw;
        for (let x = 1; x < aw - 1; x++) {
          const lIdx = row + (x - 1);
          const rIdx = row + (x + 1);
          const uIdx = (y - 1) * aw + x;
          const dIdx = (y + 1) * aw + x;

          // Gradien Luminansi
          const dLx = bLum[rIdx] - bLum[lIdx];
          const dLy = bLum[dIdx] - bLum[uIdx];

          // Gradien Jarak Warna (Color Distance Gradient)
          const dRx = rChan[rIdx] - rChan[lIdx];
          const dGx = gChan[rIdx] - gChan[lIdx];
          const dBx = bChan[rIdx] - bChan[lIdx];
          const colGradX = Math.sqrt(dRx * dRx + dGx * dGx + dBx * dBx);

          const dRy = rChan[dIdx] - rChan[uIdx];
          const dGy = gChan[dIdx] - gChan[uIdx];
          const dBy = bChan[dIdx] - bChan[uIdx];
          const colGradY = Math.sqrt(dRy * dRy + dGy * dGy + dBy * dBy);

          const gVal = Math.max(Math.abs(dLx) + Math.abs(dLy), (colGradX + colGradY) * 0.85);
          grad[row + x] = gVal;
          if (gVal > maxGrad) maxGrad = gVal;
        }
      }

      if (maxGrad < 12) return fallbackCorners;

      // 4. Adaptive Gradient Edge Thresholding (Canny-like percentile)
      const gradHist = new Int32Array(128);
      for (let i = 0; i < totalPixels; i++) {
        const bin = Math.min(127, Math.floor((grad[i] / maxGrad) * 127));
        gradHist[bin]++;
      }
      let acc = 0;
      let p75 = 0;
      for (let b = 127; b >= 0; b--) {
        acc += gradHist[b];
        if (acc >= totalPixels * 0.22) {
          p75 = (b / 127) * maxGrad;
          break;
        }
      }
      const edgeThreshold = Math.max(14, p75);

      // Binary Edge Mask & Morphological Dilate/Close untuk menyambung garis tepi terputus
      const edgeMask = new Uint8Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        edgeMask[i] = grad[i] >= edgeThreshold ? 1 : 0;
      }

      const closedMask = new Uint8Array(totalPixels);
      for (let y = 1; y < ah - 1; y++) {
        const row = y * aw;
        for (let x = 1; x < aw - 1; x++) {
          if (edgeMask[row + x]) {
            closedMask[row + x] = 1;
            continue;
          }
          if (edgeMask[row - aw + x] || edgeMask[row + aw + x] || edgeMask[row + x - 1] || edgeMask[row + x + 1]) {
            closedMask[row + x] = 1;
          }
        }
      }

      // 5. Ekstraksi Boundary Points dari Garis Tepi Terluar
      const boundaryPoints = [];
      const cx = aw / 2;
      const cy = ah / 2;
      const numRays = 72;
      const maxRadius = Math.hypot(aw, ah) / 2;

      for (let i = 0; i < numRays; i++) {
        const rad = (i * 2 * Math.PI) / numRays;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        let bestR = 0;
        let peakG = 0;

        for (let r = 18; r < maxRadius; r += 2) {
          const rx = Math.round(cx + r * cosA);
          const ry = Math.round(cy + r * sinA);
          if (rx < 2 || rx >= aw - 2 || ry < 2 || ry >= ah - 2) break;

          const idx = ry * aw + rx;
          const gVal = grad[idx];
          if (gVal > peakG && (gVal >= edgeThreshold || closedMask[idx] === 1)) {
            peakG = gVal;
            bestR = r;
          }
        }

        if (bestR > 0) {
          boundaryPoints.push({
            x: (cx + bestR * cosA) / scale,
            y: (cy + bestR * sinA) / scale
          });
        }
      }

      // Kumpulkan juga titik kontur tepi biner yang signifikan
      for (let y = 4; y < ah - 4; y += 3) {
        for (let x = 4; x < aw - 4; x += 3) {
          const idx = y * aw + x;
          if (closedMask[idx] === 1 && grad[idx] > edgeThreshold * 1.2) {
            boundaryPoints.push({
              x: x / scale,
              y: y / scale
            });
          }
        }
      }

      if (boundaryPoints.length < 8) return fallbackCorners;

      // 6. Convex Hull
      const hull = this.computeConvexHull(boundaryPoints);
      if (hull.length < 4) return fallbackCorners;

      // 7. Cari 4 Sudut Terbaik dengan Evaluasi Edge Alignment
      const quad = this.findBestQuadrilateral(hull, grad, aw, ah, scale, width * height);
      if (quad && quad.length === 4) {
        return this.orderCornersClockwise(quad);
      }

      return fallbackCorners;
    } catch (err) {
      console.warn("CV Auto-detection fallback:", err);
      return fallbackCorners;
    }
  }

  /**
   * Andrew's Monotone Chain Convex Hull O(N log N)
   */
  static computeConvexHull(points) {
    const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  /**
   * Memeriksa apakah 4 titik membentuk segi empat cembung (Convex Quadrilateral)
   */
  static isConvexQuad(pts) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % 4];
      const p3 = pts[(i + 2) % 4];
      const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
      if (cross !== 0) {
        if (sign === 0) sign = cross > 0 ? 1 : -1;
        else if ((cross > 0 ? 1 : -1) !== sign) return false;
      }
    }
    return true;
  }

  /**
   * Menghitung skor kekuatan gradien di sepanjang 4 garis sisi quadrilateral
   */
  static computeQuadEdgeGradientScore(corners, grad, aw, ah, scale) {
    if (!grad) return 1;
    let sumGrad = 0;
    let samples = 0;

    for (let i = 0; i < 4; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      const numSteps = 16;
      for (let s = 0; s <= numSteps; s++) {
        const t = s / numSteps;
        const imgX = (p1.x + (p2.x - p1.x) * t) * scale;
        const imgY = (p1.y + (p2.y - p1.y) * t) * scale;
        const gx = Math.round(imgX);
        const gy = Math.round(imgY);
        if (gx >= 0 && gx < aw && gy >= 0 && gy < ah) {
          sumGrad += grad[gy * aw + gx];
          samples++;
        }
      }
    }
    return samples > 0 ? sumGrad / samples : 1;
  }

  /**
   * Mencari 4 sudut poligon terbaik dengan kombinasi Area & Edge Alignment
   */
  static findBestQuadrilateral(hull, grad, aw, ah, scale, totalImageArea) {
    if (hull.length === 4) return hull;

    let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
    let minSum = Infinity, maxSum = -Infinity;
    let minDiff = Infinity, maxDiff = -Infinity;

    for (const pt of hull) {
      const sum = pt.x + pt.y;
      const diff = pt.x - pt.y;
      if (sum < minSum) { minSum = sum; tl = pt; }
      if (sum > maxSum) { maxSum = sum; br = pt; }
      if (diff > maxDiff) { maxDiff = diff; tr = pt; }
      if (diff < minDiff) { minDiff = diff; bl = pt; }
    }

    const defaultQuad = [tl, tr, br, bl];
    const candidates = [defaultQuad];

    const n = hull.length;
    const step = n > 36 ? Math.ceil(n / 32) : 1;
    const subHull = [];
    for (let i = 0; i < n; i += step) subHull.push(hull[i]);

    const m = subHull.length;
    for (let i = 0; i < m - 3; i++) {
      for (let j = i + 1; j < m - 2; j++) {
        for (let k = j + 1; k < m - 1; k++) {
          for (let l = k + 1; l < m; l++) {
            candidates.push([subHull[i], subHull[j], subHull[k], subHull[l]]);
          }
        }
      }
    }

    let bestQuad = defaultQuad;
    let bestScore = -Infinity;

    for (const cand of candidates) {
      const ordered = this.orderCornersClockwise(cand);
      const area = this.polygonArea(ordered);
      const areaRatio = area / (totalImageArea || 1);

      // Area dokumen wajar: antara 10% s/d 98% layar
      if (areaRatio < 0.10 || areaRatio > 0.98) continue;
      if (!this.isConvexQuad(ordered)) continue;

      const edgeScore = this.computeQuadEdgeGradientScore(ordered, grad, aw, ah, scale);
      const totalScore = Math.pow(areaRatio, 0.35) * edgeScore;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestQuad = ordered;
      }
    }

    return bestQuad;
  }

  static polygonArea(pts) {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  }

  static orderCornersClockwise(corners) {
    const sortedY = corners.slice().sort((a, b) => a.y - b.y);
    const topTwo = sortedY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottomTwo = sortedY.slice(2, 4).sort((a, b) => a.x - b.x);

    const tl = topTwo[0];
    const tr = topTwo[1];
    const bl = bottomTwo[0];
    const br = bottomTwo[1];

    return [tl, tr, br, bl];
  }

  /**
   * Menghitung matriks transformasi perspektif (Homography 3x3)
   */
  static getPerspectiveTransformMatrix(src, dst) {
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
   * Menghitung dimensi alami dokumen dari 4 sudut (mempertahankan rasio aspek asli, tidak gepeng)
   */
  static computeNaturalDimensions(corners, maxDim = 2000) {
    const [tl, tr, br, bl] = corners;
    const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const naturalW = Math.max(widthBottom, widthTop);

    const heightRight = Math.hypot(tr.x - br.x, tr.y - br.y);
    const heightLeft = Math.hypot(tl.x - bl.x, tl.y - bl.y);
    const naturalH = Math.max(heightRight, heightLeft);

    // Skala resolusi tinggi untuk menjaga ketajaman huruf
    const scale = maxDim / Math.max(naturalW, naturalH);
    const targetW = Math.max(300, Math.round(naturalW * scale));
    const targetH = Math.max(300, Math.round(naturalH * scale));

    return { width: targetW, height: targetH };
  }

  /**
   * Memutar canvas 90 derajat searah jarum jam secara bebas
   */
  static rotateCanvas(canvas, degrees = 90) {
    const rad = (degrees * Math.PI) / 180;
    const newCanvas = document.createElement('canvas');

    if (degrees === 90 || degrees === 270) {
      newCanvas.width = canvas.height;
      newCanvas.height = canvas.width;
    } else {
      newCanvas.width = canvas.width;
      newCanvas.height = canvas.height;
    }

    const ctx = newCanvas.getContext('2d', { willReadFrequently: true });
    ctx.translate(newCanvas.width / 2, newCanvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return newCanvas;
  }

  /**
   * Meluruskan sudut dokumen foto ke bidang datar persegi (Perspective Warp)
   * Menggunakan interpolasi bilinear terbalik (Backward Mapping) bebas celah
   */
  static warpPerspective(sourceCanvas, corners, outWidth = null, outHeight = null) {
    if (!outWidth || !outHeight) {
      const dims = this.computeNaturalDimensions(corners, 2000);
      outWidth = dims.width;
      outHeight = dims.height;
    }

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

    // Matriks invers dari target ke source (Backward mapping)
    const H = this.getPerspectiveTransformMatrix(dstCorners, corners);

    const sW = sourceCanvas.width;
    const sH = sourceCanvas.height;
    const srcPixels = srcData.data;
    const dstPixels = dstData.data;

    const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = H;

    for (let y = 0; y < outHeight; y++) {
      const rowOffset = y * outWidth;
      for (let x = 0; x < outWidth; x++) {
        const denom = h31 * x + h32 * y + h33;
        if (denom === 0) continue;

        const sx = (h11 * x + h12 * y + h13) / denom;
        const sy = (h21 * x + h22 * y + h23) / denom;

        if (sx >= 0 && sx < sW - 1 && sy >= 0 && sy < sH - 1) {
          // Bilinear Interpolation
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const dx = sx - x0;
          const dy = sy - y0;
          const w00 = (1 - dx) * (1 - dy);
          const w10 = dx * (1 - dy);
          const w01 = (1 - dx) * dy;
          const w11 = dx * dy;

          const idx00 = (y0 * sW + x0) * 4;
          const idx10 = (y0 * sW + x1) * 4;
          const idx01 = (y1 * sW + x0) * 4;
          const idx11 = (y1 * sW + x1) * 4;

          const dstIdx = (rowOffset + x) * 4;

          dstPixels[dstIdx] = Math.round(
            w00 * srcPixels[idx00] + w10 * srcPixels[idx10] +
            w01 * srcPixels[idx01] + w11 * srcPixels[idx11]
          );
          dstPixels[dstIdx + 1] = Math.round(
            w00 * srcPixels[idx00 + 1] + w10 * srcPixels[idx10 + 1] +
            w01 * srcPixels[idx01 + 1] + w11 * srcPixels[idx11 + 1]
          );
          dstPixels[dstIdx + 2] = Math.round(
            w00 * srcPixels[idx00 + 2] + w10 * srcPixels[idx10 + 2] +
            w01 * srcPixels[idx01 + 2] + w11 * srcPixels[idx11 + 2]
          );
          dstPixels[dstIdx + 3] = 255;
        }
      }
    }

    targetCtx.putImageData(dstData, 0, 0);
    return targetCanvas;
  }

  /**
   * CamScanner Pro Filter Suite:
   * 1. Magic Color: Local Illumination Normalization + Continuous S-Curve Tone Mapping (Line-Preserving)
   *    - Memutihkan kertas tanpa menghilangkan garis tabel dan garis buku tulis tipis
   *    - Menjaga saturasi stempel merah/biru dan tanda tangan pulpen
   * 2. B&W: Bradley-Roth Adaptive Thresholding dengan sensitivitas tinggi untuk garis tabel & teks
   * 3. Grayscale: Normalized Gray Tone
   * 4. Original: Raw capture with contrast tuning
   * 5. Text & Line Sharpening: Laplacian Unsharp Mask
   */
  static applyDocumentFilter(canvas, filterType = 'magic', brightness = 0, contrast = 0) {
    const width = canvas.width;
    const height = canvas.height;

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const ctx = outputCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);

    if (filterType === 'original' && brightness === 0 && contrast === 0) {
      return outputCanvas;
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // -------------------------------------------------------------------------
    // A. MAGIC COLOR (CamScanner Pro: Continuous Tone Curve & Table Line Preservation)
    // -------------------------------------------------------------------------
    if (filterType === 'magic') {
      // 1. Peta Pencahayaan Kertas Lokal (Local Paper Background Estimation)
      // Menggunakan sampling lokal untuk mendeteksi kecerahan kertas asli
      // tanpa menganggap garis tabel atau garis buku tulis sebagai bayangan
      const step = 24;
      const gw = Math.ceil(width / step);
      const gh = Math.ceil(height / step);
      const bgGrid = new Float32Array(gw * gh);

      for (let gy = 0; gy < gh; gy++) {
        const yStart = gy * step;
        const yEnd = Math.min(height, yStart + step);
        for (let gx = 0; gx < gw; gx++) {
          const xStart = gx * step;
          const xEnd = Math.min(width, xStart + step);

          let maxLum = 0;
          for (let y = yStart; y < yEnd; y += 2) {
            const row = y * width;
            for (let x = xStart; x < xEnd; x += 2) {
              const i = (row + x) * 4;
              const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              if (lum > maxLum) maxLum = lum;
            }
          }
          bgGrid[gy * gw + gx] = Math.max(35, maxLum);
        }
      }

      // Smooth background illumination grid dengan 2-pass box blur
      const smoothGrid = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          let sum = 0, count = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const ny = gy + dy;
            if (ny < 0 || ny >= gh) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = gx + dx;
              if (nx < 0 || nx >= gw) continue;
              sum += bgGrid[ny * gw + nx];
              count++;
            }
          }
          smoothGrid[gy * gw + gx] = sum / count;
        }
      }

      // 2. Normalisasi & Continuous S-Curve Tone Mapping
      for (let y = 0; y < height; y++) {
        const gy = Math.min(gh - 1, Math.floor(y / step));
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const gx = Math.min(gw - 1, Math.floor(x / step));
          const localBg = Math.max(30, smoothGrid[gy * gw + gx]);
          const normFactor = 245 / localBg;

          const idx = (row + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Hilangkan bayangan dengan normalisasi terhadap latar lokal
          let normR = Math.min(255, r * normFactor);
          let normG = Math.min(255, g * normFactor);
          let normB = Math.min(255, b * normFactor);

          const normLum = 0.299 * normR + 0.587 * normG + 0.114 * normB;

          // Deteksi saturasi warna (stempel merah/biru, pulpen, logo, garis buku biru)
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC - minC;

          // Target Luminance dengan Sigmoid S-Curve Halus (Mencegah garis tabel/buku hilang)
          let targetLum;
          const paperWhite = 224;
          const inkBlack = 85;

          if (normLum >= paperWhite) {
            targetLum = 255;
          } else if (normLum <= inkBlack) {
            targetLum = Math.max(0, normLum * 0.52);
          } else {
            // Mid-tones: Garis tabel, kotak formulir, garis buku tulis bergaris
            // Menggunakan kurva kontinu (continuous curve) agar garis abu-abu tetap terlihat tajam!
            const u = (normLum - inkBlack) / (paperWhite - inkBlack);
            targetLum = (inkBlack * 0.52) + (paperWhite - inkBlack * 0.52) * Math.pow(u, 1.28);
          }

          if (sat > 16) {
            // Tinta Berwarna: Pulpen biru, stempel merah, spidol, garis buku biru
            const satBoost = 1.30;
            normR = Math.min(255, Math.max(0, targetLum + (normR - normLum) * satBoost));
            normG = Math.min(255, Math.max(0, targetLum + (normG - normLum) * satBoost));
            normB = Math.min(255, Math.max(0, targetLum + (normB - normLum) * satBoost));
          } else {
            // Tinta Netral: Teks dan garis tabel hitam/abu-abu
            normR = targetLum;
            normG = targetLum;
            normB = targetLum;
          }

          data[idx] = Math.min(255, Math.max(0, Math.round(normR)));
          data[idx + 1] = Math.min(255, Math.max(0, Math.round(normG)));
          data[idx + 2] = Math.min(255, Math.max(0, Math.round(normB)));
        }
      }
    }

    // -------------------------------------------------------------------------
    // B. HITAM PUTIH FOTOKOPI (Bradley-Roth Local Adaptive Thresholding)
    // -------------------------------------------------------------------------
    else if (filterType === 'bw') {
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }

      const integral = new Float64Array(width * height);
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y < height; y++) {
          sum += gray[y * width + x];
          if (x === 0) {
            integral[y * width + x] = sum;
          } else {
            integral[y * width + x] = integral[y * width + (x - 1)] + sum;
          }
        }
      }

      const s = Math.max(12, Math.floor(width / 18));
      const s2 = Math.floor(s / 2);
      // Sensitivitas T = 0.08 agar garis tabel tipis dan arsiran buku tulis ikut tertangkap
      const T = 0.08;

      for (let y = 0; y < height; y++) {
        const y1 = Math.max(0, y - s2);
        const y2 = Math.min(height - 1, y + s2);
        for (let x = 0; x < width; x++) {
          const x1 = Math.max(0, x - s2);
          const x2 = Math.min(width - 1, x + s2);

          const count = (x2 - x1) * (y2 - y1);
          const sum = integral[y2 * width + x2] -
                      integral[y1 * width + x2] -
                      integral[y2 * width + x1] +
                      integral[y1 * width + x1];

          const curr = gray[y * width + x];
          const val = (curr * count) < (sum * (1 - T)) ? 0 : 255;

          const idx = (y * width + x) * 4;
          data[idx] = val;
          data[idx + 1] = val;
          data[idx + 2] = val;
        }
      }
    }

    // -------------------------------------------------------------------------
    // C. GRAYSCALE BERSIH
    // -------------------------------------------------------------------------
    else if (filterType === 'grayscale') {
      for (let i = 0; i < data.length; i += 4) {
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = lum;
        data[i + 1] = lum;
        data[i + 2] = lum;
      }
    }

    // -------------------------------------------------------------------------
    // D. FINE-TUNING BRIGHTNESS & CONTRAST
    // -------------------------------------------------------------------------
    if (brightness !== 0 || contrast !== 0) {
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          let val = data[i + c] + brightness;
          if (contrast !== 0) {
            val = factor * (val - 128) + 128;
          }
          data[i + c] = Math.min(255, Math.max(0, val));
        }
      }
    }

    // -------------------------------------------------------------------------
    // E. TEXT & LINE SHARPENING PASS (Laplacian Unsharp Mask)
    // Menajamkan guratan huruf, garis tabel, angka kecil, stempel, dan tanda tangan
    // -------------------------------------------------------------------------
    if (filterType === 'magic' || filterType === 'bw' || filterType === 'grayscale') {
      const sharpenAlpha = 0.45;
      const copy = new Uint8ClampedArray(data);

      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = (row + x) * 4;
          const lum = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];

          // Tajamkan area teks/tinta dan garis tabel (bukan background putih polos)
          if (lum < 238) {
            for (let c = 0; c < 3; c++) {
              const val = copy[idx + c];
              const up = copy[idx - width * 4 + c];
              const down = copy[idx + width * 4 + c];
              const left = copy[idx - 4 + c];
              const right = copy[idx + 4 + c];

              const laplacian = (4 * val) - up - down - left - right;
              data[idx + c] = Math.min(255, Math.max(0, Math.round(val + sharpenAlpha * laplacian)));
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return outputCanvas;
  }
}
