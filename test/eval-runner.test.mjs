import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4700';
const platformToken=process.env.RUNTIME_API_TOKEN||'m242-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'');
assert.match(runtimeSha,/^[a-f0-9]{40}$/i,'RUNTIME_COMMIT_SHA must be set for M24.2');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const suffix=randomUUID().slice(0,8);
const providerKey=`eval-provider-${suffix}`;
const modelKey=`eval-model-${suffix}`;
const sourceHash='c'.repeat(64);
const schemaHash='d'.repeat(64);

let r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'SYNTHETIC',displayName:'M24.2 Eval Provider',
  adapterKey:'synthetic-eval',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M24.2 Eval Model',qualityTier:'PREMIUM',
  latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

const createFrozenManifest=async({label,observation,assertions,candidateSha=runtimeSha})=>{
  let x=await request('POST','/api/runtime/eval-suites',{
    suiteKey:`m242-${label}-${suffix}`,name:`M24.2 ${label} Suite`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const suiteId=x.body.data.id;

  x=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
  assert.equal(x.status,201,JSON.stringify(x.body));
  const versionId=x.body.data.id;

  x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
    caseKey:`${label}-case`,sequenceNo:1,
    replayInput:{
      projectType:'AIGC_CONTENT',
      taskType:'SCRIPT_CONTINUITY',
      query:'Synthetic SC049 continuity replay for M24.2.',
      policyMode:'QUALITY_FIRST',
      requiredStructuredOutput:true,
      allowedProviderKeys:[providerKey],
      syntheticObservation:observation
    },
    sourceRefs:[{
      sourceFileId:'synthetic-source-001',sourceVersion:'v1',lineStart:10,lineEnd:20,
      contentSha256:sourceHash,contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'
    }],
    assertions
  });
  assert.equal(x.status,201,JSON.stringify(x.body));

  x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
  assert.equal(x.status,200,JSON.stringify(x.body));
  const fixtureSha256=x.body.data.fixtureSha256;

  x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha:candidateSha,
    baselineRuntimeSha:'34578464f5d19e87978ccb81719fb23a4b79d6f1',
    workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
    ragIndexVersion:'synthetic-rag-v1',
    idempotencyKey:`m242-manifest-${label}-${suffix}`,
    metadata:{executionMode:'SYNTHETIC_REPLAY'}
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  assert.equal(x.body.data.fixtureSha256,fixtureSha256);
  return x.body.data;
};

const passOutput={
  findingCount:1,
  findings:[{code:'SC049_SYNTHETIC',severity:'P1_CONTINUITY'}],
  noOtherHardConflicts:true
};
const passObservation={
  output:passOutput,
  outputSchemaSha256:schemaHash,
  evidence:[{sourceFileId:'synthetic-source-001',contentSha256:sourceHash,lineStart:10,lineEnd:20}],
  execution:{status:'PASS',durationMs:120,estimatedCost:0.02,costCurrency:'USD'}
};
const passAssertions={
  structuredOutput:{
    requiredKeys:['findingCount','findings','noOtherHardConflicts'],
    exact:passOutput,jsonSchemaSha256:schemaHash
  },
  evidence:{
    required:true,minCount:1,allowedSourceFileIds:['synthetic-source-001'],requireContentHash:true
  },
  router:{
    matched:true,policyResult:'ALLOW',routeRuleKey:'P86',
    selectedProviderKey:providerKey,selectedModelKey:modelKey,providerHealthStatus:'HEALTHY'
  },
  execution:{status:'PASS',maxDurationMs:1000,maxEstimatedCost:0.1,costCurrency:'USD'}
};

const passManifest=await createFrozenManifest({
  label:'pass',observation:passObservation,assertions:passAssertions
});

const runKey=`m242-run-pass-${suffix}`;
r=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{idempotencyKey:runKey});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.executionMode,'SYNTHETIC_REPLAY');
assert.equal(r.body.data.candidateRuntimeSha,runtimeSha.toLowerCase());
assert.equal(r.body.data.caseCount,1);
assert.equal(r.body.data.passedCaseCount,1);
assert.equal(r.body.data.failedCaseCount,0);
assert.ok(r.body.data.assertionCount>=10);
assert.equal(r.body.data.failedAssertionCount,0);
assert.match(r.body.data.resultSha256,/^[a-f0-9]{64}$/);
assert.equal(r.body.data.summary.providerInvoked,false);
const passRunId=r.body.data.id;
const passResultHash=r.body.data.resultSha256;

r=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{idempotencyKey:runKey});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,passRunId);
assert.equal(r.body.data.resultSha256,passResultHash);
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/eval-runs/${passRunId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.cases.length,1);
assert.equal(r.body.data.cases[0].status,'PASS');
assert.equal(r.body.data.cases[0].route.selectedProviderKey,providerKey);
assert.equal(r.body.data.cases[0].route.selectedModelKey,modelKey);
assert.equal(r.body.data.cases[0].observedExecution.providerInvoked,false);
assert.ok(r.body.data.cases[0].assertions.every(x=>x.status==='PASS'));

const failObservation={
  output:{findingCount:0},
  outputSchemaSha256:schemaHash,
  evidence:[],
  execution:{status:'PASS',durationMs:2500,estimatedCost:0.5,costCurrency:'EUR'}
};
const failAssertions={
  structuredOutput:{requiredKeys:['findingCount','findings'],jsonSchemaSha256:schemaHash},
  evidence:{required:true,minCount:1,allowedSourceFileIds:['synthetic-source-001'],requireContentHash:true},
  router:{
    matched:true,policyResult:'ALLOW',routeRuleKey:'P86',
    selectedProviderKey:providerKey,selectedModelKey:'expected-wrong-model',providerHealthStatus:'HEALTHY'
  },
  execution:{status:'PASS',maxDurationMs:1000,maxEstimatedCost:0.1,costCurrency:'USD'}
};
const failManifest=await createFrozenManifest({
  label:'fail',observation:failObservation,assertions:failAssertions
});

r=await request('POST',`/api/runtime/eval-replay-manifests/${failManifest.id}/run`,{
  idempotencyKey:`m242-run-fail-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FAIL');
assert.equal(r.body.data.caseCount,1);
assert.equal(r.body.data.failedCaseCount,1);
assert.ok(r.body.data.failedAssertionCount>=5);
const failureCodes=r.body.data.cases[0].assertions.map(x=>x.failureCode).filter(Boolean);
assert.ok(failureCodes.includes('STRUCTURED_OUTPUT_REQUIRED_KEY_MISSING'));
assert.ok(failureCodes.includes('EVIDENCE_REQUIRED_MISSING'));
assert.ok(failureCodes.includes('ROUTER_SELECTEDMODELKEY_MISMATCH'));
assert.ok(failureCodes.includes('EXECUTION_DURATION_EXCEEDED'));
assert.ok(failureCodes.includes('EXECUTION_COST_EXCEEDED'));
assert.ok(failureCodes.includes('EXECUTION_CURRENCY_MISMATCH'));

const mismatchManifest=await createFrozenManifest({
  label:'sha-mismatch',observation:passObservation,assertions:passAssertions,
  candidateSha:'f'.repeat(40)
});
r=await request('POST',`/api/runtime/eval-replay-manifests/${mismatchManifest.id}/run`,{
  idempotencyKey:`m242-sha-mismatch-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RUNTIME_SHA_MISMATCH');

r=await request('POST',`/api/runtime/eval-replay-manifests/${failManifest.id}/run`,{
  idempotencyKey:runKey
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RUN_IDEMPOTENCY_CONFLICT');

let noAuth=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{
  idempotencyKey:`unauth-${suffix}`
},null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));
noAuth=await request('GET',`/api/runtime/eval-runs/${passRunId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[passRun]]=await db.execute(
  'SELECT status,case_count,failed_case_count,failed_assertion_count,result_sha256 FROM eval_runs WHERE id=?',[passRunId]
);
assert.equal(passRun.status,'PASS');
assert.equal(Number(passRun.case_count),1);
assert.equal(Number(passRun.failed_case_count),0);
assert.equal(Number(passRun.failed_assertion_count),0);
assert.equal(passRun.result_sha256,passResultHash);
const [[providerInvocations]]=await db.execute(
  `SELECT COUNT(*) AS count FROM tool_executions
   WHERE JSON_EXTRACT(input_json,'$.evalRunId') IS NOT NULL`
);
assert.equal(Number(providerInvocations.count),0);
await db.end();

console.log('G24_2_EVAL_RUNNER_ASSERTION_ENGINE_PASS');
