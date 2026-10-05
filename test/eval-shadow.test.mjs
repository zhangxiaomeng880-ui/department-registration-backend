import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m244-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/,'RUNTIME_COMMIT_SHA must be set for M24.4');
const baselineSha='34578464f5d19e87978ccb81719fb23a4b79d6f1';
const internalProjectId='00000000-0000-4000-8000-000000002403';
const internalTenantId='00000000-0000-4000-8000-000000002401';
const internalWorkspaceId='00000000-0000-4000-8000-000000002402';
const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const providerKey=`m244-openai-${suffix}`;
const factText='LIBRARY_SENTINEL_SOURCE_TEXT M244_PRIVATE_SOURCE_SENTINEL SC049 hard lock: call mother first, then Lin.';
const movieText='M244_MOVIE_SENTINEL SC049 current movie text: returns to 62㎡ and calls Lin directly.';
const refs=[
  {sourceFileId:'fact-file',sourceVersion:'53',lineStart:331,lineEnd:343,contentSha256:sha256(factText),contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'},
  {sourceFileId:'movie-file',sourceVersion:null,lineStart:7528,lineEnd:7556,contentSha256:sha256(movieText),contextRole:'CURRENT',sourceProvider:'SYNTHETIC_FIXTURE'}
];
const contexts=[
  {sourceFileId:'fact-file',sourceText:factText,sourceStatus:'CURRENT',sourcePath:'/private/fact'},
  {sourceFileId:'movie-file',sourceText:movieText,sourceStatus:'CURRENT',sourcePath:'/private/movie'}
];

let r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M24.4 Mock OpenAI',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/models',{
  providerKey,modelKey:'test-model',displayName:'M24.4 Test Model',
  qualityTier:'PREMIUM',latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey:'test-model',currency:'USD',inputRatePerMillion:10,outputRatePerMillion:10,
  effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M24_4_MOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  projectKey:`m244-source-${suffix}`,name:'M24.4 Business Source',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const sourceProjectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId:sourceProjectId,runType:'WORKFLOW',triggerSource:'USER',status:'RUNNING',
  runtimeCommitSha:baselineSha,workflowVersion:'prod-workflow-v1',routerVersion:'policy-router-v2',
  input:{query:'M244_SOURCE_RUN_PRIVATE_INPUT_SENTINEL'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const sourceRunId=r.body.data.id;

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
await db.execute(
  "UPDATE runs SET status='PASS',finished_at='2026-09-20 12:00:00.000000' WHERE id=?",
  [sourceRunId]
);

r=await request('POST','/api/runtime/eval-suites',{
  suiteKey:`m244-shadow-${suffix}`,name:'M24.4 Shadow Suite'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;
r=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;
r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'shadow-case',sequenceNo:1,
  replayInput:{
    projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
    query:'检查连续性，只输出证据支持的问题。',scope:'SC049',
    policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
    allowedProviderKeys:[providerKey],preferredProviderKey:providerKey,
    preferredModelKey:'test-model',precedence:['STORY_FACTS','MOVIE_CURRENT']
  },
  sourceRefs:refs,
  assertions:{
    structuredOutput:{requiredKeys:['scope','findingCount','findings','noOtherHardConflicts']},
    evidence:{required:true,minCount:2,allowedSourceFileIds:['fact-file','movie-file'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',selectedProviderKey:providerKey,selectedModelKey:'test-model'},
    execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:1,costCurrency:'USD'}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,baselineRuntimeSha:baselineSha,
  workflowVersion:'eval-shadow-v1',routerVersion:'policy-router-v2',ragIndexVersion:'shadow-rag-v1',
  idempotencyKey:`m244-manifest-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const manifestId=r.body.data.id;

r=await request('GET','/api/runtime/eval-shadow-projects');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.projectId===internalProjectId&&x.safetyPolicyVersion==='shadow-safe-v1'));

r=await request('POST','/api/runtime/eval-shadow-projects',{projectId:sourceProjectId});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'SHADOW_PROJECT_SCOPE_NOT_INTERNAL');

r=await request('POST','/api/runtime/eval-shadow-replays',{
  sourceRunId,replayManifestId:manifestId,idempotencyKey:`m244-shadow-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const shadowId=r.body.data.id;
assert.equal(r.body.data.executionProjectId,internalProjectId);
assert.equal(r.body.data.baselineRuntimeSha,baselineSha);
assert.equal(r.body.data.candidateRuntimeSha,runtimeSha);
assert.equal(r.body.data.safetyPolicyVersion,'shadow-safe-v1');
assert.equal(r.body.data.safetySummary.customerBillingEligible,false);
assert.equal(r.body.data.safetySummary.sourceBodyRead,false);
assert.equal(r.body.data.safetySummary.sourceBodyPersisted,false);

r=await request('POST',`/api/runtime/eval-shadow-replays/${shadowId}/run`,{
  runtimeCommitSha:'f'.repeat(40),contextsByCaseKey:{'shadow-case':contexts}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'SHADOW_RUNTIME_SHA_OVERRIDE_NOT_ALLOWED');

r=await request('POST',`/api/runtime/eval-shadow-replays/${shadowId}/run`,{
  contextsByCaseKey:{'shadow-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.shadowReplay.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evalRun.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evalRun.executionProjectId,internalProjectId);
assert.equal(r.body.data.shadowReplay.safetySummary.runtimeScopeVerified,true);
assert.equal(r.body.data.shadowReplay.safetySummary.usageBillingClassVerified,true);
assert.equal(r.body.data.shadowReplay.safetySummary.usage.customerUsageCount,0);
assert.equal(r.body.data.shadowReplay.safetySummary.usage.billingClass,'INTERNAL_EVAL');
assert.match(r.body.data.shadowReplay.shadowSha256,/^[a-f0-9]{64}$/);
const evalRunId=r.body.data.evalRun.id;

r=await request('GET',`/api/runtime/eval-shadow-replays/${shadowId}/source-integrity`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.matches,true);

const [scopeRows]=await db.execute(
  `SELECT DISTINCT rr.tenant_id,rr.workspace_id,rr.project_id,u.billing_class
   FROM eval_case_results e
   JOIN runs rr ON rr.id=e.runtime_run_id
   JOIN usage_ledger u ON u.run_id=rr.id
   WHERE e.eval_run_id=?`,
  [evalRunId]
);
assert.ok(scopeRows.length>=1);
assert.ok(scopeRows.every(x=>x.tenant_id===internalTenantId&&x.workspace_id===internalWorkspaceId&&
  x.project_id===internalProjectId&&x.billing_class==='INTERNAL_EVAL'));

const [shadowRows]=await db.execute('SELECT * FROM eval_shadow_replays WHERE id=?',[shadowId]);
const persistedShadow=JSON.stringify(shadowRows);
assert.equal(persistedShadow.includes('LIBRARY_SENTINEL_SOURCE_TEXT'),false);
assert.equal(persistedShadow.includes('SC049 current movie text'),false);
assert.equal(persistedShadow.includes('M244_SOURCE_RUN_PRIVATE_INPUT_SENTINEL'),false);

const [caseRows]=await db.execute(
  'SELECT observed_output_json,observed_evidence_json,observed_execution_json FROM eval_case_results WHERE eval_run_id=?',
  [evalRunId]
);
const persistedEval=JSON.stringify(caseRows);
assert.equal(persistedEval.includes('LIBRARY_SENTINEL_SOURCE_TEXT'),false);
assert.equal(persistedEval.includes('SC049 current movie text'),false);

r=await request('POST','/api/runtime/eval-shadow-replays',{
  sourceRunId,replayManifestId:manifestId,idempotencyKey:`m244-drift-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const driftShadowId=r.body.data.id;

// Production request bodies are outside the shadow control-plane fingerprint.
await db.execute("UPDATE runs SET input_json=JSON_OBJECT('query','M244_MUTATED_SOURCE') WHERE id=?",[sourceRunId]);
r=await request('GET',`/api/runtime/eval-shadow-replays/${driftShadowId}/source-integrity`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.matches,true);
assert.equal(r.body.data.sourceBodyRead,false);

// Safe execution metadata is fingerprinted; drift blocks execution.
await db.execute("UPDATE runs SET workflow_version='tampered-after-prepare' WHERE id=?",[sourceRunId]);
r=await request('POST',`/api/runtime/eval-shadow-replays/${driftShadowId}/run`,{
  contextsByCaseKey:{'shadow-case':contexts}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'SHADOW_SOURCE_DRIFT');

r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,baselineRuntimeSha:'f'.repeat(40),
  workflowVersion:'eval-shadow-v1',routerVersion:'policy-router-v2',
  idempotencyKey:`m244-bad-baseline-manifest-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const badManifestId=r.body.data.id;
r=await request('POST','/api/runtime/eval-shadow-replays',{
  sourceRunId,replayManifestId:badManifestId,idempotencyKey:`m244-bad-baseline-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'SHADOW_BASELINE_SHA_MISMATCH');

let noAuth=await request('GET',`/api/runtime/eval-shadow-replays/${shadowId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));
noAuth=await request('POST','/api/runtime/eval-shadow-replays',{
  sourceRunId,replayManifestId:manifestId,idempotencyKey:'unauth'
},null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const planKey=`M244_BILL_${suffix}`;
r=await request('POST','/api/runtime/plans',{planKey,name:'M24.4 Billing Isolation Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-entitlements',{planKey,entitlementKey:'MODEL_EXECUTION',enabled:true});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:10,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:1000,paymentDueDays:7,
  effectiveFrom:'2026-08-01T00:00:00.000Z',sourceLabel:'M24_4_BILLING_ISOLATION'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termId=r.body.data.id;
r=await request('POST','/api/runtime/tenants',{tenantKey:`m244-bill-${suffix}`,name:'M24.4 Billing Tenant',planKey});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingTenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId:billingTenantId,workspaceKey:'main',name:'Main'});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingWorkspaceId=r.body.data.id;
r=await request('POST','/api/runtime/projects',{
  workspaceId:billingWorkspaceId,projectKey:`m244-bill-project-${suffix}`,
  name:'M24.4 Billing Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingProjectId=r.body.data.id;
r=await request('POST','/api/runtime/subscriptions',{
  tenantId:billingTenantId,planKey,billingTermId:termId,startedAt:'2026-09-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingCycleId=r.body.data.currentCycle.id;

r=await request('POST',`/api/runtime/eval-replay-manifests/${manifestId}/run`,{
  idempotencyKey:`m244-customer-eval-${suffix}`,executionProjectId:billingProjectId,
  runtimeCommitSha:runtimeSha,contextsByCaseKey:{'shadow-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
const customerEvalRunId=r.body.data.id;
await db.execute(
  `UPDATE usage_ledger u JOIN eval_case_results e ON e.runtime_run_id=u.run_id
   SET u.recorded_at='2026-09-15 00:00:00.000000' WHERE e.eval_run_id=?`,
  [customerEvalRunId]
);
const [[evalUsage]]=await db.execute(
  `SELECT COUNT(*) AS count,MIN(billing_class) AS billing_class
   FROM usage_ledger u JOIN eval_case_results e ON e.runtime_run_id=u.run_id
   WHERE e.eval_run_id=?`,[customerEvalRunId]
);
assert.ok(Number(evalUsage.count)>=1);
assert.equal(evalUsage.billing_class,'INTERNAL_EVAL');

r=await request('POST',`/api/runtime/billing-cycles/${billingCycleId}/finalize`,{
  finalizedAt:'2026-10-02T00:00:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.providerCostTotal,0);
assert.equal(r.body.data.usageRevenue,0);
assert.equal(r.body.data.totalDue,10);
const [[settledInternal]]=await db.execute(
  `SELECT COUNT(*) AS count
   FROM billing_usage_settlements s
   JOIN usage_ledger u ON u.id=s.usage_ledger_id
   WHERE s.billing_cycle_id=? AND u.billing_class='INTERNAL_EVAL'`,
  [billingCycleId]
);
assert.equal(Number(settledInternal.count),0);

await db.end();
console.log('G24_4_PRODUCTION_SAFE_SHADOW_EVAL_PASS');
