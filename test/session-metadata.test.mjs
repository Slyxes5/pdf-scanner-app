import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../session-store.mjs';

const dataUrl = 'data:image/png;base64,AAAA';
test('page metadata and exact reordering preserve scans and reject invalid OCR', () => {
  const store = createSessionStore();
  store.update('add-page', { id: 'first', dataUrl, pageSize: 'a4', category: 'diploma' });
  store.update('add-page', { id: 'second', dataUrl, pageSize: 'original', category: 'cv' });
  const ocr = { text: 'IJAZAH', words: [{ text: 'IJAZAH', bbox: { x0: 10, y0: 10, x1: 100, y1: 30 } }] };
  store.update('update-metadata', { id: 'first', ocr, pageSize: 'letter' });
  store.update('reorder-pages', { ids: ['second', 'first'] });
  const session = JSON.parse(store.read());
  assert.deepEqual(session.pages.map(page => page.id), ['second', 'first']);
  assert.equal(session.pages[1].dataUrl, dataUrl);
  assert.deepEqual(session.pages[1].ocr, ocr);
  assert.equal(session.pages[1].pageSize, 'letter');
  const before = store.read();
  for (const body of [
    { pageSize: 'bad' }, { category: '<script>' },
    { ocr: { text: 'bad', words: [{ text: 'bad', bbox: { x0: 30, y0: 0, x1: 10, y1: 10 } }] } },
    { ocr: { text: 'bad', words: [null] } },
  ]) assert.throws(() => store.update('update-metadata', { id: 'first', ...body }), error => error.status === 400);
  assert.throws(() => store.update('reorder-pages', { ids: ['first', 'first'] }), error => error.status === 409);
  assert.throws(() => store.update('reorder-pages', { ids: ['first'] }), error => error.status === 409);
  assert.equal(store.read(), before);
  store.update('update-page', { id: 'first', dataUrl });
  assert.equal(JSON.parse(store.read()).pages[1].ocr, null);
});
