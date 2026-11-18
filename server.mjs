import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionStore, RequestError } from './session-store.mjs';

const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const trustedHosts = (process.env.TRUSTED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
const store = createSessionStore(process.env.DATA_DIR);
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
let conversionRunning = false;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    throw new RequestError(413, 'Berkas terlalu besar.');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new RequestError(413, 'Berkas terlalu besar.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleRequest(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  let url;
  try { url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); }
  catch { throw new RequestError(400, 'Alamat tidak valid.'); }
  if (trustedHosts.length && !trustedHosts.includes(url.hostname)) throw new RequestError(403, 'Host tidak diizinkan.');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'Akses lintas situs ditolak.');
  if (request.headers.origin) {
    let origin;
    try { origin = new URL(request.headers.origin); }
    catch { throw new RequestError(403, 'Origin tidak valid.'); }
    if (origin.host !== url.host) throw new RequestError(403, 'Origin tidak diizinkan.');
  }
  if (request.method === 'GET' && url.pathname === '/healthz') return json(response, 200, { status: 'ok' });
  if (url.pathname === '/api/session' && request.method === 'GET') {
    const etag = `"${store.version()}"`;
    response.setHeader('ETag', etag);
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304);
      return response.end();
    }
    return json(response, 200, store.read());
  }
  if (url.pathname === '/api/capabilities' && request.method === 'GET') {
    return json(response, 200, { serverTools: process.env.ENABLE_SERVER_TOOLS !== 'false' });
  }
  if (url.pathname.startsWith('/api/session/')) {
    if (request.method !== 'POST') throw new RequestError(405, 'Metode tidak diizinkan.');
    if (!request.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, 'Gunakan application/json.');
    const buffer = await readBody(request, 5 * 1024 * 1024);
    let body;
    try { body = buffer.length ? JSON.parse(buffer.toString('utf8')) : {}; }
    catch { throw new RequestError(400, 'JSON tidak valid.'); }
    return json(response, 200, store.update(url.pathname.slice('/api/session/'.length), body));
  }
  if (url.pathname.startsWith('/api/tools/')) {
    if (request.method !== 'POST') throw new RequestError(405, 'Metode tidak diizinkan.');
    const tool = url.pathname.slice('/api/tools/'.length);
    if (!['word-to-pdf', 'pdf-to-word', 'pdf-to-images', 'compress-pdf'].includes(tool)) throw new RequestError(404, 'Alat tidak ditemukan.');
    if (process.env.ENABLE_SERVER_TOOLS === 'false') throw new RequestError(503, 'Konversi server belum diaktifkan di STB. Fitur scan dan ekspor PDF tetap tersedia.');
    if (conversionRunning) throw new RequestError(429, 'Server sedang memproses dokumen. Coba lagi setelah selesai.');
    conversionRunning = true;
    try {
      const buffer = await readBody(request, MAX_UPLOAD_BYTES);
      const converters = await import('./converters.mjs');
      const filename = String(request.headers['x-filename'] || url.searchParams.get('filename') || 'dokumen');
      let baseName;
      try { baseName = path.parse(decodeURIComponent(filename)).name.slice(0, 120) || 'dokumen'; }
      catch { throw new RequestError(400, 'Nama berkas tidak valid.'); }
      let result;
      let extension;
      if (tool === 'word-to-pdf') {
        result = await converters.convertWordToPdf(buffer);
        extension = '.pdf';
      } else if (tool === 'pdf-to-word') {
        result = await converters.convertPdfToWord(buffer);
        extension = '.docx';
      } else if (tool === 'pdf-to-images') {
        const dpi = Number(request.headers['x-dpi'] || url.searchParams.get('dpi') || 150);
        if (!Number.isInteger(dpi) || dpi < 36 || dpi > 200) throw new RequestError(400, 'DPI harus antara 36 dan 200.');
        const images = await converters.convertPdfToImages(buffer, dpi);
        return json(response, 200, { success: true, count: images.length, images });
      } else {
        result = await converters.compressPdf(buffer);
        extension = '.pdf';
        baseName += '-compressed';
      }
      response.writeHead(200, {
        'Content-Type': mimeTypes[extension],
        'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}${extension}"`,
        'Content-Length': result.length, 'Cache-Control': 'no-store',
      });
      return response.end(result);
    } finally { conversionRunning = false; }
  }
  if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, 'Metode tidak diizinkan.');
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); }
  catch { throw new RequestError(400, 'Alamat tidak valid.'); }
  if (decodedPath.includes('\0')) throw new RequestError(400, 'Alamat tidak valid.');
  const filePath = path.resolve(publicDirectory, `.${decodedPath === '/' ? '/index.html' : decodedPath}`);
  const relative = path.relative(publicDirectory, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new RequestError(403, 'Akses ditolak.');
  let stat;
  try { stat = await fs.promises.stat(filePath); }
  catch { throw new RequestError(404, 'Berkas tidak ditemukan.'); }
  if (!stat.isFile()) throw new RequestError(404, 'Berkas tidak ditemukan.');
  response.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size, 'Cache-Control': 'no-cache',
  });
  if (request.method === 'HEAD') return response.end();
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) return response.destroy();
    if (!(error instanceof RequestError)) console.error('Request failed:', error.code || error.name);
    json(response, error.status || 500, { error: error instanceof RequestError ? error.message : 'Server gagal memproses dokumen.' });
  });
});
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.maxRequestsPerSocket = 200;
server.listen(port, host, () => console.log(`PDF Scanner listening on http://${host}:${server.address().port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
