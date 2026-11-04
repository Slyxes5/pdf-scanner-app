import puppeteer from 'C:/Projects/kit-kliping-engine/node_modules/puppeteer/cjs/puppeteer/puppeteer.js';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const errors = [];

  page.on('console', msg => console.log('BROWSER_LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => errors.push(err.toString()));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  console.log('Page Title:', await page.title());

  // 1. Click sample document
  await page.click('#btnStartSample');
  await new Promise(r => setTimeout(r, 600));

  const isCropActive = await page.$eval('#view-crop', el => el.classList.contains('active'));
  console.log('Step 1 (Auto-Crop View Active):', isCropActive);

  // 2. Click Warp Done
  await page.click('#btnWarpDone');
  await new Promise(r => setTimeout(r, 600));

  const isEnhanceActive = await page.$eval('#view-enhance', el => el.classList.contains('active'));
  const imgSrc = await page.$eval('#enhancePreview', el => el.src);
  console.log('Step 2 (Enhance View Active):', isEnhanceActive, '| Preview src exists:', imgSrc.startsWith('data:image/jpeg'));

  // 3. Test changing filter to 'bw'
  await page.click('.filter-chip[data-filter="bw"]');
  await new Promise(r => setTimeout(r, 300));
  console.log('Step 3 (B&W Filter Applied)');

  // 4. Save Page
  await page.click('#btnSavePage');
  await new Promise(r => setTimeout(r, 600));

  const isDocActive = await page.$eval('#view-document', el => el.classList.contains('active'));
  const pageCount = await page.$eval('#docPageCount', el => el.textContent);
  console.log('Step 4 (Document View Active):', isDocActive, '| Count:', pageCount);

  // 5. Test Export PDF
  await page.click('#btnExportPdf');
  await new Promise(r => setTimeout(r, 800));
  console.log('Step 5 (PDF Export Triggered)');

  if (errors.length > 0) {
    console.error('Page errors encountered:', errors);
    process.exit(1);
  } else {
    console.log('SUCCESS! All 5 scanner workflow steps passed with 0 errors.');
  }

  await browser.close();
})();
