import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const artifacts = await mkdtemp(path.join(os.tmpdir(), 'scanner-workflow-'));
const directory = path.join(artifacts, 'session');
await mkdir(directory);
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory, ENABLE_SERVER_TOOLS: 'false' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    child.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('error', reject);
  });
  browser = await puppeteer.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.accept(); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#navBtnDocs');
  await page.select('#documentMode', 'application');
  await page.select('#newPageCategory', 'diploma');
  const fixtures = await page.evaluate(() => ['IJAZAH UNIVERSITAS', 'CURRICULUM VITAE', 'SERTIFIKAT KOMPETENSI'].map((title, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = index === 1 ? 1000 : 700;
    canvas.height = index === 1 ? 700 : 990;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#003399'; context.lineWidth = 4;
    context.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
    context.fillStyle = '#000'; context.font = 'bold 30px Arial';
    context.fillText(title, 40, 100);
    context.font = '26px Arial';
    context.fillText('Dokumen pengujian scanner', 40, 180);
    context.fillText(`Nomor dokumen ${index + 1}`, 40, 230);
    context.fillStyle = '#bb0000'; context.fillText('TANDA TANGAN', 40, canvas.height - 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const files = [];
  for (let index = 0; index < fixtures.length; index++) {
    const file = path.join(artifacts, `input-${index}.png`);
    await writeFile(file, Buffer.from(fixtures[index], 'base64'));
    files.push(file);
  }
  const input = await page.$('#fileInput');
  await input.uploadFile(...files);
  for (let index = 0; index < 3; index++) {
    await page.waitForSelector('#view-crop.active');
    await page.click('#btnResetCrop');
    await page.click('#btnWarpDone');
    await page.waitForSelector('#view-enhance.active');
    await page.click('[data-filter="original"]');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/session/add-page') && response.status() === 200);
    await page.click('#btnSavePage');
    await saved;
  }
  await page.waitForSelector('#view-document.active');
  assert.equal(await page.$$eval('#pagesGrid .page-thumb-card', cards => cards.length), 3);
  const selectAndSave = async (selector, value) => {
    const saved = page.waitForResponse(response => response.url().endsWith('/api/session/update-metadata') && response.status() === 200);
    await page.select(selector, value);
    await saved;
  };
  await selectAndSave('[aria-label="Jenis halaman 2"]', 'cv');
  await selectAndSave('[aria-label="Jenis halaman 3"]', 'certificate');
  await selectAndSave('[aria-label="Ukuran halaman 2"]', 'letter');
  await selectAndSave('[aria-label="Ukuran halaman 3"]', 'original');
  const reordered = page.waitForResponse(response => response.url().endsWith('/api/session/reorder-pages') && response.status() === 200);
  await page.click('#btnSortApplication');
  await reordered;
  await page.waitForFunction(() => document.querySelector('[aria-label="Jenis halaman 1"]').value === 'cv');
  await page.click('#pagesGrid .page-thumb-card img');
  assert.equal(await page.$eval('#pagePreviewDialog', dialog => dialog.open), true);
  await page.screenshot({ path: path.join(artifacts, 'mobile-preview.png') });
  await page.click('#btnClosePagePreview');
  console.log('Batch import, categories, mixed formats, and preview passed.');
  const externalOcrRequests = [];
  page.on('request', request => {
    if (!request.url().startsWith(base) && /tesseract|traineddata/.test(request.url())) externalOcrRequests.push(request.url());
  });
  await page.$eval('#btnRunOcr', element => element.scrollIntoView({ block: 'center' }));
  await page.click('#btnRunOcr');
  await page.waitForFunction(() => document.getElementById('btnRunOcr').disabled, { timeout: 5000 });
  await page.waitForFunction(() => /OCR selesai|OCR gagal/.test(document.getElementById('ocrStatus').textContent), { timeout: 120000 });
  const ocrStatus = await page.$eval('#ocrStatus', element => element.textContent);
  assert.match(ocrStatus, /OCR selesai/);
  let session = await (await fetch(`${base}/api/session`)).json();
  assert.deepEqual(session.pages.map(page => page.category), ['cv', 'diploma', 'certificate']);
  assert.match(session.pages[0].ocr.text, /CURRICULUM VITAE/i);
  assert.match(session.pages[2].ocr.text, /SERTIFIKAT/i);
  assert.ok(session.pages.every(page => page.ocr.words.length > 0));
  assert.deepEqual(externalOcrRequests, []);
  console.log('Real local OCR passed.');
  await page.select('#exportCategory', 'certificate');
  await page.evaluate(async () => {
    const { PdfExporter } = await import('/js/pdf-exporter.js');
    PdfExporter.sharePdf = async () => false;
    PdfExporter.downloadPdf = async (blob, filename) => {
      window.exportedCategory = { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), filename };
    };
  });
  await page.$eval('#btnExportPdf', element => element.scrollIntoView({ block: 'center' }));
  await page.click('#btnExportPdf');
  await page.waitForFunction(() => Boolean(window.exportedCategory));
  const categoryExport = await page.evaluate(() => window.exportedCategory);
  assert.equal((await PDFDocument.load(new Uint8Array(categoryExport.bytes))).getPageCount(), 1);
  assert.match(categoryExport.filename, /Sertifikat/);
  await page.select('#exportCategory', 'all');
  await page.type('#documentSearch', 'SERTIFIKAT');
  assert.equal(await page.$$eval('#pagesGrid .page-thumb-card:not([hidden])', cards => cards.length), 1);
  assert.match(await page.$eval('#pagesGrid .page-thumb-card:not([hidden]) .ocr-text', element => element.textContent), /SERTIFIKAT/);
  await page.screenshot({ path: path.join(artifacts, 'mobile-search.png'), fullPage: true });
  await page.$eval('#documentSearch', element => { element.value = ''; element.dispatchEvent(new Event('input')); });
  const exported = await page.evaluate(async () => {
    const { pages } = await (await fetch('/api/session')).json();
    for (const page of pages) {
      const image = new Image(); image.src = page.dataUrl; await image.decode();
      page.canvas = document.createElement('canvas'); page.canvas.width = image.width; page.canvas.height = image.height;
      page.canvas.getContext('2d').drawImage(image, 0, 0);
    }
    const { PdfExporter } = await import('/js/pdf-exporter.js');
    const results = [];
    for (const withOcr of [true, false]) {
      const { blob } = await PdfExporter.exportToPdf(pages.map(page => ({ ...page, ocr: withOcr ? page.ocr : null })));
      results.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
    }
    return results;
  });
  await writeFile(path.join(artifacts, 'searchable.pdf'), Buffer.from(exported[0]));
  await writeFile(path.join(artifacts, 'images-only.pdf'), Buffer.from(exported[1]));
  const pdf = await PDFDocument.load(await readFile(path.join(artifacts, 'searchable.pdf')));
  assert.equal(pdf.getPageCount(), 3);
  const dimensions = pdf.getPages().map(page => page.getSize());
  console.log('Search and PDF export passed.');
  assert.ok(Math.abs(dimensions[0].width - 792) < 1 && Math.abs(dimensions[0].height - 612) < 1);
  assert.ok(Math.abs(dimensions[1].width - 595.28) < 1 && Math.abs(dimensions[1].height - 841.89) < 1);
  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1366, height: 900 });
  await desktop.goto(base, { waitUntil: 'networkidle0' });
  await desktop.click('#navBtnDocs');
  await desktop.waitForFunction(() => document.querySelectorAll('.ocr-text').length === 3);
  await desktop.select('#documentMode', 'application');
  assert.equal(await desktop.$eval('[aria-label="Jenis halaman 1"]', element => element.value), 'cv');
  await desktop.screenshot({ path: path.join(artifacts, 'desktop-document.png'), fullPage: true });
  console.log('Desktop sync passed.');
  await page.bringToFront();
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('.ocr-text').length === 3);
  console.log('Reload passed.');
  // Rotating an OCR page invalidates its coordinates and is synchronized to the other device.
  await page.click('#navBtnDocs');
  await page.waitForSelector('#view-document.active');
  console.log('Document reopened.');
  const rotated = page.waitForResponse(response => response.url().endsWith('/api/session/update-page') && response.status() === 200);
  await page.$eval('#pagesGrid .thumb-rot-btn', element => element.scrollIntoView({ block: 'center' }));
  await page.click('#pagesGrid .thumb-rot-btn');
  console.log('Rotation clicked.');
  await rotated;
  session = await (await fetch(`${base}/api/session`)).json();
  assert.equal(session.pages[0].ocr, null);
  await desktop.bringToFront();
  await desktop.waitForFunction(() => document.querySelectorAll('.ocr-text').length === 2);
  await page.bringToFront();
  await page.evaluate(() => {
    document.getElementById('btnRunOcr').click();
    document.getElementById('btnCancelOcr').click();
  });
  await page.waitForFunction(() => document.getElementById('ocrStatus').textContent.startsWith('OCR dibatalkan'));
  assert.equal(await page.$eval('#btnRunOcr', element => element.disabled), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'pass', batchImport: 3, localOcr: 'pass', search: 'pass', mixedPageSizes: dimensions, categoryOrder: 'pass', categoryExport: 'pass', desktopSync: 'pass', reload: 'pass', rotationInvalidatesOcr: 'pass', cancelOcr: 'pass', artifacts }));
} finally {
  if (browser) {
    const pages = await browser.pages();
    for (const page of pages.filter(page => page.url().startsWith('http'))) {
      await page.screenshot({ path: path.join(artifacts, 'last-state.png') }).catch(() => {});
      console.log('Final OCR status:', await page.$eval('#ocrStatus', element => element.textContent).catch(() => 'unavailable'), artifacts);
    }
  }
  if (browser) await browser.close();
  if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await rm(directory, { recursive: true, force: true });
}
