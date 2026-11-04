const puppeteer = require('C:/Projects/kit-kliping-engine/node_modules/puppeteer-core');
const fs = require('fs');
const http = require('http');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function postBinary(urlPath, buffer, filename) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
        'X-Filename': encodeURIComponent(filename)
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

(async () => {
  console.log('--- STARTING ALL-IN-ONE PDF TOOLS TEST SUITE ---');

  // ========================================================
  // 1. TEST BROWSER UI & NAVIGATION
  // ========================================================
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  console.log('1. Page loaded. Title:', await page.title());

  // Click on "Alat PDF" tab in bottom nav
  await page.click('#navBtnTools');
  await new Promise(r => setTimeout(r, 400));

  const isToolsActive = await page.evaluate(() => document.getElementById('view-tools').classList.contains('active'));
  console.log('2. Switched to Alat PDF view:', isToolsActive);
  await page.screenshot({ path: 'C:/Projects/pdf-scanner-app/test-tools-view.png' });
  console.log('   Saved test-tools-view.png');

  // Click on "Word ke PDF" card to open modal
  await page.click('[data-tool="word-to-pdf"]');
  await new Promise(r => setTimeout(r, 400));

  const isModalActive = await page.evaluate(() => document.getElementById('toolModal').classList.contains('active'));
  const modalTitle = await page.evaluate(() => document.getElementById('modalToolTitle').textContent);
  console.log('3. Opened Tool Modal:', isModalActive, '| Title:', modalTitle);
  await page.screenshot({ path: 'C:/Projects/pdf-scanner-app/test-tools-modal.png' });
  console.log('   Saved test-tools-modal.png');

  // Close modal
  await page.click('#btnModalClose');
  await new Promise(r => setTimeout(r, 300));
  const isModalClosed = await page.evaluate(() => !document.getElementById('toolModal').classList.contains('active'));
  console.log('4. Modal closed properly:', isModalClosed);

  // Test category filter on tools view
  await page.click('.tool-filter-pill[data-filter="organize"]');
  await new Promise(r => setTimeout(r, 200));
  const visibleCards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.tool-card'))
      .filter(c => c.style.display !== 'none')
      .map(c => c.dataset.tool);
  });
  console.log('5. Filter "organize" cards visible:', visibleCards);

  await browser.close();

  // ========================================================
  // 2. TEST BACKEND CONVERSION APIS
  // ========================================================
  console.log('\n--- TESTING API ENDPOINTS ---');

  // A. Generate a small valid PDF using pdf-lib
  const { PDFDocument, rgb } = require('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const pdfPage = pdfDoc.addPage([595.28, 841.89]);
  pdfPage.drawText('DOKUMEN PENGUJIAN API SNAPSCANNER', { x: 50, y: 750, size: 14, color: rgb(0.1, 0.1, 0.1) });
  pdfPage.drawText('Tanggal Uji: 05 November 2026', { x: 50, y: 720, size: 10, color: rgb(0.3, 0.3, 0.3) });
  const testPdfBytes = Buffer.from(await pdfDoc.save());

  // B. Test POST /api/tools/pdf-to-word
  console.log('6. Testing POST /api/tools/pdf-to-word...');
  const resDocx = await postBinary('/api/tools/pdf-to-word', testPdfBytes, 'test.pdf');
  console.log('   Status:', resDocx.statusCode, '| Docx Size:', resDocx.body.length, 'bytes');
  if (resDocx.statusCode !== 200 || resDocx.body.length < 1000) {
    throw new Error('pdf-to-word failed!');
  }

  // C. Test POST /api/tools/word-to-pdf
  console.log('7. Testing POST /api/tools/word-to-pdf...');
  const resPdf = await postBinary('/api/tools/word-to-pdf', resDocx.body, 'converted.docx');
  console.log('   Status:', resPdf.statusCode, '| PDF Size:', resPdf.body.length, 'bytes');
  if (resPdf.statusCode !== 200 || resPdf.body.length < 1000) {
    throw new Error('word-to-pdf failed!');
  }

  // D. Test POST /api/tools/pdf-to-images
  console.log('8. Testing POST /api/tools/pdf-to-images...');
  const resImages = await postBinary('/api/tools/pdf-to-images?dpi=100', resPdf.body, 'test.pdf');
  const imagesData = JSON.parse(resImages.body.toString());
  console.log('   Status:', resImages.statusCode, '| Image count:', imagesData.count);
  if (resImages.statusCode !== 200 || imagesData.count < 1) {
    throw new Error('pdf-to-images failed!');
  }

  // E. Test POST /api/tools/compress-pdf
  console.log('9. Testing POST /api/tools/compress-pdf...');
  const resCompress = await postBinary('/api/tools/compress-pdf', resPdf.body, 'test.pdf');
  console.log('   Status:', resCompress.statusCode, '| Compressed Size:', resCompress.body.length, 'bytes');
  if (resCompress.statusCode !== 200) {
    throw new Error('compress-pdf failed!');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL TESTS PASSED! FULL ILovePDF SUITE OPERATIONAL!');
  console.log('======================================================');
})();
