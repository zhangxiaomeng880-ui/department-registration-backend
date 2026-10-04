import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalRun } from './eval-runner.mjs';
import { getEvalReplayManifest } from './eval-replay.mjs';

const POLICY_VERSION='eval-release-gate-v1';
const DEFAULT_POLICY=Object.freeze({
  requireBaselinePass:true,
  requireCandidatePass:true,
  allowNewFailedAssertions:false,
  allowRouteDrift:false,
  allowEvidenceDrift:false,
  maxDurationIncreasePct:0,
  maxCostIncreasePct:0
});

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const normalizePolicy=input=>{
  const p={...DEFAULT_POLICY,...(input&&typeof input==='object'&&!Array.isArray(input)?input:{})};
  for(const key of ['maxDurationIncreasePct','maxCostIncreasePct']){
    const value=Number(p[key]);
    if(!Number.isFinite(value)||value<0) throw errorOf('Regression thresholds must be non-negative','INVALID_REGRESSION_GATE_POLICY',400,{field:key});
    p[key]=value;
  }
  for(const key of ['requireBaselinePass','requireCandidatePass','allowNewFailedAssertions','allowRouteDrift','allowEvidenceDrift']){
    p[key]=Boolean(p[key]);
  }
  return p;
};
const pctIncrease=(baseline,candidate)=>{
  const b=Number(baseline||0),c=Number(candidate||0);
  if(c<=b) return 0;
  if(b===0) return Infinity;
  return ((c-b)/b)*100;
};
const routeFingerprint=route=>({
  matched:Boolean(route?.matched),
  policyResult:route?.policyResult??null,
  routeRuleKey:route?.routeRuleKey??null,
  selectedProviderKey:route?.selectedProviderKey??null,
  selectedModelKey:route?.selectedModelKey??null,
  providerHealthStatus:route?.providerHealthStatus??null
});
const evidenceFingerprint=evidence=>(Array.isArray(evidence)?evidence:[])
  .map(item=>({
    sourceFileId:item?.sourceFileId??null,
    contentSha256:item?.contentSha256??null,
    lineStart:item?.lineStart??null,
    lineEnd:item?.lineEnd??null
  }))
  .sort((a,b)=>stableJson(a).localeCompare(stableJson(b)));
const assertionFailures=evalCase=>new Set(
  (evalCase.assertions||[]).filter(x=>x.status==='FAIL').map(x=>`${x.group}:${x.key}`)
);
const normalizeComparison=row=>({
  id:row.id,baselineEvalRunId:row.baseline_eval_run_id,candidateEvalRunId:row.candidate_eval_run_id,
  suiteVersionId:row.suite_version_id,fixtureSha256:row.fixture_sha256,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  policyVersion:row.policy_version,policySha256:row.policy_sha256,policy:row.policy_json,
  status:row.status,blockerCount:Number(row.blocker_count),summary:row.summary_json,
  comparisonSha256:row.comparison_sha256,idempotencyKey:row.idempotency_key,createdAt:row.created_at
});
const normalizeCase=row=>({
  id:row.id,comparisonId:row.comparison_id,caseKey:row.case_key,sequenceNo:Number(row.sequence_no),
  baselineStatus:row.baseline_status,candidateStatus:row.candidate_status,transition:row.transition,
  assertionRegressionCount:Number(row.assertion_regression_count),
  assertionImprovementCount:Number(row.assertion_improvement_count),
  assertionSetDrift:Boolean(row.assertion_set_drift),routerDrift:Boolean(row.router_drift),
  evidenceDrift:Boolean(row.evidence_drift),
  baselineDurationMs:row.baseline_duration_ms==null?null:Number(row.baseline_duration_ms),
  candidateDurationMs:row.candidate_duration_ms==null?null:Number(row.candidate_duration_ms),
  durationChangePct:row.duration_change_pct==null?null:Number(row.duration_change_pct),
  baselineEstimatedCost:row.baseline_estimated_cost==null?null:Number(row.baseline_estimated_cost),
  candidateEstimatedCost:row.candidate_estimated_cost==null?null:Number(row.candidate_estimated_cost),
  costChangePct:row.cost_change_pct==null?null:Number(row.cost_change_pct),
  costCurrency:row.cost_currency||null,blockerCount:Number(row.blocker_count),
  blockers:row.blockers_json||[],diff:row.diff_json,diffSha256:row.diff_sha256,createdAt:row.created_at
});
const normalizeGate=row=>({
  id:row.id,comparisonId:row.comparison_id,gateKey:row.gate_key,decision:row.decision,
  blockerCount:Number(row.blocker_count),blockers:row.blockers_json||[],
  policySha256:row.policy_sha256,gateSha256:row.gate_sha256,
  idempotencyKey:row.idempotency_key,decidedAt:row.decided_at,createdAt:row.created_at
});

const compareCase=(baseline,candidate,policy)=>{
  const blockers=[];
  const beforeFailures=assertionFailures(baseline),afterFailures=assertionFailures(candidate);
  const newFailures=[...afterFailures].filter(x=>!beforeFailures.has(x)).sort();
  const assertionSetBefore=[...(baseline.assertions||[])].map(x=>`${x.group}:${x.key}`).sort();
  const assertionSetAfter=[...(candidate.assertions||[])].map(x=>`${x.group}:${x.key}`).sort();
  const assertionSetDrift=stableJson(assertionSetBefore)!==stableJson(assertionSetAfter);
  const assertionRegressionCount=newFailures.length;
  const assertionImprovementCount=[...beforeFailures].filter(x=>!afterFailures.has(x)).length;
  if(baseline.status==='PASS'&&candidate.status!=='PASS') blockers.push({code:'CASE_STATUS_REGRESSION'});
  if(newFailures.length&&!policy.allowNewFailedAssertions) blockers.push({code:'NEW_FAILED_ASSERTIONS',assertions:newFailures});
  if(assertionSetDrift&&!policy.allowNewFailedAssertions) blockers.push({code:'ASSERTION_SET_DRIFT'});

  const beforeRoute=routeFingerprint(baseline.route),afterRoute=routeFingerprint(candidate.route);
  const routerDrift=stableJson(beforeRoute)!==stableJson(afterRoute);
  if(routerDrift&&!policy.allowRouteDrift) blockers.push({code:'ROUTE_DRIFT',baseline:beforeRoute,candidate:afterRoute});

  const beforeEvidence=evidenceFingerprint(baseline.observedEvidence),afterEvidence=evidenceFingerprint(candidate.observedEvidence);
  const evidenceDrift=stableJson(beforeEvidence)!==stableJson(afterEvidence);
  if(evidenceDrift&&!policy.allowEvidenceDrift) blockers.push({
    code:'EVIDENCE_DRIFT',baselineSha256:sha256(beforeEvidence),candidateSha256:sha256(afterEvidence)
  });

  const baselineDurationMs=Number(baseline.observedExecution?.durationMs||0);
  const candidateDurationMs=Number(candidate.observedExecution?.durationMs||0);
  const durationChangePct=pctIncrease(baselineDurationMs,candidateDurationMs);
  if(durationChangePct>policy.maxDurationIncreasePct) blockers.push({
    code:'LATENCY_REGRESSION',baselineMs:baselineDurationMs,candidateMs:candidateDurationMs,
    increasePct:Number.isFinite(durationChangePct)?Number(durationChangePct.toFixed(6)):'INF',
    allowedIncreasePct:policy.maxDurationIncreasePct
  });

  const baselineEstimatedCost=Number(baseline.observedExecution?.estimatedCost||0);
  const candidateEstimatedCost=Number(candidate.observedExecution?.estimatedCost||0);
  const beforeCurrency=baseline.observedExecution?.costCurrency||null;
  const afterCurrency=candidate.observedExecution?.costCurrency||null;
  if(beforeCurrency!==afterCurrency) blockers.push({code:'COST_CURRENCY_CHANGED',baseline:beforeCurrency,candidate:afterCurrency});
  const costChangePct=pctIncrease(baselineEstimatedCost,candidateEstimatedCost);
  if(beforeCurrency===afterCurrency&&costChangePct>policy.maxCostIncreasePct) blockers.push({
    code:'COST_REGRESSION',baselineCost:baselineEstimatedCost,candidateCost:candidateEstimatedCost,
    increasePct:Number.isFinite(costChangePct)?Number(costChangePct.toFixed(6)):'INF',
    allowedIncreasePct:policy.maxCostIncreasePct
  });

  const transition=baseline.status===candidate.status?'UNCHANGED':`${baseline.status}_TO_${candidate.status}`;
  const diff={
    baselineRoute:beforeRoute,candidateRoute:afterRoute,
    baselineEvidence:beforeEvidence,candidateEvidence:afterEvidence,
    newFailedAssertions:newFailures
  };
  const material={
    caseKey:candidate.caseKey,sequenceNo:candidate.sequenceNo,baselineStatus:baseline.status,candidateStatus:candidate.status,
    transition,assertionRegressionCount,assertionImprovementCount,assertionSetDrift,routerDrift,evidenceDrift,
    baselineDurationMs,candidateDurationMs,durationChangePct:Number.isFinite(durationChangePct)?Number(durationChangePct.toFixed(6)):null,
    baselineEstimatedCost,candidateEstimatedCost,costChangePct:Number.isFinite(costChangePct)?Number(costChangePct.toFixed(6)):null,
    costCurrency:afterCurrency,blockers,diff
  };
  return {...material,diffSha256:sha256(material)};
};

export const getEvalRegressionComparison=async comparisonId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_regression_comparisons WHERE id=?',[comparisonId]);
  if(!rows.length) throw errorOf('Eval regression comparison not found','EVAL_REGRESSION_COMPARISON_NOT_FOUND',404);
  const [cases]=await db.execute('SELECT * FROM eval_case_regressions WHERE comparison_id=? ORDER BY sequence_no,case_key,id',[comparisonId]);
  const [gates]=await db.execute('SELECT * FROM eval_release_gates WHERE comparison_id=? LIMIT 1',[comparisonId]);
  return {...normalizeComparison(rows[0]),cases:cases.map(normalizeCase),gate:gates.length?normalizeGate(gates[0]):null};
};

export const getEvalReleaseGate=async gateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_release_gates WHERE id=?',[gateId]);
  if(!rows.length) throw errorOf('Eval release gate not found','EVAL_RELEASE_GATE_NOT_FOUND',404);
  return normalizeGate(rows[0]);
};

export const compareEvalRuns=async({baselineEvalRunId,candidateEvalRunId,idempotencyKey,policy=null}={})=>{
  if(!baselineEvalRunId||!candidateEvalRunId||!idempotencyKey) throw errorOf(
    'baselineEvalRunId, candidateEvalRunId and idempotencyKey are required','INVALID_EVAL_REGRESSION_COMPARISON'
  );
  if(baselineEvalRunId===candidateEvalRunId) throw errorOf('Baseline and candidate runs must differ','EVAL_REGRESSION_SAME_RUN',409);
  const normalizedPolicy=normalizePolicy(policy);
  const policySha256=sha256({policyVersion:POLICY_VERSION,policy:normalizedPolicy});

  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [byKey]=await conn.execute('SELECT * FROM eval_regression_comparisons WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(byKey.length){
      const row=byKey[0];
      if(row.baseline_eval_run_id!==baselineEvalRunId||row.candidate_eval_run_id!==candidateEvalRunId||row.policy_sha256!==policySha256){
        throw errorOf('Idempotency key already used for another comparison','EVAL_REGRESSION_IDEMPOTENCY_CONFLICT',409);
      }
      await conn.commit();
      return {...await getEvalRegressionComparison(row.id),idempotent:true};
    }
    const [logical]=await conn.execute(
      'SELECT * FROM eval_regression_comparisons WHERE baseline_eval_run_id=? AND candidate_eval_run_id=? AND policy_sha256=? LIMIT 1 FOR UPDATE',
      [baselineEvalRunId,candidateEvalRunId,policySha256]
    );
    if(logical.length){
      await conn.commit();
      return {...await getEvalRegressionComparison(logical[0].id),idempotent:true,deduplicated:true};
    }
    await conn.commit();
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}

  const [baseline,candidate]=await Promise.all([getEvalRun(baselineEvalRunId),getEvalRun(candidateEvalRunId)]);
  if(!['PASS','FAIL'].includes(baseline.status)||!['PASS','FAIL'].includes(candidate.status)){
    throw errorOf('Only terminal PASS/FAIL runs are comparable','EVAL_REGRESSION_RUN_NOT_COMPARABLE',409);
  }
  if(baseline.executionMode!==candidate.executionMode) throw errorOf('Execution modes differ','EVAL_EXECUTION_MODE_MISMATCH',409);

  const [baseManifest,candManifest]=await Promise.all([
    getEvalReplayManifest(baseline.replayManifestId),getEvalReplayManifest(candidate.replayManifestId)
  ]);
  if(baseManifest.suiteVersionId!==candManifest.suiteVersionId) throw errorOf('Suite versions differ','EVAL_REGRESSION_SUITE_VERSION_MISMATCH',409);
  if(baseManifest.fixtureSha256!==candManifest.fixtureSha256) throw errorOf('Fixture SHA differs','EVAL_REGRESSION_FIXTURE_MISMATCH',409);
  if(candManifest.baselineRuntimeSha&&candManifest.baselineRuntimeSha!==baseline.candidateRuntimeSha){
    throw errorOf('Candidate manifest baselineRuntimeSha does not match baseline run','EVAL_BASELINE_SHA_MISMATCH',409);
  }

  const baseMap=new Map(baseline.cases.map(c=>[c.caseKey,c])),candMap=new Map(candidate.cases.map(c=>[c.caseKey,c]));
  const baseKeys=[...baseMap.keys()].sort(),candKeys=[...candMap.keys()].sort();
  if(stableJson(baseKeys)!==stableJson(candKeys)) throw errorOf('Case sets differ','EVAL_REGRESSION_CASE_SET_MISMATCH',409);

  const blockers=[];
  if(normalizedPolicy.requireBaselinePass&&baseline.status!=='PASS') blockers.push({code:'BASELINE_RUN_NOT_PASS',status:baseline.status});
  if(normalizedPolicy.requireCandidatePass&&candidate.status!=='PASS') blockers.push({code:'CANDIDATE_RUN_NOT_PASS',status:candidate.status});

  const caseRows=candidate.cases.map(c=>compareCase(baseMap.get(c.caseKey),c,normalizedPolicy));
  for(const row of caseRows) blockers.push(...row.blockers.map(b=>({caseKey:row.caseKey,...b})));
  const dedup=[...new Map(blockers.map(x=>[stableJson(x),x])).values()];
  const status=dedup.length?'BLOCK':'PASS';

  const summary={
    baseline:{runId:baseline.id,status:baseline.status,runtimeSha:baseline.candidateRuntimeSha,resultSha256:baseline.resultSha256},
    candidate:{runId:candidate.id,status:candidate.status,runtimeSha:candidate.candidateRuntimeSha,resultSha256:candidate.resultSha256},
    caseCount:caseRows.length,
    caseRegressions:caseRows.filter(x=>x.baselineStatus==='PASS'&&x.candidateStatus!=='PASS').length,
    assertionRegressions:caseRows.reduce((n,x)=>n+x.assertionRegressionCount,0),
    routerDrifts:caseRows.filter(x=>x.routerDrift).length,
    evidenceDrifts:caseRows.filter(x=>x.evidenceDrift).length,
    latencyRegressions:caseRows.filter(x=>x.blockers.some(b=>b.code==='LATENCY_REGRESSION')).length,
    costRegressions:caseRows.filter(x=>x.blockers.some(b=>b.code==='COST_REGRESSION'||b.code==='COST_CURRENCY_CHANGED')).length
  };
  const comparisonSha256=sha256({
    baselineEvalRunId,candidateEvalRunId,suiteVersionId:baseManifest.suiteVersionId,
    fixtureSha256:baseManifest.fixtureSha256,policyVersion:POLICY_VERSION,policySha256,status,
    summary,cases:caseRows.map(x=>({caseKey:x.caseKey,diffSha256:x.diffSha256}))
  });

  const comparisonId=randomUUID(),gateId=randomUUID(),gateKey='V2_4_RELEASE';
  const gateSha256=sha256({comparisonSha256,gateKey,decision:status,blockers:dedup,policySha256});
  const write=await db.getConnection();
  try{
    await write.beginTransaction();
    await write.execute(
      `INSERT INTO eval_regression_comparisons
       (id,baseline_eval_run_id,candidate_eval_run_id,suite_version_id,fixture_sha256,baseline_runtime_sha,
        candidate_runtime_sha,policy_version,policy_sha256,policy_json,status,blocker_count,summary_json,comparison_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [comparisonId,baselineEvalRunId,candidateEvalRunId,baseManifest.suiteVersionId,baseManifest.fixtureSha256,
       baseline.candidateRuntimeSha,candidate.candidateRuntimeSha,POLICY_VERSION,policySha256,JSON.stringify(normalizedPolicy),
       status,dedup.length,JSON.stringify(summary),comparisonSha256,idempotencyKey]
    );
    for(const row of caseRows){
      await write.execute(
        `INSERT INTO eval_case_regressions
         (id,comparison_id,case_key,sequence_no,baseline_status,candidate_status,transition,
          assertion_regression_count,assertion_improvement_count,assertion_set_drift,router_drift,evidence_drift,
          baseline_duration_ms,candidate_duration_ms,duration_change_pct,baseline_estimated_cost,candidate_estimated_cost,
          cost_change_pct,cost_currency,blocker_count,blockers_json,diff_json,diff_sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),comparisonId,row.caseKey,row.sequenceNo,row.baselineStatus,row.candidateStatus,row.transition,
         row.assertionRegressionCount,row.assertionImprovementCount,row.assertionSetDrift,row.routerDrift,row.evidenceDrift,
         row.baselineDurationMs,row.candidateDurationMs,row.durationChangePct,row.baselineEstimatedCost,row.candidateEstimatedCost,
         row.costChangePct,row.costCurrency,row.blockers.length,JSON.stringify(row.blockers),JSON.stringify(row.diff),row.diffSha256]
      );
    }
    await write.execute(
      `INSERT INTO eval_release_gates
       (id,comparison_id,gate_key,decision,blocker_count,blockers_json,policy_sha256,gate_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [gateId,comparisonId,gateKey,status,dedup.length,JSON.stringify(dedup),policySha256,gateSha256,`gate:${idempotencyKey}`]
    );
    await write.commit();
  }catch(error){await write.rollback();throw error;}finally{write.release();}
  return {...await getEvalRegressionComparison(comparisonId),idempotent:false};
};

export const EVAL_REGRESSION_POLICY_VERSION=POLICY_VERSION;
