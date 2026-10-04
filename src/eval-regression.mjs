import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalRun } from './eval-runner.mjs';
import { getEvalReplayManifest } from './eval-replay.mjs';

const POLICY_VERSION='regression-gate-v1';
const POLICY=Object.freeze({
  requireCandidateRunPass:true,
  maxLatencyRegressionPct:20,
  minLatencyRegressionMs:100,
  maxCostRegressionPct:10,
  minCostRegressionAbsolute:0.01
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
const pctChange=(b,c)=>{
  b=Number(b||0);c=Number(c||0);
  if(b===0) return c===0?0:null;
  return Number((((c-b)/b)*100).toFixed(6));
};
const assertionMap=items=>new Map((items||[]).map(x=>[`${x.group}:${x.key}`,x]));
const evidenceMap=items=>new Map((items||[]).filter(x=>x?.sourceFileId!=null).map(x=>[
  String(x.sourceFileId),String(x.contentSha256||'').toLowerCase()
]));
const healthRank=value=>({HEALTHY:4,DEGRADED:3,UNKNOWN:2,UNHEALTHY:1,OFFLINE:0})[String(value||'UNKNOWN').toUpperCase()]??2;
const add=(arr,code,details={})=>arr.push({code,...details});

const normalizeComparison=row=>({
  id:row.id,baselineEvalRunId:row.baseline_eval_run_id,candidateEvalRunId:row.candidate_eval_run_id,
  suiteVersionId:row.suite_version_id,fixtureSha256:row.fixture_sha256,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  policyVersion:row.policy_version,policy:row.policy_json,status:row.status,
  blockerCount:Number(row.blocker_count),warningCount:Number(row.warning_count),
  caseRegressions:Number(row.case_regressions),caseImprovements:Number(row.case_improvements),
  assertionRegressions:Number(row.assertion_regressions),assertionImprovements:Number(row.assertion_improvements),
  evidenceRegressions:Number(row.evidence_regressions),routerRegressions:Number(row.router_regressions),
  latencyRegressions:Number(row.latency_regressions),costRegressions:Number(row.cost_regressions),
  summary:row.summary_json,comparisonSha256:row.comparison_sha256,idempotencyKey:row.idempotency_key,
  createdAt:row.created_at
});
const normalizeCase=row=>({
  id:row.id,comparisonId:row.comparison_id,caseKey:row.case_key,sequenceNo:Number(row.sequence_no),
  baselineStatus:row.baseline_status||null,candidateStatus:row.candidate_status||null,
  transition:row.transition,status:row.status,blockerCount:Number(row.blocker_count),
  warningCount:Number(row.warning_count),blockers:row.blockers_json||[],warnings:row.warnings_json||[],
  metrics:row.metrics_json,comparisonSha256:row.comparison_sha256,createdAt:row.created_at
});
const normalizeGate=row=>({
  id:row.id,comparisonId:row.comparison_id,gateKey:row.gate_key,decision:row.decision,
  blockerCount:Number(row.blocker_count),warningCount:Number(row.warning_count),
  blockers:row.blockers_json||[],warnings:row.warnings_json||[],
  policySha256:row.policy_sha256,gateSha256:row.gate_sha256,
  idempotencyKey:row.idempotency_key,decidedAt:row.decided_at,createdAt:row.created_at
});

const compareCase=(baseline,candidate)=>{
  const blockers=[],warnings=[];
  const bStatus=baseline?.status||null,cStatus=candidate?.status||null;
  let transition='UNCHANGED';

  if(!baseline){
    transition='CANDIDATE_ONLY';
    add(warnings,'CANDIDATE_EXTRA_CASE');
  }else if(!candidate){
    transition='CANDIDATE_MISSING';
    add(blockers,'CANDIDATE_CASE_MISSING');
  }else if(bStatus==='PASS'&&cStatus==='FAIL'){
    transition='PASS_TO_FAIL';
    add(blockers,'CASE_PASS_REGRESSION');
  }else if(bStatus==='FAIL'&&cStatus==='PASS'){
    transition='FAIL_TO_PASS';
  }else if(bStatus===cStatus){
    transition=`UNCHANGED_${bStatus||'UNKNOWN'}`;
  }else{
    transition=`${bStatus||'UNKNOWN'}_TO_${cStatus||'UNKNOWN'}`;
  }

  let assertionRegressions=0,assertionImprovements=0,missingAssertions=0;
  if(baseline&&candidate){
    const bm=assertionMap(baseline.assertions),cm=assertionMap(candidate.assertions);
    for(const [key,b] of bm){
      const c=cm.get(key);
      if(!c){
        missingAssertions++;
        add(blockers,'CANDIDATE_ASSERTION_MISSING',{assertion:key});
        continue;
      }
      if(b.status==='PASS'&&c.status==='FAIL'){
        assertionRegressions++;
        add(blockers,'ASSERTION_PASS_REGRESSION',{assertion:key,failureCode:c.failureCode||null});
      }else if(b.status==='FAIL'&&c.status==='PASS'){
        assertionImprovements++;
      }
    }
    for(const key of cm.keys()) if(!bm.has(key)) add(warnings,'CANDIDATE_EXTRA_ASSERTION',{assertion:key});
  }

  let routerRegressions=0;
  if(baseline&&candidate){
    const b=baseline.route||{},c=candidate.route||{};
    if(b.policyResult==='ALLOW'&&c.policyResult==='BLOCK'){
      routerRegressions++;
      add(blockers,'ROUTER_ALLOW_TO_BLOCK',{baseline:b.policyResult,candidate:c.policyResult});
    }
    for(const [field,code] of [
      ['routeRuleKey','ROUTER_ROUTE_RULE_DRIFT'],
      ['selectedProviderKey','ROUTER_PROVIDER_DRIFT'],
      ['selectedModelKey','ROUTER_MODEL_DRIFT']
    ]){
      if((b[field]??null)!==(c[field]??null)){
        routerRegressions++;
        add(blockers,code,{baseline:b[field]??null,candidate:c[field]??null});
      }
    }
    if(healthRank(c.providerHealthStatus)<healthRank(b.providerHealthStatus)){
      routerRegressions++;
      add(blockers,'ROUTER_PROVIDER_HEALTH_REGRESSION',{
        baseline:b.providerHealthStatus??null,candidate:c.providerHealthStatus??null
      });
    }
  }

  let evidenceRegressions=0;
  if(baseline&&candidate){
    const be=baseline.observedEvidence||[],ce=candidate.observedEvidence||[];
    if(ce.length<be.length){
      evidenceRegressions++;
      add(blockers,'EVIDENCE_COUNT_REGRESSION',{baseline:be.length,candidate:ce.length});
    }
    const bm=evidenceMap(be),cm=evidenceMap(ce);
    for(const [sourceFileId,bHash] of bm){
      if(!cm.has(sourceFileId)){
        evidenceRegressions++;
        add(blockers,'EVIDENCE_SOURCE_LOST',{sourceFileId});
      }else if(cm.get(sourceFileId)!==bHash){
        evidenceRegressions++;
        add(blockers,'EVIDENCE_CONTENT_HASH_CHANGED',{
          sourceFileId,baseline:bHash,candidate:cm.get(sourceFileId)
        });
      }
    }
  }

  const bx=baseline?.observedExecution||{},cx=candidate?.observedExecution||{};
  const bDuration=Number(bx.durationMs||0),cDuration=Number(cx.durationMs||0);
  const durationDelta=cDuration-bDuration,latencyPct=pctChange(bDuration,cDuration);
  let latencyRegression=0;
  if(baseline&&candidate&&durationDelta>POLICY.minLatencyRegressionMs &&
     (latencyPct==null||latencyPct>POLICY.maxLatencyRegressionPct)){
    latencyRegression=1;
    add(blockers,'LATENCY_REGRESSION',{baselineMs:bDuration,candidateMs:cDuration,changePct:latencyPct});
  }

  const bCost=Number(bx.estimatedCost||0),cCost=Number(cx.estimatedCost||0);
  const bCurrency=bx.costCurrency||null,cCurrency=cx.costCurrency||null;
  const costDelta=cCost-bCost,costPct=pctChange(bCost,cCost);
  let costRegression=0;
  if(baseline&&candidate&&bCurrency!==cCurrency){
    costRegression=1;
    add(blockers,'COST_CURRENCY_DRIFT',{baseline:bCurrency,candidate:cCurrency});
  }else if(baseline&&candidate&&costDelta>POLICY.minCostRegressionAbsolute &&
           (costPct==null||costPct>POLICY.maxCostRegressionPct)){
    costRegression=1;
    add(blockers,'COST_REGRESSION',{baseline:bCost,candidate:cCost,currency:cCurrency,changePct:costPct});
  }

  const metrics={
    assertionRegressions,assertionImprovements,missingAssertions,routerRegressions,evidenceRegressions,
    latencyRegression,costRegression,
    baselineEvidenceCount:(baseline?.observedEvidence||[]).length,
    candidateEvidenceCount:(candidate?.observedEvidence||[]).length,
    baselineDurationMs:bDuration,candidateDurationMs:cDuration,latencyChangePct:latencyPct,
    baselineEstimatedCost:bCost,candidateEstimatedCost:cCost,costCurrency:cCurrency,costChangePct:costPct,
    improvements:{
      case:bStatus==='FAIL'&&cStatus==='PASS'?1:0,
      assertions:assertionImprovements,
      evidence:baseline&&candidate&&(candidate.observedEvidence||[]).length>(baseline.observedEvidence||[]).length?1:0,
      latency:baseline&&candidate&&cDuration<bDuration?1:0,
      cost:baseline&&candidate&&bCurrency===cCurrency&&cCost<bCost?1:0
    }
  };
  const comparisonSha256=sha256({
    caseKey:candidate?.caseKey||baseline?.caseKey,
    sequenceNo:candidate?.sequenceNo||baseline?.sequenceNo||0,
    baselineResultSha256:baseline?.resultSha256||null,candidateResultSha256:candidate?.resultSha256||null,
    transition,blockers,warnings,metrics
  });
  return {
    caseKey:candidate?.caseKey||baseline?.caseKey,
    sequenceNo:Number(candidate?.sequenceNo||baseline?.sequenceNo||0),
    baselineStatus:bStatus,candidateStatus:cStatus,transition,status:blockers.length?'BLOCK':'PASS',
    blockers,warnings,metrics,comparisonSha256
  };
};

export const getEvalRegressionComparison=async comparisonId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_regression_comparisons WHERE id=?',[comparisonId]);
  if(!rows.length) throw errorOf('Eval regression comparison not found','EVAL_COMPARISON_NOT_FOUND',404);
  const [cases]=await db.execute(
    'SELECT * FROM eval_case_regressions WHERE comparison_id=? ORDER BY sequence_no,case_key,id',[comparisonId]
  );
  return {...normalizeComparison(rows[0]),cases:cases.map(normalizeCase)};
};

export const compareEvalRuns=async({baselineEvalRunId,candidateEvalRunId,idempotencyKey}={})=>{
  if(!baselineEvalRunId||!candidateEvalRunId||!idempotencyKey) throw errorOf(
    'baselineEvalRunId, candidateEvalRunId and idempotencyKey are required','INVALID_EVAL_COMPARISON'
  );
  if(baselineEvalRunId===candidateEvalRunId) throw errorOf(
    'Baseline and candidate eval runs must differ','EVAL_COMPARISON_SAME_RUN',409
  );

  const [baseline,candidate]=await Promise.all([getEvalRun(baselineEvalRunId),getEvalRun(candidateEvalRunId)]);
  if(!['PASS','FAIL'].includes(baseline.status)||!['PASS','FAIL'].includes(candidate.status)){
    throw errorOf('Only completed PASS/FAIL eval runs can be compared','EVAL_COMPARISON_RUN_NOT_COMPLETE',409);
  }
  if(!baseline.resultSha256||!candidate.resultSha256){
    throw errorOf('Both eval runs require result SHA-256','EVAL_COMPARISON_RESULT_HASH_MISSING',409);
  }
  const [bm,cm]=await Promise.all([
    getEvalReplayManifest(baseline.replayManifestId),getEvalReplayManifest(candidate.replayManifestId)
  ]);
  if(bm.suiteVersionId!==cm.suiteVersionId||bm.fixtureSha256!==cm.fixtureSha256){
    throw errorOf('Baseline and candidate must use the same frozen fixture','EVAL_COMPARISON_FIXTURE_MISMATCH',409,{
      baselineSuiteVersionId:bm.suiteVersionId,candidateSuiteVersionId:cm.suiteVersionId,
      baselineFixtureSha256:bm.fixtureSha256,candidateFixtureSha256:cm.fixtureSha256
    });
  }

  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [idem]=await connection.execute(
      'SELECT * FROM eval_regression_comparisons WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(idem.length){
      const row=idem[0];
      if(row.baseline_eval_run_id!==baselineEvalRunId||row.candidate_eval_run_id!==candidateEvalRunId){
        throw errorOf('Idempotency key was already used for another comparison','EVAL_COMPARISON_IDEMPOTENCY_CONFLICT',409);
      }
      await connection.commit();
      return {...await getEvalRegressionComparison(row.id),idempotent:true};
    }
    const [pair]=await connection.execute(
      `SELECT * FROM eval_regression_comparisons
       WHERE baseline_eval_run_id=? AND candidate_eval_run_id=? AND policy_version=? LIMIT 1 FOR UPDATE`,
      [baselineEvalRunId,candidateEvalRunId,POLICY_VERSION]
    );
    if(pair.length){
      await connection.commit();
      return {...await getEvalRegressionComparison(pair[0].id),idempotent:true};
    }

    const baseMap=new Map(baseline.cases.map(x=>[x.caseKey,x]));
    const candMap=new Map(candidate.cases.map(x=>[x.caseKey,x]));
    const keys=[...new Set([...baseMap.keys(),...candMap.keys()])].sort((a,b)=>{
      const an=candMap.get(a)?.sequenceNo||baseMap.get(a)?.sequenceNo||0;
      const bn=candMap.get(b)?.sequenceNo||baseMap.get(b)?.sequenceNo||0;
      return an-bn||a.localeCompare(b);
    });
    const cases=keys.map(key=>compareCase(baseMap.get(key),candMap.get(key)));

    const blockers=[],warnings=[];
    if(POLICY.requireCandidateRunPass&&candidate.status!=='PASS'){
      add(blockers,'CANDIDATE_RUN_NOT_PASS',{candidateStatus:candidate.status});
    }
    for(const item of cases){
      for(const signal of item.blockers) blockers.push({caseKey:item.caseKey,...signal});
      for(const signal of item.warnings) warnings.push({caseKey:item.caseKey,...signal});
    }
    const totals={
      caseRegressions:cases.filter(x=>['PASS_TO_FAIL','CANDIDATE_MISSING'].includes(x.transition)).length,
      caseImprovements:cases.filter(x=>x.transition==='FAIL_TO_PASS').length,
      assertionRegressions:cases.reduce((n,x)=>n+x.metrics.assertionRegressions+x.metrics.missingAssertions,0),
      assertionImprovements:cases.reduce((n,x)=>n+x.metrics.assertionImprovements,0),
      evidenceRegressions:cases.reduce((n,x)=>n+x.metrics.evidenceRegressions,0),
      routerRegressions:cases.reduce((n,x)=>n+x.metrics.routerRegressions,0),
      latencyRegressions:cases.reduce((n,x)=>n+x.metrics.latencyRegression,0),
      costRegressions:cases.reduce((n,x)=>n+x.metrics.costRegression,0)
    };
    const status=blockers.length?'BLOCK':'PASS';
    const policySha256=sha256(POLICY);
    const summary={
      baseline:{runId:baseline.id,status:baseline.status,resultSha256:baseline.resultSha256,runtimeSha:baseline.candidateRuntimeSha},
      candidate:{runId:candidate.id,status:candidate.status,resultSha256:candidate.resultSha256,runtimeSha:candidate.candidateRuntimeSha},
      fixtureSha256:bm.fixtureSha256,policySha256,caseCount:cases.length,
      blockerCount:blockers.length,warningCount:warnings.length,...totals,blockers,warnings
    };
    const comparisonSha256=sha256({
      baselineResultSha256:baseline.resultSha256,candidateResultSha256:candidate.resultSha256,
      fixtureSha256:bm.fixtureSha256,policyVersion:POLICY_VERSION,policySha256,status,
      cases:cases.map(x=>({caseKey:x.caseKey,comparisonSha256:x.comparisonSha256}))
    });
    const id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_regression_comparisons
       (id,baseline_eval_run_id,candidate_eval_run_id,suite_version_id,fixture_sha256,
        baseline_runtime_sha,candidate_runtime_sha,policy_version,policy_json,status,blocker_count,warning_count,
        case_regressions,case_improvements,assertion_regressions,assertion_improvements,
        evidence_regressions,router_regressions,latency_regressions,cost_regressions,
        summary_json,comparison_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,baselineEvalRunId,candidateEvalRunId,bm.suiteVersionId,bm.fixtureSha256,
       baseline.candidateRuntimeSha,candidate.candidateRuntimeSha,POLICY_VERSION,JSON.stringify(POLICY),status,
       blockers.length,warnings.length,totals.caseRegressions,totals.caseImprovements,
       totals.assertionRegressions,totals.assertionImprovements,totals.evidenceRegressions,
       totals.routerRegressions,totals.latencyRegressions,totals.costRegressions,
       JSON.stringify(summary),comparisonSha256,idempotencyKey]
    );
    for(const item of cases){
      await connection.execute(
        `INSERT INTO eval_case_regressions
         (id,comparison_id,case_key,sequence_no,baseline_status,candidate_status,transition,status,
          blocker_count,warning_count,blockers_json,warnings_json,metrics_json,comparison_sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),id,item.caseKey,item.sequenceNo,item.baselineStatus,item.candidateStatus,item.transition,item.status,
         item.blockers.length,item.warnings.length,JSON.stringify(item.blockers),JSON.stringify(item.warnings),
         JSON.stringify(item.metrics),item.comparisonSha256]
      );
    }
    await connection.commit();
    return {...await getEvalRegressionComparison(id),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const getEvalReleaseGate=async gateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_release_gates WHERE id=?',[gateId]);
  if(!rows.length) throw errorOf('Eval release gate not found','EVAL_RELEASE_GATE_NOT_FOUND',404);
  return normalizeGate(rows[0]);
};

export const createEvalReleaseGate=async({comparisonId,gateKey='RUNTIME_RELEASE',idempotencyKey}={})=>{
  if(!comparisonId||!idempotencyKey) throw errorOf(
    'comparisonId and idempotencyKey are required','INVALID_EVAL_RELEASE_GATE'
  );
  const comparison=await getEvalRegressionComparison(comparisonId);
  const blockers=comparison.summary?.blockers||[],warnings=comparison.summary?.warnings||[];
  const decision=comparison.status==='PASS'?'PASS':'BLOCK';
  const policySha256=sha256(comparison.policy);
  const gateSha256=sha256({
    comparisonSha256:comparison.comparisonSha256,gateKey,decision,blockers,warnings,policySha256
  });
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [idem]=await connection.execute(
      'SELECT * FROM eval_release_gates WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(idem.length){
      const row=idem[0];
      if(row.comparison_id!==comparisonId||row.gate_key!==gateKey){
        throw errorOf('Idempotency key was already used for another release gate','EVAL_RELEASE_GATE_IDEMPOTENCY_CONFLICT',409);
      }
      await connection.commit();
      return {...normalizeGate(row),idempotent:true};
    }
    const [existing]=await connection.execute(
      'SELECT * FROM eval_release_gates WHERE comparison_id=? AND gate_key=? LIMIT 1 FOR UPDATE',[comparisonId,gateKey]
    );
    if(existing.length){
      await connection.commit();
      return {...normalizeGate(existing[0]),idempotent:true};
    }
    const id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_release_gates
       (id,comparison_id,gate_key,decision,blocker_count,warning_count,blockers_json,warnings_json,
        policy_sha256,gate_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id,comparisonId,gateKey,decision,blockers.length,warnings.length,
       JSON.stringify(blockers),JSON.stringify(warnings),policySha256,gateSha256,idempotencyKey]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_release_gates WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeGate(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const enforceEvalReleaseGate=async gateId=>{
  const gate=await getEvalReleaseGate(gateId);
  if(gate.decision!=='PASS') throw errorOf(
    'Eval release gate blocked the release','EVAL_RELEASE_GATE_BLOCKED',409,{
      gateId:gate.id,blockerCount:gate.blockerCount,blockers:gate.blockers
    }
  );
  return gate;
};

export const EVAL_REGRESSION_POLICY_VERSION=POLICY_VERSION;
export const EVAL_REGRESSION_POLICY=POLICY;
