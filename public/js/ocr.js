let libraryPromise;

function loadLibrary() {
  if (window.Tesseract) return Promise.resolve();
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/assets/ocr/tesseract.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Aset OCR belum tersedia. Jalankan npm run prepare:ocr di server.'));
      document.head.appendChild(script);
    }).catch(error => { libraryPromise = null; throw error; });
  }
  return libraryPromise;
}

export async function recognizePages(pages, { onProgress = () => {}, onPage = async () => {}, signal } = {}) {
  await loadLibrary();
  let current = 0;
  let worker;
  let rejectInterrupted;
  const interrupted = new Promise((resolve, reject) => { rejectInterrupted = reject; });
  const abort = () => rejectInterrupted(new DOMException('OCR dibatalkan.', 'AbortError'));
  const run = task => Promise.race([task, interrupted]);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException('OCR dibatalkan.', 'AbortError');
    onProgress('Menyiapkan OCR Bahasa Indonesia + English...');
    worker = await run(window.Tesseract.createWorker(['ind', 'eng'], 1, {
      workerPath: `${location.origin}/assets/ocr/worker.min.js`,
      corePath: `${location.origin}/assets/ocr`,
      langPath: `${location.origin}/assets/ocr`,
      workerBlobURL: false,
      errorHandler: error => rejectInterrupted(new Error(String(error))),
      logger: message => {
        if (message.status === 'recognizing text') {
          onProgress(`OCR ${current + 1}/${pages.length} · ${Math.round(message.progress * 100)}%`);
        }
      },
    }).then(created => {
      if (signal?.aborted) void created.terminate();
      return created;
    }));
    for (current = 0; current < pages.length; current++) {
      if (signal?.aborted) throw new DOMException('OCR dibatalkan.', 'AbortError');
      const page = pages[current];
      // A data URL snapshots the page so edits cannot change coordinates during recognition.
      const source = page.dataUrl || page.canvas.toDataURL('image/png');
      const { data } = await run(worker.recognize(source, {}, { text: true, blocks: true }));
      const words = (data.blocks || []).flatMap(block => block.paragraphs || [])
        .flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || [])
        .filter(word => word.text.trim() && word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0)
        .map(({ text, bbox }) => ({ text, bbox }));
      await onPage(page, { text: data.text, words }, source);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (worker) await worker.terminate();
  }
}
