import { ScannerCore } from './scanner-core.js';
import { PdfExporter } from './pdf-exporter.js';

// Application State
const state = {
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
  doc: document.getElementById('view-document')
};

const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const loupeCanvas = document.getElementById('loupeCanvas');
const loupeCtx = loupeCanvas.getContext('2d');
const enhancePreview = document.getElementById('enhancePreview');
const pagesGrid = document.getElementById('pagesGrid');

// Switch Views
function showView(name) {
  Object.keys(views).forEach(key => {
    views[key].classList.toggle('active', key === name);
  });
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
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      loadNewImage(img);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = ''; // Reset input agar bisa pilih file yang sama
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
  cropCtx.strokeStyle = '#00f0ff';
  cropCtx.shadowColor = 'rgba(0, 240, 255, 0.8)';
  cropCtx.shadowBlur = 10;
  cropCtx.stroke();
  cropCtx.shadowBlur = 0;

  // Gambar Titik Sudut (Pin Handles)
  pts.forEach((pt, i) => {
    cropCtx.beginPath();
    cropCtx.arc(pt.x, pt.y, 16, 0, Math.PI * 2);
    cropCtx.fillStyle = '#00f0ff';
    cropCtx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    cropCtx.shadowBlur = 6;
    cropCtx.fill();

    cropCtx.beginPath();
    cropCtx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
    cropCtx.fillStyle = '#ffffff';
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
  state.dragCornerIdx = -1;
  hideLoupe();
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
  loupeCtx.strokeStyle = '#00f0ff';
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
  const w = state.workingCanvas.width;
  const h = state.workingCanvas.height;
  const imgData = state.workingCanvas.getContext('2d').getImageData(0, 0, w, h);
  state.corners = ScannerCore.detectDocumentCorners(w, h, imgData);
  renderCropCanvas();
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
// 3. Warp to A4 & Filter / Enhance View
// -------------------------------------------------------------
document.getElementById('btnWarpDone').addEventListener('click', () => {
  // Melakukan Warp Perspektif ke format standar A4 (1200 x 1697)
  state.warpedCanvas = ScannerCore.warpPerspective(state.workingCanvas, state.corners, 1200, 1697);
  updateEnhancedPreview();
  showView('enhance');
});

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
  updateEnhancedPreview();
});

// Tombol Simpan Halaman
document.getElementById('btnSavePage').addEventListener('click', () => {
  saveCurrentPage();
});

document.getElementById('btnAddAnother').addEventListener('click', () => {
  saveCurrentPage();
  // Buka kamera/pilih foto untuk halaman berikutnya
  cameraInput.click();
});

function saveCurrentPage() {
  const pageId = `page-${Date.now()}`;
  state.pages.push({
    id: pageId,
    canvas: state.filteredCanvas,
    filter: state.filter
  });

  renderPagesGrid();
  showView('doc');
}

// -------------------------------------------------------------
// 4. Multi-Page Document Gallery & PDF Export
// -------------------------------------------------------------
function renderPagesGrid() {
  pagesGrid.innerHTML = '';
  document.getElementById('docPageCount').textContent = `${state.pages.length} Halaman`;

  state.pages.forEach((page, index) => {
    const card = document.createElement('div');
    card.className = 'page-thumb-card';
    card.innerHTML = `
      <div class="thumb-header">
        <span>Hal ${index + 1}</span>
        <button class="thumb-del-btn" data-id="${page.id}" title="Hapus halaman">&times;</button>
      </div>
      <img src="${page.canvas.toDataURL('image/jpeg', 0.6)}" alt="Halaman ${index + 1}">
    `;
    pagesGrid.appendChild(card);
  });

  // Event hapus halaman
  document.querySelectorAll('.thumb-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      state.pages = state.pages.filter(p => p.id !== id);
      renderPagesGrid();
      if (state.pages.length === 0) {
        showView('home');
      }
    });
  });
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
  if (state.pages.length === 0) {
    alert("Belum ada halaman dokumen yang discan.");
    return;
  }

  const btn = document.getElementById('btnExportPdf');
  btn.disabled = true;
  btn.textContent = 'Membuat PDF... ⏳';

  try {
    const docTitle = document.getElementById('docTitleInput').value.trim() || 'Scan-Dokumen';
    const filename = `${docTitle}-${new Date().toISOString().slice(0, 10)}.pdf`;

    const { blob } = await PdfExporter.exportToPdf(state.pages, {
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
    btn.textContent = 'Unduh Berkas PDF 📄';
  }
});

// Navigation & Back Buttons
document.getElementById('btnCropBack')?.addEventListener('click', () => {
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

// Wi-Fi Display & Copy Helper
const wifiUrlText = document.getElementById('wifiUrlText');
const btnCopyIp = document.getElementById('btnCopyIp');

if (wifiUrlText && window.location.origin) {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    wifiUrlText.textContent = window.location.origin;
  }
}

btnCopyIp?.addEventListener('click', () => {
  const url = wifiUrlText.textContent;
  navigator.clipboard.writeText(url).then(() => {
    btnCopyIp.textContent = '✅ Tersalin!';
    setTimeout(() => {
      btnCopyIp.textContent = '📋 Salin';
    }, 2000);
  }).catch(() => {
    prompt('Salin tautan ini untuk dibuka di HP:', url);
  });
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
