import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
};

const projectKey = `runtime-api-ci-${randomUUID()}`;

let r = await request('POST', '/api/runtime/projects', {
  projectKey,
  name: 'AI Native Runtime API CI',
  projectType: 'AIGC_CONTENT',
  currentWorkflowVersion: 'workflow-api-v1',
  currentKnowledgeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});
assert.equal(r.status, 201);
const projectId = r.body.data.id;

r = await request('POST', '/api/runtime/runs', {
  projectId,
  runType: 'WORKFLOW',
  triggerSource: 'CI',
  input: { task: 'SC042-SC050 continuity read' },
  runtimeCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  knowledgeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  workflowVersion: 'workflow-api-v1',
  routerVersion: 'router-api-v1',
});
assert.equal(r.status, 201);
const runId = r.body.data.id;

r = await request('POST', '/api/runtime/tasks', {
  runId,
  stageKey: 'SCRIPT',
  taskKey: 'sc042-sc050-continuity-read',
  taskType: 'ANALYSIS',
  sequenceNo: 1,
  input: { scope: 'SC042-SC050' },
  dependencies: { knowledgeCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
});
assert.equal(r.status, 201);
const taskId = r.body.data.id;

r = await request('PATCH', `/api/runtime/tasks/${taskId}`, {
  status: 'PASS',
  output: { result: 'continuity read completed' },
  finished: true,
});
assert.equal(r.status, 200);

r = await request('POST', `/api/runtime/runs/${runId}/knowledge-contexts`, {
  items: [{
    taskId,
    sourceProvider: 'CHATGPT_LIBRARY',
    sourceFileId: 'library-source-ci-001',
    sourceLibraryFileId: 'library-artifact-ci-001',
    sourceVersion: '1',
    sourcePath: '/project/CURRENT_INDEX.md',
    sourceName: 'CURRENT_INDEX.md',
    sourceModifiedAt: '2026-10-04T00:00:00.000Z',
    sourceStatus: 'CURRENT',
    precedenceRank: 1,
    retrievalQuery: 'task-scoped current facts',
    retrievalMode: 'search+read',
    contextRole: 'PROJECT_MANIFEST',
    sourceLineStart: 1,
    sourceLineEnd: 20,
    contentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  }]
});
assert.equal(r.status, 201);
assert.equal(r.body.data.count, 1);
assert.equal(r.body.data.items[0].sourceProvider, 'CHATGPT_LIBRARY');
assert.match(r.body.data.items[0].contentSha256, /^[a-f0-9]{64}$/);

r = await request('GET', `/api/runtime/runs/${runId}/knowledge-contexts`);
assert.equal(r.status, 200);
assert.equal(r.body.data.items.length, 1);
assert.equal(r.body.data.items[0].sourceVersion, '1');
assert.equal(r.body.data.items[0].sourceLineStart, 1);
assert.equal(r.body.data.items[0].sourceLineEnd, 20);
assert.equal(Object.hasOwn(r.body.data.items[0], 'content'), false);
assert.match(r.body.data.fingerprint, /^[a-f0-9]{64}$/);
const knowledgeFingerprint = r.body.data.fingerprint;

r = await request('POST', `/api/runtime/runs/${runId}/checkpoints`, {
  taskId,
  stageKey: 'SCRIPT',
  stepKey: 'continuity-read',
  state: {
    lastCompletedTask: 'sc042-sc050-continuity-read',
    status: 'PASS',
  },
  completedTaskKeys: ['sc042-sc050-continuity-read'],
  pendingTaskKeys: ['next-runtime-task'],
  blockedTaskKeys: [],
  dependencyFingerprint: knowledgeFingerprint,
  runtimeCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  knowledgeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  workflowVersion: 'workflow-api-v1',
  routerVersion: 'router-api-v1',
  resumeFromTaskKey: 'next-runtime-task',
  createdBy: 'runtime-api-ci',
});
assert.equal(r.status, 201);
assert.equal(r.body.data.sequenceNo, 1);

r = await request('GET', `/api/runtime/runs/${runId}/checkpoints/latest`);
assert.equal(r.status, 200);
assert.equal(r.body.data.resumeFromTaskKey, 'next-runtime-task');
assert.equal(r.body.data.workflowVersion, 'workflow-api-v1');

r = await request('POST', `/api/runtime/runs/${runId}/resume`, {
  runtimeCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  knowledgeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  workflowVersion: 'workflow-api-v1',
  routerVersion: 'router-api-v1',
  dependencyFingerprint: knowledgeFingerprint,
});
assert.equal(r.status, 200);
assert.equal(r.body.data.resumeFromTaskKey, 'next-runtime-task');

r = await request('POST', `/api/runtime/runs/${runId}/resume`, {
  workflowVersion: 'workflow-api-v2',
});
assert.equal(r.status, 409);
assert.equal(r.body.error, 'RESUME_INVALIDATED');
assert.ok(r.body.details.changedFields.includes('workflowVersion'));

console.log('RUNTIME_API_MYSQL_INTEGRATION_PASS');
