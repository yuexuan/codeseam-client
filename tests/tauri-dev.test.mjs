import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { canReuseDevServer } from '../scripts/tauri-dev.mjs';

test('Tauri reuses only the CodeSeam server for this checkout and leaves it running', async () => {
  let identity = { app: 'codeseam', root: process.cwd() };
  const server = createServer((request, response) => {
    assert.equal(request.url, '/__codeseam_dev');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(identity));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await canReuseDevServer(url, process.cwd()), true);
    identity = { app: 'codeseam', root: dirname(process.cwd()) };
    assert.equal(await canReuseDevServer(url, process.cwd()), false);
    identity = { app: 'another-app', root: process.cwd() };
    assert.equal(await canReuseDevServer(url, process.cwd()), false);
    identity = { app: 'codeseam' };
    assert.equal(await canReuseDevServer(url, process.cwd()), false);
    assert.equal(server.listening, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(await canReuseDevServer(url, process.cwd()), false);
});
