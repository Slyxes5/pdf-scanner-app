# SnapScanner PDF 📄📱

Aplikasi Web Scanner Dokumen otomatis dari kamera HP yang langsung menghasilkan berkas PDF berstandar A4 dengan tampilan lurus, jernih, dan rapi seperti CamScanner.

## OCR, multi-page import, and application documents

- Select multiple gallery photos (up to the remaining 30-page session capacity). Review the crop and filter of each photo before saving; canceling crop discards the remaining queue, while saved pages stay available.
- Each page supports A4, Letter, or original image aspect ratio. A4 and Letter follow portrait/landscape orientation and fit the entire image within 5 mm margins without stretching. Original ratio uses a nominal 150 DPI, not a measurement of the physical paper. Click a page thumbnail to preview the PDF layout.
- Move pages up/down. Application mode labels pages as CV, cover letter, diploma, transcript, certificate, identity, or other. Sort explicitly by that order, then export everything together or one category at a time. Changing mode does not reorder or alter scans.
- Run Indonesian + English OCR explicitly. Search filters the page list and shows matching OCR text; it does not change the exported pages. The PDF includes invisible text at recognized word positions over the scan image. OCR can misread text; check the expandable results. Rotating a saved page invalidates its OCR until recognition runs again.
- Images, category, size, order, and OCR results share the existing session persistence/sync. Mode and default options are preferences saved in the current browser. Existing sessions without metadata default to A4 and Other.
- OCR runs in the browser. Engine and language models are served locally; no document is sent to an external OCR service. Existing shared-session image/OCR sync to your own scanner server still applies.

`npm install` prepares local OCR assets automatically. If install scripts are disabled, run `npm run prepare:ocr`. Generated files in `public/assets/ocr/` are ignored by Git; include this directory when packaging a release. OCR adds approximately 39 MiB to the static assets and uses device RAM/CPU during recognition.

Verification (isolated sessions, no saved user scans modified):

```powershell
node --test test/server.test.mjs test/session-metadata.test.mjs
$env:BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node test/browser-smoke.mjs
node test/scanner-workflow.mjs
```

The workflow check imports three generated images, exercises actual local OCR and search, mixed page sizes, application ordering, desktop sync/reload, and invalidation after rotation. It leaves synthetic PDFs/screenshots in a temporary directory printed by the script. Physical camera behavior still needs a phone check.

---

## ✨ Fitur Utama

1. **Auto-Detect Sudut Kertas (Corner Edge Detection)**:
   - Menganalisis kontras dan luminansi citra untuk menemukan 4 sudut batas tepi dokumen secara instan.
2. **Kaca Pembesar Presisi (Magnifying Loupe)**:
   - Saat pengguna menggeser sudut dokumen di layar HP, kaca pembesar melayang 2.5x muncul di atas jari untuk bidikan sudut yang presisi.
3. **Perspective Warp (Homography Transformation)**:
   - Menyelesaikan sistem persamaan 8 linear (eliminasi Gaussian) untuk menghitung matriks homography 3x3.
   - Meluruskan dokumen yang diambil dalam sudut miring (*skewed/tilted*) menjadi halaman persegi panjang tegak rata.
4. **CamScanner-Style Enhancement Filters**:
   - **Magic Color**: Mencerahkan latar belakang kertas menjadi putih bersih dan mempertajam warna tulisan.
   - **Hitam Putih (B&W)**: Kontras biner tajam khusus teks dan dokumen tulisan tangan/fotokopi.
   - **Grayscale**: Skala abu-abu profesional untuk dokumen formal.
   - **Original**: Foto asli beresolusi tinggi tanpa filter warna.
   - **Slider Kontras & Kecerahan**: Fine-tuning kontras sesuai preferensi pengguna.
5. **Multi-Halaman & Susun Lembar**:
   - Jepret halaman berikutnya berkali-kali tanpa batas.
   - Pengurutan dan penghapusan halaman fleksibel di Document View.
6. **Ekspor PDF Berstandar A4**:
   - Menggunakan `jsPDF` yang bekerja secara offline.
   - Margin rapi dan otomatis menyesuaikan rasio aspek lembaran A4.
   - Integrasi `navigator.share` untuk langsung mengirim PDF ke WhatsApp / Google Drive di HP.
7. **Dokumen Sampel Instan (Demo Mode)**:
   - Satu tombol untuk menguji seluruh alur kerja (auto-crop, warp, filter, PDF) tanpa harus upload foto terlebih dahulu.

---

## 🚀 Cara Menjalankan

### 1. Jalankan Server di Laptop / Komputer
```bash
cd C:\Projects\pdf-scanner-app
npm start
```
Server akan berjalan di port `3000`.

### 2. Akses di Browser Laptop / PC
Buka:
```
http://localhost:3000
```

### 3. Akses Langsung di Smartphone (HP)
Pastikan HP Anda terhubung ke jaringan Wi-Fi yang sama dengan laptop. Buka Chrome / Safari di HP dan ketik:
```
http://192.168.1.20:3000
```
*(Alamat IP lokal otomatis tertera di terminal saat server dinyalakan).*

---

## 📂 Struktur Proyek

```
pdf-scanner-app/
├── package.json               # Konfigurasi proyek (ESM)
├── server.mjs                 # Server HTTP zero-dependency dengan deteksi IP Wi-Fi
├── test-e2e.cjs               # Script pengujian otomatis alur kerja (Puppeteer)
├── README.md                  # Dokumentasi proyek
└── public/
    ├── index.html             # Tampilan aplikasi mobile (Home, Crop, Enhance, Document)
    ├── css/
    │   └── styles.css         # Styling dark-mode modern mobile-first (CamScanner vibe)
    ├── assets/
    │   └── jspdf.umd.min.js   # Pustaka jsPDF offline-ready
    └── js/
        ├── app.js             # Controller utama, event touch/mouse, state machine
        ├── scanner-core.js    # Mesin matematika homography, warp, dan filter citra
        └── pdf-exporter.js    # Generator PDF A4 & Web Share API
```

---

## 🧪 Pengujian
Jalankan pengujian E2E headless:
```bash
node test-e2e.cjs
```
Hasil: Semua 5 tahapan alur scan dan ekspor PDF tervalidasi sukses dengan 0 error.
