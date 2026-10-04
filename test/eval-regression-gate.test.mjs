import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';
import { EVAL_ASSERTION_SCHEMA_SHA256 } from '../src/eval-runner.mjs';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m243-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/,'RUNTIME_COMMIT_SHA must be set');

const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
const req=async(method,path,body,auth=token)=>{
  const headers={'content-type':'application/json'};
  if(auth) headers.authorization=`Bearer ${auth}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const providerKey=`m243-provider-${suffix}`;
const factText='LIBRARY_SENTINEL_SOURCE_TEXT SC049 hard lock: call mother first, then Lin.';
const currentText='SC049 current movie text: returns to 62㎡ and calls Lin directly.';
const refs=[
  {sourceFileId:'fact-file',sourceVersion:'53',lineStart:331,lineEnd:343,contentSha256:sha256(factText),contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'},
  {sourceFileId:'movie-file',sourceVersion:null,lineStart:7528,lineEnd:7556,contentSha256:sha256(currentText),contextRole:'CURRENT',sourceProvider:'SYNTHETIC_FIXTURE'}
];
const contexts=[
  {sourceFileId:'fact-file',sourceText:factText,sourceStatus:'CURRENT',sourcePath:'/synthetic/facts'},
  {sourceFileId:'movie-file',sourceText:currentText,sourceStatus:'CURRENT',sourcePath:'/synthetic/movie'}
];

let r=await req('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M24.3 Mock Provider',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await req('POST','/api/runtime/models',{
  providerKey,modelKey:'test-model',displayName:'M24.3 Test Model',
  qualityTier:'PREMIUM',latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await req('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey:'test-model',currency:'USD',inputRatePerMillion:1,outputRatePerMillion:1,
  effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M24_3_MOCK_PRICING'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await req('POST','/api/runtime/projects',{
  projectKey:`m243-project-${suffix}`,name:'M24.3 Eval Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

r=await req('POST','/api/runtime/eval-suites',{
  suiteKey:`m243-suite-${suffix}`,name:'M24.3 Regression Suite'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;

r=await req('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;

r=await req('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'regression-case',sequenceNo:1,
  replayInput:{
    projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
    query:'检查SC049连续性，只输出真实问题和证据。',scope:'SC049',
    policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
    allowedProviderKeys:[providerKey],preferredProviderKey:providerKey,
    preferredModelKey:'test-model',precedence:['STORY_FACTS','MOVIE_CURRENT']
  },
  sourceRefs:refs,
  assertions:{
    structuredOutput:{
      requiredKeys:['scope','findingCount','findings','noOtherHardConflicts'],
      jsonSchemaSha256:EVAL_ASSERTION_SCHEMA_SHA256
    },
    evidence:{required:true,minCount:2,allowedSourceFileIds:['fact-file','movie-file'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',routeRuleKey:'P86',selectedProviderKey:providerKey,selectedModelKey:'test-model',providerHealthStatus:'HEALTHY'},
    execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:0.01,costCurrency:'USD'}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await req('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await req('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,
  baselineRuntimeSha:'34578464f5d19e87978ccb81719fb23a4b79d6f1',
  workflowVersion:'eval-runner-v1',routerVersion:'policy-router-v2',
  ragIndexVersion:'synthetic-rag-v1',idempotencyKey:`m243-manifest-${suffix}`,
  metadata:{executionMode:'RUNTIME_REPLAY'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const manifestId=r.body.data.id;

r=await req('POST',`/api/runtime/eval-replay-manifests/${manifestId}/run`,{
  idempotencyKey:`m243-baseline-${suffix}`,executionProjectId:projectId,runtimeCommitSha:runtimeSha,
  contextsByCaseKey:{'regression-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body.data));
const baseline=r.body.data;

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [runRows]=await db.execute('SELECT * FROM eval_runs WHERE id=?',[baseline.id]);
const [caseRows]=await db.execute('SELECT * FROM eval_case_results WHERE eval_run_id=?',[baseline.id]);
assert.equal(runRows.length,1);assert.equal(caseRows.length,1);
const baseRun=runRows[0],baseCase=caseRows[0];
const [baseAssertions]=await db.execute(
  'SELECT * FROM eval_assertion_results WHERE eval_case_result_id=? ORDER BY assertion_group,assertion_key',[baseCase.id]
);
assert.ok(baseAssertions.length>=10);

const cloneRun=async({label,sha,status,caseStatus,route,evidence,execution,failOneAssertion=false})=>{
  const runId=randomUUID(),caseId=randomUUID();
  const failedAssertions=failOneAssertion?1:0;
  await db.execute(
    `INSERT INTO eval_runs
     (id,replay_manifest_id,execution_project_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,
      case_count,passed_case_count,failed_case_count,assertion_count,passed_assertion_count,failed_assertion_count,
      result_sha256,summary_json,idempotency_key,started_at,finished_at)
     VALUES (?,?,?,?,?,'RUNTIME_REPLAY',?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))`,
    [runId,baseRun.replay_manifest_id,baseRun.execution_project_id,sha,baseRun.candidate_runtime_sha,status,
     1,status==='PASS'?1:0,status==='FAIL'?1:0,baseAssertions.length,baseAssertions.length-failedAssertions,
     failedAssertions,sha256(`run-${label}`),JSON.stringify({clonedFor:'M24.3',label}),`clone-${label}-${suffix}`]
  );
  await db.execute(
    `INSERT INTO eval_case_results
     (id,eval_run_id,eval_case_id,case_key,sequence_no,runtime_run_id,status,route_json,observed_output_json,
      observed_evidence_json,observed_execution_json,assertion_summary_json,error_code,result_sha256,
      started_at,finished_at)
     VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,NULL,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))`,
    [caseId,runId,baseCase.eval_case_id,baseCase.case_key,baseCase.sequence_no,caseStatus,
     JSON.stringify(route),JSON.stringify(baseCase.observed_output_json),JSON.stringify(evidence),
     JSON.stringify(execution),JSON.stringify({total:baseAssertions.length,passed:baseAssertions.length-failedAssertions,failed:failedAssertions}),
     sha256(`case-${label}`)]
  );
  for(let i=0;i<baseAssertions.length;i++){
    const src=baseAssertions[i];
    const fail=failOneAssertion&&i===0;
    await db.execute(
      `INSERT INTO eval_assertion_results
       (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),caseId,src.assertion_group,src.assertion_key,fail?'FAIL':src.status,
       src.expected_json==null?null:JSON.stringify(src.expected_json),
       src.actual_json==null?null:JSON.stringify(src.actual_json),
       fail?'SYNTHETIC_REGRESSION':src.failure_code]
    );
  }
  return runId;
};

const baselineRoute=baseCase.route_json;
const baselineEvidence=baseCase.observed_evidence_json;
const baselineExecution=baseCase.observed_execution_json;

const improvedId=await cloneRun({
  label:'improved',sha:'1'.repeat(40),status:'PASS',caseStatus:'PASS',
  route:baselineRoute,
  evidence:[...baselineEvidence,{sourceFileId:'bonus-source',contentSha256:'c'.repeat(64)}],
  execution:{...baselineExecution,durationMs:Math.max(0,Number(baselineExecution.durationMs||0)-50),
    estimatedCost:Math.max(0,Number(baselineExecution.estimatedCost||0)-0.000001)},
  failOneAssertion:false
});

r=await req('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baseline.id,candidateEvalRunId:improvedId,idempotencyKey:`m243-cmp-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body.data));
assert.equal(r.body.data.blockerCount,0);
assert.equal(r.body.data.caseRegressions,0);
const passComparisonId=r.body.data.id;

r=await req('POST','/api/runtime/eval-release-gates',{
  comparisonId:passComparisonId,gateKey:'V2.4_RC',idempotencyKey:`m243-gate-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');
const passGateId=r.body.data.id;

r=await req('POST',`/api/runtime/eval-release-gates/${passGateId}/enforce`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');

const badRoute={...baselineRoute,policyResult:'BLOCK',selectedProviderKey:'regressed-provider',
  selectedModelKey:'regressed-model',providerHealthStatus:'UNHEALTHY'};
const badExecution={...baselineExecution,durationMs:Number(baselineExecution.durationMs||0)+5000,
  estimatedCost:Number(baselineExecution.estimatedCost||0)+0.25,costCurrency:'USD'};
const badId=await cloneRun({
  label:'regressed',sha:'2'.repeat(40),status:'FAIL',caseStatus:'FAIL',
  route:badRoute,evidence:[],execution:badExecution,failOneAssertion:true
});

r=await req('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baseline.id,candidateEvalRunId:badId,idempotencyKey:`m243-cmp-block-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCK',JSON.stringify(r.body.data));
assert.equal(r.body.data.caseRegressions,1);
assert.ok(r.body.data.assertionRegressions>=1);
assert.ok(r.body.data.evidenceRegressions>=1);
assert.ok(r.body.data.routerRegressions>=1);
assert.equal(r.body.data.latencyRegressions,1);
assert.equal(r.body.data.costRegressions,1);
const codes=r.body.data.summary.blockers.map(x=>x.code);
for(const code of ['CANDIDATE_RUN_NOT_PASS','CASE_PASS_REGRESSION','ASSERTION_PASS_REGRESSION',
  'ROUTER_ALLOW_TO_BLOCK','ROUTER_PROVIDER_DRIFT','ROUTER_MODEL_DRIFT',
  'EVIDENCE_COUNT_REGRESSION','EVIDENCE_SOURCE_LOST','LATENCY_REGRESSION','COST_REGRESSION']){
  assert.ok(codes.includes(code),`missing ${code}: ${JSON.stringify(codes)}`);
}
const blockComparisonId=r.body.data.id;

r=await req('POST','/api/runtime/eval-release-gates',{
  comparisonId:blockComparisonId,gateKey:'V2.4_RC',idempotencyKey:`m243-gate-block-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'BLOCK');
const blockGateId=r.body.data.id;

r=await req('POST',`/api/runtime/eval-release-gates/${blockGateId}/enforce`,{});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RELEASE_GATE_BLOCKED');

r=await req('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baseline.id,candidateEvalRunId:badId,idempotencyKey:`m243-cmp-block-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,blockComparisonId);
assert.equal(r.body.data.idempotent,true);

const noAuth=await req('GET',`/api/runtime/eval-regression-comparisons/${passComparisonId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const [[cmpCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_regression_comparisons');
const [[gateCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_release_gates');
assert.equal(Number(cmpCount.count),2);
assert.equal(Number(gateCount.count),2);
await db.end();

console.log('G24_3_REGRESSION_COMPARATOR_RELEASE_GATE_PASS');
