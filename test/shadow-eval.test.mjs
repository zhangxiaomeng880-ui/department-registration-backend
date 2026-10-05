import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';
import { EVAL_ASSERTION_SCHEMA_SHA256 } from '../src/eval-runner.mjs';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4900';
const platformToken=process.env.RUNTIME_API_TOKEN||'m244-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/,'RUNTIME_COMMIT_SHA must be set for M24.4');
const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const planKey=`SHADOW_${suffix}`;
const providerKey=`shadow-openai-${suffix}`;
const modelKey='test-model';
const factText='SHADOW_SENTINEL_FACT SC049 hard lock: call mother first, then Lin.';
const movieText='SHADOW_SENTINEL_MOVIE SC049 current movie text: calls Lin directly.';
const refs=[
  {sourceFileId:'fact-file',sourceVersion:'53',lineStart:331,lineEnd:343,contentSha256:sha256(factText),contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'},
  {sourceFileId:'movie-file',sourceVersion:null,lineStart:7528,lineEnd:7556,contentSha256:sha256(movieText),contextRole:'CURRENT',sourceProvider:'SYNTHETIC_FIXTURE'}
];
const contexts=[
  {sourceFileId:'fact-file',sourceText:factText,sourceStatus:'CURRENT',sourcePath:'/synthetic/facts'},
  {sourceFileId:'movie-file',sourceText:movieText,sourceStatus:'CURRENT',sourcePath:'/synthetic/movie'}
];

let r=await request('POST','/api/runtime/plans',{planKey,name:'M24.4 Shadow Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-entitlements',{planKey,entitlementKey:'MODEL_EXECUTION',enabled:true});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:10,includedUsageCredit:0,
  overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,effectiveFrom:'2026-10-01T00:00:00.000Z',sourceLabel:'M24_4_SHADOW'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingTermId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{tenantKey:`shadow-tenant-${suffix}`,name:'Shadow Tenant',planKey});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:`shadow-ws-${suffix}`,name:'Shadow Workspace'});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;
r=await request('POST','/api/runtime/projects',{workspaceId,projectKey:`shadow-project-${suffix}`,name:'Shadow Project',projectType:'AIGC_CONTENT'});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
r=await request('POST','/api/runtime/subscriptions',{tenantId,planKey,billingTermId,startedAt:'2026-10-01T00:00:00.000Z'});
assert.equal(r.status,201,JSON.stringify(r.body));
const cycleId=r.body.data.currentCycle.id;

r=await request('POST','/api/runtime/providers',{providerKey,providerType:'OPENAI',displayName:'Shadow Mock OpenAI',adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/models',{providerKey,modelKey,displayName:'Shadow Test Model',qualityTier:'PREMIUM',latencyTier:'FAST',costTier:'LOW',priority:1,capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/pricing-versions',{providerKey,modelKey,currency:'USD',inputRatePerMillion:1,outputRatePerMillion:1,effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M24_4_MOCK_PRICE'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/eval-suites',{suiteKey:`shadow-suite-${suffix}`,name:'M24.4 Shadow Suite'});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;
r=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;
r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'shadow-case',sequenceNo:1,
  replayInput:{projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',query:'检查SC049连续性，只输出真实问题和证据。',scope:'SC049',policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,allowedProviderKeys:[providerKey],preferredProviderKey:providerKey,preferredModelKey:modelKey,precedence:['STORY_FACTS','MOVIE_CURRENT']},
  sourceRefs:refs,
  assertions:{
    structuredOutput:{requiredKeys:['scope','findingCount','findings','noOtherHardConflicts'],jsonSchemaSha256:EVAL_ASSERTION_SCHEMA_SHA256},
    evidence:{required:true,minCount:2,allowedSourceFileIds:['fact-file','movie-file'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',routeRuleKey:'P86',selectedProviderKey:providerKey,selectedModelKey:modelKey,providerHealthStatus:'HEALTHY'},
    execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:0.01,costCurrency:'USD'}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
r=await request('POST','/api/runtime/eval-replay-manifests',{suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,baselineRuntimeSha:'1a00c72fdf20a6db3cff823e5200edf9e5f4d5d2',workflowVersion:'eval-runner-v1',routerVersion:'policy-router-v2',ragIndexVersion:'shadow-rag-v1',idempotencyKey:`shadow-manifest-${suffix}`,metadata:{mode:'SHADOW_EVAL'}});
assert.equal(r.status,201,JSON.stringify(r.body));
const manifestId=r.body.data.id;

r=await request('POST','/api/runtime/shadow-eval-policies',{policyKey:`shadow-policy-${suffix}`,name:'M24.4 Safe Shadow Policy',maxCasesPerRun:1,maxEstimatedCost:0.02,costCurrency:'USD',maxDurationMs:60000,allowedTaskTypes:['SCRIPT_CONTINUITY'],allowedProviderKeys:[providerKey],allowedModelKeys:[modelKey],requireTransientContext:true});
assert.equal(r.status,201,JSON.stringify(r.body));
const policyId=r.body.data.id;

r=await request('GET',`/api/runtime/tenants/${tenantId}/usage-meter?periodType=MONTH&at=2026-10-05T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.usageCount,0);assert.equal(r.body.data.runCount,0);assert.equal(r.body.data.estimatedCost,0);

r=await request('POST','/api/runtime/shadow-evals',{policyId,replayManifestId:manifestId,executionProjectId:projectId,idempotencyKey:`shadow-run-${suffix}`,contextsByCaseKey:{'shadow-case':contexts}});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.evalRun.executionMode,'SHADOW_EVAL');
assert.equal(r.body.data.evalRun.status,'PASS');
assert.equal(r.body.data.summary.billable,false);
assert.equal(r.body.data.summary.billingIsolationPass,true);
assert.equal(r.body.data.summary.usageCount,r.body.data.summary.shadowUsageCount);
assert.ok(r.body.data.summary.usageCount>0);
const shadowExecutionId=r.body.data.id;
const evalRunId=r.body.data.evalRunId;
const runtimeRunId=r.body.data.evalRun.cases[0].runtimeRunId;

r=await request('GET',`/api/runtime/tenants/${tenantId}/usage-meter?periodType=MONTH&at=2026-10-05T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.usageCount,0);assert.equal(r.body.data.runCount,0);assert.equal(r.body.data.estimatedCost,0);

const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const [[usage]]=await db.execute('SELECT usage_class,estimated_cost,cost_currency FROM usage_ledger WHERE run_id=?',[runtimeRunId]);
assert.equal(usage.usage_class,'SHADOW');assert.equal(usage.cost_currency,'USD');assert.ok(Number(usage.estimated_cost)>0);
const [[runRow]]=await db.execute('SELECT run_type,trigger_source,input_json FROM runs WHERE id=?',[runtimeRunId]);
assert.equal(runRow.run_type,'SHADOW_EVAL');assert.equal(runRow.trigger_source,'SHADOW_EVAL');
const [[reservationCount]]=await db.execute('SELECT COUNT(*) AS count FROM usage_reservations WHERE run_id=?',[runtimeRunId]);
assert.equal(Number(reservationCount.count),0);

r=await request('POST','/api/runtime/quota-policies',{subjectType:'TENANT',subjectId:tenantId,policyKey:'shadow-token-guard',metricKey:'TOKEN_TOTAL',periodType:'MONTH',hardLimit:1,actionOnHard:'BLOCK'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/runs',{projectId,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'});
assert.equal(r.status,201,JSON.stringify(r.body));
const normalRunId=r.body.data.id;
r=await request('POST',`/api/runtime/runs/${normalRunId}/quota-evaluate`,{source:'M24_4_GATE',at:'2026-10-05T00:00:00.000Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'ALLOW');

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{finalizedAt:'2026-11-02T00:00:00.000Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.subtotal,10);
assert.equal(r.body.data.totalDue,10);
const [[cycle]]=await db.execute('SELECT provider_cost_total,usage_revenue,invoice_subtotal,total_due FROM billing_cycles WHERE id=?',[cycleId]);
assert.equal(Number(cycle.provider_cost_total),0);assert.equal(Number(cycle.usage_revenue),0);assert.equal(Number(cycle.invoice_subtotal),10);assert.equal(Number(cycle.total_due),10);
const [[settlements]]=await db.execute('SELECT COUNT(*) AS count FROM billing_usage_settlements WHERE billing_cycle_id=?',[cycleId]);
assert.equal(Number(settlements.count),0);

r=await request('POST',`/api/runtime/shadow-eval-policies/${policyId}/status`,{status:'PAUSED'});
assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.status,'PAUSED');
r=await request('POST','/api/runtime/shadow-evals',{policyId,replayManifestId:manifestId,executionProjectId:projectId,idempotencyKey:`shadow-paused-${suffix}`,contextsByCaseKey:{'shadow-case':contexts}});
assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.error,'SHADOW_POLICY_PAUSED');

r=await request('POST','/api/runtime/shadow-eval-policies',{policyKey:`shadow-too-cheap-${suffix}`,name:'Too Cheap Policy',maxCasesPerRun:1,maxEstimatedCost:0.001,costCurrency:'USD',maxDurationMs:60000,allowedTaskTypes:['SCRIPT_CONTINUITY'],allowedProviderKeys:[providerKey],allowedModelKeys:[modelKey]});
assert.equal(r.status,201,JSON.stringify(r.body));
const cheapPolicyId=r.body.data.id;
r=await request('POST','/api/runtime/shadow-evals',{policyId:cheapPolicyId,replayManifestId:manifestId,executionProjectId:projectId,idempotencyKey:`shadow-cheap-${suffix}`,contextsByCaseKey:{'shadow-case':contexts}});
assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.error,'SHADOW_DECLARED_COST_LIMIT_EXCEEDED');

r=await request('POST','/api/runtime/shadow-eval-policies',{policyKey:`shadow-unsafe-${suffix}`,name:'Unsafe Policy',maxCasesPerRun:1,maxEstimatedCost:1,costCurrency:'USD',maxDurationMs:60000,allowedTaskTypes:['FILE_WRITE'],allowedProviderKeys:[providerKey],allowedModelKeys:[modelKey]});
assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.error,'SHADOW_TASK_NOT_SERVER_APPROVED');

r=await request('GET',`/api/runtime/shadow-evals/${shadowExecutionId}`);
assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.evalRunId,evalRunId);
let noAuth=await request('GET','/api/runtime/shadow-eval-policies',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));
noAuth=await request('POST','/api/runtime/shadow-evals',{policyId,replayManifestId:manifestId,executionProjectId:projectId,idempotencyKey:'unauth'},null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const [persisted]=await db.execute('SELECT r.input_json,t.input_json AS task_input,te.input_json AS tool_input,ec.observed_output_json,ec.observed_evidence_json,se.summary_json FROM runs r JOIN tasks t ON t.run_id=r.id LEFT JOIN tool_executions te ON te.run_id=r.id LEFT JOIN eval_case_results ec ON ec.runtime_run_id=r.id LEFT JOIN shadow_eval_executions se ON se.eval_run_id=ec.eval_run_id WHERE r.id=?',[runtimeRunId]);
const persistedText=JSON.stringify(persisted);
assert.equal(persistedText.includes('SHADOW_SENTINEL_FACT'),false);assert.equal(persistedText.includes('SHADOW_SENTINEL_MOVIE'),false);
await db.end();

console.log('G24_4_PRODUCTION_SAFE_SHADOW_EVAL_PASS');
