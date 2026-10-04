import {
  runtimeDbConfigured,
  createProject,
  createRun,
  createTask,
  updateTask,
  saveCheckpoint,
  getLatestCheckpoint,
  resumeRun,
  addKnowledgeContexts,
  listKnowledgeContexts,
  getKnowledgeContextFingerprint,
} from './runtime-db.mjs';
import {
  routeAndRecord,
  recordToolExecution,
  recordGateResult,
  recordQaEvidence,
} from './runtime-evidence.mjs';

const match = (pathname, expression) => pathname.match(expression);

export const handleRuntimeRoute = async (req, res, url, helpers) => {
  const { json, readBody } = helpers;
  if (!url.pathname.startsWith('/api/runtime/')) return false;

  if (!runtimeDbConfigured()) {
    json(res, 503, { error: 'RUNTIME_DB_NOT_CONFIGURED' });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/projects') {
    const result = await createProject(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/runs') {
    const result = await createRun(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tasks') {
    const result = await createTask(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/routes') {
    const result = await routeAndRecord(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tool-executions') {
    const result = await recordToolExecution(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/gate-results') {
    const result = await recordGateResult(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/qa-evidence') {
    const result = await recordQaEvidence(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const taskMatch = match(url.pathname, /^\/api\/runtime\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && taskMatch) {
    const result = await updateTask(taskMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const knowledgeMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/knowledge-contexts$/);
  if (req.method === 'POST' && knowledgeMatch) {
    const result = await addKnowledgeContexts(knowledgeMatch[1], await readBody(req));
    json(res, 201, { data: result });
    return true;
  }
  if (req.method === 'GET' && knowledgeMatch) {
    const items = await listKnowledgeContexts(knowledgeMatch[1]);
    const fingerprint = await getKnowledgeContextFingerprint(knowledgeMatch[1]);
    json(res, 200, { data: { runId: knowledgeMatch[1], fingerprint, items } });
    return true;
  }

  const checkpointMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/checkpoints$/);
  if (req.method === 'POST' && checkpointMatch) {
    const result = await saveCheckpoint(checkpointMatch[1], await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const latestMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/checkpoints\/latest$/);
  if (req.method === 'GET' && latestMatch) {
    const result = await getLatestCheckpoint(latestMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const resumeMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/resume$/);
  if (req.method === 'POST' && resumeMatch) {
    const result = await resumeRun(resumeMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  json(res, 404, { error: 'RUNTIME_ROUTE_NOT_FOUND' });
  return true;
};
