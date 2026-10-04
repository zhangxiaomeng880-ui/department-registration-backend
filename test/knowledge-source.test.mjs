import assert from 'node:assert/strict';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const suffix = Date.now().toString(36);
const sourceKey = `chatgpt-library-ci-${suffix}`;

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
};

let r = await request('POST', '/api/runtime/knowledge/sources', {
  sourceKey,
  provider: 'chatgpt_library',
  sourceType: 'LIBRARY',
  transportMode: 'CHATGPT_TOOL',
  rootScope: '/project',
});
assert.equal(r.status, 201);
assert.equal(r.body.data.provider, 'chatgpt_library');
assert.equal(r.body.data.transportMode, 'CHATGPT_TOOL');

const v1 = [
  {
    file_id: 'file-current',
    library_file_id: 'lib-current',
    version_id: '1',
    library_path: '/project/story/current.md',
    name: 'current.md',
    mime_type: 'text/markdown',
    file_provider: 'native',
    modified_at: '2026-10-04T00:00:00Z',
    source_status: 'CURRENT',
    default_retrieval: true,
  },
  {
    file_id: 'file-working',
    library_file_id: 'lib-working',
    version_id: '1',
    library_path: '/project/story/working.md',
    name: 'working.md',
    mime_type: 'text/markdown',
    file_provider: 'native',
    modified_at: '2026-10-04T00:00:00Z',
    source_status: 'WORKING',
    default_retrieval: false,
  },
];

r = await request('POST', '/api/runtime/knowledge/sync-metadata', {
  sourceKey,
  provider: 'chatgpt_library',
  documents: v1,
});
assert.equal(r.status, 200);
assert.equal(r.body.data.changedCount, 2);
assert.equal(r.body.data.unchangedCount, 0);

r = await request('GET', `/api/runtime/knowledge/documents?sourceKey=${encodeURIComponent(sourceKey)}&defaultRetrieval=true`);
assert.equal(r.status, 200);
assert.equal(r.body.data.length, 1);
assert.equal(r.body.data[0].name, 'current.md');
assert.equal(r.body.data[0].versionId, '1');
assert.equal(r.body.data[0].sourceStatus, 'CURRENT');
assert.equal(Object.hasOwn(r.body.data[0], 'content'), false);
assert.equal(Object.hasOwn(r.body.data[0], 'body'), false);

r = await request('POST', '/api/runtime/knowledge/sync-metadata', {
  sourceKey,
  provider: 'chatgpt_library',
  documents: v1,
});
assert.equal(r.status, 200);
assert.equal(r.body.data.changedCount, 0);
assert.equal(r.body.data.unchangedCount, 2);

const v2 = structuredClone(v1);
v2[0].version_id = '2';
v2[0].modified_at = '2026-10-04T01:00:00Z';

r = await request('POST', '/api/runtime/knowledge/sync-metadata', {
  sourceKey,
  provider: 'chatgpt_library',
  documents: v2,
});
assert.equal(r.status, 200);
assert.equal(r.body.data.changedCount, 1);
assert.equal(r.body.data.unchangedCount, 1);

r = await request('GET', `/api/runtime/knowledge/documents?sourceKey=${encodeURIComponent(sourceKey)}&sourceStatus=CURRENT`);
assert.equal(r.status, 200);
assert.equal(r.body.data.length, 1);
assert.equal(r.body.data[0].versionId, '2');
assert.equal(r.body.data[0].needsReindex, true);

console.log('KNOWLEDGE_SOURCE_ADAPTER_PASS');
