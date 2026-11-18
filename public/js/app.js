import { ScannerCore } from './scanner-core.js';
import { PdfExporter } from './pdf-exporter.js';
import { initializeDocumentWorkspace } from './document-workspace.js';
import { openToolModal, closeToolModal, handleFilesSelected, executeActiveTool } from './pdf-tools.js';

// Application State
const state = {
  importQueue: [],
  pages: [],             // { id, canvas, filter }
  rawImage: null,        // HTMLImageElement atau ImageBitmap asli
  workingCanvas: null,   // Canvas gambar asli yang sedang diedit
  corners: [],           // [TL, TR, BR, BL]
  dragCornerIdx: -1,     // Index sudut yang sedang ditarik (-1 = tidak ada)
  touchOffset: { x: 0, y: 0 },
  rotation: 0,           // 0, 90, 180, 270
  filter: 'magic',       // 'magic', 'bw', 'grayscale', 'original'
  warpedCanvas: null,    // Canvas hasil pelurusan perspektif
  filteredCanvas: null,  // Canvas hasil filter akhir
  brightness: 0,
  contrast: 15
};

// DOM Elements
const views = {
  home: document.getElementById('view-home'),
  crop: document.getElementById('view-crop'),
  enhance: document.getElementById('view-enhance'),
  doc: document.getElementById('view-document'),
  tools: document.getElementById('view-tools')
};

const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const loupeCanvas = document.getElementById('loupeCanvas');
const loupeCtx = loupeCanvas.getContext('2d');
const enhancePreview = document.getElementById('enhancePreview');
const pagesGrid = document.getElementById('pagesGrid');
let documentWorkspace;

// Switch Views
function showView(name) {
  Object.keys(views).forEach(key => {
    views[key].classList.toggle('active', key === name);
  });

  // Tampilkan navigasi bawah hanya pada tampilan beranda, alat, dan dokumen
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = (name === 'home' || name === 'tools' || name === 'doc') ? 'flex' : 'none';
  }

  // Sinkronisasi state tombol navigasi bawah
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  if (name === 'home') {
    document.getElementById('navBtnHome')?.classList.add('active');
  } else if (name === 'tools') {
    document.getElementById('navBtnTools')?.classList.add('active');
  } else if (name === 'doc') {
    document.getElementById('navBtnDocs')?.classList.add('active');
  }
}

// -------------------------------------------------------------
// 1. Image Input & Loading (Camera & Gallery)
// -------------------------------------------------------------
const cameraInput = document.getElementById('cameraInput');
const fileInput = document.getElementById('fileInput');

document.getElementById('btnStartCamera')?.addEventListener('click', () => {
  cameraInput.click();
});

document.getElementById('btnStartGallery')?.addEventListener('click', () => {
  fileInput.click();
});

document.getElementById('btnStartSample')?.addEventListener('click', () => {
  generateSampleDocument();
});

cameraInput.addEventListener('change', handleFileSelected);
fileInput.addEventListener('change', handleFileSelected);

function handleFileSelected(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  if (files.length + state.pages.length > 30) {
    alert('Maksimum 30 halaman per sesi. Pilih lebih sedikit foto.');
    return;
  }
  if (files.some(file => !file.type.startsWith('image/') || file.size > 25 * 1024 * 1024)) {
    alert('Pilih berkas gambar, maksimum 25 MB per foto.');
    return;
  }
  state.importQueue = files;
  loadNextQueuedImage();
}

function loadNextQueuedImage() {
  const file = state.importQueue.shift();
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      loadNewImage(img);
      document.getElementById('cropQueueTitle').textContent = state.importQueue.length
        ? `Sesuaikan · ${state.importQueue.length} foto berikutnya` : 'Sesuaikan Sudut';
    };
    img.onerror = () => { state.importQueue = []; alert('Foto tidak bisa dibaca. Gunakan JPEG, PNG, atau WebP.'); showView(state.pages.length ? 'doc' : 'home'); };
    img.src = event.target.result;
  };
  reader.onerror = () => { state.importQueue = []; alert('Berkas foto gagal dibaca.'); };
  reader.readAsDataURL(file);
}

function loadNewImage(img) {
  state.rawImage = img;
  state.rotation = 0;
  state.filter = 'magic';
  state.brightness = 0;
  state.contrast = 15;

  // Siapkan working canvas dengan resolusi proporsional max 2000px untuk performa mulus
  const maxDim = 2000;
  let w = img.width;
  let h = img.height;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  state.workingCanvas = canvas;

  // Auto Edge Detection
  const imgData = ctx.getImageData(0, 0, w, h);
  state.corners = ScannerCore.detectDocumentCorners(w, h, imgData);

  setupCropView();
  showView('crop');
}

// -------------------------------------------------------------
// 2. Crop / Perspective Corner View & Loupe
// -------------------------------------------------------------
let displayScale = 1;
let displayOffsetX = 0;
let displayOffsetY = 0;

function setupCropView() {
  const container = document.getElementById('cropContainer');
  const rect = container.getBoundingClientRect();
  const cWidth = rect.width || window.innerWidth - 32;
  const cHeight = rect.height || window.innerHeight - 220;

  cropCanvas.width = cWidth;
  cropCanvas.height = cHeight;

  const imgW = state.workingCanvas.width;
  const imgH = state.workingCanvas.height;

  // Hitung skala fit
  const scaleX = (cWidth - 40) / imgW;
  const scaleY = (cHeight - 40) / imgH;
  displayScale = Math.min(scaleX, scaleY);

  displayOffsetX = (cWidth - imgW * displayScale) / 2;
  displayOffsetY = (cHeight - imgH * displayScale) / 2;

  renderCropCanvas();
}

function imgToCanvas(pt) {
  return {
    x: displayOffsetX + pt.x * displayScale,
    y: displayOffsetY + pt.y * displayScale
  };
}

function canvasToImg(pt) {
  return {
    x: Math.max(0, Math.min(state.workingCanvas.width, (pt.x - displayOffsetX) / displayScale)),
    y: Math.max(0, Math.min(state.workingCanvas.height, (pt.y - displayOffsetY) / displayScale))
  };
}

function renderCropCanvas() {
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

  // Gambar citra asli
  const imgW = state.workingCanvas.width * displayScale;
  const imgH = state.workingCanvas.height * displayScale;
  cropCtx.drawImage(state.workingCanvas, displayOffsetX, displayOffsetY, imgW, imgH);

  // Gambar Masking redup di luar area crop
  const pts = state.corners.map(imgToCanvas);

  cropCtx.save();
  cropCtx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

  // Klip area poligon transparan
  cropCtx.globalCompositeOperation = 'destination-out';
  cropCtx.beginPath();
  cropCtx.moveTo(pts[0].x, pts[0].y);
  cropCtx.lineTo(pts[1].x, pts[1].y);
  cropCtx.lineTo(pts[2].x, pts[2].y);
  cropCtx.lineTo(pts[3].x, pts[3].y);
  cropCtx.closePath();
  cropCtx.fill();
  cropCtx.restore();

  // Gambar Garis Poligon Sudut
  cropCtx.beginPath();
  cropCtx.moveTo(pts[0].x, pts[0].y);
  cropCtx.lineTo(pts[1].x, pts[1].y);
  cropCtx.lineTo(pts[2].x, pts[2].y);
  cropCtx.lineTo(pts[3].x, pts[3].y);
  cropCtx.closePath();
  cropCtx.lineWidth = 3;
  cropCtx.strokeStyle = '#d4fb38';
  cropCtx.shadowColor = 'rgba(212, 251, 56, 0.7)';
  cropCtx.shadowBlur = 12;
  cropCtx.stroke();
  cropCtx.shadowBlur = 0;

  // Gambar Titik Sudut (Pin Handles)
  pts.forEach((pt, i) => {
    cropCtx.beginPath();
    cropCtx.arc(pt.x, pt.y, 16, 0, Math.PI * 2);
    cropCtx.fillStyle = '#d4fb38';
    cropCtx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    cropCtx.shadowBlur = 8;
    cropCtx.fill();

    cropCtx.beginPath();
    cropCtx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    cropCtx.fillStyle = '#080a0f';
    cropCtx.fill();
    cropCtx.shadowBlur = 0;
  });
}

// Interaksi Touch & Mouse Drag Sudut
function getPointerPos(e) {
  const rect = cropCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function handlePointerDown(e) {
  const pos = getPointerPos(e);
  const pts = state.corners.map(imgToCanvas);

  // Cari sudut terdekat dalam radius 45px
  let bestDist = 50;
  let bestIdx = -1;
  pts.forEach((pt, idx) => {
    const d = Math.hypot(pt.x - pos.x, pt.y - pos.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  });

  if (bestIdx !== -1) {
    state.dragCornerIdx = bestIdx;
    showLoupe(pos);
  }
}

function handlePointerMove(e) {
  if (state.dragCornerIdx === -1) return;
  e.preventDefault();
  const pos = getPointerPos(e);
  state.corners[state.dragCornerIdx] = canvasToImg(pos);
  renderCropCanvas();
  showLoupe(pos);
}

function handlePointerUp() {
  if (state.dragCornerIdx !== -1) {
    snapCornerToEdge(state.dragCornerIdx);
    state.dragCornerIdx = -1;
    renderCropCanvas();
  }
  hideLoupe();
}

/**
 * Magnetic Edge Snapping:
 * Menempelkan sudut pin ke piksel gradien tepi terkuat di sekitarnya saat jari dilepas
 */
function snapCornerToEdge(idx) {
  if (idx < 0 || idx >= 4 || !state.workingCanvas) return;
  const pt = state.corners[idx];
  const w = state.workingCanvas.width;
  const h = state.workingCanvas.height;
  const ctx = state.workingCanvas.getContext('2d', { willReadFrequently: true });

  const radius = 14;
  const sx = Math.max(1, Math.round(pt.x) - radius);
  const sy = Math.max(1, Math.round(pt.y) - radius);
  const sw = Math.min(w - 2 - sx, radius * 2);
  const sh = Math.min(h - 2 - sy, radius * 2);
  if (sw <= 3 || sh <= 3) return;

  const patch = ctx.getImageData(sx, sy, sw, sh).data;
  let maxGrad = 0;
  let bestX = pt.x;
  let bestY = pt.y;

  for (let py = 1; py < sh - 1; py++) {
    for (let px = 1; px < sw - 1; px++) {
      const idxR = (py * sw + px) * 4;
      const lumL = 0.299 * patch[idxR - 4] + 0.587 * patch[idxR - 3] + 0.114 * patch[idxR - 2];
      const lumR = 0.299 * patch[idxR + 4] + 0.587 * patch[idxR + 5] + 0.114 * patch[idxR + 6];
      const lumU = 0.299 * patch[idxR - sw * 4] + 0.587 * patch[idxR - sw * 4 + 1] + 0.114 * patch[idxR - sw * 4 + 2];
      const lumD = 0.299 * patch[idxR + sw * 4] + 0.587 * patch[idxR + sw * 4 + 1] + 0.114 * patch[idxR + sw * 4 + 2];
      const grad = Math.abs(lumR - lumL) + Math.abs(lumD - lumU);
      if (grad > maxGrad) {
        maxGrad = grad;
        bestX = sx + px;
        bestY = sy + py;
      }
    }
  }

  // Snap otomatis jika gradien kontras tinggi
  if (maxGrad > 40) {
    state.corners[idx] = { x: bestX, y: bestY };
  }
}

function showLoupe(canvasPos) {
  const corner = state.corners[state.dragCornerIdx];
  if (!corner) return;

  const loupeEl = document.getElementById('loupeContainer');
  loupeEl.style.display = 'block';

  // Posisi loupe melayang di atas jari
  const cx = canvasPos.x;
  const cy = Math.max(10, canvasPos.y - 120);
  loupeEl.style.left = `${cx - 55}px`;
  loupeEl.style.top = `${cy}px`;

  // Render perbesaran 2.5x di canvas loupe
  const lSize = 110;
  loupeCanvas.width = lSize;
  loupeCanvas.height = lSize;

  const zoom = 2.5;
  const srcW = lSize / zoom;
  const srcH = lSize / zoom;

  loupeCtx.clearRect(0, 0, lSize, lSize);
  loupeCtx.drawImage(
    state.workingCanvas,
    corner.x - srcW / 2, corner.y - srcH / 2, srcW, srcH,
    0, 0, lSize, lSize
  );

  // Crosshair bidik
  loupeCtx.strokeStyle = '#d4fb38';
  loupeCtx.lineWidth = 2;
  loupeCtx.beginPath();
  loupeCtx.arc(lSize / 2, lSize / 2, 8, 0, Math.PI * 2);
  loupeCtx.stroke();
}

function hideLoupe() {
  document.getElementById('loupeContainer').style.display = 'none';
}

cropCanvas.addEventListener('mousedown', handlePointerDown);
window.addEventListener('mousemove', handlePointerMove);
window.addEventListener('mouseup', handlePointerUp);

cropCanvas.addEventListener('touchstart', handlePointerDown, { passive: false });
window.addEventListener('touchmove', handlePointerMove, { passive: false });
window.addEventListener('touchend', handlePointerUp);

// Tombol Aksi Crop View
document.getElementById('btnResetCrop').addEventListener('click', () => {
  const w = state.workingCanvas.width;
  const h = state.workingCanvas.height;
  state.corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h }
  ];
  renderCropCanvas();
});

document.getElementById('btnAutoDetect').addEventListener('click', () => {
  const btn = document.getElementById('btnAutoDetect');
  const origText = btn.innerHTML;
  btn.innerHTML = '<span>Mencari...</span>';

  setTimeout(() => {
    const w = state.workingCanvas.width;
    const h = state.workingCanvas.height;
    const imgData = state.workingCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    state.corners = ScannerCore.detectDocumentCorners(w, h, imgData);
    renderCropCanvas();
    btn.innerHTML = origText;
  }, 30);
});

document.getElementById('btnRotate').addEventListener('click', () => {
  rotateWorkingCanvas();
});

function rotateWorkingCanvas() {
  const oldCanvas = state.workingCanvas;
  const newCanvas = document.createElement('canvas');
  newCanvas.width = oldCanvas.height;
  newCanvas.height = oldCanvas.width;

  const ctx = newCanvas.getContext('2d');
  ctx.translate(newCanvas.width / 2, newCanvas.height / 2);
  ctx.rotate((90 * Math.PI) / 180);
  ctx.drawImage(oldCanvas, -oldCanvas.width / 2, -oldCanvas.height / 2);

  state.workingCanvas = newCanvas;

  // Putar juga posisi 4 sudut
  state.corners = state.corners.map(pt => ({
    x: newCanvas.width - pt.y,
    y: pt.x
  }));

  setupCropView();
}

// -------------------------------------------------------------
// 3. Warp to Document & Filter / Enhance View
// -------------------------------------------------------------
document.getElementById('btnWarpDone').addEventListener('click', () => {
  // Melakukan Warp Perspektif dengan dimensi alami dokumen (mempertahankan rasio aspek asli, tidak gepeng)
  state.warpedCanvas = ScannerCore.warpPerspective(state.workingCanvas, state.corners);
  updateEnhancedPreview();
  showView('enhance');
});

// Fitur Putar 90 Derajat di Halaman Filter (Enhance View)
function rotateEnhancedCanvas() {
  if (!state.warpedCanvas) return;
  state.warpedCanvas = ScannerCore.rotateCanvas(state.warpedCanvas, 90);
  updateEnhancedPreview();
}

document.getElementById('btnEnhanceRotate')?.addEventListener('click', rotateEnhancedCanvas);
document.getElementById('btnEnhanceRotateHeader')?.addEventListener('click', rotateEnhancedCanvas);

function updateEnhancedPreview() {
  state.filteredCanvas = ScannerCore.applyDocumentFilter(
    state.warpedCanvas,
    state.filter,
    state.brightness,
    state.contrast
  );
  enhancePreview.src = state.filteredCanvas.toDataURL('image/jpeg', 0.9);
}

// Filter presets
document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    updateEnhancedPreview();
  });
});

// Slider contrast / brightness
const contrastSlider = document.getElementById('contrastSlider');
contrastSlider.addEventListener('input', (e) => {
  state.contrast = parseInt(e.target.value, 10);
  const valLabel = document.getElementById('contrastValueLabel');
  if (valLabel) {
    valLabel.textContent = (state.contrast > 0 ? '+' : '') + state.contrast;
  }
  updateEnhancedPreview();
});

// Tombol Simpan Halaman
document.getElementById('btnSavePage').addEventListener('click', () => {
  saveCurrentPage();
});

document.getElementById('btnAddAnother').addEventListener('click', () => {
  if (saveCurrentPage()) return;
  // Buka kamera/pilih foto untuk halaman berikutnya
  cameraInput.click();
});

function saveCurrentPage() {
  if (!state.filteredCanvas || state.pages.length >= 30) {
    alert('Maksimum 30 halaman per sesi. Ekspor dokumen sebelum menambah halaman.');
    return true;
  }
  const pageId = `page-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  const dataUrl = state.filteredCanvas.toDataURL('image/jpeg', 0.88);
  const metadata = {
    pageSize: document.getElementById('defaultPageSize').value,
    category: document.getElementById('documentMode').value === 'application' ? document.getElementById('newPageCategory').value : 'other',
  };
  state.pages.push({
    id: pageId,
    canvas: state.filteredCanvas,
    filter: state.filter,
    dataUrl: dataUrl,
    ...metadata
  });

  renderPagesGrid();
  showView('doc');

  // Realtime Multi-Device Sync: Kirim ke server agar langsung muncul di Laptop/PC
  sendSessionChange('/api/session/add-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: pageId, filter: state.filter, dataUrl: dataUrl, ...metadata })
  }).then(r => r ? r.json() : null).then(res => {
    if (res && res.lastUpdated) state.lastSyncedAt = res.lastUpdated;
    updateSyncBadge(state.pages.length);
  }).catch(err => console.debug('Sync add page error:', err));
  if (state.importQueue.length) {
    loadNextQueuedImage();
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// 4. Multi-Page Document Gallery & PDF Export
// -------------------------------------------------------------
function renderPagesGrid() {
  pagesGrid.innerHTML = '';
  const count = state.pages.length;
  document.getElementById('docPageCount').textContent = `${count} Halaman`;

  // Sinkronisasi badge navigasi bawah
  const badge1 = document.getElementById('navDocBadge');
  const badge2 = document.getElementById('navDocBadge2');
  if (badge1) {
    badge1.textContent = count;
    badge1.style.display = count > 0 ? 'flex' : 'none';
  }
  if (badge2) {
    badge2.textContent = count;
    badge2.style.display = count > 0 ? 'flex' : 'none';
  }

  // Update daftar dokumen siap ekspor di beranda
  const homeRecents = document.getElementById('homeRecentScans');
  const homeList = document.getElementById('homeRecentList');
  if (homeRecents && homeList) {
    if (count > 0) {
      homeRecents.style.display = 'flex';
      homeList.innerHTML = '';
      state.pages.forEach((p, idx) => {
        const thumb = document.createElement('img');
        thumb.className = 'recents-thumb';
        thumb.src = p.dataUrl || p.canvas.toDataURL('image/jpeg', 0.5);
        thumb.alt = `Halaman ${idx + 1}`;
        thumb.title = `Halaman ${idx + 1} - Klik untuk lihat`;
        thumb.style.cursor = 'pointer';
        thumb.addEventListener('click', () => showView('doc'));
        homeList.appendChild(thumb);
      });
    } else {
      homeRecents.style.display = 'none';
      homeList.innerHTML = '';
    }
  }

  state.pages.forEach((page, index) => {
    const card = document.createElement('div');
    card.className = 'page-thumb-card';
    card.innerHTML = `
      <div class="thumb-header">
        <span>Hal ${index + 1}</span>
        <div class="thumb-actions">
          <button class="thumb-rot-btn" data-id="${page.id}" title="Putar 90°" aria-label="Putar 90 Derajat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button class="thumb-del-btn" data-id="${page.id}" title="Hapus halaman" aria-label="Hapus">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <img src="${page.dataUrl || page.canvas.toDataURL('image/jpeg', 0.6)}" alt="Halaman ${index + 1}">
    `;
    pagesGrid.appendChild(card);
  });

  // Event putar halaman di galeri
  document.querySelectorAll('.thumb-rot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const pageObj = state.pages.find(p => p.id === id);
      if (pageObj) {
        pageObj.canvas = ScannerCore.rotateCanvas(pageObj.canvas, 90);
        pageObj.dataUrl = pageObj.canvas.toDataURL('image/jpeg', 0.88);
        pageObj.ocr = null;
        renderPagesGrid();

        // Realtime Sync: update lembar ke server
        sendSessionChange('/api/session/update-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pageObj.id, dataUrl: pageObj.dataUrl })
        }).then(r => r ? r.json() : null).then(res => {
          if (res && res.lastUpdated) state.lastSyncedAt = res.lastUpdated;
        }).catch(() => {});
      }
    });
  });

  // Event hapus halaman
  document.querySelectorAll('.thumb-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      state.pages = state.pages.filter(p => p.id !== id);
      renderPagesGrid();
      if (state.pages.length === 0) {
        showView('home');
      }

      // Realtime Sync: hapus lembar di server
      sendSessionChange('/api/session/delete-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      }).then(r => r ? r.json() : null).then(res => {
        if (res && res.lastUpdated) state.lastSyncedAt = res.lastUpdated;
        updateSyncBadge(state.pages.length);
      }).catch(() => {});
    });
  });
  documentWorkspace?.render();
}

// Tombol tambah halaman dari document view
document.getElementById('btnDocAddCamera').addEventListener('click', () => {
  cameraInput.click();
});
document.getElementById('btnDocAddGallery').addEventListener('click', () => {
  fileInput.click();
});

// Ekspor PDF
document.getElementById('btnExportPdf').addEventListener('click', async () => {
  const pages = documentWorkspace.exportPages();
  if (pages.length === 0) {
    alert('Belum ada halaman untuk pilihan ekspor ini. Tambahkan scan atau pilih jenis berkas lain.');
    return;
  }

  const btn = document.getElementById('btnExportPdf');
  btn.disabled = true;
  btn.textContent = 'Membuat PDF...';

  try {
    const docTitle = document.getElementById('docTitleInput').value.trim() || 'Scan-Dokumen';
    const filename = `${docTitle}${documentWorkspace.exportSuffix()}-${new Date().toISOString().slice(0, 10)}.pdf`;

    const { blob } = await PdfExporter.exportToPdf(pages, {
      filename,
      pageSize: 'a4',
      quality: 0.90
    });

    // Coba Share API di HP terlebih dahulu (WhatsApp/Files), fallback ke download
    const shared = await PdfExporter.sharePdf(blob, filename).catch(() => false);
    if (!shared) {
      PdfExporter.downloadPdf(blob, filename);
    }
  } catch (err) {
    console.error("Gagal ekspor PDF:", err);
    alert("Terjadi kesalahan saat mengekspor PDF: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unduh PDF';
  }
});

// Navigation & Back Buttons
document.getElementById('btnCropBack')?.addEventListener('click', () => {
  state.importQueue = [];
  if (state.pages.length > 0) {
    showView('doc');
  } else {
    showView('home');
  }
});

document.getElementById('btnEnhanceBack')?.addEventListener('click', () => {
  showView('crop');
});

document.getElementById('btnSavePageHeader')?.addEventListener('click', () => {
  saveCurrentPage();
});

document.getElementById('btnDocBack')?.addEventListener('click', () => {
  if (confirm('Mulai scan dokumen baru? (Halaman yang sudah discan akan tetap tersimpan)')) {
    showView('home');
  }
});

// Copy Helpers for Tailscale & Wi-Fi URL
document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const url = btn.hasAttribute('data-current-url') ? location.origin : btn.dataset.url;
    navigator.clipboard.writeText(url).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Tersalin';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1500);
    }).catch(() => {
      prompt('Salin tautan ini untuk dibuka di HP:', url);
    });
  });
});

// Floating Bottom Nav Bar Listeners
document.getElementById('navBtnHome')?.addEventListener('click', () => showView('home'));
document.getElementById('navBtnScan')?.addEventListener('click', () => cameraInput.click());
document.getElementById('navBtnTools')?.addEventListener('click', () => showView('tools'));
document.getElementById('navBtnDocs')?.addEventListener('click', () => showView('doc'));

document.getElementById('btnGoToTools')?.addEventListener('click', () => showView('tools'));
document.getElementById('btnHomeViewDoc')?.addEventListener('click', () => showView('doc'));

// Top info button: scroll to network card
document.getElementById('btnTopInfo')?.addEventListener('click', () => {
  const card = document.getElementById('networkCard');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth' });
    card.style.borderColor = 'var(--accent-neon)';
    setTimeout(() => {
      card.style.borderColor = '';
    }, 1800);
  }
});

// Category pills on Home view
document.querySelectorAll('.cat-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const preset = pill.dataset.preset;
    if (preset === 'receipt') {
      state.filter = 'bw';
    } else if (preset === 'book') {
      state.filter = 'grayscale';
    } else {
      state.filter = 'magic';
    }
    document.querySelectorAll('.filter-chip').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === state.filter);
    });
  });
});

// ========================================================
// PDF Tools Hub Event Listeners
// ========================================================
// Tool Cards Click -> Buka Modal
document.querySelectorAll('.tool-card').forEach(card => {
  card.addEventListener('click', () => {
    const toolId = card.dataset.tool;
    if (card.getAttribute('aria-disabled') === 'true') return;
    if (toolId) openToolModal(toolId);
  });
});

// Filter Kategori di Halaman Alat PDF
document.querySelectorAll('.tool-filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.tool-filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const filter = pill.dataset.filter;

    document.querySelectorAll('.tool-card').forEach(card => {
      const cat = card.dataset.category;
      if (filter === 'all' || cat === filter) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  });
});

// Modal File Selection & Dropzone
const modalDropzone = document.getElementById('modalDropzone');
const modalFileInput = document.getElementById('modalFileInput');

modalDropzone?.addEventListener('click', () => {
  modalFileInput.click();
});

modalFileInput?.addEventListener('change', (e) => {
  handleFilesSelected(e.target.files);
});

// Drag and drop pada dropzone modal
modalDropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  modalDropzone.classList.add('dragover');
});

modalDropzone?.addEventListener('dragleave', () => {
  modalDropzone.classList.remove('dragover');
});

modalDropzone?.addEventListener('drop', (e) => {
  e.preventDefault();
  modalDropzone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    handleFilesSelected(e.dataTransfer.files);
  }
});

// Modal Action & Close
document.getElementById('btnModalAction')?.addEventListener('click', () => {
  executeActiveTool();
});

document.getElementById('btnModalClose')?.addEventListener('click', () => {
  closeToolModal();
});

document.getElementById('modalBackdrop')?.addEventListener('click', () => {
  closeToolModal();
});

// -------------------------------------------------------------
// 5. Generate Sample Document (Untuk Demo Langsung & Testing)
// -------------------------------------------------------------
function generateSampleDocument() {
  const w = 1200;
  const h = 1600;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Background meja kayu gelap
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#1c1b18');
  bgGrad.addColorStop(0.5, '#2a2824');
  bgGrad.addColorStop(1, '#181715');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Kertas A4 miring di atas meja
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-6 * Math.PI) / 180); // Sudut miring 6 derajat

  const docW = 780;
  const docH = 1100;
  const docX = -docW / 2;
  const docY = -docH / 2;

  // Bayangan kertas
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetX = 15;
  ctx.shadowOffsetY = 20;

  // Kertas putih agak krem (realistis)
  ctx.fillStyle = '#f8f7f2';
  ctx.fillRect(docX, docY, docW, docH);
  ctx.shadowColor = 'transparent';

  // Konten Dokumen Faktur
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('PT NUSANTARA JAYA ABADI', docX + 50, docY + 80);

  ctx.fillStyle = '#4b5563';
  ctx.font = '16px sans-serif';
  ctx.fillText('Jl. Sudirman No. 88, Jakarta Selatan | Telp: (021) 555-8899', docX + 50, docY + 110);
  ctx.fillText('Email: billing@nusantarajaya.co.id | NPWP: 01.345.678.9-012.000', docX + 50, docY + 135);

  // Garis pemisah
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(docX + 50, docY + 160);
  ctx.lineTo(docX + docW - 50, docY + 160);
  ctx.stroke();

  // Judul Faktur
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('FAKTUR PENJUALAN RESMI', docX + 50, docY + 215);

  // Info Faktur & Pelanggan
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#374151';
  ctx.fillText('No. Faktur  : INV/2026/XI/00482', docX + 50, docY + 260);
  ctx.fillText('Tanggal     : 04 November 2026', docX + 50, docY + 290);
  ctx.fillText('Jatuh Tempo : 18 November 2026', docX + 50, docY + 320);

  ctx.fillText('Kepada Yth  : PT Teknologi Maju Bersama', docX + 400, docY + 260);
  ctx.fillText('Alamat      : Menara Palma Lt. 12, Kuningan', docX + 400, docY + 290);
  ctx.fillText('Perhatian   : Bagian Keuangan / Purchasing', docX + 400, docY + 320);

  // Tabel Barang
  const tableY = docY + 370;
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(docX + 50, tableY, docW - 100, 36);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('NO', docX + 65, tableY + 24);
  ctx.fillText('DESKRIPSI BARANG / LAYANAN', docX + 110, tableY + 24);
  ctx.fillText('QTY', docX + 460, tableY + 24);
  ctx.fillText('HARGA (RP)', docX + 530, tableY + 24);
  ctx.fillText('TOTAL (RP)', docX + 640, tableY + 24);

  // Baris-baris barang
  const items = [
    { no: '1', desc: 'Langganan Cloud Workspace Pro (1 Thn)', qty: '1', price: '1.200.000', total: '1.200.000' },
    { no: '2', desc: 'Setup & Integrasi Dokumen Otomatis', qty: '1', price: '450.000', total: '450.000' },
    { no: '3', desc: 'Backup Enkripsi Multi-Cloud Storage', qty: '2', price: '50.000', total: '100.000' }
  ];

  let currentY = tableY + 40;
  ctx.font = '15px sans-serif';
  items.forEach((item, idx) => {
    ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
    ctx.fillRect(docX + 50, currentY, docW - 100, 34);

    ctx.fillStyle = '#1f2937';
    ctx.fillText(item.no, docX + 65, currentY + 22);
    ctx.fillText(item.desc, docX + 110, currentY + 22);
    ctx.fillText(item.qty, docX + 470, currentY + 22);
    ctx.fillText(item.price, docX + 530, currentY + 22);
    ctx.fillText(item.total, docX + 640, currentY + 22);

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(docX + 50, currentY + 34);
    ctx.lineTo(docX + docW - 50, currentY + 34);
    ctx.stroke();

    currentY += 34;
  });

  // Total
  currentY += 20;
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Subtotal:', docX + 480, currentY);
  ctx.fillText('Rp 1.750.000', docX + 620, currentY);

  currentY += 30;
  ctx.fillText('PPN 11%:', docX + 480, currentY);
  ctx.fillText('Rp 192.500', docX + 635, currentY);

  currentY += 35;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#0f766e';
  ctx.fillText('TOTAL BAYAR:', docX + 450, currentY);
  ctx.fillText('Rp 1.942.500', docX + 615, currentY);

  // Stempel Merah "LUNAS"
  ctx.save();
  ctx.translate(docX + 180, currentY - 20);
  ctx.rotate((-15 * Math.PI) / 180);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 5;
  ctx.strokeRect(-90, -40, 180, 80);
  ctx.fillStyle = '#dc2626';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LUNAS', 0, 12);
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('PT NUSANTARA JAYA', 0, -20);
  ctx.fillText('TERVERIFIKASI', 0, 30);
  ctx.restore();

  // Tanda Tangan & Barcode
  const footY = docY + docH - 120;
  ctx.fillStyle = '#4b5563';
  ctx.font = '14px sans-serif';
  ctx.fillText('Hormat Kami,', docX + 550, footY);
  ctx.fillText('( Budi Raharjo, M.Kom )', docX + 510, footY + 70);
  ctx.fillText('Direktur Keuangan', docX + 540, footY + 90);

  // Simulasi Barcode di Kiri Bawah
  ctx.fillStyle = '#111827';
  for (let bx = 0; bx < 220; bx += 4) {
    if ((bx * 7) % 11 > 3) {
      ctx.fillRect(docX + 50 + bx, footY + 20, 3, 50);
    }
  }
  ctx.font = '12px monospace';
  ctx.fillText('8993012849102-ID', docX + 90, footY + 85);

  ctx.restore();

  // Konversi canvas demo ke image
  const demoImg = new Image();
  demoImg.onload = () => {
    loadNewImage(demoImg);
  };
  demoImg.src = canvas.toDataURL('image/jpeg', 0.92);
}

// Resize listener
window.addEventListener('resize', () => {
  if (views.crop.classList.contains('active') && state.workingCanvas) {
    setupCropView();
  }
});

// ========================================================
// REALTIME MULTI-DEVICE SYNC (HP ↔ PC Realtime Sync)
// ========================================================
let isSyncing = false;
let pendingSessionChanges = 0;
let sessionSyncFailed = false;
let sessionSyncDisabled = false;
let sessionETag = null;
let sessionRevision = 0;

document.getElementById('docTitleInput').addEventListener('change', event => {
  if (sessionSyncDisabled) return;
  sendSessionChange('/api/session/update-title', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: event.target.value }),
  }).then(response => response && response.json()).then(result => {
    if (result) state.lastSyncedAt = result.lastUpdated;
  }).catch(() => {});
});

async function sendSessionChange(url, options) {
  if (sessionSyncDisabled) return null;
  sessionRevision++;
  pendingSessionChanges++;
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      if (response.status === 404) {
        sessionSyncDisabled = true;
        const status = document.getElementById('syncStatusText');
        if (status) status.textContent = 'Mode Lokal';
        const statusDot = document.getElementById('syncStatusDot');
        if (statusDot) { statusDot.style.background = '#888'; statusDot.style.boxShadow = 'none'; }
        return null;
      }
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Halaman belum tersimpan di server.');
    }
    return response;
  } catch (error) {
    if (sessionSyncDisabled) return null;
    sessionSyncFailed = true;
    const status = document.getElementById('syncStatusText');
    if (status) status.textContent = 'Belum tersimpan';
    alert(`${error.message}\nEkspor PDF dari perangkat ini sebelum menutup halaman.`);
    throw error;
  } finally {
    pendingSessionChanges--;
  }
}

function dataUrlToCanvas(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas');
      cvs.width = img.width;
      cvs.height = img.height;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(cvs);
    };
    img.onerror = () => {
      const cvs = document.createElement('canvas');
      cvs.width = 600;
      cvs.height = 800;
      resolve(cvs);
    };
    img.src = dataUrl;
  });
}

function updateSyncBadge(count) {
  const statusText = document.getElementById('syncStatusText');
  const statusDot = document.getElementById('syncStatusDot');
  if (statusText) {
    statusText.textContent = count > 0 ? `Sync (${count} Hal)` : 'Sync Aktif';
  }
  if (statusDot) {
    statusDot.style.background = '#d4fb38';
    statusDot.style.boxShadow = '0 0 10px #d4fb38';
  }
}

async function pollSharedSession() {
  if (isSyncing || pendingSessionChanges || sessionSyncFailed || sessionSyncDisabled) return;
  isSyncing = true;
  const revision = sessionRevision;
  try {
    const res = await fetch('/api/session', { cache: 'no-store', headers: sessionETag ? { 'If-None-Match': sessionETag } : {} });
    if (!res.ok) {
      if (res.status === 404) {
        sessionSyncDisabled = true;
        const status = document.getElementById('syncStatusText');
        if (status) status.textContent = 'Mode Lokal';
        const statusDot = document.getElementById('syncStatusDot');
        if (statusDot) { statusDot.style.background = '#888'; statusDot.style.boxShadow = 'none'; }
      }
      return;
    }
    sessionETag = res.headers.get('etag');
    const data = await res.json();
    if (revision !== sessionRevision || pendingSessionChanges) { sessionETag = null; return; }

    if (data.title && document.getElementById('docTitleInput')) {
      const titleInput = document.getElementById('docTitleInput');
      if (titleInput && titleInput !== document.activeElement && data.title !== titleInput.value) {
        titleInput.value = data.title;
      }
    }

    if (data.lastUpdated && data.lastUpdated > (state.lastSyncedAt || 0)) {
      const serverPages = data.pages || [];
      const localIds = state.pages.map(p => p.id).join(',');
      const serverIds = serverPages.map(p => p.id).join(',');

      if (localIds !== serverIds || state.pages.length !== serverPages.length || serverPages.some((page, index) =>
        page.dataUrl !== state.pages[index]?.dataUrl || page.pageSize !== state.pages[index]?.pageSize ||
        page.category !== state.pages[index]?.category || JSON.stringify(page.ocr) !== JSON.stringify(state.pages[index]?.ocr))) {
        const updatedPages = [];
        for (const sp of serverPages) {
          const existing = state.pages.find(lp => lp.id === sp.id);
          if (existing && existing.dataUrl === sp.dataUrl) {
            updatedPages.push({ ...existing, pageSize: sp.pageSize, category: sp.category, ocr: sp.ocr });
          } else {
            const cvs = await dataUrlToCanvas(sp.dataUrl);
            updatedPages.push({
              id: sp.id,
              canvas: cvs,
              filter: sp.filter || 'magic',
              dataUrl: sp.dataUrl,
              pageSize: sp.pageSize, category: sp.category, ocr: sp.ocr
            });
          }
        }
        if (revision !== sessionRevision || pendingSessionChanges) { sessionETag = null; return; }
        state.pages = updatedPages;
        state.lastSyncedAt = data.lastUpdated;
        renderPagesGrid();
        updateSyncBadge(updatedPages.length);
      } else {
        state.lastSyncedAt = data.lastUpdated;
      }
    }
  } catch (err) {
    console.debug('Polling session error:', err);
  } finally {
    isSyncing = false;
  }
}

// Polling interval setiap 1.5 detik & event visibility
setInterval(pollSharedSession, 1500);
window.addEventListener('focus', pollSharedSession);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollSharedSession();
});

// Sync awal saat aplikasi dimuat
documentWorkspace = initializeDocumentWorkspace(state, {
  render: renderPagesGrid,
  sync: async (url, body) => {
    const response = await sendSessionChange(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return response ? response.json() : null;
  },
});
renderPagesGrid();
pollSharedSession();

document.querySelectorAll('.network-link').forEach(link => { link.textContent = location.origin; });
fetch('/api/capabilities').then(response => response.json()).then(capabilities => {
  if (capabilities.serverTools) return;
  for (const tool of ['word-to-pdf', 'pdf-to-word', 'pdf-to-images', 'compress-pdf']) {
    const card = document.querySelector(`[data-tool="${tool}"]`);
    if (!card) continue;
    card.setAttribute('aria-disabled', 'true');
    card.style.opacity = '0.5';
    card.style.cursor = 'not-allowed';
    const description = card.querySelector('.tool-card-body p');
    if (description) description.textContent = 'Belum tersedia di server ini. Scan, ekspor, gabung, dan pisah PDF tetap tersedia.';
  }
}).catch(() => {});

