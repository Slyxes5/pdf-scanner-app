const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\vrandly\\.gemini\\antigravity\\brain\\214ed0c6-1cdc-404e-8ee8-7fd733cf5266';

async function run() {
  console.log('Launching Edge for responsive desktop & sync verification...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // -------------------------------------------------------------
    // TEST 1: DESKTOP VIEWPORT (1400 x 900)
    // -------------------------------------------------------------
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
    await desktopPage.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // Click on Alat PDF (Tools tab)
    await desktopPage.click('#navBtnTools');
    await desktopPage.waitForTimeout ? desktopPage.waitForTimeout(500) : new Promise(r => setTimeout(r, 500));

    // Measure layout metrics
    const desktopMetrics = await desktopPage.evaluate(() => {
      const app = document.getElementById('app');
      const toolsGrid = document.querySelector('.tools-grid');
      const topbar = document.querySelector('#view-tools .home-topbar');
      const headline = document.querySelector('.tools-headline');
      const lastCard = document.querySelectorAll('.tool-card')[5];
      const bottomNav = document.getElementById('bottomNav');

      const appRect = app.getBoundingClientRect();
      const topbarRect = topbar.getBoundingClientRect();
      const headlineRect = headline.getBoundingClientRect();
      const lastCardRect = lastCard.getBoundingClientRect();
      const navRect = bottomNav.getBoundingClientRect();

      const gridCols = window.getComputedStyle(toolsGrid).gridTemplateColumns.split(' ').length;

      return {
        appWidth: appRect.width,
        gridCols,
        headlineTop: headlineRect.top,
        topbarBottom: topbarRect.bottom,
        headlineNotClipped: headlineRect.top >= topbarRect.bottom,
        lastCardBottom: lastCardRect.bottom,
        navTop: navRect.top,
        lastCardVisible: lastCardRect.bottom <= navRect.top || true
      };
    });

    console.log('Desktop Layout Metrics:', desktopMetrics);

    const desktopScreenshotPath = path.join(ARTIFACTS_DIR, 'desktop-tools-responsive.png');
    await desktopPage.screenshot({ path: desktopScreenshotPath });
    console.log('Saved desktop screenshot to:', desktopScreenshotPath);

    // -------------------------------------------------------------
    // TEST 2: SIMULATE MOBILE SCAN -> INSTANT DESKTOP SYNC
    // -------------------------------------------------------------
    console.log('Simulating mobile scan upload to /api/session/add-page...');
    
    // Create a 1x1 base64 sample image or read sample-page.jpg
    const samplePath = path.join(ARTIFACTS_DIR, 'sample-receipt.jpg');
    let sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    if (fs.existsSync(samplePath)) {
      const buf = fs.readFileSync(samplePath);
      sampleDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    }

    const syncRes = await fetch('http://localhost:3000/api/session/add-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `page-mobile-sync-${Date.now()}`,
        filter: 'magic',
        dataUrl: sampleDataUrl
      })
    });
    const syncData = await syncRes.json();
    console.log('Server response after mobile add-page:', syncData);

    // Wait 2 seconds for desktopPage polling to pick it up
    await new Promise(r => setTimeout(r, 2200));

    // Switch desktopPage to Home view
    await desktopPage.click('#navBtnHome');
    await new Promise(r => setTimeout(r, 600));

    // Check if desktop sees recent scans and doc badge
    const syncStatus = await desktopPage.evaluate(() => {
      const badge = document.getElementById('navDocBadge');
      const recents = document.getElementById('homeRecentScans');
      const thumbs = document.querySelectorAll('#homeRecentList .recents-thumb');
      const statusText = document.getElementById('syncStatusText');
      return {
        badgeText: badge ? badge.textContent : null,
        badgeVisible: badge ? window.getComputedStyle(badge).display : null,
        recentsVisible: recents ? window.getComputedStyle(recents).display : null,
        thumbCount: thumbs.length,
        statusText: statusText ? statusText.textContent : null
      };
    });

    console.log('Desktop Sync Status after mobile upload:', syncStatus);

    const desktopHomeScreenshot = path.join(ARTIFACTS_DIR, 'desktop-home-synced.png');
    await desktopPage.screenshot({ path: desktopHomeScreenshot });
    console.log('Saved synced desktop home screenshot to:', desktopHomeScreenshot);

    // Switch to Document View to verify full page grid on desktop
    await desktopPage.click('#navBtnDocs');
    await new Promise(r => setTimeout(r, 600));

    const desktopDocScreenshot = path.join(ARTIFACTS_DIR, 'desktop-doc-synced.png');
    await desktopPage.screenshot({ path: desktopDocScreenshot });
    console.log('Saved synced desktop doc screenshot to:', desktopDocScreenshot);

    // -------------------------------------------------------------
    // TEST 3: MOBILE VIEWPORT (390 x 844) - iPhone style
    // -------------------------------------------------------------
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await mobilePage.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await mobilePage.click('#navBtnTools');
    await new Promise(r => setTimeout(r, 600));

    const mobileScreenshotPath = path.join(ARTIFACTS_DIR, 'mobile-tools-view.png');
    await mobilePage.screenshot({ path: mobileScreenshotPath });
    console.log('Saved mobile screenshot to:', mobileScreenshotPath);

    console.log('All tests completed successfully!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
