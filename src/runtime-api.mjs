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
import { executeScriptContinuityAgent } from './autonomous-agent.mjs';
import { orchestrateContextPacket } from './runtime-orchestrator.mjs';
import { getRunObservability } from './runtime-observability.mjs';
import {
  upsertProvider,
  upsertModel,
  setProviderHealth,
  listProviderRegistry,
} from './provider-registry.mjs';
import {
  createPricingVersion,
  listPricingVersions,
  upsertProjectBudgetPolicy,
  getRunCostSummary,
  getProjectCostSummary,
  evaluateBudgetPolicy,
} from './cost-ledger.mjs';
import {
  createEphemeralContextPacket,
  getEphemeralContextPacketMetadata,
  consumeEphemeralContextPacket,
} from './context-bridge.mjs';

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

  if (req.method === 'POST' && url.pathname === '/api/runtime/providers') {
    const result = await upsertProvider(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/models') {
    const result = await upsertModel(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/provider-registry') {
    const result = await listProviderRegistry();
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/pricing-versions') {
    const result = await createPricingVersion(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/pricing-versions') {
    const result = await listPricingVersions({
      providerKey:url.searchParams.get('providerKey') || null,
      modelKey:url.searchParams.get('modelKey') || null,
      serviceTier:url.searchParams.get('serviceTier') || null,
    });
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/budget-policies') {
    const result = await upsertProjectBudgetPolicy(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const providerHealthMatch = match(url.pathname, /^\/api\/runtime\/providers\/([^/]+)\/health$/);
  if (req.method === 'PATCH' && providerHealthMatch) {
    const result = await setProviderHealth(providerHealthMatch[1], await readBody(req));
    json(res, 200, { data: result });
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

  if (req.method === 'POST' && url.pathname === '/api/runtime/context-packets') {
    const result = createEphemeralContextPacket(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const contextMetadataMatch = match(url.pathname, /^\/api\/runtime\/context-packets\/([^/]+)\/metadata$/);
  if (req.method === 'GET' && contextMetadataMatch) {
    const result = getEphemeralContextPacketMetadata(contextMetadataMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const contextExecuteMatch = match(url.pathname, /^\/api\/runtime\/context-packets\/([^/]+)\/execute$/);
  if (req.method === 'POST' && contextExecuteMatch) {
    const body = await readBody(req);
    const packet = consumeEphemeralContextPacket(contextExecuteMatch[1]);
    const result = await executeScriptContinuityAgent({
      ...body,
      query: body.query || packet.query,
      scope: body.scope || packet.scope,
      contextPacket: {
        precedence: packet.precedence,
        items: packet.items,
      },
    });
    json(res, 200, {
      data: {
        ...result,
        contextPacketId: packet.id,
        contextPacketConsumed: true,
        contextPacketHash: packet.contextHash,
      },
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/agent-executions') {
    const result = await executeScriptContinuityAgent(await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/orchestrate') {
    const result = await orchestrateContextPacket(await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const taskMatch = match(url.pathname, /^\/api\/runtime\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && taskMatch) {
    const result = await updateTask(taskMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const observabilityMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/observability$/);
  if (req.method === 'GET' && observabilityMatch) {
    const result = await getRunObservability(observabilityMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const runCostMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/cost-summary$/);
  if (req.method === 'GET' && runCostMatch) {
    const result = await getRunCostSummary(runCostMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const projectCostMatch = match(url.pathname, /^\/api\/runtime\/projects\/([^/]+)\/cost-summary$/);
  if (req.method === 'GET' && projectCostMatch) {
    const result = await getProjectCostSummary(projectCostMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const budgetEvaluateMatch = match(url.pathname, /^\/api\/runtime\/projects\/([^/]+)\/budget-evaluate$/);
  if (req.method === 'POST' && budgetEvaluateMatch) {
    const body = await readBody(req);
    const result = await evaluateBudgetPolicy({
      projectId:budgetEvaluateMatch[1],
      runId:body.runId || null,
    });
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
