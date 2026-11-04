import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import mammoth from 'mammoth';
import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/**
 * Konversi berkas .docx (Word) menjadi berkas PDF A4 berkualitas tinggi
 * @param {Buffer} docxBuffer 
 * @returns {Promise<Buffer>}
 */
export async function convertWordToPdf(docxBuffer) {
  // 1. Ekstrak konten HTML dari docx
  const { value: htmlBody } = await mammoth.convertToHtml({ buffer: docxBuffer });

  const htmlDocument = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Dokumen Hasil Konversi</title>
  <style>
    @page {
      size: A4;
      margin: 25mm 20mm 20mm 20mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #111827;
      margin: 0;
      padding: 0;
    }
    p {
      margin: 0 0 10pt;
    }
    h1 {
      font-size: 18pt;
      font-weight: 700;
      margin: 18pt 0 8pt;
      color: #000;
    }
    h2 {
      font-size: 14pt;
      font-weight: 700;
      margin: 14pt 0 6pt;
      color: #111;
    }
    h3 {
      font-size: 12pt;
      font-weight: 600;
      margin: 12pt 0 4pt;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12pt 0;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 6pt 8pt;
      text-align: left;
      font-size: 10pt;
    }
    th {
      background-color: #f3f4f6;
      font-weight: 600;
    }
    img {
      max-width: 100%;
      height: auto;
      margin: 8pt 0;
    }
    ul, ol {
      margin: 0 0 10pt;
      padding-left: 24pt;
    }
    li {
      margin-bottom: 4pt;
    }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;

  // 2. Render ke PDF via Edge headless
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlDocument, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '25mm',
        bottom: '20mm',
        left: '20mm',
        right: '20mm'
      }
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Menjalankan perintah python secara asinkron
 * @param {string[]} args 
 * @returns {Promise<string>}
 */
function runPython(args) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', args);
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', data => { stdout += data.toString(); });
    py.stderr.on('data', data => { stderr += data.toString(); });

    py.on('close', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Python process exited with code ${code}: ${stderr || stdout}`));
      }
    });

    py.on('error', err => {
      reject(err);
    });
  });
}

/**
 * Konversi berkas PDF menjadi berkas Word (.docx) yang bisa diedit kembali
 * @param {Buffer} pdfBuffer 
 * @returns {Promise<Buffer>}
 */
export async function convertPdfToWord(pdfBuffer) {
  const tmpId = `pdf2docx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const inputPdf = path.join(os.tmpdir(), `${tmpId}.pdf`);
  const outputDocx = path.join(os.tmpdir(), `${tmpId}.docx`);

  await fs.promises.writeFile(inputPdf, pdfBuffer);

  const script = `
import sys
import warnings
warnings.filterwarnings('ignore')
from pdf2docx import Converter

cv = Converter(sys.argv[1])
cv.convert(sys.argv[2], start=0, end=None)
cv.close()
`;

  try {
    await runPython(['-c', script, inputPdf, outputDocx]);
    const docxBytes = await fs.promises.readFile(outputDocx);
    return docxBytes;
  } finally {
    // Bersihkan file sementara
    fs.promises.unlink(inputPdf).catch(() => {});
    fs.promises.unlink(outputDocx).catch(() => {});
  }
}

/**
 * Konversi halaman PDF menjadi daftar gambar PNG
 * @param {Buffer} pdfBuffer 
 * @param {number} dpi 
 * @returns {Promise<Array<{page: number, dataUrl: string, width: number, height: number}>>}
 */
export async function convertPdfToImages(pdfBuffer, dpi = 150) {
  const tmpId = `pdf2img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const inputPdf = path.join(os.tmpdir(), `${tmpId}.pdf`);
  const outPrefix = path.join(os.tmpdir(), `${tmpId}_p`);

  await fs.promises.writeFile(inputPdf, pdfBuffer);

  const script = `
import sys, json, base64, os
import pymupdf

doc = pymupdf.open(sys.argv[1])
dpi = int(sys.argv[2])
results = []

for idx, page in enumerate(doc):
    pix = page.get_pixmap(dpi=dpi)
    img_bytes = pix.tobytes("png")
    b64 = base64.b64encode(img_bytes).decode("ascii")
    results.append({
        "page": idx + 1,
        "dataUrl": f"data:image/png;base64,{b64}",
        "width": pix.width,
        "height": pix.height
    })

print(json.dumps(results))
`;

  try {
    const output = await runPython(['-c', script, inputPdf, dpi.toString()]);
    // Temukan baris JSON output
    const jsonStr = output.substring(output.indexOf('['), output.lastIndexOf(']') + 1);
    return JSON.parse(jsonStr);
  } finally {
    fs.promises.unlink(inputPdf).catch(() => {});
  }
}

/**
 * Kompresi berkas PDF (Deflate streams, garbage collect, remove redundant structures)
 * @param {Buffer} pdfBuffer 
 * @returns {Promise<Buffer>}
 */
export async function compressPdf(pdfBuffer) {
  const tmpId = `compress_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const inputPdf = path.join(os.tmpdir(), `${tmpId}_in.pdf`);
  const outputPdf = path.join(os.tmpdir(), `${tmpId}_out.pdf`);

  await fs.promises.writeFile(inputPdf, pdfBuffer);

  const script = `
import sys
import pymupdf

doc = pymupdf.open(sys.argv[1])
# Simpan dengan kompresi maksimal dan garbage collection
doc.save(sys.argv[2], garbage=4, deflate=True, clean=True)
doc.close()
`;

  try {
    await runPython(['-c', script, inputPdf, outputPdf]);
    const compressedBytes = await fs.promises.readFile(outputPdf);
    return compressedBytes;
  } finally {
    fs.promises.unlink(inputPdf).catch(() => {});
    fs.promises.unlink(outputPdf).catch(() => {});
  }
}
