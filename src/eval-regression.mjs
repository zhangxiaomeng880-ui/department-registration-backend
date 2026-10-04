import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalRun } from './eval-runner.mjs';

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
const round6=value=>Number(Number(value).toFixed(6));
const pctChange=(baseline,candidate)=>{
  const b=Number(baseline||0),c=Number(candidate||0);
  if(b===0) return c===0?0:null;
  return round6(((c-b)/b)*100);
};
const executionOf=caseResult=>caseResult?.observedExecution&&typeof caseResult.observedExecution==='object'
  ?caseResult.observedExecution:{};
const assertionKey=x=>`${x.group}::${x.key}`;
const routeSignature=route=>({
  policyResult:route?.policyResult??null,
  routeRuleKey:route?.routeRuleKey??null,
  selectedProviderKey:route?.selectedProviderKey??null,
  selectedModelKey:route?.selectedModelKey??null
});
const normalizeComparison=row=>({
  id:row.id,baselineEvalRunId:row.baseline_eval_run_id,candidateEvalRunId:row.candidate_eval_run_id,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  fixtureSha256:row.fixture_sha256,status:row.status,
  caseRegressions:Number(row.case_regressions),caseImprovements:Number(row.case_improvements),
  assertionRegressions:Number(row.assertion_regressions),assertionImprovements:Number(row.assertion_improvements),
  evidenceRegressions:Number(row.evidence_regressions),routerDrifts:Number(row.router_drifts),
  baselineTotalCost:Number(row.baseline_total_cost),candidateTotalCost:Number(row.candidate_total_cost),
  costChangePct:row.cost_change_pct==null?null:Number(row.cost_change_pct),
  baselineTotalDurationMs:Number(row.baseline_total_duration_ms),
  candidateTotalDurationMs:Number(row.candidate_total_duration_ms),
  latencyChangePct:row.latency_change_pct==null?null:Number(row.latency_change_pct),
  comparisonSha256:row.comparison_sha256,summary:row.summary_json,
  idempotencyKey:row.idempotency_key,createdAt:row.created_at
});
const normalizeCaseDiff=row=>({
  id:row.id,comparisonId:row.comparison_id,caseKey:row.case_key,
  baselineStatus:row.baseline_status,candidateStatus:row.candidate_status,caseTransition:row.case_transition,
  assertionRegressions:Number(row.assertion_regressions),assertionImprovements:Number(row.assertion_improvements),
  evidenceRegressions:Number(row.evidence_regressions),routerDrift:Boolean(row.router_drift),
  baselineCost:Number(row.baseline_cost),candidateCost:Number(row.candidate_cost),
  costChangePct:row.cost_change_pct==null?null:Number(row.cost_change_pct),
  baselineDurationMs:Number(row.baseline_duration_ms),candidateDurationMs:Number(row.candidate_duration_ms),
  latencyChangePct:row.latency_change_pct==null?null:Number(row.latency_change_pct),
  diff:row.diff_json,diffSha256:row.diff_sha256,createdAt:row.created_at
});
const normalizeGate=row=>({
  id:row.id,comparisonId:row.comparison_id,gateKey:row.gate_key,decision:row.decision,
  policy:row.policy_json,blockers:row.blockers_json,policySha256:row.policy_sha256,
  decisionSha256:row.decision_sha256,idempotencyKey:row.idempotency_key,
  decidedAt:row.decided_at,createdAt:row.created_at
});

const compareCase=(baseline,candidate)=>{
  const baselineAssertions=new Map((baseline.assertions||[]).map(x=>[assertionKey(x),x]));
  const candidateAssertions=new Map((candidate.assertions||[]).map(x=>[assertionKey(x),x]));
  const assertionKeys=[...new Set([...baselineAssertions.keys(),...candidateAssertions.keys()])].sort();
  let assertionRegressions=0,assertionImprovements=0,evidenceRegressions=0;
  const assertionDiffs=[];

  for(const key of assertionKeys){
    const b=baselineAssertions.get(key),c=candidateAssertions.get(key);
    if(!b||!c) throw errorOf('Baseline and candidate assertion sets differ','EVAL_COMPARISON_ASSERTION_SET_MISMATCH',409,{
      caseKey:baseline.caseKey,assertionKey:key
    });
    const transition=`${b.status}->${c.status}`;
    if(b.status==='PASS'&&c.status==='FAIL'){
      assertionRegressions++;
      if(c.group==='evidence') evidenceRegressions++;
    }else if(b.status==='FAIL'&&c.status==='PASS'){
      assertionImprovements++;
    }
    if(b.status!==c.status||b.failureCode!==c.failureCode){
      assertionDiffs.push({
        group:c.group,key:c.key,baselineStatus:b.status,candidateStatus:c.status,
        baselineFailureCode:b.failureCode||null,candidateFailureCode:c.failureCode||null,transition
      });
    }
  }

  const bExec=executionOf(baseline),cExec=executionOf(candidate);
  const baselineCost=Number(bExec.estimatedCost||0),candidateCost=Number(cExec.estimatedCost||0);
  const baselineDurationMs=Number(bExec.durationMs||0),candidateDurationMs=Number(cExec.durationMs||0);
  const bRoute=routeSignature(baseline.route),cRoute=routeSignature(candidate.route);
  const routerDrift=!deepEqual(bRoute,cRoute);
  const caseTransition=`${baseline.status}->${candidate.status}`;

  return {
    caseKey:baseline.caseKey,
    baselineStatus:baseline.status,candidateStatus:candidate.status,caseTransition,
    assertionRegressions,assertionImprovements,evidenceRegressions,routerDrift,
    baselineCost,candidateCost,costChangePct:pctChange(baselineCost,candidateCost),
    baselineDurationMs,candidateDurationMs,latencyChangePct:pctChange(baselineDurationMs,candidateDurationMs),
    diff:{
      route:{baseline:bRoute,candidate:cRoute,drift:routerDrift},
      assertions:assertionDiffs,
      execution:{
        baseline:{durationMs:baselineDurationMs,estimatedCost:baselineCost,costCurrency:bExec.costCurrency||null},
        candidate:{durationMs:candidateDurationMs,estimatedCost:candidateCost,costCurrency:cExec.costCurrency||null}
      }
    }
  };
};
const deepEqual=(a,b)=>stableJson(a)===stableJson(b);

export const getEvalRegressionComparison=async comparisonId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_regression_comparisons WHERE id=?',[comparisonId]);
  if(!rows.length) throw errorOf('Eval regression comparison not found','EVAL_COMPARISON_NOT_FOUND',404);
  const [diffs]=await db.execute(
    'SELECT * FROM eval_regression_case_diffs WHERE comparison_id=? ORDER BY case_key,id',[comparisonId]
  );
  return {...normalizeComparison(rows[0]),caseDiffs:diffs.map(normalizeCaseDiff)};
};

export const compareEvalRuns=async({baselineEvalRunId,candidateEvalRunId,idempotencyKey}={})=>{
  if(!baselineEvalRunId||!candidateEvalRunId||!idempotencyKey) throw errorOf(
    'baselineEvalRunId, candidateEvalRunId and idempotencyKey are required','INVALID_EVAL_COMPARISON'
  );
  if(baselineEvalRunId===candidateEvalRunId) throw errorOf('Baseline and candidate Eval Runs must differ','EVAL_COMPARISON_SAME_RUN',409);

  const [baseline,candidate]=await Promise.all([getEvalRun(baselineEvalRunId),getEvalRun(candidateEvalRunId)]);
  if(!['PASS','FAIL'].includes(baseline.status)||!['PASS','FAIL'].includes(candidate.status)) throw errorOf(
    'Only completed PASS/FAIL Eval Runs can be compared','EVAL_COMPARISON_RUN_NOT_COMPLETE',409
  );
  const baselineFixture=baseline.summary?.fixtureSha256||null;
  const candidateFixture=candidate.summary?.fixtureSha256||null;
  if(!baselineFixture||baselineFixture!==candidateFixture) throw errorOf(
    'Baseline and candidate Eval Runs must use the same frozen fixture','EVAL_COMPARISON_FIXTURE_MISMATCH',409,{
      baselineFixtureSha256:baselineFixture,candidateFixtureSha256:candidateFixture
    }
  );
  if(candidate.baselineRuntimeSha&&String(candidate.baselineRuntimeSha).toLowerCase()!==String(baseline.candidateRuntimeSha).toLowerCase()){
    throw errorOf('Candidate Eval Run baseline SHA does not match actual baseline run','EVAL_COMPARISON_BASELINE_SHA_MISMATCH',409,{
      declaredBaselineRuntimeSha:candidate.baselineRuntimeSha,actualBaselineRuntimeSha:baseline.candidateRuntimeSha
    });
  }

  const baselineCases=new Map((baseline.cases||[]).map(x=>[x.caseKey,x]));
  const candidateCases=new Map((candidate.cases||[]).map(x=>[x.caseKey,x]));
  const keys=[...new Set([...baselineCases.keys(),...candidateCases.keys()])].sort();
  if(baselineCases.size!==candidateCases.size||keys.some(k=>!baselineCases.has(k)||!candidateCases.has(k))){
    throw errorOf('Baseline and candidate case sets differ','EVAL_COMPARISON_CASE_SET_MISMATCH',409);
  }

  const caseDiffs=keys.map(key=>compareCase(baselineCases.get(key),candidateCases.get(key)));
  const totals=caseDiffs.reduce((acc,x)=>{
    if(x.baselineStatus==='PASS'&&x.candidateStatus==='FAIL') acc.caseRegressions++;
    if(x.baselineStatus==='FAIL'&&x.candidateStatus==='PASS') acc.caseImprovements++;
    acc.assertionRegressions+=x.assertionRegressions;
    acc.assertionImprovements+=x.assertionImprovements;
    acc.evidenceRegressions+=x.evidenceRegressions;
    if(x.routerDrift) acc.routerDrifts++;
    acc.baselineTotalCost+=x.baselineCost;
    acc.candidateTotalCost+=x.candidateCost;
    acc.baselineTotalDurationMs+=x.baselineDurationMs;
    acc.candidateTotalDurationMs+=x.candidateDurationMs;
    return acc;
  },{
    caseRegressions:0,caseImprovements:0,assertionRegressions:0,assertionImprovements:0,
    evidenceRegressions:0,routerDrifts:0,baselineTotalCost:0,candidateTotalCost:0,
    baselineTotalDurationMs:0,candidateTotalDurationMs:0
  });
  totals.baselineTotalCost=Number(totals.baselineTotalCost.toFixed(10));
  totals.candidateTotalCost=Number(totals.candidateTotalCost.toFixed(10));
  const costChangePct=pctChange(totals.baselineTotalCost,totals.candidateTotalCost);
  const latencyChangePct=pctChange(totals.baselineTotalDurationMs,totals.candidateTotalDurationMs);
  const status=totals.caseRegressions||totals.assertionRegressions||totals.evidenceRegressions?'REGRESSION':'NO_REGRESSION';
  const summary={
    baselineStatus:baseline.status,candidateStatus:candidate.status,
    baselineResultSha256:baseline.resultSha256,candidateResultSha256:candidate.resultSha256,
    baselineFixtureSha256:baselineFixture,candidateFixtureSha256:candidateFixture,
    baselineCostFromZero:false,
    candidateCostFromZero:totals.baselineTotalCost===0&&totals.candidateTotalCost>0,
    baselineLatencyFromZero:false,
    candidateLatencyFromZero:totals.baselineTotalDurationMs===0&&totals.candidateTotalDurationMs>0,
    ...totals,costChangePct,latencyChangePct
  };
  const comparisonHash=sha256({
    baselineEvalRunId,candidateEvalRunId,
    baselineRuntimeSha:baseline.candidateRuntimeSha,candidateRuntimeSha:candidate.candidateRuntimeSha,
    fixtureSha256:baselineFixture,summary,
    cases:caseDiffs.map(x=>({caseKey:x.caseKey,diffSha256:sha256(x)}))
  });

  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute(
      'SELECT * FROM eval_regression_comparisons WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(existing.length){
      const row=existing[0];
      if(row.baseline_eval_run_id!==baselineEvalRunId||row.candidate_eval_run_id!==candidateEvalRunId){
        throw errorOf('Idempotency key was already used for another Eval comparison','EVAL_COMPARISON_IDEMPOTENCY_CONFLICT',409);
      }
      await connection.commit();
      return {...await getEvalRegressionComparison(row.id),idempotent:true};
    }

    const id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_regression_comparisons
       (id,baseline_eval_run_id,candidate_eval_run_id,baseline_runtime_sha,candidate_runtime_sha,fixture_sha256,
        status,case_regressions,case_improvements,assertion_regressions,assertion_improvements,evidence_regressions,
        router_drifts,baseline_total_cost,candidate_total_cost,cost_change_pct,baseline_total_duration_ms,
        candidate_total_duration_ms,latency_change_pct,comparison_sha256,summary_json,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,baselineEvalRunId,candidateEvalRunId,baseline.candidateRuntimeSha,candidate.candidateRuntimeSha,
       baselineFixture,status,totals.caseRegressions,totals.caseImprovements,totals.assertionRegressions,
       totals.assertionImprovements,totals.evidenceRegressions,totals.routerDrifts,
       totals.baselineTotalCost,totals.candidateTotalCost,costChangePct,totals.baselineTotalDurationMs,
       totals.candidateTotalDurationMs,latencyChangePct,comparisonHash,JSON.stringify(summary),idempotencyKey]
    );

    for(const diff of caseDiffs){
      const diffHash=sha256(diff);
      await connection.execute(
        `INSERT INTO eval_regression_case_diffs
         (id,comparison_id,case_key,baseline_status,candidate_status,case_transition,
          assertion_regressions,assertion_improvements,evidence_regressions,router_drift,
          baseline_cost,candidate_cost,cost_change_pct,baseline_duration_ms,candidate_duration_ms,
          latency_change_pct,diff_json,diff_sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),id,diff.caseKey,diff.baselineStatus,diff.candidateStatus,diff.caseTransition,
         diff.assertionRegressions,diff.assertionImprovements,diff.evidenceRegressions,diff.routerDrift,
         diff.baselineCost,diff.candidateCost,diff.costChangePct,diff.baselineDurationMs,diff.candidateDurationMs,
         diff.latencyChangePct,JSON.stringify(diff.diff),diffHash]
      );
    }
    await connection.commit();
    return {...await getEvalRegressionComparison(id),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

const validatePolicy=policy=>{
  if(!policy||typeof policy!=='object'||Array.isArray(policy)) throw errorOf('policy is required','INVALID_EVAL_RELEASE_GATE_POLICY');
  const integerFields=['maxCaseRegressions','maxAssertionRegressions','maxEvidenceRegressions','maxRouterDrifts'];
  for(const key of integerFields){
    const n=Number(policy[key]);
    if(!Number.isInteger(n)||n<0) throw errorOf(`${key} must be a non-negative integer`,'INVALID_EVAL_RELEASE_GATE_POLICY',{field:key});
  }
  for(const key of ['maxCostIncreasePct','maxLatencyIncreasePct']){
    const n=Number(policy[key]);
    if(!Number.isFinite(n)||n<0) throw errorOf(`${key} must be a non-negative number`,'INVALID_EVAL_RELEASE_GATE_POLICY',{field:key});
  }
  if(typeof policy.requireCandidatePass!=='boolean') throw errorOf('requireCandidatePass must be boolean','INVALID_EVAL_RELEASE_GATE_POLICY',{field:'requireCandidatePass'});
  return {
    requireCandidatePass:policy.requireCandidatePass,
    maxCaseRegressions:Number(policy.maxCaseRegressions),
    maxAssertionRegressions:Number(policy.maxAssertionRegressions),
    maxEvidenceRegressions:Number(policy.maxEvidenceRegressions),
    maxRouterDrifts:Number(policy.maxRouterDrifts),
    maxCostIncreasePct:Number(policy.maxCostIncreasePct),
    maxLatencyIncreasePct:Number(policy.maxLatencyIncreasePct)
  };
};

export const getEvalReleaseGate=async gateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_release_gates WHERE id=?',[gateId]);
  if(!rows.length) throw errorOf('Eval release gate not found','EVAL_RELEASE_GATE_NOT_FOUND',404);
  return normalizeGate(rows[0]);
};

export const evaluateEvalReleaseGate=async({comparisonId,gateKey,policy,idempotencyKey}={})=>{
  if(!comparisonId||!gateKey||!idempotencyKey) throw errorOf(
    'comparisonId, gateKey and idempotencyKey are required','INVALID_EVAL_RELEASE_GATE'
  );
  const normalizedPolicy=validatePolicy(policy);
  const comparison=await getEvalRegressionComparison(comparisonId);
  const candidateRun=await getEvalRun(comparison.candidateEvalRunId);
  const blockers=[];
  const add=(code,actual,limit)=>blockers.push({code,actual,limit});

  if(normalizedPolicy.requireCandidatePass&&candidateRun.status!=='PASS') add('CANDIDATE_RUN_NOT_PASS',candidateRun.status,'PASS');
  if(comparison.caseRegressions>normalizedPolicy.maxCaseRegressions) add('CASE_REGRESSION_LIMIT_EXCEEDED',comparison.caseRegressions,normalizedPolicy.maxCaseRegressions);
  if(comparison.assertionRegressions>normalizedPolicy.maxAssertionRegressions) add('ASSERTION_REGRESSION_LIMIT_EXCEEDED',comparison.assertionRegressions,normalizedPolicy.maxAssertionRegressions);
  if(comparison.evidenceRegressions>normalizedPolicy.maxEvidenceRegressions) add('EVIDENCE_REGRESSION_LIMIT_EXCEEDED',comparison.evidenceRegressions,normalizedPolicy.maxEvidenceRegressions);
  if(comparison.routerDrifts>normalizedPolicy.maxRouterDrifts) add('ROUTER_DRIFT_LIMIT_EXCEEDED',comparison.routerDrifts,normalizedPolicy.maxRouterDrifts);

  const summary=comparison.summary||{};
  if(summary.candidateCostFromZero===true&&normalizedPolicy.maxCostIncreasePct>=0){
    add('COST_INCREASE_FROM_ZERO',comparison.candidateTotalCost,0);
  }else if(comparison.costChangePct!=null&&comparison.costChangePct>normalizedPolicy.maxCostIncreasePct){
    add('COST_INCREASE_LIMIT_EXCEEDED',comparison.costChangePct,normalizedPolicy.maxCostIncreasePct);
  }
  if(summary.candidateLatencyFromZero===true&&normalizedPolicy.maxLatencyIncreasePct>=0){
    add('LATENCY_INCREASE_FROM_ZERO',comparison.candidateTotalDurationMs,0);
  }else if(comparison.latencyChangePct!=null&&comparison.latencyChangePct>normalizedPolicy.maxLatencyIncreasePct){
    add('LATENCY_INCREASE_LIMIT_EXCEEDED',comparison.latencyChangePct,normalizedPolicy.maxLatencyIncreasePct);
  }

  const decision=blockers.length?'BLOCK':'PASS';
  const policyHash=sha256(normalizedPolicy);
  const decisionHash=sha256({
    comparisonSha256:comparison.comparisonSha256,gateKey:String(gateKey),
    decision,policySha256:policyHash,blockers
  });
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute(
      'SELECT * FROM eval_release_gates WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(existing.length){
      const row=existing[0];
      if(row.comparison_id!==comparisonId||row.gate_key!==String(gateKey)||row.policy_sha256!==policyHash){
        throw errorOf('Idempotency key was already used for another release gate decision','EVAL_RELEASE_GATE_IDEMPOTENCY_CONFLICT',409);
      }
      await connection.commit();
      return {...normalizeGate(row),idempotent:true};
    }
    const id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_release_gates
       (id,comparison_id,gate_key,decision,policy_json,blockers_json,policy_sha256,decision_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id,comparisonId,String(gateKey),decision,JSON.stringify(normalizedPolicy),JSON.stringify(blockers),
       policyHash,decisionHash,idempotencyKey]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_release_gates WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeGate(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};
