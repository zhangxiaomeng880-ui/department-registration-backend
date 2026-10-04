import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m243-platform-token';
const request=async(method,path,body,auth=token)=>{
  const headers={'content-type':'application/json'};
  if(auth) headers.authorization=`Bearer ${auth}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const baselineSha='a'.repeat(40), candidateSha='b'.repeat(40), candidate2Sha='c'.repeat(40);
let r=await request('POST','/api/runtime/eval-suites',{suiteKey:`m243-${suffix}`,name:'M24.3 Regression Suite'});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;

const createVersion=async(versionNo,caseKey)=>{
  let x=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo});
  assert.equal(x.status,201,JSON.stringify(x.body));
  const versionId=x.body.data.id;
  x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
    caseKey,sequenceNo:1,
    replayInput:{
      projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
      query:'Synthetic regression comparator fixture.',
      policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
      syntheticObservation:{output:{ok:true},evidence:[],execution:{status:'PASS',durationMs:1,estimatedCost:0,costCurrency:'USD'}}
    },
    sourceRefs:[],
    assertions:{router:{matched:true,policyResult:'ALLOW'}}
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const caseId=x.body.data.id;
  x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
  assert.equal(x.status,200,JSON.stringify(x.body));
  return {versionId,caseId,fixtureSha256:x.body.data.fixtureSha256};
};

const v1=await createVersion(1,'shared-case');
const createManifest=async(versionId,candidateRuntimeSha,key,baselineRuntimeSha=null)=>{
  const x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha,baselineRuntimeSha,
    workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
    ragIndexVersion:'synthetic-rag-v1',idempotencyKey:key
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  return x.body.data;
};
const baselineManifest=await createManifest(v1.versionId,baselineSha,`m243-base-manifest-${suffix}`);
const candidateManifest=await createManifest(v1.versionId,candidateSha,`m243-candidate-manifest-${suffix}`,baselineSha);
const candidate2Manifest=await createManifest(v1.versionId,candidate2Sha,`m243-candidate2-manifest-${suffix}`,baselineSha);

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const routeBase={
  matched:true,policyResult:'ALLOW',routeRuleKey:'P86',
  selectedProviderKey:'provider-a',selectedModelKey:'model-a',providerHealthStatus:'HEALTHY'
};

const seedRun=async({manifest,sha,status='PASS',caseStatus='PASS',route=routeBase,evidenceCount=2,durationMs=100,cost=0.1,assertionFail=false,label})=>{
  const runId=randomUUID(),caseResultId=randomUUID();
  const evidence=Array.from({length:evidenceCount},(_,i)=>({sourceFileId:`s${i+1}`,contentSha256:'d'.repeat(64)}));
  const execution={status:'PASS',durationMs,estimatedCost:cost,costCurrency:'USD',providerInvoked:false,executionMode:'SYNTHETIC_REPLAY'};
  await db.execute(
    `INSERT INTO eval_runs
     (id,replay_manifest_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,
      case_count,passed_case_count,failed_case_count,assertion_count,passed_assertion_count,failed_assertion_count,
      result_sha256,summary_json,idempotency_key,finished_at)
     VALUES (?,?,?,?, 'SYNTHETIC_REPLAY',?,1,?,?,1,?,?,?, ?,?,CURRENT_TIMESTAMP(6))`,
    [runId,manifest.id,sha,manifest.baselineRuntimeSha||null,status,
     caseStatus==='PASS'?1:0,caseStatus==='FAIL'?1:0,assertionFail?0:1,assertionFail?1:0,
     (label==='baseline'?'1':label==='pass'?'2':label==='drift'?'3':'4').repeat(64),
     JSON.stringify({seed:'M24.3',label}),`seed-run-${label}-${suffix}`]
  );
  await db.execute(
    `INSERT INTO eval_case_results
     (id,eval_run_id,eval_case_id,case_key,sequence_no,status,route_json,observed_output_json,
      observed_evidence_json,observed_execution_json,assertion_summary_json,result_sha256,finished_at)
     VALUES (?,?,?,?,1,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
    [caseResultId,runId,v1.caseId,'shared-case',caseStatus,JSON.stringify(route),JSON.stringify({ok:true}),
     JSON.stringify(evidence),JSON.stringify(execution),
     JSON.stringify({total:1,passed:assertionFail?0:1,failed:assertionFail?1:0,failureCodes:assertionFail?['ROUTER_SELECTEDMODELKEY_MISMATCH']:[]}),
     (label==='baseline'?'5':label==='pass'?'6':label==='drift'?'7':'8').repeat(64)]
  );
  await db.execute(
    `INSERT INTO eval_assertion_results
     (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),caseResultId,'router','selectedModelKey',assertionFail?'FAIL':'PASS',
     JSON.stringify('model-a'),JSON.stringify(route.selectedModelKey),
     assertionFail?'ROUTER_SELECTEDMODELKEY_MISMATCH':null]
  );
  return runId;
};

const baselineRun=await seedRun({manifest:baselineManifest,sha:baselineSha,label:'baseline'});
const passRun=await seedRun({manifest:candidateManifest,sha:candidateSha,label:'pass',durationMs:90,cost:0.09});
const driftRoute={...routeBase,selectedModelKey:'model-b'};
const driftRun=await seedRun({
  manifest:candidateManifest,sha:candidateSha,label:'drift',route:driftRoute,evidenceCount:1,durationMs:120,cost:0.12
});
const failRun=await seedRun({
  manifest:candidate2Manifest,sha:candidate2Sha,label:'fail',caseStatus:'FAIL',assertionFail:true
});

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:passRun,idempotencyKey:`cmp-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.blockerCount,0);
assert.equal(r.body.data.gate.decision,'PASS');
assert.equal(r.body.data.gate.blockerCount,0);
assert.match(r.body.data.comparisonSha256,/^[a-f0-9]{64}$/);
assert.match(r.body.data.policySha256,/^[a-f0-9]{64}$/);
assert.match(r.body.data.gate.gateSha256,/^[a-f0-9]{64}$/);
const passComparisonId=r.body.data.id;
const passGateId=r.body.data.gate.id;

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:passRun,idempotencyKey:`cmp-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,passComparisonId);
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/eval-release-gates/${passGateId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:driftRun,idempotencyKey:`cmp-drift-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCK');
assert.equal(r.body.data.gate.decision,'BLOCK');
const driftCodes=r.body.data.gate.blockers.map(x=>x.code);
assert.ok(driftCodes.includes('EVIDENCE_COUNT_REGRESSION'));
assert.ok(driftCodes.includes('ROUTER_DRIFT'));
assert.ok(driftCodes.includes('LATENCY_REGRESSION'));
assert.ok(driftCodes.includes('COST_REGRESSION'));
assert.equal(r.body.data.summary.candidate.status,'PASS');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:driftRun,idempotencyKey:`cmp-drift-relaxed-${suffix}`,
  policy:{allowRouterDrift:true,maxEvidenceCountDrop:1,maxDurationIncreasePct:25,maxCostIncreasePct:25}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.gate.decision,'PASS');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:failRun,idempotencyKey:`cmp-fail-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCK');
const failCodes=r.body.data.gate.blockers.map(x=>x.code);
assert.ok(failCodes.includes('CANDIDATE_RUN_NOT_PASS'));
assert.ok(failCodes.includes('CASE_STATUS_REGRESSION'));
assert.ok(failCodes.includes('NEW_FAILED_ASSERTIONS'));

const v2=await createVersion(2,'other-case');
const otherManifest=await createManifest(v2.versionId,'e'.repeat(40),`m243-other-manifest-${suffix}`);
const otherRunId=randomUUID(),otherCaseResultId=randomUUID();
await db.execute(
  `INSERT INTO eval_runs
   (id,replay_manifest_id,candidate_runtime_sha,execution_mode,status,case_count,passed_case_count,failed_case_count,
    assertion_count,passed_assertion_count,failed_assertion_count,result_sha256,summary_json,idempotency_key,finished_at)
   VALUES (?,?,?,'SYNTHETIC_REPLAY','PASS',1,1,0,0,0,0,?,?,?,CURRENT_TIMESTAMP(6))`,
  [otherRunId,otherManifest.id,'e'.repeat(40),'9'.repeat(64),JSON.stringify({seed:'other'}),`seed-other-${suffix}`]
);
await db.execute(
  `INSERT INTO eval_case_results
   (id,eval_run_id,eval_case_id,case_key,sequence_no,status,route_json,observed_output_json,
    observed_evidence_json,observed_execution_json,assertion_summary_json,result_sha256,finished_at)
   VALUES (?,?,?,?,1,'PASS',?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
  [otherCaseResultId,otherRunId,v2.caseId,'other-case',JSON.stringify(routeBase),JSON.stringify({ok:true}),
   JSON.stringify([]),JSON.stringify({status:'PASS',durationMs:1,estimatedCost:0,costCurrency:'USD'}),
   JSON.stringify({total:0,passed:0,failed:0,failureCodes:[]}),'a'.repeat(64)]
);

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun,candidateEvalRunId:otherRunId,idempotencyKey:`cmp-mismatch-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_REGRESSION_FIXTURE_MISMATCH');

const noAuth=await request('GET',`/api/runtime/eval-regression-comparisons/${passComparisonId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const [[cmpCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_regression_comparisons');
assert.ok(Number(cmpCount.count)>=4);
const [[gateCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_release_gates');
assert.ok(Number(gateCount.count)>=4);
await db.end();

console.log('G24_3_REGRESSION_COMPARATOR_RELEASE_GATE_PASS');
