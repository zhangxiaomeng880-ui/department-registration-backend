import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const request = async (method,path,body) => {
  const response = await fetch(baseUrl + path,{
    method,
    headers:{'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return {status:response.status,body:payload};
};

const provider = async input => {
  const r = await request('POST','/api/runtime/providers',input);
  assert.equal(r.status,201,JSON.stringify(r.body));
  return r.body.data;
};
const model = async input => {
  const r = await request('POST','/api/runtime/models',input);
  assert.equal(r.status,201,JSON.stringify(r.body));
  return r.body.data;
};

await provider({
  providerKey:'primary-openai',
  providerType:'OPENAI',
  displayName:'Primary OpenAI',
  adapterKey:'openai-responses',
  healthStatus:'HEALTHY',
  priority:10,
  supportsStructuredOutput:true
});
await model({
  providerKey:'primary-openai',
  modelKey:'test-model',
  displayName:'Primary Test Model',
  qualityTier:'PREMIUM',
  latencyTier:'SLOW',
  costTier:'HIGH',
  priority:10,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});

await provider({
  providerKey:'backup-openai',
  providerType:'OPENAI',
  displayName:'Backup OpenAI',
  adapterKey:'openai-responses',
  healthStatus:'HEALTHY',
  priority:20,
  supportsStructuredOutput:true
});
await model({
  providerKey:'backup-openai',
  modelKey:'test-model',
  displayName:'Backup Test Model',
  qualityTier:'HIGH',
  latencyTier:'BALANCED',
  costTier:'MEDIUM',
  priority:10,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});

await provider({
  providerKey:'fast-synthetic',
  providerType:'SYNTHETIC',
  displayName:'Fast Synthetic',
  adapterKey:'synthetic-fast',
  healthStatus:'HEALTHY',
  priority:30,
  supportsStructuredOutput:true
});
await model({
  providerKey:'fast-synthetic',
  modelKey:'test-model',
  displayName:'Fast Test Model',
  qualityTier:'HIGH',
  latencyTier:'FAST',
  costTier:'MEDIUM',
  priority:10,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});

await provider({
  providerKey:'cheap-synthetic',
  providerType:'SYNTHETIC',
  displayName:'Cheap Synthetic',
  adapterKey:'synthetic-cheap',
  healthStatus:'HEALTHY',
  priority:40,
  supportsStructuredOutput:true
});
await model({
  providerKey:'cheap-synthetic',
  modelKey:'test-model',
  displayName:'Cheap Test Model',
  qualityTier:'STANDARD',
  latencyTier:'BALANCED',
  costTier:'LOW',
  priority:10,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});

let r = await request('POST','/api/runtime/providers',{
  providerKey:'bad-provider',
  providerType:'BAD',
  displayName:'Bad',
  adapterKey:'bad',
  metadata:{apiKey:'must-not-persist'}
});
assert.equal(r.status,400);

r = await request('GET','/api/runtime/provider-registry');
assert.equal(r.status,200);
assert.equal(r.body.data.providers.length,4);
assert.equal(r.body.data.models.length,4);
assert.equal(JSON.stringify(r.body.data).includes('must-not-persist'),false);

const suffix=randomUUID().slice(0,8);
r=await request('POST','/api/runtime/projects',{
  projectKey:`policy-router-ci-${suffix}`,
  name:'Policy Router v2 CI',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201);
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'CI',
  workflowVersion:'policy-router-v2',
  routerVersion:'router-p86-v1',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runId=r.body.data.id;
const correlationId=r.body.data.correlationId;

r=await request('POST','/api/runtime/tasks',{
  runId,
  stageKey:'SCRIPT',
  taskKey:'policy-router-ci-task',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1
});
assert.equal(r.status,201);
const taskId=r.body.data.id;

const route = async (policyMode,extra={}) => {
  const result=await request('POST','/api/runtime/routes',{
    runId,
    taskId,
    projectType:'AIGC_CONTENT',
    taskType:'SCRIPT_CONTINUITY',
    query:'synthetic SC049 continuity route',
    policyMode,
    requiredStructuredOutput:true,
    ...extra
  });
  assert.equal(result.status,201,JSON.stringify(result.body));
  return result.body.data;
};

const q1=await route('QUALITY_FIRST');
const q2=await route('QUALITY_FIRST');
assert.equal(q1.selectedProviderKey,'primary-openai');
assert.equal(q1.selectedModelKey,'test-model');
assert.equal(q1.selectedProviderKey,q2.selectedProviderKey);
assert.equal(q1.selectedModelKey,q2.selectedModelKey);
assert.equal(q1.policyResult,'ALLOW');

const cheap=await route('COST_FIRST');
assert.equal(cheap.selectedProviderKey,'cheap-synthetic');

const fast=await route('LATENCY_FIRST');
assert.equal(fast.selectedProviderKey,'fast-synthetic');

r=await request('PATCH','/api/runtime/providers/primary-openai/health',{
  healthStatus:'DOWN',
  reasonCode:'SYNTHETIC_OUTAGE',
  evidence:{source:'policy-router-ci'},
  recordedBy:'CI'
});
assert.equal(r.status,200);
assert.equal(r.body.data.previousStatus,'HEALTHY');
assert.equal(r.body.data.healthStatus,'DOWN');

const afterOutage=await route('QUALITY_FIRST');
assert.equal(afterOutage.selectedProviderKey,'backup-openai');
assert.ok(afterOutage.fallbackChain.some(x=>x.providerKey==='fast-synthetic'));
assert.ok(afterOutage.fallbackChain.some(x=>x.providerKey==='cheap-synthetic'));

const fallbackOnly=await route('FALLBACK_ONLY',{
  preferredProviderKey:'primary-openai',
  fallbackProviderKeys:['cheap-synthetic','backup-openai']
});
assert.equal(fallbackOnly.selectedProviderKey,'cheap-synthetic');

r=await request('POST','/api/runtime/context-packets',{
  query:'检查SC049连续性，只输出真实问题和证据。',
  scope:'SC049',
  ttlSeconds:300,
  precedence:['STORY_FACTS','MOVIE_CURRENT'],
  items:[
    {
      sourceFileId:'fact-file',
      sourceVersion:'53',
      sourceStatus:'CURRENT',
      lineStart:331,
      lineEnd:343,
      sourceText:'LIBRARY_CONTEXT_SENTINEL SC049 hard lock: Chen Mo must call his mother first, then call Lin Xia.'
    },
    {
      sourceFileId:'movie-file',
      sourceVersion:null,
      sourceStatus:'CURRENT',
      lineStart:7528,
      lineEnd:7556,
      sourceText:'SC049 current movie: Chen Mo returns to 62㎡ and calls Lin Xia directly; the mother call is omitted.'
    }
  ]
});
assert.equal(r.status,201);
const contextPacketId=r.body.data.id;

r=await request('POST','/api/runtime/orchestrate',{
  projectId,
  contextPacketId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  stageKey:'SCRIPT',
  taskKey:'policy-router-fallback-success',
  policyMode:'FALLBACK_ONLY',
  preferredProviderKey:'primary-openai',
  fallbackProviderKeys:['backup-openai']
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.selectedProviderKey,'backup-openai');
assert.equal(r.body.data.selectedModelKey,'test-model');
assert.equal(r.body.data.provider,'backup-openai');
assert.ok(r.body.data.gateResultId);
assert.ok(r.body.data.qaEvidenceId);
assert.ok(r.body.data.checkpointId);
const fallbackRunId=r.body.data.runId;

r=await request('POST','/api/runtime/context-packets',{
  query:'检查SC049连续性。',
  scope:'SC049',
  ttlSeconds:300,
  items:[{
    sourceFileId:'fact-file',
    sourceVersion:'53',
    sourceStatus:'CURRENT',
    lineStart:331,
    lineEnd:343,
    sourceText:'LIBRARY_CONTEXT_SENTINEL SC049 hard lock: call mother first.'
  }]
});
assert.equal(r.status,201);
const unsupportedPacketId=r.body.data.id;

r=await request('POST','/api/runtime/orchestrate',{
  projectId,
  contextPacketId:unsupportedPacketId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  stageKey:'SCRIPT',
  taskKey:'policy-router-unsupported-adapter',
  policyMode:'LATENCY_FIRST',
  allowedProviderKeys:['fast-synthetic']
});
assert.equal(r.status,503);

r=await request('PATCH','/api/runtime/providers/backup-openai/health',{
  healthStatus:'DOWN',reasonCode:'SYNTHETIC_ALL_DOWN',recordedBy:'CI'
});
assert.equal(r.status,200);
r=await request('PATCH','/api/runtime/providers/fast-synthetic/health',{
  healthStatus:'DOWN',reasonCode:'SYNTHETIC_ALL_DOWN',recordedBy:'CI'
});
assert.equal(r.status,200);
r=await request('PATCH','/api/runtime/providers/cheap-synthetic/health',{
  healthStatus:'DOWN',reasonCode:'SYNTHETIC_ALL_DOWN',recordedBy:'CI'
});
assert.equal(r.status,200);

const blocked=await route('QUALITY_FIRST');
assert.equal(blocked.policyResult,'BLOCK');
assert.equal(blocked.providerPolicyCode,'NO_ALLOWED_PROVIDER_ROUTE');
assert.equal(blocked.selectedProviderKey,null);

const db=await mysql.createConnection({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME
});

const [[fallbackRoute]]=await db.execute(
  `SELECT selected_provider_key, selected_model_key, selected_adapter_key,
          provider_health_status, fallback_chain_json, policy_mode
   FROM route_executions
   WHERE run_id=? AND selected_provider_key='backup-openai'
   ORDER BY created_at DESC LIMIT 1`,
  [fallbackRunId]
);
assert.equal(fallbackRoute.selected_provider_key,'backup-openai');
assert.equal(fallbackRoute.selected_model_key,'test-model');
assert.equal(fallbackRoute.selected_adapter_key,'openai-responses');
assert.equal(fallbackRoute.policy_mode,'FALLBACK_ONLY');

const [[fallbackTool]]=await db.execute(
  `SELECT provider_key, model_key, status, error_code
   FROM tool_executions WHERE run_id=? LIMIT 1`,
  [fallbackRunId]
);
assert.equal(fallbackTool.provider_key,'backup-openai');
assert.equal(fallbackTool.model_key,'test-model');
assert.equal(fallbackTool.status,'PASS');
assert.equal(fallbackTool.error_code,null);

const [[checkpoint]]=await db.execute(
  'SELECT COUNT(*) AS count FROM checkpoints WHERE run_id=? AND status=\'VALID\'',
  [fallbackRunId]
);
assert.equal(Number(checkpoint.count),1);

const [[healthEvents]]=await db.execute(
  'SELECT COUNT(*) AS count FROM provider_health_events WHERE reason_code LIKE \'SYNTHETIC_%\''
);
assert.ok(Number(healthEvents.count)>=4);

const [[unsupportedTool]]=await db.execute(
  `SELECT provider_key, model_key, status, error_code, error_category
   FROM tool_executions
   WHERE provider_key='fast-synthetic'
     AND error_code='PROVIDER_ADAPTER_NOT_IMPLEMENTED'
   ORDER BY created_at DESC LIMIT 1`
);
assert.equal(unsupportedTool.provider_key,'fast-synthetic');
assert.equal(unsupportedTool.status,'FAIL');
assert.equal(unsupportedTool.error_category,'CONFIGURATION');

const [[blockedRoute]]=await db.execute(
  `SELECT policy_result, selected_provider_key, decision_json
   FROM route_executions
   WHERE run_id=? AND policy_mode='QUALITY_FIRST'
   ORDER BY created_at DESC LIMIT 1`,
  [runId]
);
assert.equal(blockedRoute.policy_result,'BLOCK');
assert.equal(blockedRoute.selected_provider_key,null);
assert.equal(blockedRoute.decision_json.providerPolicy.code,'NO_ALLOWED_PROVIDER_ROUTE');

const [[secretFields]]=await db.execute(
  `SELECT COUNT(*) AS count
   FROM information_schema.columns
   WHERE table_schema=DATABASE()
     AND table_name IN ('provider_registry','model_registry')
     AND column_name REGEXP 'api_key|secret|token|password|credential'`
);
assert.equal(Number(secretFields.count),0);

await db.end();
console.log('G21_MULTI_PROVIDER_PASS');
