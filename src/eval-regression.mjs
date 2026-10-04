import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalRun } from './eval-runner.mjs';
import { getEvalReplayManifest } from './eval-replay.mjs';

const SHA64=/^[a-f0-9]{64}$/i;
const POLICY_VERSION='eval-regression-strict-v1';
const STRICT_V1=Object.freeze({
  version:POLICY_VERSION,
  blockOnCandidateEvalFailure:true,
  blockOnCaseSetDrift:true,
  blockOnNewCaseFailure:true,
  blockOnNewAssertionFailure:true,
  blockOnAssertionSetDrift:true,
  blockOnRouterDrift:true,
  blockOnEvidenceDrift:true,
  requireSameCostCurrency:true,
  maxDurationIncreasePct:25,
  durationIncreaseFloorMs:100,
  maxEstimatedCostIncreasePct:15,
  estimatedCostIncreaseFloor:0.001
});

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const deepEqual=(a,b)=>stableJson(a)===stableJson(b);
const numberOrNull=value=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
};
const pctChange=(baseline,candidate)=>{
  if(baseline==null||candidate==null) return null;
  if(baseline===0) return candidate===0?0:null;
  return ((candidate-baseline)/baseline)*100;
};
const normalizePct=value=>value==null?null:Number(value.toFixed(6));
const routerFingerprint=route=>({
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
const assertionMap=assertions=>new Map(
  (Array.isArray(assertions)?assertions:[]).map(item=>[`${item.group}::${item.key}`,item])
);
const addBlocker=(items,code,caseKey=null,details=null)=>items.push({code,caseKey,details});

const loadRunContext=async runId=>{
  const run=await getEvalRun(runId);
  if(!['PASS','FAIL'].includes(run.status)||!SHA64.test(run.resultSha256||'')){
    throw errorOf('Eval runs must be terminal and hashed before comparison','EVAL_RUN_NOT_COMPARABLE',409,{runId,status:run.status});
  }
  const manifest=await getEvalReplayManifest(run.replayManifestId);
  if(manifest.candidateRuntimeSha!==run.candidateRuntimeSha){
    throw errorOf('Eval run candidate SHA does not match its replay manifest','EVAL_RUN_MANIFEST_SHA_MISMATCH',500,{runId});
  }
  return {run,manifest};
};

const validateCompatibility=(baseline,candidate)=>{
  if(baseline.manifest.suiteVersionId!==candidate.manifest.suiteVersionId){
    throw errorOf('Baseline and candidate must use the same frozen suite version','EVAL_COMPARISON_SUITE_MISMATCH',409);
  }
  if(baseline.manifest.fixtureSha256!==candidate.manifest.fixtureSha256){
    throw errorOf('Baseline and candidate fixture SHA-256 must match','EVAL_COMPARISON_FIXTURE_MISMATCH',409);
  }
  if(baseline.run.executionMode!==candidate.run.executionMode){
    throw errorOf('Baseline and candidate execution modes must match','EVAL_COMPARISON_MODE_MISMATCH',409);
  }
  if(candidate.manifest.baselineRuntimeSha!==baseline.run.candidateRuntimeSha){
    throw errorOf('Candidate manifest baselineRuntimeSha does not match baseline run SHA','EVAL_BASELINE_SHA_MISMATCH',409,{
      declaredBaselineRuntimeSha:candidate.manifest.baselineRuntimeSha,
      baselineRunSha:baseline.run.candidateRuntimeSha
    });
  }
  if(candidate.run.candidateRuntimeSha===baseline.run.candidateRuntimeSha){
    throw errorOf('Candidate and baseline runtime SHAs must differ','EVAL_COMPARISON_SAME_RUNTIME',409);
  }
};

const compareCase=({baselineCase,candidateCase})=>{
  const caseKey=candidateCase?.caseKey||baselineCase?.caseKey||'UNKNOWN';
  const sequenceNo=Number(candidateCase?.sequenceNo??baselineCase?.sequenceNo??0);
  const blockers=[];
  if(!baselineCase||!candidateCase){
    addBlocker(blockers,'CASE_SET_DRIFT',caseKey,{
      baselinePresent:Boolean(baselineCase),candidatePresent:Boolean(candidateCase)
    });
    return {
      caseKey,sequenceNo,baselineStatus:baselineCase?.status||null,candidateStatus:candidateCase?.status||null,
      transition:!baselineCase?'ADDED':!candidateCase?'MISSING':'UNKNOWN',
      assertionRegressionCount:0,assertionImprovementCount:0,assertionSetDrift:true,
      routerDrift:false,evidenceDrift:false,
      baselineDurationMs:numberOrNull(baselineCase?.observedExecution?.durationMs),
      candidateDurationMs:numberOrNull(candidateCase?.observedExecution?.durationMs),
      durationChangePct:null,baselineEstimatedCost:numberOrNull(baselineCase?.observedExecution?.estimatedCost),
      candidateEstimatedCost:numberOrNull(candidateCase?.observedExecution?.estimatedCost),
      costChangePct:null,costCurrency:candidateCase?.observedExecution?.costCurrency||baselineCase?.observedExecution?.costCurrency||null,
      blockers,diff:{caseSetDrift:true}
    };
  }

  const transition=baselineCase.status===candidateCase.status?'STABLE':
    baselineCase.status==='PASS'&&candidateCase.status==='FAIL'?'REGRESSED':
    baselineCase.status==='FAIL'&&candidateCase.status==='PASS'?'IMPROVED':'CHANGED';
  if(baselineCase.status==='PASS'&&candidateCase.status==='FAIL'){
    addBlocker(blockers,'NEW_CASE_FAILURE',caseKey,{baselineStatus:baselineCase.status,candidateStatus:candidateCase.status});
  }

  const baselineAssertions=assertionMap(baselineCase.assertions);
  const candidateAssertions=assertionMap(candidateCase.assertions);
  const assertionKeys=[...new Set([...baselineAssertions.keys(),...candidateAssertions.keys()])].sort();
  let assertionRegressionCount=0,assertionImprovementCount=0,assertionSetDrift=false;
  const assertionDiffs=[];
  for(const key of assertionKeys){
    const before=baselineAssertions.get(key),after=candidateAssertions.get(key);
    if(!before||!after){
      assertionSetDrift=true;
      assertionDiffs.push({key,baselineStatus:before?.status||null,candidateStatus:after?.status||null,transition:'SET_DRIFT'});
      continue;
    }
    let assertionTransition='STABLE';
    if(before.status==='PASS'&&after.status==='FAIL'){assertionRegressionCount++;assertionTransition='REGRESSED';}
    else if(before.status==='FAIL'&&after.status==='PASS'){assertionImprovementCount++;assertionTransition='IMPROVED';}
    else if(before.status!==after.status) assertionTransition='CHANGED';
    assertionDiffs.push({
      key,baselineStatus:before.status,candidateStatus:after.status,transition:assertionTransition,
      baselineFailureCode:before.failureCode||null,candidateFailureCode:after.failureCode||null
    });
  }
  if(assertionRegressionCount>0) addBlocker(blockers,'NEW_ASSERTION_FAILURE',caseKey,{count:assertionRegressionCount});
  if(assertionSetDrift) addBlocker(blockers,'ASSERTION_SET_DRIFT',caseKey);

  const baselineRouter=routerFingerprint(baselineCase.route);
  const candidateRouter=routerFingerprint(candidateCase.route);
  const routerDrift=!deepEqual(baselineRouter,candidateRouter);
  if(routerDrift) addBlocker(blockers,'ROUTER_DRIFT',caseKey,{baseline:baselineRouter,candidate:candidateRouter});

  const baselineEvidence=evidenceFingerprint(baselineCase.observedEvidence);
  const candidateEvidence=evidenceFingerprint(candidateCase.observedEvidence);
  const evidenceDrift=!deepEqual(baselineEvidence,candidateEvidence);
  if(evidenceDrift) addBlocker(blockers,'EVIDENCE_DRIFT',caseKey,{
    baselineSha256:sha256(baselineEvidence),candidateSha256:sha256(candidateEvidence)
  });

  const baselineDurationMs=numberOrNull(baselineCase.observedExecution?.durationMs);
  const candidateDurationMs=numberOrNull(candidateCase.observedExecution?.durationMs);
  const durationDelta=baselineDurationMs==null||candidateDurationMs==null?null:candidateDurationMs-baselineDurationMs;
  const durationChangePct=normalizePct(pctChange(baselineDurationMs,candidateDurationMs));
  const durationRegression=durationDelta!=null&&durationDelta>STRICT_V1.durationIncreaseFloorMs&&(
    baselineDurationMs===0?candidateDurationMs>0:durationChangePct>STRICT_V1.maxDurationIncreasePct
  );
  if(durationRegression) addBlocker(blockers,'DURATION_REGRESSION',caseKey,{
    baselineDurationMs,candidateDurationMs,durationChangePct,
    maxDurationIncreasePct:STRICT_V1.maxDurationIncreasePct,
    durationIncreaseFloorMs:STRICT_V1.durationIncreaseFloorMs
  });

  const baselineEstimatedCost=numberOrNull(baselineCase.observedExecution?.estimatedCost);
  const candidateEstimatedCost=numberOrNull(candidateCase.observedExecution?.estimatedCost);
  const baselineCurrency=baselineCase.observedExecution?.costCurrency||null;
  const candidateCurrency=candidateCase.observedExecution?.costCurrency||null;
  const costCurrency=candidateCurrency||baselineCurrency;
  if(baselineCurrency!==candidateCurrency){
    addBlocker(blockers,'COST_CURRENCY_MISMATCH',caseKey,{baselineCurrency,candidateCurrency});
  }
  const costDelta=baselineEstimatedCost==null||candidateEstimatedCost==null?null:candidateEstimatedCost-baselineEstimatedCost;
  const costChangePct=normalizePct(pctChange(baselineEstimatedCost,candidateEstimatedCost));
  const costRegression=baselineCurrency===candidateCurrency&&costDelta!=null&&costDelta>STRICT_V1.estimatedCostIncreaseFloor&&(
    baselineEstimatedCost===0?candidateEstimatedCost>0:costChangePct>STRICT_V1.maxEstimatedCostIncreasePct
  );
  if(costRegression) addBlocker(blockers,'COST_REGRESSION',caseKey,{
    baselineEstimatedCost,candidateEstimatedCost,costChangePct,costCurrency,
    maxEstimatedCostIncreasePct:STRICT_V1.maxEstimatedCostIncreasePct,
    estimatedCostIncreaseFloor:STRICT_V1.estimatedCostIncreaseFloor
  });

  return {
    caseKey,sequenceNo,baselineStatus:baselineCase.status,candidateStatus:candidateCase.status,transition,
    assertionRegressionCount,assertionImprovementCount,assertionSetDrift,routerDrift,evidenceDrift,
    baselineDurationMs,candidateDurationMs,durationChangePct,
    baselineEstimatedCost,candidateEstimatedCost,costChangePct,costCurrency,
    blockers,
    diff:{assertionDiffs,baselineRouter,candidateRouter,baselineEvidence,candidateEvidence}
  };
};

const normalizeComparison=row=>({
  id:row.id,baselineEvalRunId:row.baseline_eval_run_id,candidateEvalRunId:row.candidate_eval_run_id,
  suiteVersionId:row.suite_version_id,fixtureSha256:row.fixture_sha256,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  policyVersion:row.policy_version,policySha256:row.policy_sha256,status:row.status,
  blockerCount:Number(row.blocker_count),summary:row.summary_json,comparisonSha256:row.comparison_sha256,
  idempotencyKey:row.idempotency_key,createdAt:row.created_at
});
const normalizeCaseDiff=row=>({
  id:row.id,comparisonId:row.comparison_id,caseKey:row.case_key,sequenceNo:Number(row.sequence_no),
  baselineStatus:row.baseline_status||null,candidateStatus:row.candidate_status||null,transition:row.transition,
  assertionRegressionCount:Number(row.assertion_regression_count),
  assertionImprovementCount:Number(row.assertion_improvement_count),
  assertionSetDrift:Boolean(row.assertion_set_drift),routerDrift:Boolean(row.router_drift),
  evidenceDrift:Boolean(row.evidence_drift),
  baselineDurationMs:row.baseline_duration_ms==null?null:Number(row.baseline_duration_ms),
  candidateDurationMs:row.candidate_duration_ms==null?null:Number(row.candidate_duration_ms),
  durationChangePct:row.duration_change_pct==null?null:Number(row.duration_change_pct),
  baselineEstimatedCost:row.baseline_estimated_cost==null?null:Number(row.baseline_estimated_cost),
  candidateEstimatedCost:row.candidate_estimated_cost==null?null:Number(row.candidate_estimated_cost),
  costChangePct:row.cost_change_pct==null?null:Number(row.cost_change_pct),costCurrency:row.cost_currency||null,
  blockerCount:Number(row.blocker_count),blockers:row.blockers_json,diff:row.diff_json,
  diffSha256:row.diff_sha256,createdAt:row.created_at
});
const normalizeGate=row=>({
  id:row.id,comparisonId:row.comparison_id,gateKey:row.gate_key,decision:row.decision,
  blockerCount:Number(row.blocker_count),blockers:row.blockers_json,gateSha256:row.gate_sha256,
  idempotencyKey:row.idempotency_key,decidedAt:row.decided_at,createdAt:row.created_at
});

export const getEvalRegressionComparison=async comparisonId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_regression_comparisons WHERE id=?',[comparisonId]);
  if(!rows.length) throw errorOf('Eval regression comparison not found','EVAL_COMPARISON_NOT_FOUND',404);
  const [caseRows]=await db.execute(
    'SELECT * FROM eval_case_regressions WHERE comparison_id=? ORDER BY sequence_no,case_key,id',[comparisonId]
  );
  const [gateRows]=await db.execute('SELECT * FROM eval_release_gates WHERE comparison_id=? LIMIT 1',[comparisonId]);
  return {
    ...normalizeComparison(rows[0]),
    policy:STRICT_V1,
    cases:caseRows.map(normalizeCaseDiff),
    releaseGate:gateRows.length?normalizeGate(gateRows[0]):null
  };
};

export const compareEvalRuns=async({baselineEvalRunId,candidateEvalRunId,idempotencyKey}={})=>{
  if(!baselineEvalRunId||!candidateEvalRunId||!idempotencyKey){
    throw errorOf('baselineEvalRunId, candidateEvalRunId and idempotencyKey are required','INVALID_EVAL_COMPARISON');
  }
  if(baselineEvalRunId===candidateEvalRunId){
    throw errorOf('Baseline and candidate eval runs must differ','INVALID_EVAL_COMPARISON',409);
  }

  const [baseline,candidate]=await Promise.all([
    loadRunContext(baselineEvalRunId),loadRunContext(candidateEvalRunId)
  ]);
  validateCompatibility(baseline,candidate);

  const baselineCases=new Map(baseline.run.cases.map(item=>[item.caseKey,item]));
  const candidateCases=new Map(candidate.run.cases.map(item=>[item.caseKey,item]));
  const keys=[...new Set([...baselineCases.keys(),...candidateCases.keys()])].sort((a,b)=>{
    const aa=candidateCases.get(a)?.sequenceNo??baselineCases.get(a)?.sequenceNo??0;
    const bb=candidateCases.get(b)?.sequenceNo??baselineCases.get(b)?.sequenceNo??0;
    return aa-bb||a.localeCompare(b);
  });
  const diffs=keys.map(key=>compareCase({
    baselineCase:baselineCases.get(key),candidateCase:candidateCases.get(key)
  }));

  const blockers=[];
  if(candidate.run.status!=='PASS'){
    addBlocker(blockers,'CANDIDATE_EVAL_NOT_PASS',null,{candidateStatus:candidate.run.status});
  }
  for(const diff of diffs) blockers.push(...diff.blockers);
  const decision=blockers.length?'BLOCK':'PASS';
  const policySha256=sha256(STRICT_V1);
  const caseDiffHashes=diffs.map(diff=>({
    caseKey:diff.caseKey,sequenceNo:diff.sequenceNo,
    diffSha256:sha256({
      baselineStatus:diff.baselineStatus,candidateStatus:diff.candidateStatus,transition:diff.transition,
      assertionRegressionCount:diff.assertionRegressionCount,
      assertionImprovementCount:diff.assertionImprovementCount,
      assertionSetDrift:diff.assertionSetDrift,routerDrift:diff.routerDrift,evidenceDrift:diff.evidenceDrift,
      baselineDurationMs:diff.baselineDurationMs,candidateDurationMs:diff.candidateDurationMs,
      durationChangePct:diff.durationChangePct,baselineEstimatedCost:diff.baselineEstimatedCost,
      candidateEstimatedCost:diff.candidateEstimatedCost,costChangePct:diff.costChangePct,
      costCurrency:diff.costCurrency,blockers:diff.blockers,diff:diff.diff
    })
  }));
  const summary={
    executionMode:candidate.run.executionMode,
    baselineStatus:baseline.run.status,candidateStatus:candidate.run.status,
    caseCount:diffs.length,
    caseRegressions:diffs.filter(x=>x.transition==='REGRESSED').length,
    caseImprovements:diffs.filter(x=>x.transition==='IMPROVED').length,
    assertionRegressions:diffs.reduce((sum,x)=>sum+x.assertionRegressionCount,0),
    assertionImprovements:diffs.reduce((sum,x)=>sum+x.assertionImprovementCount,0),
    assertionSetDrifts:diffs.filter(x=>x.assertionSetDrift).length,
    routerDrifts:diffs.filter(x=>x.routerDrift).length,
    evidenceDrifts:diffs.filter(x=>x.evidenceDrift).length,
    durationRegressions:blockers.filter(x=>x.code==='DURATION_REGRESSION').length,
    costRegressions:blockers.filter(x=>x.code==='COST_REGRESSION').length,
    candidateResultSha256:candidate.run.resultSha256,
    baselineResultSha256:baseline.run.resultSha256
  };
  const comparisonSha256=sha256({
    policySha256,fixtureSha256:candidate.manifest.fixtureSha256,
    baselineEvalRunId,candidateEvalRunId,
    baselineRuntimeSha:baseline.run.candidateRuntimeSha,candidateRuntimeSha:candidate.run.candidateRuntimeSha,
    baselineResultSha256:baseline.run.resultSha256,candidateResultSha256:candidate.run.resultSha256,
    decision,summary,cases:caseDiffHashes
  });

  const db=getRuntimePool(),conn=await db.getConnection();
  let comparisonId;
  try{
    await conn.beginTransaction();
    const [byKey]=await conn.execute(
      'SELECT * FROM eval_regression_comparisons WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(byKey.length){
      const row=byKey[0];
      if(row.baseline_eval_run_id!==baselineEvalRunId||row.candidate_eval_run_id!==candidateEvalRunId||row.policy_version!==POLICY_VERSION){
        throw errorOf('Idempotency key was already used for another comparison','EVAL_COMPARISON_IDEMPOTENCY_CONFLICT',409);
      }
      await conn.commit();
      return {...await getEvalRegressionComparison(row.id),idempotent:true};
    }
    const [byPair]=await conn.execute(
      'SELECT * FROM eval_regression_comparisons WHERE baseline_eval_run_id=? AND candidate_eval_run_id=? AND policy_version=? LIMIT 1 FOR UPDATE',
      [baselineEvalRunId,candidateEvalRunId,POLICY_VERSION]
    );
    if(byPair.length){
      await conn.commit();
      return {...await getEvalRegressionComparison(byPair[0].id),idempotent:true,deduplicated:true};
    }

    comparisonId=randomUUID();
    await conn.execute(
      `INSERT INTO eval_regression_comparisons
       (id,baseline_eval_run_id,candidate_eval_run_id,suite_version_id,fixture_sha256,baseline_runtime_sha,
        candidate_runtime_sha,policy_version,policy_sha256,status,blocker_count,summary_json,comparison_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [comparisonId,baselineEvalRunId,candidateEvalRunId,candidate.manifest.suiteVersionId,candidate.manifest.fixtureSha256,
       baseline.run.candidateRuntimeSha,candidate.run.candidateRuntimeSha,POLICY_VERSION,policySha256,decision,
       blockers.length,JSON.stringify(summary),comparisonSha256,idempotencyKey]
    );

    for(const [index,diff] of diffs.entries()){
      const diffSha256=caseDiffHashes[index].diffSha256;
      await conn.execute(
        `INSERT INTO eval_case_regressions
         (id,comparison_id,case_key,sequence_no,baseline_status,candidate_status,transition,
          assertion_regression_count,assertion_improvement_count,assertion_set_drift,router_drift,evidence_drift,
          baseline_duration_ms,candidate_duration_ms,duration_change_pct,baseline_estimated_cost,candidate_estimated_cost,
          cost_change_pct,cost_currency,blocker_count,blockers_json,diff_json,diff_sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),comparisonId,diff.caseKey,diff.sequenceNo,diff.baselineStatus,diff.candidateStatus,diff.transition,
         diff.assertionRegressionCount,diff.assertionImprovementCount,diff.assertionSetDrift,diff.routerDrift,diff.evidenceDrift,
         diff.baselineDurationMs,diff.candidateDurationMs,diff.durationChangePct,diff.baselineEstimatedCost,
         diff.candidateEstimatedCost,diff.costChangePct,diff.costCurrency,diff.blockers.length,
         JSON.stringify(diff.blockers),JSON.stringify(diff.diff),diffSha256]
      );
    }

    const gateId=randomUUID();
    const gateIdempotencyKey=`m243-gate:${comparisonId}`;
    const gateSha256=sha256({
      gateKey:'V2_4_RELEASE',comparisonSha256,policySha256,decision,blockers
    });
    await conn.execute(
      `INSERT INTO eval_release_gates
       (id,comparison_id,gate_key,decision,blocker_count,blockers_json,gate_sha256,idempotency_key)
       VALUES (?,?,'V2_4_RELEASE',?,?,?,?,?)`,
      [gateId,comparisonId,decision,blockers.length,JSON.stringify(blockers),gateSha256,gateIdempotencyKey]
    );
    await conn.commit();
    return {...await getEvalRegressionComparison(comparisonId),idempotent:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
};

export const EVAL_REGRESSION_POLICY=STRICT_V1;
