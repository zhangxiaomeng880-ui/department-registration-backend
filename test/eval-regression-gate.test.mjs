import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m243-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'');
assert.match(runtimeSha,/^[a-f0-9]{40}$/i,'RUNTIME_COMMIT_SHA must be set for M24.3');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const suffix=randomUUID().slice(0,8);
const providerKey=`m243-provider-${suffix}`;
const modelKey=`m243-model-${suffix}`;
const sourceHash='a'.repeat(64);
const schemaHash='b'.repeat(64);

let r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'SYNTHETIC',displayName:'M24.3 Provider',
  adapterKey:'synthetic-eval',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M24.3 Model',qualityTier:'PREMIUM',
  latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/eval-suites',{
  suiteKey:`m243-suite-${suffix}`,name:'M24.3 Regression Suite'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;

const output={findingCount:1,findings:[{code:'BASELINE'}],noOtherHardConflicts:true};
r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'continuity-case',sequenceNo:1,
  replayInput:{
    projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
    query:'Synthetic M24.3 comparator fixture.',policyMode:'QUALITY_FIRST',
    requiredStructuredOutput:true,allowedProviderKeys:[providerKey],
    syntheticObservation:{
      output,outputSchemaSha256:schemaHash,
      evidence:[{sourceFileId:'source-001',contentSha256:sourceHash}],
      execution:{status:'PASS',durationMs:500,estimatedCost:0.10,costCurrency:'USD'}
    }
  },
  sourceRefs:[{sourceFileId:'source-001',sourceVersion:'v1',contentSha256:sourceHash,contextRole:'AUTHORITATIVE'}],
  assertions:{
    structuredOutput:{requiredKeys:['findingCount','findings','noOtherHardConflicts'],exact:output,jsonSchemaSha256:schemaHash},
    evidence:{required:true,minCount:1,allowedSourceFileIds:['source-001'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',routeRuleKey:'P86',selectedProviderKey:providerKey,selectedModelKey:modelKey,providerHealthStatus:'HEALTHY'},
    execution:{status:'PASS',maxDurationMs:1000,maxEstimatedCost:0.2,costCurrency:'USD'}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,
  baselineRuntimeSha:'34578464f5d19e87978ccb81719fb23a4b79d6f1',
  workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
  ragIndexVersion:'synthetic-rag-v1',idempotencyKey:`m243-manifest-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const manifestId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-replay-manifests/${manifestId}/run`,{
  idempotencyKey:`m243-baseline-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
const baselineRun=r.body.data;

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});

const [baseRunRows]=await db.execute('SELECT * FROM eval_runs WHERE id=?',[baselineRun.id]);
const [baseCaseRows]=await db.execute('SELECT * FROM eval_case_results WHERE eval_run_id=?',[baselineRun.id]);
assert.equal(baseRunRows.length,1);
assert.equal(baseCaseRows.length,1);
const baseRunRow=baseRunRows[0],baseCase=baseCaseRows[0];
const [baseAssertions]=await db.execute('SELECT * FROM eval_assertion_results WHERE eval_case_result_id=? ORDER BY assertion_group,assertion_key',[baseCase.id]);
assert.ok(baseAssertions.length>0);

const cloneRun=async({runtimeShaValue,status,caseStatus,route,evidence,execution,assertionMutator,label})=>{
  const runId=randomUUID(),caseResultId=randomUUID();
  await db.execute(
    `INSERT INTO eval_runs
     (id,replay_manifest_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,
      case_count,passed_case_count,failed_case_count,assertion_count,passed_assertion_count,
      failed_assertion_count,result_sha256,summary_json,idempotency_key,started_at,finished_at)
     VALUES (?,?,?,?, 'SYNTHETIC_REPLAY',?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))`,
    [runId,baseRunRow.replay_manifest_id,runtimeShaValue,baseRunRow.candidate_runtime_sha,status,
     1,status==='PASS'?1:0,status==='FAIL'?1:0,baseAssertions.length,
     status==='PASS'?baseAssertions.length:baseAssertions.length-1,status==='FAIL'?1:0,
     hash(`run-${label}`),JSON.stringify({clonedFor:'M24.3',label}),`clone-${label}-${suffix}`]
  );
  await db.execute(
    `INSERT INTO eval_case_results
     (id,eval_run_id,eval_case_id,case_key,sequence_no,status,route_json,observed_output_json,
      observed_evidence_json,observed_execution_json,assertion_summary_json,result_sha256,
      started_at,finished_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))`,
    [caseResultId,runId,baseCase.eval_case_id,baseCase.case_key,baseCase.sequence_no,caseStatus,
     JSON.stringify(route),JSON.stringify(baseCase.observed_output_json),
     JSON.stringify(evidence),JSON.stringify(execution),
     JSON.stringify({total:baseAssertions.length,passed:caseStatus==='PASS'?baseAssertions.length:baseAssertions.length-1,
       failed:caseStatus==='FAIL'?1:0}),hash(`case-${label}`)]
  );
  for(let i=0;i<baseAssertions.length;i++){
    const src=baseAssertions[i];
    const next=assertionMutator?assertionMutator({...src},i):{...src};
    await db.execute(
      `INSERT INTO eval_assertion_results
       (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),caseResultId,next.assertion_group,next.assertion_key,next.status,
       next.expected_json==null?null:JSON.stringify(next.expected_json),
       next.actual_json==null?null:JSON.stringify(next.actual_json),next.failure_code]
    );
  }
  return runId;
};

const baselineRoute=baseCase.route_json;
const baselineEvidence=baseCase.observed_evidence_json;
const baselineExecution=baseCase.observed_execution_json;

const improvedRunId=await cloneRun({
  runtimeShaValue:'1'.repeat(40),status:'PASS',caseStatus:'PASS',
  route:baselineRoute,evidence:[...baselineEvidence,{sourceFileId:'source-002',contentSha256:'c'.repeat(64)}],
  execution:{...baselineExecution,durationMs:350,estimatedCost:0.08},
  label:'improved'
});

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun.id,candidateEvalRunId:improvedRunId,idempotencyKey:`cmp-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.blockerCount,0);
assert.equal(r.body.data.caseRegressions,0);
assert.equal(r.body.data.cases[0].status,'PASS');
assert.equal(r.body.data.cases[0].metrics.improvements.latency,1);
assert.equal(r.body.data.cases[0].metrics.improvements.cost,1);
const passComparisonId=r.body.data.id;

r=await request('POST','/api/runtime/eval-release-gates',{
  comparisonId:passComparisonId,gateKey:'V2.4_RC',idempotencyKey:`gate-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');
const passGateId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-release-gates/${passGateId}/enforce`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');

const badRoute={...baselineRoute,policyResult:'BLOCK',selectedProviderKey:'regressed-provider',selectedModelKey:'regressed-model',providerHealthStatus:'UNHEALTHY'};
const badExecution={...baselineExecution,durationMs:900,estimatedCost:0.25};
const badRunId=await cloneRun({
  runtimeShaValue:'2'.repeat(40),status:'FAIL',caseStatus:'FAIL',
  route:badRoute,evidence:[],execution:badExecution,
  assertionMutator:(row,index)=>index===0?{...row,status:'FAIL',failure_code:'SYNTHETIC_REGRESSION'}:row,
  label:'regressed'
});

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun.id,candidateEvalRunId:badRunId,idempotencyKey:`cmp-block-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCK');
assert.ok(r.body.data.blockerCount>=8,JSON.stringify(r.body.data));
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
  assert.ok(codes.includes(code),`missing blocker ${code}: ${JSON.stringify(codes)}`);
}
const blockComparisonId=r.body.data.id;

r=await request('POST','/api/runtime/eval-release-gates',{
  comparisonId:blockComparisonId,gateKey:'V2.4_RC',idempotencyKey:`gate-block-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'BLOCK');
const blockGateId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-release-gates/${blockGateId}/enforce`,{});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RELEASE_GATE_BLOCKED');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun.id,candidateEvalRunId:badRunId,idempotencyKey:`cmp-block-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,blockComparisonId);
assert.equal(r.body.data.idempotent,true);

const noAuth=await request('GET',`/api/runtime/eval-regression-comparisons/${passComparisonId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const [[comparisonCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_regression_comparisons');
assert.equal(Number(comparisonCount.count),2);
const [[gateCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_release_gates');
assert.equal(Number(gateCount.count),2);
await db.end();

console.log('G24_3_REGRESSION_COMPARATOR_RELEASE_GATE_PASS');
