import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pdf-scanner-browser-'));
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
  browser = await puppeteer.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const mobile = await browser.newPage();
  const errors = [];
  mobile.on('pageerror', error => errors.push(error.message));
  mobile.on('dialog', dialog => dialog.accept());
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await mobile.goto(base, { waitUntil: 'networkidle0' });
  await mobile.waitForFunction(() => document.querySelector('[data-tool="word-to-pdf"]').getAttribute('aria-disabled') === 'true');
  const pdfResult = await mobile.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 800;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 600, 800);
    context.fillStyle = '#000'; context.fillText('Private scanner smoke test', 40, 50);
    const response = await fetch('/api/session/add-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'browser-scan', dataUrl: canvas.toDataURL('image/jpeg'), filter: 'original' }),
    });
    if (!response.ok) throw new Error('Failed to save scan');
    const { PdfExporter } = await import('/js/pdf-exporter.js');
    const result = await PdfExporter.exportToPdf([{ canvas }]);
    return { bytes: result.blob.size, header: await result.blob.slice(0, 5).text() };
  });
  assert.equal(pdfResult.header, '%PDF-');
  assert.ok(pdfResult.bytes > 1000);
  await mobile.waitForFunction(() => document.querySelectorAll('#pagesGrid .page-thumb-card').length === 1);
  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1366, height: 900 });
  await desktop.goto(base, { waitUntil: 'networkidle0' });
  await desktop.waitForFunction(() => document.querySelectorAll('#pagesGrid .page-thumb-card').length === 1);
  await mobile.reload({ waitUntil: 'networkidle0' });
  await mobile.waitForFunction(() => document.querySelectorAll('#pagesGrid .page-thumb-card').length === 1);
  const links = await mobile.$$eval('.network-link', elements => elements.map(element => element.textContent));
  assert.deepEqual(links, [base]);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mobile: 'pass', desktopSync: 'pass', reload: 'pass', pdfExport: pdfResult, pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await rm(directory, { recursive: true, force: true });
}
