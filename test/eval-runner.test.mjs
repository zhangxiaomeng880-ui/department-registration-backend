import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';
import { EVAL_ASSERTION_SCHEMA_SHA256 } from '../src/eval-runner.mjs';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4700';
const platformToken=process.env.RUNTIME_API_TOKEN||'m242-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/,'RUNTIME_COMMIT_SHA must be set for M24.2');
const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const providerKey=`eval-openai-${suffix}`;
const factText='LIBRARY_SENTINEL_SOURCE_TEXT SC049 hard lock: call mother first, then Lin.';
const movieText='SC049 current movie text: returns to 62㎡ and calls Lin directly.';
const refs=[
  {sourceFileId:'fact-file',sourceVersion:'53',lineStart:331,lineEnd:343,contentSha256:sha256(factText),contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'},
  {sourceFileId:'movie-file',sourceVersion:null,lineStart:7528,lineEnd:7556,contentSha256:sha256(movieText),contextRole:'CURRENT',sourceProvider:'SYNTHETIC_FIXTURE'}
];
const contexts=[
  {sourceFileId:'fact-file',sourceText:factText,sourceStatus:'CURRENT',sourcePath:'/synthetic/facts'},
  {sourceFileId:'movie-file',sourceText:movieText,sourceStatus:'CURRENT',sourcePath:'/synthetic/movie'}
];

let r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M24.2 Mock OpenAI',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey:'test-model',displayName:'M24.2 Test Model',qualityTier:'PREMIUM',
  latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey:'test-model',currency:'USD',inputRatePerMillion:1,outputRatePerMillion:1,
  effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M24_2_MOCK_PRICING'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  projectKey:`m242-eval-project-${suffix}`,name:'M24.2 Eval Execution Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

const createManifest=async({label,assertions})=>{
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
      projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
      query:'检查SC049连续性，只输出真实问题和证据。',scope:'SC049',
      policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
      allowedProviderKeys:[providerKey],preferredProviderKey:providerKey,
      preferredModelKey:'test-model',precedence:['STORY_FACTS','MOVIE_CURRENT']
    },
    sourceRefs:refs,assertions
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
  assert.equal(x.status,200,JSON.stringify(x.body));
  const fixtureSha256=x.body.data.fixtureSha256;
  x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,
    baselineRuntimeSha:'34578464f5d19e87978ccb81719fb23a4b79d6f1',
    workflowVersion:'eval-runner-v1',routerVersion:'policy-router-v2',
    ragIndexVersion:'synthetic-rag-v1',idempotencyKey:`m242-manifest-${label}-${suffix}`,
    metadata:{executionMode:'RUNTIME_REPLAY'}
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  assert.equal(x.body.data.fixtureSha256,fixtureSha256);
  return x.body.data;
};

const passAssertions={
  structuredOutput:{
    requiredKeys:['scope','findingCount','findings','noOtherHardConflicts'],
    jsonSchemaSha256:EVAL_ASSERTION_SCHEMA_SHA256
  },
  evidence:{required:true,minCount:2,allowedSourceFileIds:['fact-file','movie-file'],requireContentHash:true},
  router:{
    matched:true,policyResult:'ALLOW',routeRuleKey:'P86',
    selectedProviderKey:providerKey,selectedModelKey:'test-model',providerHealthStatus:'HEALTHY'
  },
  execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:0.01,costCurrency:'USD'}
};
const passManifest=await createManifest({label:'pass',assertions:passAssertions});
const runKey=`m242-run-pass-${suffix}`;

r=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{
  idempotencyKey:runKey,executionProjectId:projectId,runtimeCommitSha:runtimeSha,
  contextsByCaseKey:{'pass-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.executionMode,'RUNTIME_REPLAY');
assert.equal(r.body.data.candidateRuntimeSha,runtimeSha);
assert.equal(r.body.data.executionProjectId,projectId);
assert.equal(r.body.data.caseCount,1);
assert.equal(r.body.data.passedCaseCount,1);
assert.equal(r.body.data.failedCaseCount,0);
assert.ok(r.body.data.assertionCount>=12);
assert.equal(r.body.data.failedAssertionCount,0);
assert.equal(r.body.data.summary.providerExecution,true);
assert.equal(r.body.data.summary.sourceBodyPersisted,false);
assert.match(r.body.data.resultSha256,/^[a-f0-9]{64}$/);
const passRunId=r.body.data.id;
const runtimeRunId=r.body.data.cases[0].runtimeRunId;
assert.match(runtimeRunId,/^[a-f0-9-]{36}$/);
assert.equal(r.body.data.cases[0].observedOutput.findingCount,1);
assert.equal(r.body.data.cases[0].observedEvidence.length,2);
assert.ok(r.body.data.cases[0].observedEvidence.every(x=>/^[a-f0-9]{64}$/.test(x.contentSha256)));
assert.equal(r.body.data.cases[0].observedExecution.costStatus,'CALCULATED');
assert.equal(r.body.data.cases[0].observedExecution.costCurrency,'USD');
assert.ok(r.body.data.cases[0].assertions.every(x=>x.status==='PASS'));

r=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{
  idempotencyKey:runKey,executionProjectId:projectId,runtimeCommitSha:runtimeSha,
  contextsByCaseKey:{'pass-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,passRunId);
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/eval-runs/${passRunId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.cases[0].runtimeRunId,runtimeRunId);

const failAssertions={
  structuredOutput:{requiredKeys:['scope','findingCount','findings'],jsonSchemaSha256:EVAL_ASSERTION_SCHEMA_SHA256},
  evidence:{required:true,minCount:2,allowedSourceFileIds:['fact-file','movie-file'],requireContentHash:true},
  router:{matched:true,policyResult:'ALLOW',selectedProviderKey:providerKey,selectedModelKey:'wrong-model'},
  execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:0.01,costCurrency:'USD'}
};
const failManifest=await createManifest({label:'assertion-fail',assertions:failAssertions});
r=await request('POST',`/api/runtime/eval-replay-manifests/${failManifest.id}/run`,{
  idempotencyKey:`m242-run-fail-${suffix}`,executionProjectId:projectId,runtimeCommitSha:runtimeSha,
  contextsByCaseKey:{'assertion-fail-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FAIL');
assert.equal(r.body.data.failedCaseCount,1);
const failCodes=r.body.data.cases[0].assertions.map(x=>x.failureCode).filter(Boolean);
assert.ok(failCodes.includes('ROUTER_SELECTEDMODELKEY_MISMATCH'));

r=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{
  idempotencyKey:`m242-runtime-mismatch-${suffix}`,executionProjectId:projectId,
  runtimeCommitSha:'f'.repeat(40),contextsByCaseKey:{'pass-case':contexts}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RUNTIME_SHA_MISMATCH');

const badContexts=[...contexts.map(x=>({...x}))];
badContexts[0].sourceText='tampered source body';
r=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{
  idempotencyKey:`m242-context-mismatch-${suffix}`,executionProjectId:projectId,runtimeCommitSha:runtimeSha,
  contextsByCaseKey:{'pass-case':badContexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FAIL');
assert.equal(r.body.data.cases[0].errorCode,'EVAL_CONTEXT_HASH_MISMATCH');
assert.ok(r.body.data.cases[0].assertions.some(x=>x.group==='runner'&&x.status==='FAIL'));

let noAuth=await request('POST',`/api/runtime/eval-replay-manifests/${passManifest.id}/run`,{
  idempotencyKey:`unauth-${suffix}`,executionProjectId:projectId,runtimeCommitSha:runtimeSha
},null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));
noAuth=await request('GET',`/api/runtime/eval-runs/${passRunId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[toolCount]]=await db.execute('SELECT COUNT(*) AS count FROM tool_executions WHERE run_id=?',[runtimeRunId]);
assert.equal(Number(toolCount.count),1);
const [[usageCount]]=await db.execute('SELECT COUNT(*) AS count FROM usage_ledger WHERE run_id=?',[runtimeRunId]);
assert.equal(Number(usageCount.count),1);
const [[routeCount]]=await db.execute('SELECT COUNT(*) AS count FROM route_executions WHERE run_id=?',[runtimeRunId]);
assert.equal(Number(routeCount.count),1);
const [[evalRow]]=await db.execute(
  'SELECT execution_mode,status,failed_case_count,failed_assertion_count FROM eval_runs WHERE id=?',[passRunId]
);
assert.equal(evalRow.execution_mode,'RUNTIME_REPLAY');
assert.equal(evalRow.status,'PASS');
assert.equal(Number(evalRow.failed_case_count),0);
assert.equal(Number(evalRow.failed_assertion_count),0);
const [caseRows]=await db.execute(
  'SELECT route_json,observed_output_json,observed_evidence_json,observed_execution_json FROM eval_case_results WHERE eval_run_id=?',[passRunId]
);
assert.equal(caseRows.length,1);
const persistedEval=JSON.stringify(caseRows);
assert.equal(persistedEval.includes('LIBRARY_SENTINEL_SOURCE_TEXT'),false);
assert.equal(persistedEval.includes('returns to 62㎡'),false);
await db.end();

console.log('G24_2_EVAL_RUNNER_ASSERTION_ENGINE_PASS');
