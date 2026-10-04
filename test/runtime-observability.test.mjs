import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const sentinel = 'PRIVATE_SOURCE_BODY_SENTINEL_DO_NOT_EXPOSE';

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers:{'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  return {status:response.status, body:await response.json()};
};

let r = await request('POST','/api/runtime/projects',{
  projectKey:`observability-ci-${randomUUID()}`,
  name:'Runtime Observability CI',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'v2.1-observability'
});
assert.equal(r.status,201);
const projectId = r.body.data.id;

r = await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'CI',
  input:{note:sentinel},
  workflowVersion:'v2.1-observability',
  routerVersion:'router-p86-v1',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runId = r.body.data.id;
const correlationId = r.body.data.correlationId;
assert.match(correlationId,/^[0-9a-f-]{36}$/i);

r = await request('POST','/api/runtime/tasks',{
  runId,
  correlationId,
  stageKey:'SCRIPT',
  taskKey:'observability-ci-task',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1,
  input:{sourceText:sentinel}
});
assert.equal(r.status,201);
const taskId = r.body.data.id;

r = await request('POST','/api/runtime/routes',{
  runId,
  taskId,
  correlationId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  query:'synthetic observability route',
  executionMode:'OBSERVABILITY_CI'
});
assert.equal(r.status,201);
const routeExecutionId = r.body.data.id;

r = await request('POST','/api/runtime/tool-executions',{
  runId,
  taskId,
  routeExecutionId,
  correlationId,
  toolType:'MODEL_PROVIDER',
  toolKey:'openai.responses',
  providerKey:'openai-responses',
  modelKey:'test-model',
  status:'PASS',
  input:{sourceText:sentinel},
  output:{result:'synthetic-pass'},
  tokenInput:11,
  tokenOutput:7,
  durationMs:123
});
assert.equal(r.status,201);

r = await request('POST','/api/runtime/tool-executions',{
  runId,
  taskId,
  routeExecutionId,
  correlationId,
  toolType:'MODEL_PROVIDER',
  toolKey:'openai.responses',
  providerKey:'openai-responses',
  modelKey:'test-model',
  status:'FAIL',
  input:{sourceText:sentinel},
  tokenInput:0,
  tokenOutput:0,
  durationMs:5000,
  errorCode:'MODEL_PROVIDER_ERROR',
  errorCategory:'TIMEOUT',
  errorMessage:'synthetic timeout'
});
assert.equal(r.status,201);

r = await request('PATCH',`/api/runtime/tasks/${taskId}`,{
  status:'PASS',
  output:{note:sentinel},
  finished:true
});
assert.equal(r.status,200);

r = await request('POST','/api/runtime/gate-results',{
  runId,
  taskId,
  correlationId,
  stageKey:'SCRIPT',
  gateKey:'G21-OBSERVABILITY-CI',
  status:'PASS',
  criteria:{traceable:true},
  evidence:{note:sentinel},
  decidedBy:'CI'
});
assert.equal(r.status,201);
const gateResultId = r.body.data.id;

r = await request('POST','/api/runtime/qa-evidence',{
  runId,
  taskId,
  correlationId,
  gateResultId,
  qaCaseKey:'QA-G21-OBSERVABILITY-CI',
  status:'PASS',
  evidenceType:'SYNTHETIC',
  evidence:{note:sentinel},
  issueSummary:sentinel,
  verifiedBy:'CI'
});
assert.equal(r.status,201);

r = await request('POST',`/api/runtime/runs/${runId}/checkpoints`,{
  taskId,
  correlationId,
  stageKey:'SCRIPT',
  stepKey:'observability-ci-complete',
  state:{note:sentinel,status:'PASS'},
  completedTaskKeys:['observability-ci-task'],
  pendingTaskKeys:[],
  blockedTaskKeys:[],
  workflowVersion:'v2.1-observability',
  routerVersion:'router-p86-v1',
  createdBy:'CI'
});
assert.equal(r.status,201);

r = await request('GET',`/api/runtime/runs/${runId}/observability`);
assert.equal(r.status,200);
const data = r.body.data;

assert.equal(data.run.id,runId);
assert.equal(data.run.correlationId,correlationId);
assert.equal(data.summary.taskCount,1);
assert.equal(data.summary.routeCount,1);
assert.equal(data.summary.toolExecutionCount,2);
assert.equal(data.summary.usageLedgerCount,2);
assert.equal(data.summary.gateCount,1);
assert.equal(data.summary.qaEvidenceCount,1);
assert.equal(data.summary.checkpointCount,1);
assert.equal(data.summary.tokenInput,11);
assert.equal(data.summary.tokenOutput,7);
assert.equal(data.summary.toolDurationMs,5123);
assert.equal(data.summary.correlationConsistent,true);
assert.equal(data.summary.sourceBodyExposed,false);

assert.equal(data.providers.length,1);
assert.equal(data.providers[0].providerKey,'openai-responses');
assert.equal(data.providers[0].modelKey,'test-model');

const failure = data.tools.find(item => item.status === 'FAIL');
assert.ok(failure);
assert.equal(failure.errorCategory,'TIMEOUT');
assert.equal(failure.errorCode,'MODEL_PROVIDER_ERROR');

for (const collection of [
  data.tasks,
  data.routes,
  data.tools,
  data.usage,
  data.gates,
  data.qaEvidence,
  data.checkpoints
]) {
  for (const item of collection) {
    assert.equal(item.correlationId,correlationId);
  }
}

const serialized = JSON.stringify(data);
assert.equal(serialized.includes(sentinel),false);
for (const forbidden of ['sourceText','input_json','output_json','evidence_json','state_json']) {
  assert.equal(serialized.includes(forbidden),false,`must not expose ${forbidden}`);
}

assert.ok(data.timeline.length >= 7);
console.log('G21_OBSERVABILITY_PASS');
