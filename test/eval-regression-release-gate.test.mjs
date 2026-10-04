import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m243-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
const baselineSha='34578464f5d19e87978ccb81719fb23a4b79d6f1';
assert.match(runtimeSha,/^[a-f0-9]{40}$/,'RUNTIME_COMMIT_SHA must be set for M24.3');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const providerKey=`m243-provider-${suffix}`;
const modelKey=`m243-model-${suffix}`;
const sourceHash='e'.repeat(64);

let r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'SYNTHETIC',displayName:'M24.3 Provider',
  adapterKey:'synthetic-m243',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M24.3 Model',qualityTier:'PREMIUM',
  latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});

const createScenario=async({label,observation,assertions})=>{
  let x=await request('POST','/api/runtime/eval-suites',{
    suiteKey:`m243-${label}-${suffix}`,name:`M24.3 ${label} Suite`
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
      query:`Synthetic M24.3 ${label} regression fixture.`,
      policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
      allowedProviderKeys:[providerKey],syntheticObservation:observation
    },
    sourceRefs:[{
      sourceFileId:'synthetic-source-001',sourceVersion:'v1',lineStart:1,lineEnd:5,
      contentSha256:sourceHash,contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'
    }],
    assertions
  });
  assert.equal(x.status,201,JSON.stringify(x.body));

  x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
  assert.equal(x.status,200,JSON.stringify(x.body));
  const fixtureSha256=x.body.data.fixtureSha256;

  x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha:baselineSha,
    workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
    ragIndexVersion:'synthetic-rag-v1',idempotencyKey:`m243-baseline-manifest-${label}-${suffix}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const baselineManifest=x.body.data;

  x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha:runtimeSha,baselineRuntimeSha:baselineSha,
    workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
    ragIndexVersion:'synthetic-rag-v1',idempotencyKey:`m243-candidate-manifest-${label}-${suffix}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const candidateManifest=x.body.data;

  x=await request('POST',`/api/runtime/eval-replay-manifests/${candidateManifest.id}/run`,{
    idempotencyKey:`m243-candidate-run-${label}-${suffix}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const candidateRun=x.body.data;
  assert.equal(candidateRun.summary.fixtureSha256,fixtureSha256);

  return {versionId,fixtureSha256,baselineManifest,candidateManifest,candidateRun};
};

const seedBaselineFromCandidate=async({scenario,label,baselineStatus='PASS',baselineCost,baselineDurationMs,routeOverride=null,allAssertionsPass=true})=>{
  const candidateRun=scenario.candidateRun;
  const candidateCase=candidateRun.cases[0];
  const baselineRunId=randomUUID();
  const baselineCaseResultId=randomUUID();
  const baselineRoute={...candidateCase.route,...(routeOverride||{})};
  const baselineExecution={
    ...candidateCase.observedExecution,
    durationMs:baselineDurationMs,
    estimatedCost:baselineCost,
    providerInvoked:false,
    executionMode:'SYNTHETIC_REPLAY'
  };
  const baselineAssertions=candidateCase.assertions.map(a=>({
    ...a,
    status:allAssertionsPass?'PASS':a.status,
    failureCode:allAssertionsPass?null:a.failureCode
  }));
  const failedAssertions=baselineAssertions.filter(a=>a.status==='FAIL').length;
  const assertionSummary={
    total:baselineAssertions.length,
    passed:baselineAssertions.length-failedAssertions,
    failed:failedAssertions,
    failureCodes:baselineAssertions.filter(a=>a.failureCode).map(a=>a.failureCode)
  };
  const runResultHash=(label==='pass'?'1':'2').repeat(64);
  const caseResultHash=(label==='pass'?'3':'4').repeat(64);
  const summary={
    executionMode:'SYNTHETIC_REPLAY',providerInvoked:false,
    fixtureSha256:scenario.fixtureSha256,
    manifestSha256:scenario.baselineManifest.manifestSha256,
    caseCount:1,
    passedCaseCount:baselineStatus==='PASS'?1:0,
    failedCaseCount:baselineStatus==='FAIL'?1:0,
    assertionCount:baselineAssertions.length,
    passedAssertionCount:baselineAssertions.length-failedAssertions,
    failedAssertionCount:failedAssertions
  };

  await db.execute(
    `INSERT INTO eval_runs
     (id,replay_manifest_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,
      case_count,passed_case_count,failed_case_count,assertion_count,passed_assertion_count,
      failed_assertion_count,result_sha256,summary_json,idempotency_key,finished_at)
     VALUES (?,?,?,NULL,'SYNTHETIC_REPLAY',?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6))`,
    [baselineRunId,scenario.baselineManifest.id,baselineSha,baselineStatus,1,
     baselineStatus==='PASS'?1:0,baselineStatus==='FAIL'?1:0,
     baselineAssertions.length,baselineAssertions.length-failedAssertions,failedAssertions,
     runResultHash,JSON.stringify(summary),`m243-seeded-baseline-${label}-${suffix}`]
  );
  await db.execute(
    `INSERT INTO eval_case_results
     (id,eval_run_id,eval_case_id,case_key,sequence_no,status,route_json,observed_output_json,
      observed_evidence_json,observed_execution_json,assertion_summary_json,result_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [baselineCaseResultId,baselineRunId,candidateCase.evalCaseId,candidateCase.caseKey,candidateCase.sequenceNo,
     baselineStatus,JSON.stringify(baselineRoute),JSON.stringify(candidateCase.observedOutput),
     JSON.stringify(candidateCase.observedEvidence||[]),JSON.stringify(baselineExecution),
     JSON.stringify(assertionSummary),caseResultHash]
  );
  for(const a of baselineAssertions){
    await db.execute(
      `INSERT INTO eval_assertion_results
       (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),baselineCaseResultId,a.group,a.key,a.status,
       a.expected==null?null:JSON.stringify(a.expected),
       a.actual==null?null:JSON.stringify(a.actual),a.failureCode]
    );
  }
  return baselineRunId;
};

const passOutput={findingCount:1,findings:[{code:'OK'}],noOtherHardConflicts:true};
const passScenario=await createScenario({
  label:'pass',
  observation:{
    output:passOutput,
    evidence:[{sourceFileId:'synthetic-source-001',contentSha256:sourceHash}],
    execution:{status:'PASS',durationMs:110,estimatedCost:0.11,costCurrency:'USD'}
  },
  assertions:{
    structuredOutput:{requiredKeys:['findingCount','findings','noOtherHardConflicts'],exact:passOutput},
    evidence:{required:true,minCount:1,allowedSourceFileIds:['synthetic-source-001'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',routeRuleKey:'P86',selectedProviderKey:providerKey,selectedModelKey:modelKey},
    execution:{status:'PASS',maxDurationMs:1000,maxEstimatedCost:1,costCurrency:'USD'}
  }
});
assert.equal(passScenario.candidateRun.status,'PASS');
const passBaselineRunId=await seedBaselineFromCandidate({
  scenario:passScenario,label:'pass',baselineCost:0.10,baselineDurationMs:100,allAssertionsPass:true
});

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:passBaselineRunId,candidateEvalRunId:passScenario.candidateRun.id,
  idempotencyKey:`m243-pass-comparison-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const passComparison=r.body.data;
assert.equal(passComparison.caseRegressions,0);
assert.equal(passComparison.assertionRegressions,0);
assert.equal(passComparison.evidenceRegressions,0);
assert.equal(passComparison.routerDrifts,0);
assert.equal(passComparison.costChangePct,10);
assert.equal(passComparison.latencyChangePct,10);
assert.match(passComparison.comparisonSha256,/^[a-f0-9]{64}$/);
const passComparisonId=passComparison.id;

const strictPolicy={
  requireCandidatePass:true,
  maxCaseRegressions:0,
  maxAssertionRegressions:0,
  maxEvidenceRegressions:0,
  maxRouterDrifts:0,
  maxCostIncreasePct:20,
  maxLatencyIncreasePct:20
};
r=await request('POST','/api/runtime/eval-release-gates',{
  comparisonId:passComparisonId,gateKey:'V2.4_PRE_RELEASE',policy:strictPolicy,
  idempotencyKey:`m243-pass-gate-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');
assert.deepEqual(r.body.data.blockers,[]);
assert.match(r.body.data.policySha256,/^[a-f0-9]{64}$/);
assert.match(r.body.data.decisionSha256,/^[a-f0-9]{64}$/);
const passGateId=r.body.data.id;

r=await request('GET',`/api/runtime/eval-release-gates/${passGateId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'PASS');

const failScenario=await createScenario({
  label:'block',
  observation:{
    output:{findingCount:0},
    evidence:[],
    execution:{status:'PASS',durationMs:2500,estimatedCost:0.5,costCurrency:'USD'}
  },
  assertions:{
    structuredOutput:{requiredKeys:['findingCount','findings']},
    evidence:{required:true,minCount:1,allowedSourceFileIds:['synthetic-source-001'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',routeRuleKey:'P86',selectedProviderKey:providerKey,selectedModelKey:'wrong-expected-model'},
    execution:{status:'PASS',maxDurationMs:5000,maxEstimatedCost:1,costCurrency:'USD'}
  }
});
assert.equal(failScenario.candidateRun.status,'FAIL');
const failBaselineRunId=await seedBaselineFromCandidate({
  scenario:failScenario,label:'block',baselineCost:0.1,baselineDurationMs:1000,
  routeOverride:{selectedModelKey:'baseline-model'},allAssertionsPass:true
});

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:failBaselineRunId,candidateEvalRunId:failScenario.candidateRun.id,
  idempotencyKey:`m243-block-comparison-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const blockedComparison=r.body.data;
assert.equal(blockedComparison.caseRegressions,1);
assert.ok(blockedComparison.assertionRegressions>=4);
assert.ok(blockedComparison.evidenceRegressions>=2);
assert.equal(blockedComparison.routerDrifts,1);
assert.equal(blockedComparison.costChangePct,400);
assert.equal(blockedComparison.latencyChangePct,150);
const blockedComparisonId=blockedComparison.id;

r=await request('POST','/api/runtime/eval-release-gates',{
  comparisonId:blockedComparisonId,gateKey:'V2.4_PRE_RELEASE',policy:strictPolicy,
  idempotencyKey:`m243-block-gate-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'BLOCK');
const blockerCodes=r.body.data.blockers.map(x=>x.code);
for(const code of [
  'CANDIDATE_RUN_NOT_PASS','CASE_REGRESSION_LIMIT_EXCEEDED','ASSERTION_REGRESSION_LIMIT_EXCEEDED',
  'EVIDENCE_REGRESSION_LIMIT_EXCEEDED','ROUTER_DRIFT_LIMIT_EXCEEDED',
  'COST_INCREASE_LIMIT_EXCEEDED','LATENCY_INCREASE_LIMIT_EXCEEDED'
]) assert.ok(blockerCodes.includes(code),JSON.stringify(r.body.data.blockers));

r=await request('POST','/api/runtime/eval-release-gates',{
  comparisonId:passComparisonId,gateKey:'INVALID_POLICY',
  policy:{requireCandidatePass:true,maxCaseRegressions:0},
  idempotencyKey:`m243-invalid-policy-${suffix}`
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'INVALID_EVAL_RELEASE_GATE_POLICY');

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:passBaselineRunId,candidateEvalRunId:failScenario.candidateRun.id,
  idempotencyKey:`m243-fixture-mismatch-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_COMPARISON_FIXTURE_MISMATCH');

let noAuth=await request('GET',`/api/runtime/eval-regression-comparisons/${passComparisonId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));
noAuth=await request('GET',`/api/runtime/eval-release-gates/${passGateId}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const [[comparisonCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_regression_comparisons');
assert.ok(Number(comparisonCount.count)>=2);
const [[gateCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_release_gates');
assert.ok(Number(gateCount.count)>=2);
await db.end();

console.log('G24_3_REGRESSION_RELEASE_GATE_PASS');
