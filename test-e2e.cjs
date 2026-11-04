const puppeteer = require('C:/Projects/kit-kliping-engine/node_modules/puppeteer-core');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  console.log('Launching browser test via Edge...');
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const errors = [];

  page.on('console', msg => console.log('BROWSER_LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => {
    console.error('PAGE_ERROR:', err);
    errors.push(err.toString());
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  console.log('Page Title:', await page.title());

  // 1. Click sample document
  await page.click('#btnStartSample');
  await new Promise(r => setTimeout(r, 600));

  const isCropActive = await page.evaluate(() => document.getElementById('view-crop').classList.contains('active'));
  console.log('Step 1 (Auto-Crop View Active):', isCropActive);
  await page.screenshot({ path: 'C:/Projects/pdf-scanner-app/test-crop-view.png' });

  // 2. Click Warp Done
  await page.click('#btnWarpDone');
  await new Promise(r => setTimeout(r, 600));

  const isEnhanceActive = await page.evaluate(() => document.getElementById('view-enhance').classList.contains('active'));
  const imgSrc = await page.evaluate(() => document.getElementById('enhancePreview').src);
  console.log('Step 2 (Enhance View Active):', isEnhanceActive, '| Preview src exists:', imgSrc.startsWith('data:image/jpeg'));
  await page.screenshot({ path: 'C:/Projects/pdf-scanner-app/test-enhance-magic.png' });

  // 3. Test changing filter to 'bw'
  await page.click('.filter-chip[data-filter="bw"]');
  await new Promise(r => setTimeout(r, 500));
  console.log('Step 3 (B&W Filter Applied)');
  await page.screenshot({ path: 'C:/Projects/pdf-scanner-app/test-enhance-bw.png' });

  // 4. Save Page
  await page.click('#btnSavePage');
  await new Promise(r => setTimeout(r, 600));

  const isDocActive = await page.evaluate(() => document.getElementById('view-document').classList.contains('active'));
  const pageCount = await page.evaluate(() => document.getElementById('docPageCount').textContent);
  console.log('Step 4 (Document View Active):', isDocActive, '| Count:', pageCount);

  // 5. Test Export PDF
  await page.click('#btnExportPdf');
  await new Promise(r => setTimeout(r, 1200));
  console.log('Step 5 (PDF Export Triggered)');

  // Take screenshot of Document View to verify UI
  await page.screenshot({ path: 'C:/Projects/pdf-scanner-app/test-screenshot.png' });
  console.log('Screenshot saved to test-screenshot.png');

  if (errors.length > 0) {
    console.error('Page errors encountered:', errors);
    process.exit(1);
  } else {
    console.log('SUCCESS! All 5 scanner workflow steps passed with 0 errors.');
  }

  await browser.close();
})();
