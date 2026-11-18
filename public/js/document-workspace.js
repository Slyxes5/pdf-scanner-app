import { PdfExporter } from './pdf-exporter.js';
import { recognizePages } from './ocr.js';

const categories = { cv: 'CV', letter: 'Surat lamaran', diploma: 'Ijazah', transcript: 'Transkrip', certificate: 'Sertifikat', identity: 'Identitas', other: 'Lainnya' };
const sizes = { a4: 'A4', letter: 'Letter', original: 'Rasio asli' };
const element = id => document.getElementById(id);

export function initializeDocumentWorkspace(state, { render, sync }) {
  let ocrController;
  let changingOrder = false;
  let metadataQueue = Promise.resolve();
  let lastOcrStatus = null;

  function saveMetadata(page, metadata) {
    Object.assign(page, metadata);
    const operation = metadataQueue.then(() => sync('/api/session/update-metadata', { id: page.id, ...metadata }));
    metadataQueue = operation.catch(() => {});
    return operation;
  }

  async function reorder(pages) {
    if (changingOrder) return;
    changingOrder = true;
    try {
      await sync('/api/session/reorder-pages', { ids: pages.map(page => page.id) });
      state.pages = pages;
      render();
    } catch { /* The shared sync handler displays the error. */ }
    finally { changingOrder = false; }
  }

  function applySearch() {
    const query = element('documentSearch').value.trim().toLocaleLowerCase('id');
    let matches = 0;
    document.querySelectorAll('#pagesGrid .page-thumb-card').forEach(card => {
      const page = state.pages.find(page => page.id === card.dataset.pageId);
      const matched = !query || (page?.ocr?.text || '').toLocaleLowerCase('id').includes(query);
      card.hidden = !matched;
      if (matched) matches++;
      const text = card.querySelector('.ocr-text');
      if (text && page?.ocr) {
        text.replaceChildren();
        const content = page.ocr.text;
        const index = query ? content.toLocaleLowerCase('id').indexOf(query) : -1;
        if (index < 0) text.textContent = content || 'Tidak ada teks terdeteksi.';
        else {
          const mark = document.createElement('mark');
          mark.textContent = content.slice(index, index + query.length);
          text.append(content.slice(0, index), mark, content.slice(index + query.length));
        }
      }
    });
    element('searchStatus').textContent = query ? `${matches} dari ${state.pages.length} halaman cocok. Halaman tanpa OCR belum bisa dicari.` : 'Pencarian menyaring tampilan. Isi PDF mengikuti pilihan ekspor, bukan hasil pencarian.';
  }

  function selectControl(label, choices, value, onChange) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const [key, text] of Object.entries(choices)) select.add(new Option(text, key));
    select.value = value;
    select.addEventListener('change', async () => {
      await onChange(select.value).catch(() => {});
      render();
    });
    wrapper.appendChild(select);
    return wrapper;
  }

  function button(label, action, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'toolbar-pill';
    button.disabled = disabled;
    button.addEventListener('click', action);
    return button;
  }

  function preview(page, index) {
    const layout = PdfExporter.pageLayout(page);
    const canvas = element('pagePreviewCanvas');
    const scale = 900 / Math.max(...layout.dimensions);
    canvas.width = Math.round(layout.dimensions[0] * scale);
    canvas.height = Math.round(layout.dimensions[1] * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(page.canvas, layout.x * scale, layout.y * scale, layout.width * scale, layout.height * scale);
    element('pagePreviewTitle').textContent = `Halaman ${index + 1} · ${sizes[page.pageSize || 'a4']}`;
    element('pagePreviewDialog').showModal();
  }

  function renderControls() {
    const applicationMode = element('documentMode').value === 'application';
    element('applicationControls').hidden = !applicationMode;
    element('applicationSummary').textContent = Object.entries(categories)
      .map(([key, label]) => `${label}: ${state.pages.filter(page => (page.category || 'other') === key).length}`).join(' · ');
    document.querySelectorAll('#pagesGrid .page-thumb-card').forEach((card, index) => {
      const page = state.pages[index];
      card.dataset.pageId = page.id;
      const image = card.querySelector('img');
      const layout = PdfExporter.pageLayout(page);
      image.style.aspectRatio = `${layout.dimensions[0]} / ${layout.dimensions[1]}`;
      image.style.padding = page.pageSize === 'original' ? '0' : `${5 / layout.dimensions[0] * 100}%`;
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `Preview halaman ${index + 1}`);
      image.addEventListener('click', () => preview(page, index));
      image.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview(page, index); }
      });
      const controls = document.createElement('div');
      controls.className = 'page-settings';
      controls.appendChild(selectControl(`Ukuran halaman ${index + 1}`, sizes, page.pageSize || 'a4', value => saveMetadata(page, { pageSize: value })));
      if (applicationMode) controls.appendChild(selectControl(`Jenis halaman ${index + 1}`, categories, page.category || 'other', value => saveMetadata(page, { category: value })));
      const order = document.createElement('div');
      order.className = 'document-control-row';
      for (const [offset, label] of [[-1, '↑ Naik'], [1, '↓ Turun']]) {
        order.appendChild(button(label, () => {
          const pages = [...state.pages];
          [pages[index], pages[index + offset]] = [pages[index + offset], pages[index]];
          void reorder(pages);
        }, index + offset < 0 || index + offset >= state.pages.length));
      }
      controls.appendChild(order);
      if (page.ocr) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Lihat teks OCR';
        const text = document.createElement('p');
        text.className = 'ocr-text';
        details.append(summary, text);
        controls.appendChild(details);
      } else {
        const status = document.createElement('span');
        status.className = 'document-hint';
        status.textContent = 'Belum dibaca OCR';
        controls.appendChild(status);
      }
      card.appendChild(controls);
    });
    element('btnRunOcr').disabled = Boolean(ocrController) || state.pages.length === 0;
    if (!ocrController && !lastOcrStatus) {
      const recognized = state.pages.filter(page => page.ocr).length;
      element('ocrStatus').textContent = recognized ? `${recognized}/${state.pages.length} halaman sudah dibaca. Halaman baru atau diputar perlu OCR lagi.` : 'Belum ada teks yang dibaca.';
    }
    applySearch();
  }

  for (const id of ['documentMode', 'defaultPageSize', 'newPageCategory', 'exportCategory']) {
    try {
      const saved = localStorage.getItem(`scanner-${id}`);
      if (saved && [...element(id).options].some(option => option.value === saved)) element(id).value = saved;
    } catch { /* Preferences remain usable when browser storage is blocked. */ }
    element(id).addEventListener('change', () => {
      try { localStorage.setItem(`scanner-${id}`, element(id).value); } catch { /* Optional preference storage. */ }
      render();
    });
  }
  element('documentSearch').addEventListener('input', applySearch);
  element('btnClosePagePreview').addEventListener('click', () => element('pagePreviewDialog').close());
  element('btnApplyPageSize').addEventListener('click', async () => {
    const button = element('btnApplyPageSize');
    button.disabled = true;
    try {
      for (const page of [...state.pages]) await saveMetadata(page, { pageSize: element('defaultPageSize').value });
    } catch { /* The shared sync handler displays the error. */ }
    finally { button.disabled = false; render(); }
  });
  element('btnSortApplication').addEventListener('click', () => {
    const order = Object.keys(categories);
    void reorder([...state.pages].sort((a, b) => order.indexOf(a.category || 'other') - order.indexOf(b.category || 'other')));
  });
  element('btnCancelOcr').addEventListener('click', () => ocrController?.abort());
  element('btnRunOcr').addEventListener('click', async () => {
    if (ocrController) return;
    const pages = state.pages.filter(page => !page.ocr);
    if (!pages.length) { element('ocrStatus').textContent = 'Semua halaman sudah dibaca.'; return; }
    ocrController = new AbortController();
    lastOcrStatus = null;
    element('btnCancelOcr').hidden = false;
    element('btnRunOcr').disabled = true;
    try {
      await recognizePages(pages, {
        signal: ocrController.signal,
        onProgress: text => { element('ocrStatus').textContent = text; },
        onPage: async (page, ocr, source) => {
          const current = state.pages.find(item => item.id === page.id);
          if (!current || current.dataUrl !== source) return;
          await saveMetadata(current, { ocr });
          render();
        },
      });
      lastOcrStatus = 'OCR selesai. Teks tersedia untuk pencarian dan disertakan pada PDF.';
      element('ocrStatus').textContent = lastOcrStatus;
    } catch (error) {
      lastOcrStatus = ocrController.signal.aborted ? 'OCR dibatalkan. Hasil yang sudah selesai tetap tersimpan.' : `OCR gagal: ${error.message}. Coba lagi; hasil sebelumnya tetap tersimpan.`;
      element('ocrStatus').textContent = lastOcrStatus;
    } finally {
      ocrController = null;
      element('btnCancelOcr').hidden = true;
      render();
    }
  });

  return {
    render: renderControls,
    exportPages: () => state.pages.filter(page => element('documentMode').value !== 'application' ||
      element('exportCategory').value === 'all' || (page.category || 'other') === element('exportCategory').value),
    exportSuffix: () => element('documentMode').value === 'application' && element('exportCategory').value !== 'all'
      ? `-${categories[element('exportCategory').value]}` : '',
  };
}
