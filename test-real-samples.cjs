const puppeteer = require('C:/Projects/kit-kliping-engine/node_modules/puppeteer-core');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('Testing real document photos with SnapScanner...');
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1200 });

  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Function to process a real photo file
  async function testFile(filePath, prefix, rotateCount = 0) {
    console.log(`\n=== Processing: ${prefix} ===`);
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // Upload file to fileInput
    const fileInput = await page.$('#fileInput');
    await fileInput.uploadFile(filePath);
    await new Promise(r => setTimeout(r, 1200));

    // 1. Capture Crop View (Detected corners on raw photo)
    const cropScreen = `C:/Projects/pdf-scanner-app/public/assets/${prefix}-1-crop.png`;
    await page.screenshot({ path: cropScreen });
    console.log(`Saved: ${cropScreen}`);

    // 2. Click Warp Done -> Go to Enhance View
    await page.click('#btnWarpDone');
    await new Promise(r => setTimeout(r, 1000));

    // Rotate if needed (e.g. for sideways receipt)
    for (let i = 0; i < rotateCount; i++) {
      console.log(`Rotating 90 deg clockwise (step ${i + 1}/${rotateCount})...`);
      await page.click('#btnEnhanceRotate');
      await new Promise(r => setTimeout(r, 600));
    }

    // Capture Magic Color result
    const magicScreen = `C:/Projects/pdf-scanner-app/public/assets/${prefix}-2-magic.png`;
    await page.screenshot({ path: magicScreen });
    console.log(`Saved: ${magicScreen}`);

    // Capture B&W result
    await page.click('.filter-chip[data-filter="bw"]');
    await new Promise(r => setTimeout(r, 800));
    const bwScreen = `C:/Projects/pdf-scanner-app/public/assets/${prefix}-3-bw.png`;
    await page.screenshot({ path: bwScreen });
    console.log(`Saved: ${bwScreen}`);
  }

  await testFile('C:/Projects/pdf-scanner-app/public/assets/sample-page.jpg', 'doc-page', 0);
  await testFile('C:/Projects/pdf-scanner-app/public/assets/sample-receipt.jpg', 'doc-receipt', 3);

  await browser.close();
  console.log('Finished testing all real samples!');
})();
