import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Node uses its normal TLS certificate verification. Never disable it to retry.
export async function download(url, file, size, attempts = 4) {
  if (new URL(url).protocol !== 'https:' || !Number.isSafeInteger(size) || size <= 0) throw new Error('Expected HTTPS URL and positive file size.');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (offset > size) throw new Error('Partial file exceeds expected size; move it aside before retrying.');
    if (offset === size) return;
    try {
      let location = url, response;
      for (let redirects = 0; redirects <= 10; redirects++) {
        response = await fetch(location, { headers: offset ? { Range: `bytes=${offset}-` } : {}, redirect: 'manual', signal: AbortSignal.timeout(60 * 60 * 1000) });
        if (![301,302,303,307,308].includes(response.status)) break;
        const next = new URL(response.headers.get('location'), location);
        await response.body?.cancel();
        if (next.protocol !== 'https:') throw new Error('Refusing a non-HTTPS redirect.');
        location = next.href;
      }
      if (response.status === 206) {
        const range = response.headers.get('content-range');
        if (!range?.startsWith(`bytes ${offset}-`) || !range.endsWith(`/${size}`)) throw new Error('Unexpected Content-Range.');
      } else if (response.status === 200) offset = 0;
      else { await response.body?.cancel(); throw new Error(`Download HTTP ${response.status}`); }
      let received = offset;
      const limiter = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > size) callback(new Error('Download exceeds expected size.'));
        else callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(file, { flags: offset ? 'a' : 'w' }));
      if (received !== size) throw new Error(`Incomplete download: ${received}/${size} bytes`);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(`Download attempt ${attempt} failed (${error.message}); resuming in 2 seconds.`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try { await download(process.argv[2], process.argv[3], Number(process.argv[4])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
