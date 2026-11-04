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
   * Deteksi 4 Sudut Dokumen Otomatis (Auto Edge Detection)
   * Berbasis Computer Vision: Otsu Binarization, Connected Component Blob Analysis,
   * Andrew's Monotone Chain Convex Hull, & Quad Optimization
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

      // 1. Downscale ke resolusi analisis (~320px) agar kilat (< 20ms di HP)
      const targetDim = 320;
      const scale = targetDim / Math.max(width, height);
      const aw = Math.max(10, Math.round(width * scale));
      const ah = Math.max(10, Math.round(height * scale));

      const gray = new Uint8Array(aw * ah);
      const hist = new Int32Array(256);

      for (let y = 0; y < ah; y++) {
        const srcY = Math.min(height - 1, Math.floor(y / scale));
        for (let x = 0; x < aw; x++) {
          const srcX = Math.min(width - 1, Math.floor(x / scale));
          const idx = (srcY * width + srcX) * 4;
          const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
          gray[y * aw + x] = lum;
          hist[lum]++;
        }
      }

      // 2. Otsu's Thresholding untuk memisahkan kertas terang vs latar belakang meja
      const totalPixels = aw * ah;
      let sumAll = 0;
      for (let t = 0; t < 256; t++) sumAll += t * hist[t];

      let sumB = 0, wB = 0, wF = 0, varMax = 0, otsuThreshold = 128;
      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        wF = totalPixels - wB;
        if (wF === 0) break;

        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const varBetween = wB * wF * (mB - mF) * (mB - mF);
        if (varBetween > varMax) {
          varMax = varBetween;
          otsuThreshold = t;
        }
      }

      // 3. Binary Mask & Connected Component Analysis (BFS Blob Extraction)
      const mask = new Uint8Array(aw * ah);
      for (let i = 0; i < gray.length; i++) {
        mask[i] = gray[i] >= otsuThreshold ? 1 : 0;
      }

      const visited = new Uint8Array(aw * ah);
      let maxBlobSize = 0;
      let maxBlobBorder = [];

      for (let y = 1; y < ah - 1; y++) {
        for (let x = 1; x < aw - 1; x++) {
          const idx = y * aw + x;
          if (mask[idx] === 1 && !visited[idx]) {
            const queue = [idx];
            visited[idx] = 1;
            const borderPts = [];

            let head = 0;
            while (head < queue.length) {
              const curr = queue[head++];
              const cy = Math.floor(curr / aw);
              const cx = curr % aw;

              // Titik batas tepi komponen (border pixel)
              const isBorder = (
                mask[(cy - 1) * aw + cx] === 0 ||
                mask[(cy + 1) * aw + cx] === 0 ||
                mask[cy * aw + (cx - 1)] === 0 ||
                mask[cy * aw + (cx + 1)] === 0
              );
              if (isBorder) {
                borderPts.push({ x: cx / scale, y: cy / scale });
              }

              // 4-Neighbors
              const neighbors = [
                (cy - 1) * aw + cx,
                (cy + 1) * aw + cx,
                cy * aw + (cx - 1),
                cy * aw + (cx + 1)
              ];

              for (const n of neighbors) {
                if (n >= 0 && n < aw * ah && mask[n] === 1 && !visited[n]) {
                  visited[n] = 1;
                  queue.push(n);
                }
              }
            }

            if (queue.length > maxBlobSize) {
              maxBlobSize = queue.length;
              maxBlobBorder = borderPts;
            }
          }
        }
      }

      // Jika komponen dokumen terdeteksi minimal 10% dari layar
      const blobAreaRatio = maxBlobSize / totalPixels;
      if (blobAreaRatio >= 0.08 && maxBlobBorder.length >= 8) {
        // 4. Convex Hull dari batas tepi dokumen terbesar
        const hull = this.computeConvexHull(maxBlobBorder);
        if (hull.length >= 4) {
          // 5. Cari 4 Sudut Sejati yang memaksimalkan luas segi empat
          const quad = this.findBestQuadrilateral(hull);
          if (quad && quad.length === 4) {
            return this.orderCornersClockwise(quad);
          }
        }
      }

      // 4-Fallback ke Sobel Edge Gradient jika dokumen kontras rendah
      return this.detectCornersBySobel(aw, ah, gray, scale, fallbackCorners);

    } catch (err) {
      console.warn("CV Auto-detection fallback:", err);
      return fallbackCorners;
    }
  }

  /**
   * Fallback Sobel Edge Detection jika Otsu binarization ambigu
   */
  static detectCornersBySobel(aw, ah, gray, scale, fallbackCorners) {
    const blurred = new Uint8Array(aw * ah);
    for (let y = 2; y < ah - 2; y++) {
      for (let x = 2; x < aw - 2; x++) {
        let bSum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            bSum += gray[(y + dy) * aw + (x + dx)];
          }
        }
        blurred[y * aw + x] = Math.round(bSum / 25);
      }
    }

    const grad = new Float32Array(aw * ah);
    let maxGrad = 0;
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1; x < aw - 1; x++) {
        const gx = -blurred[(y-1)*aw + (x-1)] + blurred[(y-1)*aw + (x+1)]
                   - 2 * blurred[y*aw + (x-1)] + 2 * blurred[y*aw + (x+1)]
                   - blurred[(y+1)*aw + (x-1)] + blurred[(y+1)*aw + (x+1)];
        const gy = -blurred[(y-1)*aw + (x-1)] - 2 * blurred[(y-1)*aw + x] - blurred[(y-1)*aw + (x+1)]
                   + blurred[(y+1)*aw + (x-1)] + 2 * blurred[(y+1)*aw + x] + blurred[(y+1)*aw + (x+1)];
        const g = Math.abs(gx) + Math.abs(gy);
        grad[y * aw + x] = g;
        if (g > maxGrad) maxGrad = g;
      }
    }

    if (maxGrad < 25) return fallbackCorners;

    const boundaryPoints = [];
    const gradThreshold = maxGrad * 0.28;
    const cx = aw / 2;
    const cy = ah / 2;
    const numRays = 64;
    const maxRadius = Math.hypot(aw, ah) / 2;

    for (let i = 0; i < numRays; i++) {
      const rad = (i * 2 * Math.PI) / numRays;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      let bestR = 0;
      let peakG = 0;

      for (let r = 15; r < maxRadius; r += 2) {
        const rx = Math.round(cx + r * cosA);
        const ry = Math.round(cy + r * sinA);
        if (rx < 2 || rx >= aw - 2 || ry < 2 || ry >= ah - 2) break;

        const gVal = grad[ry * aw + rx];
        if (gVal > peakG && gVal > gradThreshold) {
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

    if (boundaryPoints.length < 8) return fallbackCorners;
    const hull = this.computeConvexHull(boundaryPoints);
    if (hull.length < 4) return fallbackCorners;
    const quad = this.findBestQuadrilateral(hull);
    return this.orderCornersClockwise(quad);
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
   * Mencari 4 sudut poligon terbaik yang memaksimalkan area segi empat
   */
  static findBestQuadrilateral(hull) {
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

    let bestQuad = [tl, tr, br, bl];
    let maxArea = this.polygonArea(bestQuad);

    const n = hull.length;
    if (n <= 35) {
      for (let i = 0; i < n - 3; i++) {
        for (let j = i + 1; j < n - 2; j++) {
          for (let k = j + 1; k < n - 1; k++) {
            for (let l = k + 1; l < n; l++) {
              const cand = [hull[i], hull[j], hull[k], hull[l]];
              const a = this.polygonArea(cand);
              if (a > maxArea) {
                maxArea = a;
                bestQuad = cand;
              }
            }
          }
        }
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
   * CamScanner Filter Suite:
   * 1. Magic Color: Local Illumination Division (Shadow Eraser) + S-Curve + Stamp Color Retention
   * 2. B&W: Bradley-Roth Local Adaptive Thresholding (Crisp Photocopier Text)
   * 3. Grayscale: Normalized Gray Tone
   * 4. Original: Raw capture with contrast tuning
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
    // A. MAGIC COLOR (Teknologi Inti CamScanner: Background Division Shadow Eraser)
    // -------------------------------------------------------------------------
    if (filterType === 'magic') {
      const bgScale = 16;
      const bw = Math.max(8, Math.floor(width / bgScale));
      const bh = Math.max(8, Math.floor(height / bgScale));
      const bgLum = new Float32Array(bw * bh);

      for (let by = 0; by < bh; by++) {
        const sy = Math.min(height - 1, by * bgScale);
        for (let bx = 0; bx < bw; bx++) {
          const sx = Math.min(width - 1, bx * bgScale);
          const i = (sy * width + sx) * 4;
          bgLum[by * bw + bx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }

      // Blur peta pencahayaan untuk mendapatkan ambang terang latar belakang lokal
      const blurredBg = new Float32Array(bw * bh);
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          let sum = 0, count = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const ny = by + dy;
            if (ny < 0 || ny >= bh) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = bx + dx;
              if (nx < 0 || nx >= bw) continue;
              sum += bgLum[ny * bw + nx];
              count++;
            }
          }
          blurredBg[by * bw + bx] = sum / count;
        }
      }

      // Terapkan pembagian latar belakang (Background Division) & S-Curve
      for (let y = 0; y < height; y++) {
        const by = Math.min(bh - 1, Math.floor(y / bgScale));
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
          const bx = Math.min(bw - 1, Math.floor(x / bgScale));
          const localBg = Math.max(30, blurredBg[by * bw + bx]);

          const idx = (rowOffset + x) * 4;
          let r = data[idx];
          let g = data[idx + 1];
          let b = data[idx + 2];

          // Eliminasi bayangan gelap dengan normalisasi terhadap kecerahan lokal
          let normR = Math.min(255, (r / localBg) * 242);
          let normG = Math.min(255, (g / localBg) * 242);
          let normB = Math.min(255, (b / localBg) * 242);

          const lum = 0.299 * normR + 0.587 * normG + 0.114 * normB;

          // Deteksi Saturasi Warna (Stempel Merah/Biru, Tanda Tangan, Logo)
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC - minC;

          if (sat > 28) {
            const satBoost = 1.35;
            normR = Math.min(255, Math.max(0, lum + (normR - lum) * satBoost));
            normG = Math.min(255, Math.max(0, lum + (normG - lum) * satBoost));
            normB = Math.min(255, Math.max(0, lum + (normB - lum) * satBoost));
          } else {
            if (lum < 140) {
              normR *= 0.65;
              normG *= 0.65;
              normB *= 0.65;
            } else if (lum > 165) {
              normR = 255;
              normG = 255;
              normB = 255;
            }
          }

          data[idx] = Math.min(255, Math.max(0, normR));
          data[idx + 1] = Math.min(255, Math.max(0, normG));
          data[idx + 2] = Math.min(255, Math.max(0, normB));
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

      const s = Math.max(12, Math.floor(width / 16));
      const s2 = Math.floor(s / 2);
      const T = 0.14;

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
    // E. TEXT SHARPENING PASS (Laplacian Unsharp Mask)
    // Menajamkan guratan huruf, angka kecil, stempel, dan tanda tangan agar jernih dibaca
    // -------------------------------------------------------------------------
    if (filterType === 'magic' || filterType === 'bw' || filterType === 'grayscale') {
      const sharpenAlpha = 0.40;
      const copy = new Uint8ClampedArray(data);

      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = (row + x) * 4;
          const lum = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];

          // Hanya tajamkan area teks/tinta dan batas kontras (bukan background putih polos)
          if (lum < 235) {
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
