import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalRun } from './eval-runner.mjs';
import { getEvalReplayManifest } from './eval-replay.mjs';

const POLICY_VERSION='eval-release-gate-v1';
const DEFAULT_POLICY=Object.freeze({
  requireBaselinePass:true,
  requireCandidatePass:true,
  maxCasePassRateDropPct:0,
  maxAssertionPassRateDropPct:0,
  maxStructuredOutputPassRateDropPct:0,
  maxEvidencePassRateDropPct:0,
  maxRouterPassRateDropPct:0,
  blockOnRouteDrift:true,
  blockOnNewFailureCodes:true,
  warnP95DurationIncreasePct:10,
  maxP95DurationIncreasePct:20,
  warnCostIncreasePct:10,
  maxCostIncreasePct:20
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
const round=value=>Number(Number(value||0).toFixed(6));
const pct=(num,den)=>den>0?round((num/den)*100):100;
const dropPct=(baseline,candidate)=>round(Number(baseline||0)-Number(candidate||0));
const increasePct=(candidate,baseline)=>{
  const c=Number(candidate||0),b=Number(baseline||0);
  if(b===0) return c===0?0:null;
  return round(((c-b)/b)*100);
};
const p95=values=>{
  const nums=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return nums.length?nums[Math.max(0,Math.ceil(nums.length*0.95)-1)]:0;
};
const routeFingerprint=route=>({
  matched:Boolean(route?.matched),
  policyResult:route?.policyResult||null,
  routeRuleKey:route?.routeRuleKey||null,
  selectedProviderKey:route?.selectedProviderKey||null,
  selectedModelKey:route?.selectedModelKey||null,
  providerHealthStatus:route?.providerHealthStatus||null
});
const normalizePolicy=input=>{
  const policy={...DEFAULT_POLICY,...(input&&typeof input==='object'&&!Array.isArray(input)?input:{})};
  for(const key of [
    'maxCasePassRateDropPct','maxAssertionPassRateDropPct','maxStructuredOutputPassRateDropPct',
    'maxEvidencePassRateDropPct','maxRouterPassRateDropPct','warnP95DurationIncreasePct',
    'maxP95DurationIncreasePct','warnCostIncreasePct','maxCostIncreasePct'
  ]){
    const value=Number(policy[key]);
    if(!Number.isFinite(value)||value<0) throw errorOf('Regression thresholds must be non-negative','INVALID_REGRESSION_GATE_POLICY',400,{field:key});
    policy[key]=value;
  }
  if(policy.warnP95DurationIncreasePct>policy.maxP95DurationIncreasePct) throw errorOf('Latency warning threshold exceeds blocker threshold','INVALID_REGRESSION_GATE_POLICY');
  if(policy.warnCostIncreasePct>policy.maxCostIncreasePct) throw errorOf('Cost warning threshold exceeds blocker threshold','INVALID_REGRESSION_GATE_POLICY');
  for(const key of ['requireBaselinePass','requireCandidatePass','blockOnRouteDrift','blockOnNewFailureCodes']) policy[key]=Boolean(policy[key]);
  return policy;
};
const groupStats=(run,group)=>{
  const rows=run.cases.flatMap(c=>c.assertions||[]).filter(a=>a.group===group);
  const passed=rows.filter(a=>a.status==='PASS').length;
  return {total:rows.length,passed,failed:rows.length-passed,passRatePct:pct(passed,rows.length)};
};
const runMetrics=run=>{
  const assertions=run.cases.flatMap(c=>c.assertions||[]);
  const passedCases=run.cases.filter(c=>c.status==='PASS').length;
  const passedAssertions=assertions.filter(a=>a.status==='PASS').length;
  const durations=run.cases.map(c=>Number(c.observedExecution?.durationMs)).filter(Number.isFinite);
  const costs={};
  for(const c of run.cases){
    const amount=Number(c.observedExecution?.estimatedCost);
    if(!Number.isFinite(amount)) continue;
    const currency=String(c.observedExecution?.costCurrency||'UNSPECIFIED');
    costs[currency]=round((costs[currency]||0)+amount);
  }
  return {
    status:run.status,
    caseCount:run.cases.length,passedCases,failedCases:run.cases.length-passedCases,casePassRatePct:pct(passedCases,run.cases.length),
    assertionCount:assertions.length,passedAssertions,failedAssertions:assertions.length-passedAssertions,assertionPassRatePct:pct(passedAssertions,assertions.length),
    structuredOutput:groupStats(run,'structuredOutput'),
    evidence:groupStats(run,'evidence'),
    router:groupStats(run,'router'),
    execution:groupStats(run,'execution'),
    p95DurationMs:round(p95(durations)),
    totalEstimatedCostByCurrency:costs,
    failureCodes:[...new Set(assertions.map(a=>a.failureCode).filter(Boolean))].sort()
  };
};
const caseGroupRate=(rows,group)=>{
  const xs=(rows||[]).filter(a=>a.group===group);
  const passed=xs.filter(a=>a.status==='PASS').length;
  return pct(passed,xs.length);
};
const caseFailureCodes=rows=>[...new Set((rows||[]).map(a=>a.failureCode).filter(Boolean))].sort();

const compareCase=(baseline,candidate,policy)=>{
  const blockers=[],warnings=[];
  const ba=baseline.assertions||[],ca=candidate.assertions||[];
  const baseRoute=routeFingerprint(baseline.route),candRoute=routeFingerprint(candidate.route);
  const routeChanged=stableJson(baseRoute)!==stableJson(candRoute);
  const baseDuration=Number(baseline.observedExecution?.durationMs||0),candDuration=Number(candidate.observedExecution?.durationMs||0);
  const durationIncreasePct=increasePct(candDuration,baseDuration);
  const baseCost=Number(baseline.observedExecution?.estimatedCost||0),candCost=Number(candidate.observedExecution?.estimatedCost||0);
  const baseCurrency=String(baseline.observedExecution?.costCurrency||''),candCurrency=String(candidate.observedExecution?.costCurrency||'');
  const sameCurrency=baseCurrency===candCurrency;
  const costIncreasePct=sameCurrency?increasePct(candCost,baseCost):null;

  if(baseline.status==='PASS'&&candidate.status!=='PASS') blockers.push('CASE_STATUS_REGRESSION');
  for(const [group,limit,code] of [
    ['structuredOutput',policy.maxStructuredOutputPassRateDropPct,'STRUCTURED_OUTPUT_PASS_RATE_REGRESSION'],
    ['evidence',policy.maxEvidencePassRateDropPct,'EVIDENCE_PASS_RATE_REGRESSION'],
    ['router',policy.maxRouterPassRateDropPct,'ROUTER_PASS_RATE_REGRESSION']
  ]){
    if(dropPct(caseGroupRate(ba,group),caseGroupRate(ca,group))>limit) blockers.push(code);
  }
  if(policy.blockOnRouteDrift&&routeChanged) blockers.push('ROUTE_DRIFT');

  if(durationIncreasePct===null){
    if(candDuration>0) blockers.push('LATENCY_FROM_ZERO_BASELINE');
  }else if(durationIncreasePct>policy.maxP95DurationIncreasePct) blockers.push('LATENCY_REGRESSION');
  else if(durationIncreasePct>policy.warnP95DurationIncreasePct) warnings.push('LATENCY_WARNING');

  if(!sameCurrency) blockers.push('COST_CURRENCY_CHANGED');
  else if(costIncreasePct===null){
    if(candCost>0) blockers.push('COST_FROM_ZERO_BASELINE');
  }else if(costIncreasePct>policy.maxCostIncreasePct) blockers.push('COST_REGRESSION');
  else if(costIncreasePct>policy.warnCostIncreasePct) warnings.push('COST_WARNING');

  const baseFailures=new Set(caseFailureCodes(ba));
  const newFailureCodes=caseFailureCodes(ca).filter(code=>!baseFailures.has(code));
  if(policy.blockOnNewFailureCodes&&newFailureCodes.length) blockers.push('NEW_FAILURE_CODES');

  const transition=baseline.status===candidate.status?'UNCHANGED':`${baseline.status}_TO_${candidate.status}`;
  const status=blockers.length?'BLOCKED':(warnings.length?'WARNING':'PASS');
  const metrics={
    baselineStatus:baseline.status,candidateStatus:candidate.status,
    baselineRoute:baseRoute,candidateRoute:candRoute,routeChanged,
    baselineDurationMs:round(baseDuration),candidateDurationMs:round(candDuration),durationIncreasePct,
    baselineEstimatedCost:round(baseCost),candidateEstimatedCost:round(candCost),
    baselineCostCurrency:baseCurrency||null,candidateCostCurrency:candCurrency||null,costIncreasePct,
    structuredOutputPassRateDropPct:dropPct(caseGroupRate(ba,'structuredOutput'),caseGroupRate(ca,'structuredOutput')),
    evidencePassRateDropPct:dropPct(caseGroupRate(ba,'evidence'),caseGroupRate(ca,'evidence')),
    routerPassRateDropPct:dropPct(caseGroupRate(ba,'router'),caseGroupRate(ca,'router')),
    newFailureCodes
  };
  const material={caseKey:candidate.caseKey,sequenceNo:candidate.sequenceNo,transition,status,blockers,warnings,metrics};
  return {...material,comparisonSha256:sha256(material)};
};

const normalizeComparison=row=>({
  id:row.id,baselineEvalRunId:row.baseline_eval_run_id,candidateEvalRunId:row.candidate_eval_run_id,
  suiteVersionId:row.suite_version_id,fixtureSha256:row.fixture_sha256,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  policyVersion:row.policy_version,policySha256:row.policy_sha256,policy:row.policy_json,status:row.status,
  blockerCount:Number(row.blocker_count),warningCount:Number(row.warning_count),
  caseRegressions:Number(row.case_regressions),caseImprovements:Number(row.case_improvements),
  assertionRegressions:Number(row.assertion_regressions),assertionImprovements:Number(row.assertion_improvements),
  evidenceRegressions:Number(row.evidence_regressions),routerRegressions:Number(row.router_regressions),
  latencyRegressions:Number(row.latency_regressions),costRegressions:Number(row.cost_regressions),
  summary:row.summary_json,comparisonSha256:row.comparison_sha256,idempotencyKey:row.idempotency_key,createdAt:row.created_at
});
const normalizeCase=row=>({
  id:row.id,comparisonId:row.comparison_id,caseKey:row.case_key,sequenceNo:Number(row.sequence_no),
  baselineStatus:row.baseline_status,candidateStatus:row.candidate_status,transition:row.transition,status:row.status,
  blockerCount:Number(row.blocker_count),warningCount:Number(row.warning_count),
  blockers:row.blockers_json||[],warnings:row.warnings_json||[],metrics:row.metrics_json,
  comparisonSha256:row.comparison_sha256,createdAt:row.created_at
});
const normalizeGate=row=>({
  id:row.id,comparisonId:row.comparison_id,gateKey:row.gate_key,decision:row.decision,
  blockerCount:Number(row.blocker_count),warningCount:Number(row.warning_count),
  blockers:row.blockers_json||[],warnings:row.warnings_json||[],policySha256:row.policy_sha256,
  gateSha256:row.gate_sha256,idempotencyKey:row.idempotency_key,decidedAt:row.decided_at,createdAt:row.created_at
});

export const getEvalRegressionComparison=async comparisonId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_regression_comparisons WHERE id=?',[comparisonId]);
  if(!rows.length) throw errorOf('Eval regression comparison not found','EVAL_REGRESSION_COMPARISON_NOT_FOUND',404);
  const [cases]=await db.execute('SELECT * FROM eval_case_regressions WHERE comparison_id=? ORDER BY sequence_no,case_key,id',[comparisonId]);
  const [gates]=await db.execute('SELECT * FROM eval_release_gates WHERE comparison_id=? ORDER BY decided_at,id',[comparisonId]);
  return {...normalizeComparison(rows[0]),cases:cases.map(normalizeCase),releaseGates:gates.map(normalizeGate)};
};

export const compareEvalRuns=async({baselineEvalRunId,candidateEvalRunId,idempotencyKey,policy=null}={})=>{
  if(!baselineEvalRunId||!candidateEvalRunId||!idempotencyKey) throw errorOf('baselineEvalRunId, candidateEvalRunId and idempotencyKey are required','INVALID_EVAL_REGRESSION_COMPARISON');
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
  if(!['PASS','FAIL'].includes(baseline.status)||!['PASS','FAIL'].includes(candidate.status)) throw errorOf('Only terminal PASS/FAIL runs are comparable','EVAL_REGRESSION_RUN_NOT_COMPARABLE',409);
  if(baseline.executionMode!==candidate.executionMode) throw errorOf('Execution modes differ','EVAL_EXECUTION_MODE_MISMATCH',409);
  const [baseManifest,candManifest]=await Promise.all([
    getEvalReplayManifest(baseline.replayManifestId),getEvalReplayManifest(candidate.replayManifestId)
  ]);
  if(baseManifest.suiteVersionId!==candManifest.suiteVersionId) throw errorOf('Suite versions differ','EVAL_REGRESSION_SUITE_VERSION_MISMATCH',409);
  if(baseManifest.fixtureSha256!==candManifest.fixtureSha256) throw errorOf('Fixture SHA differs','EVAL_REGRESSION_FIXTURE_MISMATCH',409);
  if(candManifest.baselineRuntimeSha&&candManifest.baselineRuntimeSha!==baseline.candidateRuntimeSha) throw errorOf(
    'Candidate manifest baselineRuntimeSha does not match baseline run','EVAL_BASELINE_SHA_MISMATCH',409
  );

  const baseMap=new Map(baseline.cases.map(c=>[c.caseKey,c])),candMap=new Map(candidate.cases.map(c=>[c.caseKey,c]));
  const baseKeys=[...baseMap.keys()].sort(),candKeys=[...candMap.keys()].sort();
  if(stableJson(baseKeys)!==stableJson(candKeys)) throw errorOf('Case sets differ','EVAL_REGRESSION_CASE_SET_MISMATCH',409);

  const bm=runMetrics(baseline),cm=runMetrics(candidate),blockers=[],warnings=[];
  const block=(code,details={})=>blockers.push({code,...details});
  const warn=(code,details={})=>warnings.push({code,...details});
  if(normalizedPolicy.requireBaselinePass&&baseline.status!=='PASS') block('BASELINE_RUN_NOT_PASS',{status:baseline.status});
  if(normalizedPolicy.requireCandidatePass&&candidate.status!=='PASS') block('CANDIDATE_RUN_NOT_PASS',{status:candidate.status});

  for(const [key,limit,code] of [
    ['casePassRatePct',normalizedPolicy.maxCasePassRateDropPct,'CASE_PASS_RATE_REGRESSION'],
    ['assertionPassRatePct',normalizedPolicy.maxAssertionPassRateDropPct,'ASSERTION_PASS_RATE_REGRESSION']
  ]){
    const drop=dropPct(bm[key],cm[key]);
    if(drop>limit) block(code,{baseline:bm[key],candidate:cm[key],dropPct:drop,limitPct:limit});
  }
  for(const [group,limit,code] of [
    ['structuredOutput',normalizedPolicy.maxStructuredOutputPassRateDropPct,'STRUCTURED_OUTPUT_PASS_RATE_REGRESSION'],
    ['evidence',normalizedPolicy.maxEvidencePassRateDropPct,'EVIDENCE_PASS_RATE_REGRESSION'],
    ['router',normalizedPolicy.maxRouterPassRateDropPct,'ROUTER_PASS_RATE_REGRESSION']
  ]){
    const drop=dropPct(bm[group].passRatePct,cm[group].passRatePct);
    if(drop>limit) block(code,{baseline:bm[group].passRatePct,candidate:cm[group].passRatePct,dropPct:drop,limitPct:limit});
  }

  const latencyIncrease=increasePct(cm.p95DurationMs,bm.p95DurationMs);
  if(latencyIncrease===null){
    if(cm.p95DurationMs>0) block('P95_LATENCY_FROM_ZERO_BASELINE',{candidateMs:cm.p95DurationMs});
  }else if(latencyIncrease>normalizedPolicy.maxP95DurationIncreasePct){
    block('P95_LATENCY_REGRESSION',{baselineMs:bm.p95DurationMs,candidateMs:cm.p95DurationMs,increasePct:latencyIncrease,limitPct:normalizedPolicy.maxP95DurationIncreasePct});
  }else if(latencyIncrease>normalizedPolicy.warnP95DurationIncreasePct) warn('P95_LATENCY_WARNING',{increasePct:latencyIncrease});

  const currencies=[...new Set([...Object.keys(bm.totalEstimatedCostByCurrency),...Object.keys(cm.totalEstimatedCostByCurrency)])].sort();
  const costByCurrency={};
  for(const currency of currencies){
    const b=bm.totalEstimatedCostByCurrency[currency]||0,c=cm.totalEstimatedCostByCurrency[currency]||0,inc=increasePct(c,b);
    costByCurrency[currency]={baseline:b,candidate:c,increasePct:inc};
    if(inc===null){
      if(c>0) block('COST_FROM_ZERO_BASELINE',{currency,candidate:c});
    }else if(inc>normalizedPolicy.maxCostIncreasePct) block('COST_REGRESSION',{currency,baseline:b,candidate:c,increasePct:inc,limitPct:normalizedPolicy.maxCostIncreasePct});
    else if(inc>normalizedPolicy.warnCostIncreasePct) warn('COST_WARNING',{currency,increasePct:inc});
  }

  const baselineFailures=new Set(bm.failureCodes);
  const newFailureCodes=cm.failureCodes.filter(code=>!baselineFailures.has(code));
  if(normalizedPolicy.blockOnNewFailureCodes&&newFailureCodes.length) block('NEW_FAILURE_CODES',{failureCodes:newFailureCodes});

  const caseRows=[];
  for(const bc of baseline.cases){
    const row=compareCase(bc,candMap.get(bc.caseKey),normalizedPolicy);
    if(normalizedPolicy.blockOnRouteDrift&&row.metrics.routeChanged) block('ROUTE_DRIFT',{caseKey:bc.caseKey});
    caseRows.push(row);
  }
  const dedup=items=>[...new Map(items.map(x=>[stableJson(x),x])).values()];
  const globalBlockers=dedup(blockers),globalWarnings=dedup(warnings);
  const status=globalBlockers.length?'BLOCKED':(globalWarnings.length?'WARNING':'PASS');
  const caseRegressions=caseRows.filter(x=>x.metrics.baselineStatus==='PASS'&&x.metrics.candidateStatus!=='PASS').length;
  const caseImprovements=caseRows.filter(x=>x.metrics.baselineStatus!=='PASS'&&x.metrics.candidateStatus==='PASS').length;
  const assertionRegressions=Math.max(0,cm.failedAssertions-bm.failedAssertions);
  const assertionImprovements=Math.max(0,bm.failedAssertions-cm.failedAssertions);
  const evidenceRegressions=caseRows.filter(x=>x.blockers.includes('EVIDENCE_PASS_RATE_REGRESSION')).length;
  const routerRegressions=caseRows.filter(x=>x.blockers.includes('ROUTER_PASS_RATE_REGRESSION')||x.blockers.includes('ROUTE_DRIFT')).length;
  const latencyRegressions=caseRows.filter(x=>x.blockers.includes('LATENCY_REGRESSION')||x.blockers.includes('LATENCY_FROM_ZERO_BASELINE')).length;
  const costRegressions=caseRows.filter(x=>x.blockers.includes('COST_REGRESSION')||x.blockers.includes('COST_FROM_ZERO_BASELINE')||x.blockers.includes('COST_CURRENCY_CHANGED')).length;

  const summary={
    baseline:{runId:baseline.id,runtimeSha:baseline.candidateRuntimeSha,metrics:bm},
    candidate:{runId:candidate.id,runtimeSha:candidate.candidateRuntimeSha,metrics:cm},
    deltas:{
      casePassRateDropPct:dropPct(bm.casePassRatePct,cm.casePassRatePct),
      assertionPassRateDropPct:dropPct(bm.assertionPassRatePct,cm.assertionPassRatePct),
      structuredOutputPassRateDropPct:dropPct(bm.structuredOutput.passRatePct,cm.structuredOutput.passRatePct),
      evidencePassRateDropPct:dropPct(bm.evidence.passRatePct,cm.evidence.passRatePct),
      routerPassRateDropPct:dropPct(bm.router.passRatePct,cm.router.passRatePct),
      p95DurationIncreasePct:latencyIncrease,costByCurrency,newFailureCodes
    },
    blockers:globalBlockers,warnings:globalWarnings
  };
  const comparisonSha256=sha256({
    baselineResultSha256:baseline.resultSha256,candidateResultSha256:candidate.resultSha256,
    suiteVersionId:baseManifest.suiteVersionId,fixtureSha256:baseManifest.fixtureSha256,
    policyVersion:POLICY_VERSION,policySha256,status,summary,
    cases:caseRows.map(x=>({caseKey:x.caseKey,comparisonSha256:x.comparisonSha256}))
  });

  const write=await db.getConnection();
  try{
    await write.beginTransaction();
    const id=randomUUID();
    await write.execute(
      `INSERT INTO eval_regression_comparisons
       (id,baseline_eval_run_id,candidate_eval_run_id,suite_version_id,fixture_sha256,baseline_runtime_sha,
        candidate_runtime_sha,policy_version,policy_sha256,policy_json,status,blocker_count,warning_count,
        case_regressions,case_improvements,assertion_regressions,assertion_improvements,evidence_regressions,
        router_regressions,latency_regressions,cost_regressions,summary_json,comparison_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,baseline.id,candidate.id,baseManifest.suiteVersionId,baseManifest.fixtureSha256,
       baseline.candidateRuntimeSha,candidate.candidateRuntimeSha,POLICY_VERSION,policySha256,JSON.stringify(normalizedPolicy),
       status,globalBlockers.length,globalWarnings.length,caseRegressions,caseImprovements,assertionRegressions,
       assertionImprovements,evidenceRegressions,routerRegressions,latencyRegressions,costRegressions,
       JSON.stringify(summary),comparisonSha256,idempotencyKey]
    );
    for(const row of caseRows){
      await write.execute(
        `INSERT INTO eval_case_regressions
         (id,comparison_id,case_key,sequence_no,baseline_status,candidate_status,transition,status,
          blocker_count,warning_count,blockers_json,warnings_json,metrics_json,comparison_sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),id,row.caseKey,row.sequenceNo,row.metrics.baselineStatus,row.metrics.candidateStatus,
         row.transition,row.status,row.blockers.length,row.warnings.length,JSON.stringify(row.blockers),
         JSON.stringify(row.warnings),JSON.stringify(row.metrics),row.comparisonSha256]
      );
    }
    await write.commit();
    return {...await getEvalRegressionComparison(id),idempotent:false};
  }catch(error){await write.rollback();throw error;}finally{write.release();}
};

export const createEvalReleaseGate=async(comparisonId,{gateKey='PRODUCTION_PROMOTION',idempotencyKey}={})=>{
  if(!comparisonId||!gateKey||!idempotencyKey) throw errorOf('comparisonId, gateKey and idempotencyKey are required','INVALID_EVAL_RELEASE_GATE');
  const comparison=await getEvalRegressionComparison(comparisonId);
  const decision=comparison.blockerCount>0?'BLOCKED':'PASS';
  const blockers=comparison.summary?.blockers||[],warnings=comparison.summary?.warnings||[];
  const gateSha256=sha256({
    comparisonSha256:comparison.comparisonSha256,gateKey,decision,blockerCount:comparison.blockerCount,
    warningCount:comparison.warningCount,blockers,warnings,policySha256:comparison.policySha256
  });
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [byKey]=await conn.execute('SELECT * FROM eval_release_gates WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(byKey.length){
      const row=byKey[0];
      if(row.comparison_id!==comparisonId||row.gate_key!==gateKey) throw errorOf('Idempotency key already used for another release gate','EVAL_RELEASE_GATE_IDEMPOTENCY_CONFLICT',409);
      await conn.commit();
      return {...normalizeGate(row),idempotent:true};
    }
    const [sameGate]=await conn.execute('SELECT * FROM eval_release_gates WHERE comparison_id=? AND gate_key=? LIMIT 1 FOR UPDATE',[comparisonId,gateKey]);
    if(sameGate.length){
      await conn.commit();
      return {...normalizeGate(sameGate[0]),idempotent:true};
    }
    const id=randomUUID();
    await conn.execute(
      `INSERT INTO eval_release_gates
       (id,comparison_id,gate_key,decision,blocker_count,warning_count,blockers_json,warnings_json,policy_sha256,gate_sha256,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id,comparisonId,gateKey,decision,comparison.blockerCount,comparison.warningCount,
       JSON.stringify(blockers),JSON.stringify(warnings),comparison.policySha256,gateSha256,idempotencyKey]
    );
    const [rows]=await conn.execute('SELECT * FROM eval_release_gates WHERE id=?',[id]);
    await conn.commit();
    return {...normalizeGate(rows[0]),idempotent:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
};

export const getEvalReleaseGate=async gateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_release_gates WHERE id=?',[gateId]);
  if(!rows.length) throw errorOf('Eval release gate not found','EVAL_RELEASE_GATE_NOT_FOUND',404);
  const row=rows[0],comparison=await getEvalRegressionComparison(row.comparison_id);
  const expected=sha256({
    comparisonSha256:comparison.comparisonSha256,gateKey:row.gate_key,decision:row.decision,
    blockerCount:Number(row.blocker_count),warningCount:Number(row.warning_count),
    blockers:row.blockers_json||[],warnings:row.warnings_json||[],policySha256:row.policy_sha256
  });
  if(expected!==row.gate_sha256) throw errorOf('Eval release gate integrity check failed','EVAL_RELEASE_GATE_INTEGRITY_MISMATCH',500);
  return normalizeGate(row);
};

export const REGRESSION_GATE_POLICY_VERSION=POLICY_VERSION;
export const REGRESSION_GATE_DEFAULT_POLICY=DEFAULT_POLICY;
