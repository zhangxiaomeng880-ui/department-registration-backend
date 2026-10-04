import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m243-platform-token';
const request=async(method,path,body,auth=token)=>{
  const headers={'content-type':'application/json'};
  if(auth) headers.authorization=`Bearer ${auth}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stableValue(value)),'utf8'
).digest('hex');

const suffix=randomUUID().slice(0,8);
const baselineSha='a'.repeat(40);
const candidatePassSha='b'.repeat(40);
const candidateBlockSha='c'.repeat(40);
const wrongBaselineCandidateSha='d'.repeat(40);
const corruptCandidateSha='f'.repeat(40);

let r=await request('POST','/api/runtime/eval-suites',{
  suiteKey:`m243-clean-${suffix}`,name:'M24.3 Clean Regression Suite'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'shared-case',sequenceNo:1,
  replayInput:{
    projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
    query:'Synthetic M24.3 comparator fixture.',
    policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
    syntheticObservation:{
      output:{ok:true},evidence:[],
      execution:{status:'PASS',durationMs:1,estimatedCost:0,costCurrency:'USD'}
    }
  },
  sourceRefs:[],
  assertions:{router:{matched:true,policyResult:'ALLOW'}}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const evalCaseId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
const fixtureSha256=r.body.data.fixtureSha256;
assert.match(fixtureSha256,/^[a-f0-9]{64}$/);

const createManifest=async({candidateRuntimeSha,baselineRuntimeSha=null,label})=>{
  const x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha,baselineRuntimeSha,
    workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
    ragIndexVersion:'synthetic-rag-v1',
    idempotencyKey:`m243-manifest-${label}-${suffix}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  assert.equal(x.body.data.fixtureSha256,fixtureSha256);
  return x.body.data;
};

const baselineManifest=await createManifest({candidateRuntimeSha:baselineSha,label:'baseline'});
const passManifest=await createManifest({
  candidateRuntimeSha:candidatePassSha,baselineRuntimeSha:baselineSha,label:'pass'
});
const blockManifest=await createManifest({
  candidateRuntimeSha:candidateBlockSha,baselineRuntimeSha:baselineSha,label:'block'
});
const wrongBaselineManifest=await createManifest({
  candidateRuntimeSha:wrongBaselineCandidateSha,baselineRuntimeSha:'e'.repeat(40),label:'wrong-baseline'
});
const corruptManifest=await createManifest({
  candidateRuntimeSha:corruptCandidateSha,baselineRuntimeSha:baselineSha,label:'corrupt'
});

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});

const baselineRoute={
  matched:true,policyResult:'ALLOW',routeRuleKey:'P86',
  selectedProviderKey:'provider-a',selectedModelKey:'model-a',providerHealthStatus:'HEALTHY'
};
const baselineEvidence=[
  {sourceFileId:'source-1',contentSha256:'1'.repeat(64),lineStart:10,lineEnd:20},
  {sourceFileId:'source-2',contentSha256:'2'.repeat(64),lineStart:30,lineEnd:40}
];

const seedRun=async({
  manifest,sha,label,runStatus='PASS',caseStatus='PASS',route=baselineRoute,
  evidence=baselineEvidence,durationMs=1000,cost=0.1,currency='USD',
  selectedModelAssertionStatus='PASS',addExtraAssertion=false,corruptRunHash=false
})=>{
  const runId=randomUUID(),caseResultId=randomUUID();
  const assertions=[{
    group:'router',key:'selectedModelKey',status:selectedModelAssertionStatus,
    expected:'model-a',actual:route.selectedModelKey,
    failureCode:selectedModelAssertionStatus==='PASS'?null:'ROUTER_SELECTEDMODELKEY_MISMATCH'
  }];
  if(addExtraAssertion){
    assertions.push({
      group:'execution',key:'status',status:'PASS',
      expected:'PASS',actual:'PASS',failureCode:null
    });
  }
  const failedAssertions=assertions.filter(x=>x.status==='FAIL').length;
  const caseResultSha256=sha256({label,kind:'case-result'});
  const runResultSha256=sha256({
    replayManifestSha256:manifest.manifestSha256,
    candidateRuntimeSha:sha,
    status:runStatus,
    cases:[{caseKey:'shared-case',sequenceNo:1,resultSha256:caseResultSha256}]
  });
  await db.execute(
    `INSERT INTO eval_runs
     (id,replay_manifest_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,
      case_count,passed_case_count,failed_case_count,assertion_count,passed_assertion_count,failed_assertion_count,
      result_sha256,summary_json,idempotency_key,finished_at)
     VALUES (?,?,?,?, 'SYNTHETIC_REPLAY',?,1,?,?,?, ?,?,?,?, ?,CURRENT_TIMESTAMP(6))`,
    [
      runId,manifest.id,sha,manifest.baselineRuntimeSha||null,runStatus,
      caseStatus==='PASS'?1:0,caseStatus==='FAIL'?1:0,
      assertions.length,assertions.length-failedAssertions,failedAssertions,
      corruptRunHash?'0'.repeat(64):runResultSha256,
      JSON.stringify({seed:'M24.3',label}),
      `seed-run-${label}-${suffix}`
    ]
  );
  await db.execute(
    `INSERT INTO eval_case_results
     (id,eval_run_id,eval_case_id,case_key,sequence_no,status,route_json,observed_output_json,
      observed_evidence_json,observed_execution_json,assertion_summary_json,result_sha256,finished_at)
     VALUES (?,?,?,?,1,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
    [
      caseResultId,runId,evalCaseId,'shared-case',caseStatus,
      JSON.stringify(route),JSON.stringify({ok:true}),JSON.stringify(evidence),
      JSON.stringify({
        status:caseStatus,durationMs,estimatedCost:cost,costCurrency:currency,
        providerInvoked:false,executionMode:'SYNTHETIC_REPLAY'
      }),
      JSON.stringify({
        total:assertions.length,passed:assertions.length-failedAssertions,failed:failedAssertions,
        failureCodes:assertions.filter(x=>x.failureCode).map(x=>x.failureCode)
      }),
      caseResultSha256
    ]
  );
  for(const assertion of assertions){
    await db.execute(
      `INSERT INTO eval_assertion_results
       (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),caseResultId,assertion.group,assertion.key,assertion.status,
        JSON.stringify(assertion.expected),JSON.stringify(assertion.actual),assertion.failureCode
      ]
    );
  }
  return runId;
};

const baselineRun=await seedRun({manifest:baselineManifest,sha:baselineSha,label:'baseline'});
const passRun=await seedRun({
  manifest:passManifest,sha:candidatePassSha,label:'pass',
  durationMs:1120,cost:0.11
});
const blockRun=await seedRun({
  manifest:blockManifest,sha:candidateBlockSha,label:'block',
  runStatus:'FAIL',caseStatus:'FAIL',
  route:{...baselineRoute,selectedModelKey:'model-b'},
  evidence:[baselineEvidence[0]],
  durationMs:1400,cost:0.13,
  selectedModelAssertionStatus:'FAIL',addExtraAssertion:true
});
const wrongBaselineRun=await seedRun({
  manifest:wrongBaselineManifest,sha:wrongBaselineCandidateSha,label:'wrong-baseline'
});
const corruptRun=await seedRun({
  manifest:corruptManifest,sha:corruptCandidateSha,label:'corrupt',corruptRunHash:true
});

const passKey=`m243-cmp-pass-${suffix}`;
r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:passRun,idempotencyKey:passKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.blockerCount,0);
assert.equal(r.body.data.policy.version,'eval-regression-strict-v1');
assert.equal(r.body.data.releaseGate.decision,'PASS');
assert.equal(r.body.data.releaseGate.blockerCount,0);
assert.equal(r.body.data.cases[0].durationChangePct,12);
assert.equal(r.body.data.cases[0].costChangePct,10);
assert.match(r.body.data.comparisonSha256,/^[a-f0-9]{64}$/);
assert.match(r.body.data.releaseGate.gateSha256,/^[a-f0-9]{64}$/);
const passComparisonId=r.body.data.id;

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:passRun,idempotencyKey:passKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,passComparisonId);
assert.equal(r.body.data.idempotent,true);

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:passRun,idempotencyKey:`m243-cmp-pass-dedup-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,passComparisonId);
assert.equal(r.body.data.deduplicated,true);

r=await request('GET',`/api/runtime/eval-regression-comparisons/${passComparisonId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.releaseGate.decision,'PASS');

const blockKey=`m243-cmp-block-${suffix}`;
r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:blockRun,idempotencyKey:blockKey,
  policy:{allowRouterDrift:true,maxDurationIncreasePct:999,maxEstimatedCostIncreasePct:999}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCK');
assert.equal(r.body.data.releaseGate.decision,'BLOCK');
const blockerCodes=r.body.data.releaseGate.blockers.map(x=>x.code);
for(const code of [
  'CANDIDATE_EVAL_NOT_PASS','NEW_CASE_FAILURE','NEW_ASSERTION_FAILURE',
  'ASSERTION_SET_DRIFT','ROUTER_DRIFT','EVIDENCE_DRIFT',
  'DURATION_REGRESSION','COST_REGRESSION'
]){
  assert.ok(blockerCodes.includes(code),`missing blocker ${code}: ${JSON.stringify(blockerCodes)}`);
}
assert.equal(r.body.data.summary.caseRegressions,1);
assert.equal(r.body.data.summary.assertionRegressions,1);
assert.equal(r.body.data.summary.routerDrifts,1);
assert.equal(r.body.data.summary.evidenceDrifts,1);
assert.equal(r.body.data.summary.durationRegressions,1);
assert.equal(r.body.data.summary.costRegressions,1);
const blockComparisonId=r.body.data.id;

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:blockRun,idempotencyKey:passKey
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_COMPARISON_IDEMPOTENCY_CONFLICT');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:wrongBaselineRun,
  idempotencyKey:`m243-wrong-baseline-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_BASELINE_SHA_MISMATCH');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:corruptRun,
  idempotencyKey:`m243-corrupt-${suffix}`
});
assert.equal(r.status,500,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RUN_INTEGRITY_MISMATCH');

let noAuth=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:passRun,idempotencyKey:`m243-unauth-${suffix}`
},null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));
noAuth=await request('GET',`/api/runtime/eval-regression-comparisons/${blockComparisonId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const [[cmpCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_regression_comparisons');
assert.equal(Number(cmpCount.count),2);
const [[gateCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_release_gates');
assert.equal(Number(gateCount.count),2);
await db.end();

console.log('G24_3_REGRESSION_COMPARATOR_RELEASE_GATE_PASS');
