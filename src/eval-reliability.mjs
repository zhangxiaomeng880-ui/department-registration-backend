import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const POLICY_VERSION='eval-reliability-v1';
const SHA40=/^[a-f0-9]{40}$/i;
const MAX_WINDOW_MS=90*24*60*60*1000;

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details) error.details=details;
  return error;
};
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  }
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const toIso=value=>value==null?null:new Date(value).toISOString();
const rate=(n,d)=>d?Number((Number(n)/Number(d)).toFixed(6)):null;
const number=value=>value==null?null:Number(value);
const percentile=(values,p)=>{
  const sorted=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length) return null;
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));
  return sorted[index];
};
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const normalizeWindow=({windowStart,windowEnd,candidateRuntimeSha=null}={})=>{
  if(!windowStart||!windowEnd) throw errorOf('windowStart and windowEnd are required','INVALID_RELIABILITY_WINDOW');
  const start=new Date(windowStart),end=new Date(windowEnd);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start){
    throw errorOf('Reliability window must be a valid increasing time range','INVALID_RELIABILITY_WINDOW');
  }
  if(end-start>MAX_WINDOW_MS) throw errorOf('Reliability window cannot exceed 90 days','RELIABILITY_WINDOW_TOO_LARGE');
  if(candidateRuntimeSha!=null&&!SHA40.test(String(candidateRuntimeSha))){
    throw errorOf('candidateRuntimeSha must be a 40-character Git SHA','INVALID_RELIABILITY_RUNTIME_SHA');
  }
  return {
    windowStart:start.toISOString(),
    windowEnd:end.toISOString(),
    candidateRuntimeSha:candidateRuntimeSha?String(candidateRuntimeSha).toLowerCase():null
  };
};
const whereFor=(alias,scope)=>{
  const sql=[`${alias}.created_at>=?`,`${alias}.created_at<?`];
  const params=[scope.windowStart,scope.windowEnd];
  if(scope.candidateRuntimeSha){
    sql.push(`${alias}.candidate_runtime_sha=?`);
    params.push(scope.candidateRuntimeSha);
  }
  return {sql:sql.join(' AND '),params};
};
const normalizeSnapshot=row=>({
  id:row.id,
  windowStart:toIso(row.window_start),
  windowEnd:toIso(row.window_end),
  candidateRuntimeSha:row.candidate_runtime_sha||null,
  policyVersion:row.policy_version,
  scope:parseJson(row.scope_json),
  metrics:parseJson(row.metrics_json),
  sourceWatermark:parseJson(row.source_watermark_json),
  snapshotSha256:row.snapshot_sha256,
  idempotencyKey:row.idempotency_key,
  generatedAt:toIso(row.generated_at),
  createdAt:toIso(row.created_at)
});

export const getEvalReliabilitySnapshot=async snapshotId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_reliability_snapshots WHERE id=?',[snapshotId]);
  if(!rows.length) throw errorOf('Eval reliability snapshot not found','EVAL_RELIABILITY_SNAPSHOT_NOT_FOUND',404);
  return normalizeSnapshot(rows[0]);
};

const buildMetrics=async(scope,db)=>{
  const er=whereFor('er',scope);
  const rc=whereFor('rc',scope);
  const sr=whereFor('sr',scope);

  const [[evalAgg]]=await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(er.status='PASS') AS passed,
            SUM(er.status='FAIL') AS failed,
            SUM(er.status NOT IN ('PASS','FAIL')) AS other,
            COALESCE(SUM(er.case_count),0) AS cases,
            COALESCE(SUM(er.passed_case_count),0) AS passed_cases,
            COALESCE(SUM(er.failed_case_count),0) AS failed_cases,
            COALESCE(SUM(er.assertion_count),0) AS assertions,
            COALESCE(SUM(er.passed_assertion_count),0) AS passed_assertions,
            COALESCE(SUM(er.failed_assertion_count),0) AS failed_assertions
       FROM eval_runs er WHERE ${er.sql}`,er.params
  );
  const [caseErrors]=await db.execute(
    `SELECT COALESCE(cr.error_code,'UNSPECIFIED') AS code,COUNT(*) AS count
       FROM eval_case_results cr
       JOIN eval_runs er ON er.id=cr.eval_run_id
      WHERE ${er.sql} AND cr.status<>'PASS'
      GROUP BY COALESCE(cr.error_code,'UNSPECIFIED')
      ORDER BY count DESC,code ASC`,er.params
  );
  const [assertionFailures]=await db.execute(
    `SELECT ar.assertion_group AS assertion_group,COALESCE(ar.failure_code,'UNSPECIFIED') AS failure_code,COUNT(*) AS count
       FROM eval_assertion_results ar
       JOIN eval_case_results cr ON cr.id=ar.eval_case_result_id
       JOIN eval_runs er ON er.id=cr.eval_run_id
      WHERE ${er.sql} AND ar.status='FAIL'
      GROUP BY ar.assertion_group,COALESCE(ar.failure_code,'UNSPECIFIED')
      ORDER BY count DESC,assertion_group ASC,failure_code ASC`,er.params
  );
  const [executionRows]=await db.execute(
    `SELECT cr.observed_execution_json
       FROM eval_case_results cr
       JOIN eval_runs er ON er.id=cr.eval_run_id
      WHERE ${er.sql} AND cr.observed_execution_json IS NOT NULL`,er.params
  );
  const executionSamples=executionRows.map(row=>parseJson(row.observed_execution_json)).filter(Boolean);
  const durations=executionSamples.map(x=>Number(x.durationMs)).filter(Number.isFinite);
  const costs=executionSamples.map(x=>Number(x.estimatedCost)).filter(Number.isFinite);
  const currencies=[...new Set(executionSamples.map(x=>x.costCurrency).filter(Boolean))].sort();

  const [comparisonRows]=await db.execute(
    `SELECT rc.status,rc.blocker_count,rc.summary_json
       FROM eval_regression_comparisons rc WHERE ${rc.sql}
       ORDER BY rc.created_at,rc.id`,rc.params
  );
  const [caseRegressionRows]=await db.execute(
    `SELECT cr.transition,cr.assertion_regression_count,cr.assertion_improvement_count,
            cr.assertion_set_drift,cr.router_drift,cr.evidence_drift,cr.blockers_json
       FROM eval_case_regressions cr
       JOIN eval_regression_comparisons rc ON rc.id=cr.comparison_id
      WHERE ${rc.sql}
      ORDER BY rc.created_at,cr.sequence_no,cr.case_key`,rc.params
  );
  const [gateRows]=await db.execute(
    `SELECT g.decision,g.blocker_count,g.blockers_json
       FROM eval_release_gates g
       JOIN eval_regression_comparisons rc ON rc.id=g.comparison_id
      WHERE ${rc.sql}
      ORDER BY g.decided_at,g.id`,rc.params
  );

  const blockerCounts=new Map();
  const recordBlockers=raw=>{
    const items=parseJson(raw);
    if(!Array.isArray(items)) return;
    for(const item of items){
      const code=String(item?.code||'UNSPECIFIED');
      blockerCounts.set(code,(blockerCounts.get(code)||0)+1);
    }
  };
  caseRegressionRows.forEach(row=>recordBlockers(row.blockers_json));
  gateRows.forEach(row=>recordBlockers(row.blockers_json));
  const topBlockers=[...blockerCounts.entries()]
    .map(([code,count])=>({code,count}))
    .sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code));

  const [shadowRows]=await db.execute(
    `SELECT sr.status,sr.eval_run_id,sr.safety_summary_json
       FROM eval_shadow_replays sr WHERE ${sr.sql}
       ORDER BY sr.created_at,sr.id`,sr.params
  );
  let sourceBodyReadViolations=0,customerBillingViolations=0;
  for(const row of shadowRows){
    const safety=parseJson(row.safety_summary_json)||{};
    if(safety.sourceBodyRead===true) sourceBodyReadViolations++;
    if(safety.customerBillingEligible===true) customerBillingViolations++;
  }
  const shadowTerminal=shadowRows.filter(row=>['PASS','FAIL','ERROR'].includes(row.status));
  const shadowLinked=shadowTerminal.filter(row=>row.eval_run_id).length;

  const [runtimeRows]=await db.execute(
    `SELECT er.candidate_runtime_sha,
            COUNT(*) AS total,
            SUM(er.status='PASS') AS passed,
            SUM(er.status='FAIL') AS failed,
            SUM(er.status NOT IN ('PASS','FAIL')) AS other,
            COALESCE(SUM(er.failed_case_count),0) AS failed_cases,
            COALESCE(SUM(er.failed_assertion_count),0) AS failed_assertions
       FROM eval_runs er
      WHERE er.created_at>=? AND er.created_at<?
      GROUP BY er.candidate_runtime_sha
      ORDER BY er.candidate_runtime_sha`,
    [scope.windowStart,scope.windowEnd]
  );

  const metrics={
    eval:{
      total:Number(evalAgg.total||0),
      passed:Number(evalAgg.passed||0),
      failed:Number(evalAgg.failed||0),
      other:Number(evalAgg.other||0),
      passRate:rate(evalAgg.passed,evalAgg.total),
      cases:Number(evalAgg.cases||0),
      passedCases:Number(evalAgg.passed_cases||0),
      failedCases:Number(evalAgg.failed_cases||0),
      casePassRate:rate(evalAgg.passed_cases,evalAgg.cases),
      assertions:Number(evalAgg.assertions||0),
      passedAssertions:Number(evalAgg.passed_assertions||0),
      failedAssertions:Number(evalAgg.failed_assertions||0),
      assertionPassRate:rate(evalAgg.passed_assertions,evalAgg.assertions),
      topCaseErrors:caseErrors.map(row=>({code:row.code,count:Number(row.count)})),
      topAssertionFailures:assertionFailures.map(row=>({
        group:row.assertion_group,code:row.failure_code,count:Number(row.count)
      })),
      execution:{
        sampleCount:executionSamples.length,
        durationMs:{
          p50:percentile(durations,0.50),
          p95:percentile(durations,0.95),
          max:durations.length?Math.max(...durations):null
        },
        estimatedCost:{
          p50:percentile(costs,0.50),
          p95:percentile(costs,0.95),
          max:costs.length?Math.max(...costs):null,
          currencies
        }
      }
    },
    regression:{
      comparisons:comparisonRows.length,
      passedComparisons:comparisonRows.filter(row=>row.status==='PASS').length,
      blockedComparisons:comparisonRows.filter(row=>row.status==='BLOCK').length,
      blockerCount:sum(comparisonRows,'blocker_count'),
      releaseGates:gateRows.length,
      passedReleaseGates:gateRows.filter(row=>row.decision==='PASS').length,
      blockedReleaseGates:gateRows.filter(row=>row.decision==='BLOCK').length,
      caseRegressions:caseRegressionRows.filter(row=>row.transition==='REGRESSED').length,
      caseImprovements:caseRegressionRows.filter(row=>row.transition==='IMPROVED').length,
      assertionRegressions:sum(caseRegressionRows,'assertion_regression_count'),
      assertionImprovements:sum(caseRegressionRows,'assertion_improvement_count'),
      assertionSetDrifts:caseRegressionRows.filter(row=>Boolean(row.assertion_set_drift)).length,
      routerDrifts:caseRegressionRows.filter(row=>Boolean(row.router_drift)).length,
      evidenceDrifts:caseRegressionRows.filter(row=>Boolean(row.evidence_drift)).length,
      topBlockers
    },
    shadow:{
      total:shadowRows.length,
      passed:shadowRows.filter(row=>row.status==='PASS').length,
      failed:shadowRows.filter(row=>row.status==='FAIL').length,
      errors:shadowRows.filter(row=>row.status==='ERROR').length,
      inProgress:shadowRows.filter(row=>!['PASS','FAIL','ERROR'].includes(row.status)).length,
      terminalPassRate:rate(shadowRows.filter(row=>row.status==='PASS').length,shadowTerminal.length),
      terminalEvalRunLinkCoverage:rate(shadowLinked,shadowTerminal.length),
      sourceBodyReadViolations,
      customerBillingEligibilityViolations:customerBillingViolations
    },
    runtimeBreakdown:runtimeRows.map(row=>({
      candidateRuntimeSha:row.candidate_runtime_sha,
      total:Number(row.total||0),
      passed:Number(row.passed||0),
      failed:Number(row.failed||0),
      other:Number(row.other||0),
      passRate:rate(row.passed,row.total),
      failedCases:Number(row.failed_cases||0),
      failedAssertions:Number(row.failed_assertions||0)
    }))
  };
  return metrics;
};

const buildWatermark=async(scope,db)=>{
  const er=whereFor('er',scope),rc=whereFor('rc',scope),sr=whereFor('sr',scope);
  const [[evalMark]]=await db.execute(
    `SELECT COUNT(*) AS count,MAX(er.created_at) AS max_created_at FROM eval_runs er WHERE ${er.sql}`,er.params
  );
  const [[regressionMark]]=await db.execute(
    `SELECT COUNT(*) AS count,MAX(rc.created_at) AS max_created_at FROM eval_regression_comparisons rc WHERE ${rc.sql}`,rc.params
  );
  const [[shadowMark]]=await db.execute(
    `SELECT COUNT(*) AS count,MAX(sr.created_at) AS max_created_at FROM eval_shadow_replays sr WHERE ${sr.sql}`,sr.params
  );
  return {
    evalRuns:{count:Number(evalMark.count||0),maxCreatedAt:toIso(evalMark.max_created_at)},
    regressionComparisons:{count:Number(regressionMark.count||0),maxCreatedAt:toIso(regressionMark.max_created_at)},
    shadowReplays:{count:Number(shadowMark.count||0),maxCreatedAt:toIso(shadowMark.max_created_at)}
  };
};

export const createEvalReliabilitySnapshot=async({
  windowStart,windowEnd,candidateRuntimeSha=null,idempotencyKey
}={})=>{
  if(!idempotencyKey) throw errorOf('idempotencyKey is required','INVALID_RELIABILITY_SNAPSHOT');
  const scope=normalizeWindow({windowStart,windowEnd,candidateRuntimeSha});
  const db=getRuntimePool();

  const [existing]=await db.execute(
    'SELECT * FROM eval_reliability_snapshots WHERE idempotency_key=? LIMIT 1',[idempotencyKey]
  );
  if(existing.length){
    const row=normalizeSnapshot(existing[0]);
    const same=row.windowStart===scope.windowStart&&row.windowEnd===scope.windowEnd&&
      (row.candidateRuntimeSha||null)===(scope.candidateRuntimeSha||null);
    if(!same) throw errorOf(
      'Idempotency key was already used for another reliability scope',
      'EVAL_RELIABILITY_IDEMPOTENCY_CONFLICT',409
    );
    return {...row,idempotent:true};
  }

  const [metrics,sourceWatermark]=await Promise.all([
    buildMetrics(scope,db),buildWatermark(scope,db)
  ]);
  const snapshotScope={
    ...scope,
    timeBasis:{
      evalRuns:'eval_runs.created_at',
      regressionComparisons:'eval_regression_comparisons.created_at',
      shadowReplays:'eval_shadow_replays.created_at'
    }
  };
  const snapshotSha256=sha256({
    policyVersion:POLICY_VERSION,
    scope:snapshotScope,
    metrics,
    sourceWatermark
  });

  const [sameHash]=await db.execute(
    'SELECT * FROM eval_reliability_snapshots WHERE snapshot_sha256=? LIMIT 1',[snapshotSha256]
  );
  if(sameHash.length) return {...normalizeSnapshot(sameHash[0]),idempotent:true,deduplicated:true};

  const id=randomUUID();
  await db.execute(
    `INSERT INTO eval_reliability_snapshots
     (id,window_start,window_end,candidate_runtime_sha,policy_version,scope_json,metrics_json,
      source_watermark_json,snapshot_sha256,idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,scope.windowStart,scope.windowEnd,scope.candidateRuntimeSha,POLICY_VERSION,
      JSON.stringify(snapshotScope),JSON.stringify(metrics),JSON.stringify(sourceWatermark),
      snapshotSha256,idempotencyKey
    ]
  );
  return {...await getEvalReliabilitySnapshot(id),idempotent:false};
};

export const EVAL_RELIABILITY_POLICY_VERSION=POLICY_VERSION;
