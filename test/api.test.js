const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ApiError,
  createResource,
  createResourceVersion,
  getVersionTags,
  updateResource,
  uploadFileDirect,
  uploadFileInChunks
} = require('../dist/api.js');

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

async function withMockFetch(handler, callback) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

test('resource methods use the current create, update, and version endpoints', async () => {
  const calls = [];
  await withMockFetch(async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    if (String(url).endsWith('/versions')) return jsonResponse({ id: 'version-id', version: '1.0.0' });
    return jsonResponse({ id: 'resource-id', status: 'draft' });
  }, async () => {
    await createResource('token', { title: 'New resource' });
    await updateResource('token', 'resource-id', { tags: [] });
    await createResourceVersion('token', 'resource-id', { version: '1.0.0' });
  });

  assert.deepEqual(calls.map(({ url, method }) => ({ url, method })), [
    { url: 'https://www.nexusmc.cn/api/resources', method: 'POST' },
    { url: 'https://www.nexusmc.cn/api/resources/resource-id', method: 'PATCH' },
    { url: 'https://www.nexusmc.cn/api/resources/resource-id/versions', method: 'POST' }
  ]);
  assert.deepEqual(calls[1].body.tags, []);
});

test('getVersionTags reads the dynamic official tag endpoint', async () => {
  await withMockFetch(
    async () => jsonResponse([{ key: 'releases', label: 'Release', enabled: true, sortOrder: 1 }]),
    async () => {
      const tags = await getVersionTags({ retries: 0 });
      assert.equal(tags[0].key, 'releases');
    }
  );
});

test('API errors preserve status and parse non-JSON bodies', async () => {
  await withMockFetch(
    async () => new Response('upstream unavailable', { status: 503 }),
    async () => {
      await assert.rejects(
        () => updateResource('token', 'resource-id', {}),
        (error) => error instanceof ApiError && error.status === 503 && /upstream unavailable/.test(error.message)
      );
    }
  );
});

test('direct upload performs init, transfer, and confirmation', async () => {
  const tempFile = path.join(os.tmpdir(), `nexusmc-direct-${process.pid}.jar`);
  fs.writeFileSync(tempFile, 'direct-upload');
  const calls = [];

  try {
    await withMockFetch(async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      if (String(url).endsWith('/direct/init')) {
        return jsonResponse({
          uploadUrl: 'https://upload.example/direct',
          method: 'PUT',
          headers: { 'Content-Type': 'application/java-archive' },
          expiresIn: 900,
          key: 'uploads/files/random.jar',
          url: '/uploads/files/random.jar',
          bucketId: 'bucket',
          filename: path.basename(tempFile),
          size: 13
        });
      }
      if (String(url) === 'https://upload.example/direct') return new Response('', { status: 200 });
      return jsonResponse({ url: '/uploads/files/random.jar', filename: path.basename(tempFile), size: 13 });
    }, async () => {
      const result = await uploadFileDirect('token', tempFile, { timeoutMs: 1000, retries: 0 });
      assert.equal(result.url, '/uploads/files/random.jar');
    });

    assert.deepEqual(calls.map((call) => call.method), ['POST', 'PUT', 'POST']);
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('chunk upload sends bounded parts and polls an asynchronous merge', async () => {
  const tempFile = path.join(os.tmpdir(), `nexusmc-chunk-${process.pid}.jar`);
  fs.writeFileSync(tempFile, '123456');
  const calls = [];

  try {
    await withMockFetch(async (url, init) => {
      const value = String(url);
      calls.push({ url: value, method: init.method });
      if (value.endsWith('/session/init')) {
        return jsonResponse({ uploadId: 'upload-id', chunkSize: 3, totalChunks: 2 });
      }
      if (value.includes('/part/')) return jsonResponse({ ok: true });
      if (value.endsWith('/finish')) return jsonResponse({ processing: true, uploadId: 'upload-id' });
      if (value.endsWith('/status')) {
        return jsonResponse({
          status: 'completed',
          result: { url: '/uploads/files/chunk.jar', filename: 'chunk.jar', size: 6, sha256: 'hash' }
        });
      }
      throw new Error(`Unexpected URL: ${value}`);
    }, async () => {
      const result = await uploadFileInChunks('token', tempFile, {
        chunkSizeBytes: 3,
        timeoutMs: 1000,
        pollIntervalMs: 1,
        retries: 0
      });
      assert.equal(result.sha256, 'hash');
    });

    assert.equal(calls.filter((call) => call.url.includes('/part/')).length, 2);
    assert.ok(calls.some((call) => call.url.endsWith('/status')));
  } finally {
    fs.unlinkSync(tempFile);
  }
});
