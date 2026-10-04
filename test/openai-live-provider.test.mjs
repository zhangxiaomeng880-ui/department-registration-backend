import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required for live provider validation');
}
if (!process.env.OPENAI_MODEL) {
  throw new Error('OPENAI_MODEL is required for live provider validation');
}

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

const suffix = randomUUID().slice(0,8);

let r = await request('POST','/api/runtime/projects',{
  projectKey:`openai-live-${suffix}`,
  name:'OpenAI Live Provider Validation',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'openai-live-v1'
});
assert.equal(r.status,201);
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'LIVE_PROVIDER_TEST',
  input:{task:'live OpenAI Responses validation'},
  workflowVersion:'openai-live-v1',
  routerVersion:'router-p86-v1',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runId=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId,
  stageKey:'SCRIPT',
  taskKey:'live-provider-continuity',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1,
  input:{scope:'SC049 synthetic contract validation'}
});
assert.equal(r.status,201);
const taskId=r.body.data.id;

r=await request('POST','/api/runtime/routes',{
  runId,
  taskId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  query:'Check the supplied SC049 context for one continuity mismatch.',
  executionMode:'AUTONOMOUS_MODEL_PROVIDER_LIVE'
});
assert.equal(r.status,201);
assert.equal(r.body.data.routeRuleKey,'P86');
const routeExecutionId=r.body.data.id;

r=await request('POST','/api/runtime/agent-executions',{
  runId,
  taskId,
  routeExecutionId,
  routeRuleKey:'P86',
  query:'Check the supplied SC049 context for one continuity mismatch. Return only evidence-supported issues.',
  scope:'SC049',
  contextPacket:{
    precedence:['STORY_FACTS','MOVIE_CURRENT'],
    items:[
      {
        sourceFileId:'synthetic-fact-source',
        sourceVersion:'live-test-v1',
        sourcePath:'synthetic://story-facts',
        lineStart:1,
        lineEnd:1,
        sourceText:'CURRENT fact: after returning home, Chen Mo calls his mother first to resolve the matchmaking expectation, then calls Lin Xia.'
      },
      {
        sourceFileId:'synthetic-movie-source',
        sourceVersion:'live-test-v1',
        sourcePath:'synthetic://movie-current',
        lineStart:1,
        lineEnd:1,
        sourceText:'CURRENT movie scene: after returning home, Chen Mo directly calls Lin Xia; the mother call is absent.'
      }
    ]
  }
});

assert.equal(r.status,200);
assert.equal(r.body.data.executionMode,'AUTONOMOUS_MODEL_PROVIDER');
assert.equal(r.body.data.provider,'openai-responses');
assert.ok(r.body.data.providerResponseId);
assert.ok(r.body.data.model);
assert.equal(r.body.data.sourceBodyPersisted,false);
assert.ok(Number.isInteger(r.body.data.output.findingCount));
assert.ok(Array.isArray(r.body.data.output.findings));

console.log('OPENAI_LIVE_PROVIDER_PASS');
console.log(JSON.stringify({
  providerResponseId:r.body.data.providerResponseId,
  model:r.body.data.model,
  findingCount:r.body.data.output.findingCount,
  usage:r.body.data.usage || null
}));
