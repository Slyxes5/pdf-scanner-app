import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { convertWordToPdf, convertPdfToWord, convertPdfToImages, compressPdf } from './converters.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

// ========================================================
// SHARED MULTI-DEVICE SESSION (Real-time HP ↔ PC Sync)
// ========================================================
const sharedSession = {
  title: 'Scan-Dokumen',
  pages: [], // { id, filter, dataUrl, createdAt }
  lastUpdated: Date.now()
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }
  return addresses;
}

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, X-Filename, X-Dpi'
    });
    return res.end();
  }

  // ========================================================
  // SHARED SESSION SYNC API (HP ↔ PC Sync)
  // ========================================================
  if (req.url.startsWith('/api/session')) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const endpoint = urlObj.pathname;

    // GET /api/session -> Ambil state dokumen terkini
    if (req.method === 'GET' && endpoint === '/api/session') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(sharedSession));
    }

    // POST /api/session/add-page -> Tambah lembar hasil scan dari HP/PC
    if (req.method === 'POST' && endpoint === '/api/session/add-page') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const pageId = body.id || `page-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          sharedSession.pages.push({
            id: pageId,
            filter: body.filter || 'magic',
            dataUrl: body.dataUrl,
            createdAt: Date.now()
          });
          sharedSession.lastUpdated = Date.now();

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(JSON.stringify({ success: true, count: sharedSession.pages.length, pageId, lastUpdated: sharedSession.lastUpdated }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/session/delete-page -> Hapus lembar dari session bersama
    if (req.method === 'POST' && endpoint === '/api/session/delete-page') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          sharedSession.pages = sharedSession.pages.filter(p => p.id !== body.id);
          sharedSession.lastUpdated = Date.now();

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(JSON.stringify({ success: true, count: sharedSession.pages.length, lastUpdated: sharedSession.lastUpdated }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/session/update-page -> Update lembar (misal: setelah di-rotate)
    if (req.method === 'POST' && endpoint === '/api/session/update-page') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const target = sharedSession.pages.find(p => p.id === body.id);
          if (target && body.dataUrl) {
            target.dataUrl = body.dataUrl;
            sharedSession.lastUpdated = Date.now();
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(JSON.stringify({ success: true, count: sharedSession.pages.length, lastUpdated: sharedSession.lastUpdated }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/session/clear -> Reset lembaran
    if (req.method === 'POST' && endpoint === '/api/session/clear') {
      sharedSession.pages = [];
      sharedSession.lastUpdated = Date.now();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({ success: true, count: 0, lastUpdated: sharedSession.lastUpdated }));
    }
  }

  // ========================================================
  // API TOOLS ENDPOINTS (iLovePDF Suite)
  // ========================================================
  if (req.url.startsWith('/api/tools/') && req.method === 'POST') {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const endpoint = urlObj.pathname;
    const chunks = [];
    let totalSize = 0;
    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

    req.on('data', chunk => {
      totalSize += chunk.length;
      if (totalSize > MAX_SIZE) {
        res.writeHead(413, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'Ukuran berkas melebihi batas 50MB.' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      const fileBuffer = Buffer.concat(chunks);
      const origFilename = req.headers['x-filename'] || urlObj.searchParams.get('filename') || 'dokumen';
      const baseName = path.parse(decodeURIComponent(origFilename)).name || 'dokumen';

      try {
        if (endpoint === '/api/tools/word-to-pdf') {
          const pdfBuf = await convertWordToPdf(fileBuffer);
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}.pdf"`,
            'Content-Length': pdfBuf.length,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(pdfBuf);
        }

        if (endpoint === '/api/tools/pdf-to-word') {
          const docxBuf = await convertPdfToWord(fileBuffer);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}.docx"`,
            'Content-Length': docxBuf.length,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(docxBuf);
        }

        if (endpoint === '/api/tools/pdf-to-images') {
          const dpi = parseInt(req.headers['x-dpi'] || urlObj.searchParams.get('dpi') || '150', 10);
          const images = await convertPdfToImages(fileBuffer, dpi);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(JSON.stringify({ success: true, count: images.length, images }));
        }

        if (endpoint === '/api/tools/compress-pdf') {
          const compressedBuf = await compressPdf(fileBuffer);
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}-compressed.pdf"`,
            'Content-Length': compressedBuf.length,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(compressedBuf);
        }

        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify({ error: 'Endpoint alat tidak ditemukan.' }));
      } catch (err) {
        console.error('API Tools Error:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify({ error: err.message || 'Terjadi kesalahan pemrosesan berkas di server.' }));
      }
    });
    return;
  }

  // ========================================================
  // STATIC ASSETS SERVING
  // ========================================================
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(publicDir, reqPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(65));
  console.log('📄 SNAP SCANNER & PDF TOOLS HUB — ALL-IN-ONE UTILITY');
  console.log('='.repeat(65));
  console.log(`\n💻 Akses di Laptop/PC : http://localhost:${PORT}`);
  
  const localIps = getLocalIpAddresses();
  console.log('\n📱 Akses Langsung di HP Anda (dalam 1 jaringan Wi-Fi):');
  localIps.forEach(net => {
    console.log(`   👉 http://${net.address}:${PORT} (${net.name})`);
  });
  console.log('\n💡 Fitur Aktif: Realtime Device Sync, Word ↔ PDF, Merge, Split, Compress');
  console.log('='.repeat(65));
});
