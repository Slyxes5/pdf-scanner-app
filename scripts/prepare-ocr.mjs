import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const target = fileURLToPath(new URL('../public/assets/ocr/', import.meta.url));
await mkdir(target, { recursive: true });
const engine = path.dirname(require.resolve('tesseract.js/package.json'));
for (const file of ['tesseract.min.js', 'worker.min.js', 'tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) {
  await copyFile(path.join(engine, 'dist', file), path.join(target, file));
}
await copyFile(path.join(engine, 'LICENSE.md'), path.join(target, 'TESSERACT-LICENSE'));
const core = path.dirname(require.resolve('tesseract.js-core/package.json'));
for (const file of await readdir(core)) {
  if (file.endsWith('.wasm.js')) await copyFile(path.join(core, file), path.join(target, file));
}
await copyFile(path.join(core, 'LICENSE'), path.join(target, 'CORE-LICENSE'));
for (const language of ['ind', 'eng']) {
  const { langPath } = require(`@tesseract.js-data/${language}`);
  await copyFile(path.join(langPath, `${language}.traineddata.gz`), path.join(target, `${language}.traineddata.gz`));
}
console.log('Local OCR assets ready (Indonesian + English).');
