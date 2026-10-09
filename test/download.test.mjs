import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download } from '../src/download.mjs';

test('downloads resume at the correct byte and handle servers ignoring Range', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-tars-download-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.partial');
  fs.writeFileSync(file, 'ab');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=2-');
    return new Response('cd', { status: 206, headers: { 'Content-Range': 'bytes 2-3/4' } });
  });
  await download('https://example.com/file', file, 4, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'abcd');
  fs.writeFileSync(file, 'ab');
  t.mock.method(globalThis, 'fetch', async () => new Response('wxyz', { status: 200 }));
  await download('https://example.com/file', file, 4, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'wxyz');
});
test('download rejects HTTP, bad ranges, oversize bodies and insecure redirects', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-tars-download-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.partial');
  await assert.rejects(download('http://example.com/file', file, 4, 1));
  t.mock.method(globalThis, 'fetch', async () => new Response('abcdef', { status: 200 }));
  await assert.rejects(download('https://example.com/file', file, 4, 1), /exceeds/);
  t.mock.method(globalThis, 'fetch', async () => new Response('abcd', { status: 206, headers: { 'Content-Range': 'bytes 1-4/5' } }));
  await assert.rejects(download('https://example.com/file', file, 4, 1), /Content-Range/);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'http://example.com/file' } }));
  await assert.rejects(download('https://example.com/file', file, 4, 1), /non-HTTPS/);
});
