import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_PAGES = 30;
const MAX_SESSION_BYTES = 24 * 1024 * 1024;
const PAGE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const IMAGE_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const PAGE_SIZES = ['a4', 'letter', 'original'];
const CATEGORIES = ['other', 'cv', 'letter', 'diploma', 'transcript', 'certificate', 'identity'];

function pageMetadata(body) {
  const metadata = {};
  for (const [key, choices] of [['pageSize', PAGE_SIZES], ['category', CATEGORIES]]) {
    if (body[key] === undefined) continue;
    if (!choices.includes(body[key])) throw new RequestError(400, 'Pengaturan halaman tidak valid.');
    metadata[key] = body[key];
  }
  if (body.ocr !== undefined) {
    const ocr = body.ocr;
    if (ocr !== null) {
      if (!ocr || typeof ocr.text !== 'string' || ocr.text.length > 100000 ||
          !Array.isArray(ocr.words) || ocr.words.length > 15000 || ocr.words.some(word =>
            typeof word?.text !== 'string' || word.text.length > 500 ||
            !['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(word.bbox?.[key]) && word.bbox[key] >= 0 && word.bbox[key] <= 10000) ||
            word.bbox.x1 <= word.bbox.x0 || word.bbox.y1 <= word.bbox.y0)) {
        throw new RequestError(400, 'Data OCR tidak valid.');
      }
    }
    metadata.ocr = ocr === null ? null : { text: ocr.text, words: ocr.words.map(({ text, bbox }) => ({ text, bbox })) };
  }
  return metadata;
}

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createSessionStore(dataDirectory) {
  const sessionFile = dataDirectory ? path.join(dataDirectory, 'session.json') : null;
  let session = { title: 'Scan-Dokumen', pages: [], lastUpdated: Date.now() };
  if (sessionFile) {
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    try {
      session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      if (!Array.isArray(session.pages) || typeof session.title !== 'string') {
        throw new Error('Invalid saved session');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let serialized = JSON.stringify(session);

  function update(action, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError(400, 'Data permintaan tidak valid.');
    }
    let pages = [...session.pages];
    let title = session.title;
    let pageId = body.id;
    if (!['clear', 'update-title', 'reorder-pages'].includes(action)) {
      if (action === 'add-page' && !pageId) pageId = `page-${randomUUID()}`;
      if (typeof pageId !== 'string' || !PAGE_ID.test(pageId)) {
        throw new RequestError(400, 'ID halaman tidak valid.');
      }
    }
    if (action === 'update-metadata') {
      const existing = pages.findIndex(page => page.id === pageId);
      if (existing === -1) throw new RequestError(404, 'Halaman tidak ditemukan.');
      pages[existing] = { ...pages[existing], ...pageMetadata(body) };
    } else if (action === 'reorder-pages') {
      if (!Array.isArray(body.ids) || body.ids.length !== pages.length || new Set(body.ids).size !== pages.length ||
          body.ids.some(id => !pages.some(page => page.id === id))) {
        throw new RequestError(409, 'Daftar halaman berubah. Muat ulang sebelum mengurutkan.');
      }
      pages = body.ids.map(id => pages.find(page => page.id === id));
    } else if (action === 'add-page' || action === 'update-page') {
      if (typeof body.dataUrl !== 'string' || body.dataUrl.length > 4 * 1024 * 1024 || !IMAGE_URL.test(body.dataUrl)) {
        throw new RequestError(400, 'Gambar harus JPEG, PNG, atau WebP, maksimum 4 MB.');
      }
      const existing = pages.findIndex(page => page.id === pageId);
      if (action === 'add-page') {
        if (existing !== -1) throw new RequestError(409, 'Halaman sudah tersimpan.');
        if (pages.length >= MAX_PAGES) throw new RequestError(413, 'Maksimum 30 halaman per sesi. Ekspor lalu hapus halaman lama.');
        const filter = ['magic', 'bw', 'grayscale', 'original', 'color'].includes(body.filter) ? body.filter : 'magic';
        pages.push({ id: pageId, filter, dataUrl: body.dataUrl, createdAt: Date.now(), ...pageMetadata(body) });
      } else {
        if (existing === -1) throw new RequestError(404, 'Halaman tidak ditemukan.');
        pages[existing] = { ...pages[existing], dataUrl: body.dataUrl, ocr: null, ...pageMetadata(body) };
      }
    } else if (action === 'delete-page') {
      pages = pages.filter(page => page.id !== pageId);
    } else if (action === 'clear') {
      pages = [];
    } else if (action === 'update-title') {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120) {
        throw new RequestError(400, 'Nama dokumen harus berisi 1–120 karakter.');
      }
      title = body.title.trim();
    } else {
      throw new RequestError(404, 'Endpoint tidak ditemukan.');
    }
    const next = { ...session, title, pages, lastUpdated: Math.max(Date.now(), session.lastUpdated + 1) };
    const nextSerialized = JSON.stringify(next);
    if (Buffer.byteLength(nextSerialized) > MAX_SESSION_BYTES) {
      throw new RequestError(413, 'Sesi penuh (24 MB). Ekspor lalu hapus halaman lama.');
    }
    if (sessionFile) {
      const temporaryFile = `${sessionFile}.tmp`;
      const descriptor = fs.openSync(temporaryFile, 'w', 0o600);
      try {
        fs.writeFileSync(descriptor, nextSerialized);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporaryFile, sessionFile);
    }
    session = next;
    serialized = nextSerialized;
    return { success: true, count: pages.length, pageId, lastUpdated: next.lastUpdated };
  }
  return { read: () => serialized, version: () => String(session.lastUpdated), update };
}
