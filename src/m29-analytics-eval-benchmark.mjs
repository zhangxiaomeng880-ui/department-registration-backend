import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getProjectHealth,getPortfolioIntelligence } from './portfolio-closure-governance.mjs';

const GATE='G-M29-ANALYTICS-EVAL';
const MODEL_TOOL_TYPES=new Set(['MODEL','TOOL']);
const SHA40=/^[a-f0-9]{40}$/;

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>input?.[k]==null||input[k]===''||(typeof input[k]==='object'&&!Array.isArray(input[k])&&!Object.keys(input[k]).length));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};

const loadProject=async(projectId,db=getRuntimePool())=>{
  const row=await one(db,'SELECT p.*,w.tenant_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=?',[projectId]);
  if(!row)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return row;
};

export const resolveM29AnalyticsProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id,tenantId:p.tenant_id};
};

const latestGate=async(db,table,projectId,gateKey)=>
  one(db,`SELECT status,as_of,created_at FROM ${table} WHERE project_id=? AND gate_key=? ORDER BY as_of DESC,created_at DESC LIMIT 1`,[projectId,gateKey]);

export const createM29AnalyticsSnapshot=async(projectId,input={})=>{
  requireFields(input,['snapshotKey','windowStart','windowEnd','evidence'],'INVALID_M29_ANALYTICS_SNAPSHOT');
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  const start=asDate(input.windowStart),end=asDate(input.windowEnd);
  if(end<=start)throw errorOf('windowEnd must be after windowStart','M29_ANALYTICS_WINDOW_INVALID',409);

  const projectHealth=await getProjectHealth(projectId,{asOf:end,persist:false});
  const portfolioLinks=await list(db,'SELECT portfolio_id FROM portfolio_project_links WHERE project_id=? ORDER BY portfolio_id',[projectId]);
  const portfolios=[];
  for(const row of portfolioLinks){
    const p=await getPortfolioIntelligence(row.portfolio_id,{asOf:end,persist:false});
    portfolios.push({portfolioId:row.portfolio_id,health:p.portfolio.health,summary:p.summary,capacitySignal:p.capacitySignal,budgetSignal:p.budgetSignal});
  }

  const metricAgg=await one(db,`SELECT COUNT(*) total,
      SUM(q.status='PASS') pass_quality,SUM(q.status='WARN') warn_quality,SUM(q.status='FAIL') fail_quality
    FROM m29_metric_observations o
    LEFT JOIN m29_data_quality_evaluations q ON q.metric_observation_id=o.id
    WHERE o.project_id=? AND o.observed_at>=? AND o.observed_at<?`,[projectId,start,end]);
  const signalAgg=await one(db,`SELECT COUNT(*) total,
      SUM(status IN ('ACTIONED','CLOSED')) actioned,SUM(status='DETECTED') detected
    FROM m29_detected_signals WHERE project_id=? AND detected_at>=? AND detected_at<?`,[projectId,start,end]);
  const loopAgg=await one(db,`SELECT COUNT(*) total FROM m29_loop_closures WHERE project_id=? AND closed_at>=? AND closed_at<?`,[projectId,start,end]);
  const automationAgg=await one(db,`SELECT COUNT(*) total,SUM(status='FIRED') fired,SUM(status='FAILED') failed
    FROM m29_automation_intakes WHERE project_id=? AND occurred_at>=? AND occurred_at<?`,[projectId,start,end]);

  let production;
  if(project.project_type==='AIGC_CONTENT'){
    const jobs=await one(db,`SELECT COUNT(*) total,SUM(status='PASS') passed,SUM(status='FAIL') failed,
      SUM(status='BLOCKED') blocked,COALESCE(SUM(latency_ms),0) latency_ms
      FROM aigc_generation_jobs WHERE project_id=? AND created_at>=? AND created_at<?`,[projectId,start,end]);
    const selected=await one(db,`SELECT COUNT(*) total FROM aigc_generation_candidates
      WHERE project_id=? AND is_current=TRUE AND selection_status='SELECTED' AND created_at>=? AND created_at<?`,[projectId,start,end]);
    const perf=await one(db,`SELECT COUNT(*) total,SUM(data_quality_status='PASS') pass_quality
      FROM aigc_performance_observations WHERE project_id=? AND observed_at>=? AND observed_at<?`,[projectId,start,end]);
    production={domain:'AIGC',generationJobs:Number(jobs.total||0),passedJobs:Number(jobs.passed||0),
      failedJobs:Number(jobs.failed||0),blockedJobs:Number(jobs.blocked||0),latencyMs:Number(jobs.latency_ms||0),
      currentSelectedCandidates:Number(selected.total||0),performanceObservations:Number(perf.total||0),
      passQualityPerformance:Number(perf.pass_quality||0),coverageStatus:Number(jobs.total||0)>0?'PASS':'EMPTY'};
  }else{
    const outcomes=await one(db,`SELECT COUNT(*) total,SUM(data_quality_status='PASS') pass_quality
      FROM product_outcome_observations WHERE project_id=? AND observed_at>=? AND observed_at<?`,[projectId,start,end]);
    production={domain:'PRODUCT',outcomeObservations:Number(outcomes.total||0),
      passQualityOutcomes:Number(outcomes.pass_quality||0),coverageStatus:Number(outcomes.total||0)>0?'PASS':'EMPTY'};
  }

  const projectAnalytics={health:projectHealth.health,status:project.status,reasonCodes:projectHealth.reasonCodes,
    currentMilestone:projectHealth.currentMilestone||null,forecastEnd:projectHealth.forecastEnd||null};
  const portfolioAnalytics={coverageStatus:portfolios.length?'PASS':'N_A',portfolios};
  const dataAnalytics={
    metricObservations:Number(metricAgg.total||0),passQuality:Number(metricAgg.pass_quality||0),
    warnQuality:Number(metricAgg.warn_quality||0),failQuality:Number(metricAgg.fail_quality||0),
    detectedSignals:Number(signalAgg.total||0),openSignals:Number(signalAgg.detected||0),
    actionedSignals:Number(signalAgg.actioned||0),closedLoops:Number(loopAgg.total||0),
    automationIntakes:Number(automationAgg.total||0),firedAutomation:Number(automationAgg.fired||0),
    failedAutomation:Number(automationAgg.failed||0)
  };
  const sourceWatermark={
    projectHealthAsOf:projectHealth.asOf||end,
    metricObservationCount:dataAnalytics.metricObservations,
    detectedSignalCount:dataAnalytics.detectedSignals,
    loopClosureCount:dataAnalytics.closedLoops,
    automationIntakeCount:dataAnalytics.automationIntakes
  };
  const status=production.coverageStatus==='PASS'&&dataAnalytics.metricObservations>0?'PASS':'HOLD';
  const id=randomUUID();
  await db.execute(`INSERT INTO m29_analytics_snapshots
    (id,project_id,snapshot_key,window_start,window_end,project_analytics_json,portfolio_analytics_json,
     production_analytics_json,data_analytics_json,source_watermark_json,status,evidence_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.snapshotKey,start,end,asJson(projectAnalytics),asJson(portfolioAnalytics),
     asJson(production),asJson(dataAnalytics),asJson(sourceWatermark),status,asJson(input.evidence)]);
  return {id,projectId,snapshotKey:input.snapshotKey,status,windowStart:start,windowEnd:end,
    projectAnalytics,portfolioAnalytics,productionAnalytics:production,dataAnalytics,sourceWatermark};
};

export const bindM29EvalBenchmark=async(projectId,input={})=>{
  requireFields(input,['bindingKey','benchmarkRunId','reliabilitySnapshotId','modelToolVersion','evidence'],
    'INVALID_M29_EVAL_BENCHMARK_BINDING');
  const db=getRuntimePool();await loadProject(projectId,db);
  const row=await one(db,`SELECT r.id benchmark_run_id,r.eval_run_id,r.capability_key,
      s.project_id subject_project_id,s.benchmark_type,s.id subject_id,
      snap.id snapshot_id,snap.status snapshot_status,snap.version_label,
      c.capability_type,e.status eval_status,e.candidate_runtime_sha
    FROM capability_benchmark_runs r
    JOIN benchmark_subjects s ON s.id=r.subject_id
    JOIN benchmark_snapshots snap ON snap.id=r.snapshot_id
    JOIN capability_registry c ON c.capability_key=r.capability_key
    LEFT JOIN eval_runs e ON e.id=r.eval_run_id
    WHERE r.id=?`,[input.benchmarkRunId]);
  if(!row)throw errorOf('Capability benchmark run not found','M29_BENCHMARK_RUN_NOT_FOUND',404);
  if(row.subject_project_id!==projectId)throw errorOf('Benchmark subject must be scoped to project','M29_BENCHMARK_PROJECT_SCOPE_REQUIRED',409);
  if(row.benchmark_type!=='AI_CAPABILITY'||!MODEL_TOOL_TYPES.has(row.capability_type))
    throw errorOf('M29 benchmark must target MODEL or TOOL capability','M29_MODEL_TOOL_BENCHMARK_REQUIRED',409);
  if(!row.eval_run_id||row.eval_status!=='PASS'||!SHA40.test(String(row.candidate_runtime_sha||'')))
    throw errorOf('Benchmark requires PASS Eval Run with exact Runtime SHA','M29_EVAL_EXACT_RUNTIME_REQUIRED',409);
  if(row.snapshot_status!=='CURRENT'||!row.version_label)
    throw errorOf('Benchmark snapshot requires CURRENT exact version label','M29_BENCHMARK_EXACT_VERSION_REQUIRED',409);
  if(String(input.modelToolVersion)!==String(row.version_label))
    throw errorOf('modelToolVersion must equal benchmark snapshot versionLabel','M29_BENCHMARK_VERSION_MISMATCH',409);
  const reliability=await one(db,'SELECT id,candidate_runtime_sha,snapshot_sha256,policy_version FROM eval_reliability_snapshots WHERE id=?',[input.reliabilitySnapshotId]);
  if(!reliability)throw errorOf('Eval reliability snapshot not found','M29_RELIABILITY_SNAPSHOT_NOT_FOUND',404);
  if(reliability.candidate_runtime_sha&&reliability.candidate_runtime_sha!==row.candidate_runtime_sha)
    throw errorOf('Reliability snapshot Runtime SHA mismatch','M29_RELIABILITY_RUNTIME_MISMATCH',409);
  const exactVersion={runtimeSha:row.candidate_runtime_sha,capabilityKey:row.capability_key,
    capabilityType:row.capability_type,modelToolVersion:row.version_label,
    benchmarkSnapshotId:row.snapshot_id,evalRunId:row.eval_run_id,
    reliabilitySnapshotId:reliability.id,reliabilitySnapshotSha256:reliability.snapshot_sha256,
    reliabilityPolicyVersion:reliability.policy_version};
  const id=randomUUID();
  await db.execute(`INSERT INTO m29_eval_benchmark_bindings
    (id,project_id,binding_key,benchmark_run_id,eval_run_id,reliability_snapshot_id,capability_key,
     capability_type,model_tool_version,candidate_runtime_sha,exact_version_json,status,evidence_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'VERIFIED',?)`,
    [id,projectId,input.bindingKey,row.benchmark_run_id,row.eval_run_id,reliability.id,row.capability_key,
     row.capability_type,row.version_label,row.candidate_runtime_sha,asJson(exactVersion),asJson(input.evidence)]);
  return {id,projectId,bindingKey:input.bindingKey,status:'VERIFIED',...exactVersion};
};

export const evaluateM29AnalyticsEvalGate=async(projectId,input={})=>{
  const db=getRuntimePool();await loadProject(projectId,db);
  const reasons=[];
  const [dataGate,selfLoopGate,automationGate]=await Promise.all([
    latestGate(db,'m29_data_detection_gate_evaluations',projectId,'G-M29-DATA-DETECTION'),
    latestGate(db,'m29_self_loop_gate_evaluations',projectId,'G-M29-SELF-LOOP'),
    latestGate(db,'m29_automation_gate_evaluations',projectId,'G-M29-AUTOMATION')
  ]);
  if(dataGate?.status!=='PASS')reasons.push('M29_DATA_GATE_REQUIRED');
  if(selfLoopGate?.status!=='PASS')reasons.push('M29_SELF_LOOP_GATE_REQUIRED');
  if(automationGate?.status!=='PASS')reasons.push('M29_AUTOMATION_GATE_REQUIRED');
  const analytics=await one(db,'SELECT * FROM m29_analytics_snapshots WHERE project_id=? ORDER BY window_end DESC,created_at DESC LIMIT 1',[projectId]);
  if(!analytics||analytics.status!=='PASS')reasons.push('M29_ANALYTICS_SNAPSHOT_PASS_REQUIRED');
  const bindings=await list(db,`SELECT * FROM m29_eval_benchmark_bindings
    WHERE project_id=? AND status='VERIFIED' ORDER BY created_at,id`,[projectId]);
  const modelToolTypes=[...new Set(bindings.map(x=>x.capability_type))];
  if(!bindings.length)reasons.push('M29_EVAL_BENCHMARK_BINDING_REQUIRED');
  if(!modelToolTypes.some(x=>MODEL_TOOL_TYPES.has(x)))reasons.push('M29_MODEL_TOOL_BENCHMARK_REQUIRED');
  const exactVersionValid=bindings.every(x=>SHA40.test(x.candidate_runtime_sha)&&Boolean(parseJson(x.exact_version_json)?.modelToolVersion));
  if(bindings.length&&!exactVersionValid)reasons.push('M29_EXACT_VERSION_LINEAGE_INVALID');
  const snapshot={
    upstream:{data:dataGate?.status||null,selfLoop:selfLoopGate?.status||null,automation:automationGate?.status||null},
    analyticsSnapshotId:analytics?.id||null,analyticsStatus:analytics?.status||null,
    portfolioCoverage:analytics?parseJson(analytics.portfolio_analytics_json)?.coverageStatus:null,
    productionCoverage:analytics?parseJson(analytics.production_analytics_json)?.coverageStatus:null,
    benchmarkBindingCount:bindings.length,benchmarkCapabilityTypes:modelToolTypes,
    exactVersionValid,readyForCrossDomainEvaluation:reasons.length===0
  };
  const status=reasons.length?'HOLD':'PASS',asOf=input.asOf?asDate(input.asOf):new Date();
  const id=randomUUID();
  await db.execute(`INSERT INTO m29_analytics_eval_gate_evaluations
    (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,
    [id,projectId,GATE,status,asJson(reasons),asJson(snapshot),asOf]);
  return {id,projectId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:snapshot,asOf};
};

export const getM29AnalyticsEvalState=async projectId=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  const [analytics,bindings,gates]=await Promise.all([
    list(db,'SELECT * FROM m29_analytics_snapshots WHERE project_id=? ORDER BY window_end DESC,created_at DESC',[projectId]),
    list(db,'SELECT * FROM m29_eval_benchmark_bindings WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM m29_analytics_eval_gate_evaluations WHERE project_id=? ORDER BY as_of DESC,created_at DESC',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,projectType:project.project_type},
    frontend:{language:'zh-CN',gateName:'分析 / 评测 / 能力基准门禁',
      moduleNames:['统一分析快照','评测与能力基准绑定','分析与评测门禁'],
      principle:'复用既有数据、Portfolio Intelligence 与 Eval Runtime；Benchmark 必须绑定 exact version，不以主观评分替代证据。'},
    analyticsSnapshots:analytics.map(x=>({id:x.id,snapshotKey:x.snapshot_key,status:x.status,
      projectAnalytics:parseJson(x.project_analytics_json),portfolioAnalytics:parseJson(x.portfolio_analytics_json),
      productionAnalytics:parseJson(x.production_analytics_json),dataAnalytics:parseJson(x.data_analytics_json),
      sourceWatermark:parseJson(x.source_watermark_json),windowStart:x.window_start,windowEnd:x.window_end})),
    benchmarkBindings:bindings.map(x=>({id:x.id,bindingKey:x.binding_key,capabilityKey:x.capability_key,
      capabilityType:x.capability_type,modelToolVersion:x.model_tool_version,candidateRuntimeSha:x.candidate_runtime_sha,
      exactVersion:parseJson(x.exact_version_json),status:x.status})),
    latestGate:gates[0]?{id:gates[0].id,status:gates[0].status,reasonCodes:parseJson(gates[0].reason_codes_json),
      evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),asOf:gates[0].as_of}:null
  };
};
