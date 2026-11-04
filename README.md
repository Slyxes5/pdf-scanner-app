# SnapScanner PDF 📄📱

Aplikasi Web Scanner Dokumen otomatis dari kamera HP yang langsung menghasilkan berkas PDF berstandar A4 dengan tampilan lurus, jernih, dan rapi seperti CamScanner.

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
