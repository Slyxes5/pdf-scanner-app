import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function startServer(directory) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory, TRUSTED_HOSTS: '127.0.0.1', ENABLE_SERVER_TOOLS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out')); }, 5000);
    child.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
  });
  return {
    base,
    stop: async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } },
  };
}

test('private scanner persists scans across restarts, rejects unsafe requests, and clears saved pages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pdf-scanner-test-'));
  let server;
  try {
    server = await startServer(directory);
    const post = (endpoint, body, extraHeaders = {}) => fetch(`${server.base}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
    });
    assert.equal((await fetch(`${server.base}/`)).status, 200);
    assert.equal((await fetch(`${server.base}/api/session`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const invalidHostStatus = await new Promise((resolve, reject) => {
      http.get(`${server.base}/healthz`, { headers: { Host: 'untrusted.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await post('/api/session/add-page', { id: 'bad"id', dataUrl: image })).status, 400);
    assert.equal((await post('/api/session/add-page', { id: 'bad-image', dataUrl: 'data:text/html;base64,AAAA' })).status, 400);
    assert.equal((await post('/api/tools/word-to-pdf', {})).status, 503);
    const saved = await post('/api/session/add-page', { id: 'scan-1', dataUrl: image, filter: 'grayscale' });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).count, 1);
    assert.equal((await post('/api/session/update-title', { title: 'Dokumen uji' })).status, 200);
    assert.equal((await post('/api/session/add-page', { id: 'scan-1', dataUrl: image })).status, 409);
    const response = await fetch(`${server.base}/api/session`);
    const etag = response.headers.get('etag');
    assert.equal((await response.json()).pages[0].filter, 'grayscale');
    assert.equal((await fetch(`${server.base}/api/session`, { headers: { 'If-None-Match': etag } })).status, 304);
    const oversized = await post('/api/session/add-page', { id: 'large', dataUrl: 'x'.repeat(5 * 1024 * 1024) });
    assert.equal(oversized.status, 413);
    assert.equal((await fetch(`${server.base}/healthz`)).status, 200);
    await server.stop();
    server = await startServer(directory);
    const restored = await (await fetch(`${server.base}/api/session`)).json();
    assert.equal(restored.title, 'Dokumen uji');
    assert.equal(restored.pages[0].dataUrl, image);
    assert.equal((await post('/api/session/clear', {})).status, 200);
    await server.stop();
    server = await startServer(directory);
    assert.equal((await (await fetch(`${server.base}/api/session`)).json()).pages.length, 0);
  } finally {
    if (server) await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
