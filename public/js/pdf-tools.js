/**
 * SnapScanner PDF Tools Engine (iLovePDF Style)
 * Supports Word-to-PDF, PDF-to-Word, Merge, Split, Compress, and PDF-to-Images.
 */

// Global state untuk modul PDF Tools
export const toolsState = {
  activeTool: null,
  files: [],
  processing: false,
  resultBlob: null,
  resultUrl: null,
  resultFilename: '',
  resultImages: []
};

/**
 * Konfigurasi Metadata 6 Alat PDF
 */
export const TOOL_CONFIGS = {
  'word-to-pdf': {
    id: 'word-to-pdf',
    title: 'Word ke PDF',
    badge: 'POPULER',
    desc: 'Ubah berkas .docx Word menjadi dokumen PDF A4 rapi dan presisi.',
    accept: '.docx,.doc',
    multi: false,
    btnText: 'Konversi ke PDF'
  },
  'pdf-to-word': {
    id: 'pdf-to-word',
    title: 'PDF ke Word',
    badge: 'POPULER',
    desc: 'Ekstrak tabel, teks, dan tata letak PDF menjadi dokumen .docx yang bisa diedit.',
    accept: '.pdf',
    multi: false,
    btnText: 'Konversi ke Word'
  },
  'merge-pdf': {
    id: 'merge-pdf',
    title: 'Gabung PDF',
    badge: 'OFFLINE',
    desc: 'Satukan dua atau lebih berkas PDF menjadi satu berkas secara berurutan.',
    accept: '.pdf',
    multi: true,
    btnText: 'Gabungkan PDF'
  },
  'split-pdf': {
    id: 'split-pdf',
    title: 'Pisah PDF',
    badge: 'OFFLINE',
    desc: 'Ekstrak rentang halaman tertentu (misal: 1-3) dari dokumen PDF.',
    accept: '.pdf',
    multi: false,
    btnText: 'Pisahkan Halaman'
  },
  'compress-pdf': {
    id: 'compress-pdf',
    title: 'Kompres PDF',
    badge: 'OPTIMASI',
    desc: 'Kecilkan ukuran berkas PDF untuk keperluan kirim email atau unggah dokumen.',
    accept: '.pdf',
    multi: false,
    btnText: 'Kompres Berkas'
  },
  'pdf-to-images': {
    id: 'pdf-to-images',
    title: 'PDF ke Gambar',
    badge: 'HD',
    desc: 'Ekstrak setiap halaman berkas PDF menjadi gambar PNG beresolusi tinggi.',
    accept: '.pdf',
    multi: false,
    btnText: 'Ekstrak Gambar'
  }
};

/**
 * Membuka Modal Alat
 * @param {string} toolId 
 */
export function openToolModal(toolId) {
  const config = TOOL_CONFIGS[toolId];
  if (!config) return;

  toolsState.activeTool = toolId;
  toolsState.files = [];
  toolsState.processing = false;
  toolsState.resultBlob = null;
  toolsState.resultImages = [];
  if (toolsState.resultUrl) {
    URL.revokeObjectURL(toolsState.resultUrl);
    toolsState.resultUrl = null;
  }

  // Update UI Modal
  document.getElementById('modalToolTitle').textContent = config.title;
  document.getElementById('modalToolDesc').textContent = config.desc;
  document.getElementById('modalToolBadge').textContent = config.badge;

  const fileInput = document.getElementById('modalFileInput');
  fileInput.accept = config.accept;
  fileInput.multiple = config.multi;
  fileInput.value = '';

  // Reset Elements
  document.getElementById('modalDropzone').style.display = 'flex';
  document.getElementById('modalFileList').style.display = 'none';
  document.getElementById('modalFileList').innerHTML = '';
  document.getElementById('modalProgressBox').style.display = 'none';
  document.getElementById('modalResultBox').style.display = 'none';
  document.getElementById('modalExtraOptions').style.display = 'none';

  // Opsi Tambahan untuk Split & PDF to Images
  if (toolId === 'split-pdf') {
    document.getElementById('modalExtraOptions').style.display = 'block';
    document.getElementById('modalExtraOptions').innerHTML = `
      <div class="tool-option-box">
        <label class="tool-option-label" for="splitRangeInput">Rentang Halaman yang Diekstrak</label>
        <input type="text" id="splitRangeInput" class="tool-option-input" placeholder="Contoh: 1-3, 5 atau kosongkan untuk semua" value="1">
        <span class="tool-option-hint">Format: 1-3 (halaman 1 sampai 3), 1,3,5 (pilih halaman tertentu)</span>
      </div>
    `;
  } else if (toolId === 'pdf-to-images') {
    document.getElementById('modalExtraOptions').style.display = 'block';
    document.getElementById('modalExtraOptions').innerHTML = `
      <div class="tool-option-box">
        <label class="tool-option-label" for="dpiSelect">Kualitas Resolusi Gambar</label>
        <select id="dpiSelect" class="tool-option-select">
          <option value="100">Standar (100 DPI - Ukuran Kecil)</option>
          <option value="150" selected>Tinggi (150 DPI - Rekomendasi)</option>
          <option value="200">Ultra HD (200 DPI - Sangat Jernih)</option>
        </select>
      </div>
    `;
  }

  const actionBtn = document.getElementById('btnModalAction');
  actionBtn.disabled = true;
  actionBtn.querySelector('.btn-text').textContent = config.btnText;

  // Buka Modal
  const modal = document.getElementById('toolModal');
  modal.classList.add('active');
}

/**
 * Menutup Modal Alat
 */
export function closeToolModal() {
  const modal = document.getElementById('toolModal');
  modal.classList.remove('active');
  toolsState.activeTool = null;
  toolsState.files = [];
  toolsState.processing = false;
}

/**
 * Update UI saat berkas dipilih
 */
export function handleFilesSelected(fileList) {
  const newFiles = Array.from(fileList);
  if (!newFiles.length) return;

  const config = TOOL_CONFIGS[toolsState.activeTool];
  if (config.multi) {
    toolsState.files = [...toolsState.files, ...newFiles];
  } else {
    toolsState.files = [newFiles[0]];
  }

  renderFileList();
}

function renderFileList() {
  const fileListBox = document.getElementById('modalFileList');
  const dropzone = document.getElementById('modalDropzone');
  const actionBtn = document.getElementById('btnModalAction');

  if (!toolsState.files.length) {
    fileListBox.style.display = 'none';
    fileListBox.innerHTML = '';
    actionBtn.disabled = true;
    return;
  }

  fileListBox.style.display = 'flex';
  fileListBox.innerHTML = '';

  toolsState.files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'tool-file-item';
    const sizeKB = (file.size / 1024).toFixed(1);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const displaySize = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

    item.innerHTML = `
      <div class="tool-file-info">
        <span class="tool-file-num">${index + 1}</span>
        <div class="tool-file-names">
          <span class="tool-file-title" title="${file.name}">${file.name}</span>
          <span class="tool-file-size">${displaySize}</span>
        </div>
      </div>
      <button class="tool-file-del" data-index="${index}" title="Hapus berkas">&times;</button>
    `;
    fileListBox.appendChild(item);
  });

  // Event hapus berkas dari daftar
  fileListBox.querySelectorAll('.tool-file-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      toolsState.files.splice(idx, 1);
      renderFileList();
    });
  });

  actionBtn.disabled = false;
}

/**
 * Eksekusi Proses Alat PDF
 */
export async function executeActiveTool() {
  if (toolsState.processing || !toolsState.files.length) return;
  const toolId = toolsState.activeTool;
  const config = TOOL_CONFIGS[toolId];

  toolsState.processing = true;
  const actionBtn = document.getElementById('btnModalAction');
  actionBtn.disabled = true;

  const progressBox = document.getElementById('modalProgressBox');
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');
  const resultBox = document.getElementById('modalResultBox');

  progressBox.style.display = 'block';
  resultBox.style.display = 'none';
  progressBar.style.width = '20%';
  progressText.textContent = 'Menyiapkan berkas dokumen...';

  try {
    if (toolId === 'word-to-pdf') {
      await processWordToPdf();
    } else if (toolId === 'pdf-to-word') {
      await processPdfToWord();
    } else if (toolId === 'merge-pdf') {
      await processMergePdf();
    } else if (toolId === 'split-pdf') {
      await processSplitPdf();
    } else if (toolId === 'compress-pdf') {
      await processCompressPdf();
    } else if (toolId === 'pdf-to-images') {
      await processPdfToImages();
    }
  } catch (err) {
    console.error('Error saat memproses berkas:', err);
    progressText.textContent = 'Gagal: ' + (err.message || 'Terjadi kesalahan');
    progressBar.style.backgroundColor = '#ef4444';
  } finally {
    toolsState.processing = false;
    actionBtn.disabled = false;
  }
}

/**
 * 1. Word ke PDF
 */
async function processWordToPdf() {
  const file = toolsState.files[0];
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');

  progressBar.style.width = '45%';
  progressText.textContent = 'Mengonversi tata letak Word ke PDF via Engine...';

  const res = await fetch('/api/tools/word-to-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name)
    },
    body: file
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error (${res.status})`);
  }

  progressBar.style.width = '90%';
  progressText.textContent = 'Membangun berkas PDF final...';

  const blob = await res.blob();
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  showToolResult(blob, `${baseName}.pdf`, 'PDF Berhasil Dibuat!', 'Dokumen Word Anda telah berhasil dikonversi menjadi berkas PDF vektor A4.');
}

/**
 * 2. PDF ke Word
 */
async function processPdfToWord() {
  const file = toolsState.files[0];
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');

  progressBar.style.width = '40%';
  progressText.textContent = 'Menganalisis teks, tabel, dan tata letak PDF...';

  const res = await fetch('/api/tools/pdf-to-word', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name)
    },
    body: file
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error (${res.status})`);
  }

  progressBar.style.width = '90%';
  progressText.textContent = 'Menyusun berkas Word .docx...';

  const blob = await res.blob();
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  showToolResult(blob, `${baseName}.docx`, 'Word Berhasil Dibuat!', 'Dokumen PDF Anda telah berhasil diekstrak menjadi berkas Word (.docx) yang bisa diedit.');
}

/**
 * 3. Gabung PDF (Client-Side pdf-lib)
 */
async function processMergePdf() {
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');

  if (toolsState.files.length < 2) {
    throw new Error('Pilih minimal 2 berkas PDF untuk digabungkan.');
  }

  progressBar.style.width = '30%';
  progressText.textContent = 'Membaca dokumen PDF (Proses Lokal/Offline)...';

  const PDFLib = window.PDFLib || window.pdfLib;
  if (!PDFLib) throw new Error('Pustaka PDF-Lib belum dimuat.');

  const mergedDoc = await PDFLib.PDFDocument.create();

  for (let i = 0; i < toolsState.files.length; i++) {
    const file = toolsState.files[i];
    progressText.textContent = `Menggabungkan berkas ${i + 1} dari ${toolsState.files.length}...`;
    progressBar.style.width = `${30 + Math.round(((i + 1) / toolsState.files.length) * 55)}%`;

    const arrayBuffer = await file.arrayBuffer();
    const doc = await PDFLib.PDFDocument.load(arrayBuffer);
    const copiedPages = await mergedDoc.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach(page => mergedDoc.addPage(page));
  }

  progressBar.style.width = '95%';
  progressText.textContent = 'Menyimpan berkas gabungan...';

  const mergedBytes = await mergedDoc.save();
  const blob = new Blob([mergedBytes], { type: 'application/pdf' });
  const filename = `Gabungan-${Date.now()}.pdf`;

  showToolResult(blob, filename, 'PDF Berhasil Digabung!', `${toolsState.files.length} berkas PDF telah disatukan secara instan.`);
}

/**
 * 4. Pisah PDF (Client-Side pdf-lib)
 */
async function processSplitPdf() {
  const file = toolsState.files[0];
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');
  const rangeInput = document.getElementById('splitRangeInput');
  const rangeStr = rangeInput ? rangeInput.value.trim() : '';

  progressBar.style.width = '35%';
  progressText.textContent = 'Membaca struktur halaman PDF...';

  const PDFLib = window.PDFLib || window.pdfLib;
  if (!PDFLib) throw new Error('Pustaka PDF-Lib belum dimuat.');

  const arrayBuffer = await file.arrayBuffer();
  const doc = await PDFLib.PDFDocument.load(arrayBuffer);
  const totalPages = doc.getPageCount();

  // Parsing rentang halaman (misal: "1-3, 5")
  let pageIndices = [];
  if (!rangeStr || rangeStr.toLowerCase() === 'semua') {
    pageIndices = doc.getPageIndices();
  } else {
    const parts = rangeStr.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let p = Math.max(1, start); p <= Math.min(totalPages, end); p++) {
            if (!pageIndices.includes(p - 1)) pageIndices.push(p - 1);
          }
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          if (!pageIndices.includes(p - 1)) pageIndices.push(p - 1);
        }
      }
    }
  }

  if (!pageIndices.length) {
    throw new Error(`Rentang halaman tidak valid. Dokumen memiliki ${totalPages} halaman.`);
  }

  progressBar.style.width = '70%';
  progressText.textContent = `Mengekstrak ${pageIndices.length} halaman pilihan...`;

  const newDoc = await PDFLib.PDFDocument.create();
  const copiedPages = await newDoc.copyPages(doc, pageIndices);
  copiedPages.forEach(p => newDoc.addPage(p));

  const splitBytes = await newDoc.save();
  const blob = new Blob([splitBytes], { type: 'application/pdf' });
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const filename = `${baseName}-halaman-${rangeStr.replace(/[^0-9-]/g, '_') || 'ekstrak'}.pdf`;

  showToolResult(blob, filename, 'Halaman Berhasil Dipisah!', `${pageIndices.length} dari ${totalPages} halaman telah diekstrak ke berkas PDF baru.`);
}

/**
 * 5. Kompres PDF
 */
async function processCompressPdf() {
  const file = toolsState.files[0];
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');

  progressBar.style.width = '40%';
  progressText.textContent = 'Mengompresi data streams dan struktur internal PDF...';

  const res = await fetch('/api/tools/compress-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name)
    },
    body: file
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error (${res.status})`);
  }

  progressBar.style.width = '90%';
  progressText.textContent = 'Menghitung penghematan ukuran berkas...';

  const blob = await res.blob();
  const origSizeKB = (file.size / 1024).toFixed(1);
  const newSizeKB = (blob.size / 1024).toFixed(1);
  const savedPercent = Math.max(0, Math.round(((file.size - blob.size) / file.size) * 100));

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  showToolResult(
    blob,
    `${baseName}-terkompres.pdf`,
    'PDF Berhasil Dikompres!',
    `Ukuran asli: ${origSizeKB} KB → Hasil kompresi: ${newSizeKB} KB (Hemat ${savedPercent}%)`
  );
}

/**
 * 6. PDF ke Gambar
 */
async function processPdfToImages() {
  const file = toolsState.files[0];
  const progressBar = document.getElementById('modalProgressBar');
  const progressText = document.getElementById('modalProgressText');
  const dpiSelect = document.getElementById('dpiSelect');
  const dpi = dpiSelect ? dpiSelect.value : '150';

  progressBar.style.width = '40%';
  progressText.textContent = `Merender halaman PDF menjadi gambar (DPI: ${dpi})...`;

  const res = await fetch(`/api/tools/pdf-to-images?dpi=${dpi}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name)
    },
    body: file
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error (${res.status})`);
  }

  progressBar.style.width = '90%';
  progressText.textContent = 'Menyiapkan galeri gambar...';

  const data = await res.json();
  toolsState.resultImages = data.images || [];

  showImagesGalleryResult(toolsState.resultImages, file.name);
}

/**
 * Tampilkan Hasil Berkas Single (PDF / Word)
 */
function showToolResult(blob, filename, titleText, descText) {
  const progressBox = document.getElementById('modalProgressBox');
  const resultBox = document.getElementById('modalResultBox');
  const progressBar = document.getElementById('modalProgressBar');

  progressBar.style.width = '100%';
  progressBox.style.display = 'none';

  toolsState.resultBlob = blob;
  toolsState.resultFilename = filename;
  toolsState.resultUrl = URL.createObjectURL(blob);

  resultBox.style.display = 'flex';
  resultBox.innerHTML = `
    <div class="result-card">
      <div class="result-icon-badge">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div class="result-details">
        <h3 class="result-title">${titleText}</h3>
        <p class="result-desc">${descText}</p>
        <span class="result-filename-tag">${filename}</span>
      </div>
      <a href="${toolsState.resultUrl}" download="${filename}" class="btn-download-result">
        <span>Unduh Berkas</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
    </div>
  `;
}

/**
 * Tampilkan Hasil Galeri Gambar (PDF to Images)
 */
function showImagesGalleryResult(images, origFilename) {
  const progressBox = document.getElementById('modalProgressBox');
  const resultBox = document.getElementById('modalResultBox');
  progressBox.style.display = 'none';

  resultBox.style.display = 'flex';
  const baseName = origFilename.replace(/\.[^/.]+$/, "");

  let galleryHtml = `
    <div class="result-gallery-header">
      <h3>Hasil Ekstraksi (${images.length} Halaman)</h3>
      <p>Klik tombol unduh pada tiap gambar untuk menyimpan ke perangkat Anda.</p>
    </div>
    <div class="result-gallery-grid">
  `;

  images.forEach(img => {
    galleryHtml += `
      <div class="gallery-item-card">
        <div class="gallery-item-head">
          <span>Halaman ${img.page}</span>
          <a href="${img.dataUrl}" download="${baseName}-hal-${img.page}.png" class="gallery-dl-btn" title="Unduh gambar halaman ini">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
        </div>
        <img src="${img.dataUrl}" alt="Halaman ${img.page}">
      </div>
    `;
  });

  galleryHtml += `</div>`;
  resultBox.innerHTML = galleryHtml;
}
