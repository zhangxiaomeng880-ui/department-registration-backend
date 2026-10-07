import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AIGC-PERFORMANCE';
const CONFIDENCE=new Set(['LOW','MEDIUM','HIGH']);
const FEEDBACK_TYPES=new Set(['QUANTITATIVE','QUALITATIVE']);
const DATA_QUALITY=new Set(['PASS','WARN','FAIL']);
const FEEDBACK_SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const RECOMMENDED_SCOPES=new Set(['DISTRIBUTION','PRODUCTION','CREATIVE','REVIEW']);
const EXPERIMENT_TYPES=new Set(['DISTRIBUTION','PRODUCTION','CREATIVE']);
const RECOGNIZED_METRICS=new Set([
  'entry','retention3s','retention5s','completionRate','watchTimeSeconds',
  'likeCount','commentCount','saveCount','shareCount','followCount','profileVisits',
  'ctaConversions','nextEpisodeRate','continuousWatchRate','ostJumpRate','fullContentJumpRate'
]);

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];
const finiteOrNull=v=>Number.isFinite(Number(v))?Number(v):null;
const ratio=(a,b)=>b>0?Number((a/b).toFixed(6)):null;

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'Performance Feedback requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const containsSecret=value=>{
  if(!value||typeof value!=='object')return false;
  for(const [key,child] of Object.entries(value)){
    if(/token|secret|password|credential/i.test(key))return true;
    if(containsSecret(child))return true;
  }
  return false;
};

export const resolveAigcPerformanceProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const createAigcPerformanceSnapshot=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'publicationRecordId','snapshotKey','platformKey','region','language',
    'windowStart','windowEnd','metrics','sampleSize','dataQualityStatus','dataQuality',
    'source','confidence','limitations','evidence','observedAt'
  ],'INVALID_AIGC_PERFORMANCE_SNAPSHOT');
  const confidence=upper(input.confidence),dataQualityStatus=upper(input.dataQualityStatus);
  if(!CONFIDENCE.has(confidence))throw errorOf(
    'Performance confidence must be LOW/MEDIUM/HIGH','AIGC_PERFORMANCE_CONFIDENCE_INVALID',409
  );
  if(!DATA_QUALITY.has(dataQualityStatus))throw errorOf(
    'Performance data quality must be PASS/WARN/FAIL','AIGC_PERFORMANCE_DATA_QUALITY_INVALID',409
  );
  const sampleSize=Number(input.sampleSize);
  if(!Number.isInteger(sampleSize)||sampleSize<0)throw errorOf(
    'Performance sampleSize must be a non-negative integer','AIGC_PERFORMANCE_SAMPLE_SIZE_INVALID',409
  );
  if(containsSecret(input.source))throw errorOf(
    'Performance source metadata must not contain credentials',
    'AIGC_PERFORMANCE_SOURCE_CREDENTIAL_FORBIDDEN',409
  );
  const metricKeys=Object.keys(input.metrics||{});
  if(!metricKeys.some(k=>RECOGNIZED_METRICS.has(k))&&!nonEmpty(input.metrics?.custom))
    throw errorOf('Performance snapshot has no recognized metrics',
      'AIGC_PERFORMANCE_METRICS_REQUIRED',409);
  const windowStart=new Date(input.windowStart),windowEnd=new Date(input.windowEnd),observedAt=new Date(input.observedAt);
  if([windowStart,windowEnd,observedAt].some(x=>Number.isNaN(x.getTime()))||windowEnd<=windowStart||observedAt<windowEnd)
    throw errorOf('Performance time window is invalid','AIGC_PERFORMANCE_WINDOW_INVALID',409);

  const db=getRuntimePool();
  const [pubs]=await db.execute(
    `SELECT r.*,i.platform_key,i.region,i.language
       FROM aigc_publication_records r
       JOIN aigc_release_plan_items i ON i.id=r.release_plan_item_id
      WHERE r.id=? AND r.project_id=?`,[input.publicationRecordId,projectId]
  );
  const pub=pubs[0];
  if(!pub||pub.status!=='PUBLISHED')throw errorOf(
    'Performance snapshot requires PUBLISHED record','AIGC_PERFORMANCE_PUBLISHED_REQUIRED',409
  );
  const [verified]=await db.execute(
    `SELECT id FROM aigc_post_publish_verifications
      WHERE publication_record_id=? AND status='PASS'
      ORDER BY verified_at DESC LIMIT 1`,[pub.id]
  );
  if(!verified.length)throw errorOf(
    'Performance snapshot requires post-publish PASS',
    'AIGC_PERFORMANCE_POST_PUBLISH_PASS_REQUIRED',409
  );
  if(upper(input.platformKey)!==pub.platform_key||input.region!==pub.region||input.language!==pub.language)
    throw errorOf('Performance platform/region/language must match publication',
      'AIGC_PERFORMANCE_PUBLICATION_SCOPE_MISMATCH',409);

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_performance_snapshots
      (id,project_id,publication_record_id,snapshot_key,platform_key,region,language,
       window_start,window_end,metrics_json,sample_size,data_quality_status,data_quality_json,
       source_json,confidence,limitations_json,evidence_json,observed_at,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,pub.id,input.snapshotKey,pub.platform_key,input.region,input.language,
     windowStart,windowEnd,asJson(input.metrics),sampleSize,dataQualityStatus,asJson(input.dataQuality),
     asJson(input.source),confidence,asJson(input.limitations),asJson(input.evidence),observedAt,actorId]
  );
  return {id,projectId,publicationRecordId:pub.id,snapshotKey:input.snapshotKey,
    platformKey:pub.platform_key,region:input.region,language:input.language,
    sampleSize,dataQualityStatus,confidence};
};

export const createAigcProductionMetricSnapshot=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,['snapshotKey','asOf','evidence'],'INVALID_AIGC_PRODUCTION_METRICS');
  const asOf=new Date(input.asOf);
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool();
  const [jobs,candidates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_generation_jobs WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_generation_candidates WHERE project_id=? ORDER BY created_at,id',[projectId])
  ]);

  const terminal=jobs.filter(j=>['PASS','FAIL','BLOCKED'].includes(j.status));
  const passJobs=terminal.filter(j=>j.status==='PASS');
  const failedBlocked=terminal.filter(j=>['FAIL','BLOCKED'].includes(j.status));
  const selected=candidates.filter(c=>c.is_current&&['SELECTED','LOCKED'].includes(c.selection_status));
  const firstPassCandidates=candidates.filter(c=>{
    const qa=parseJson(c.qa_json)||{};
    return Object.values(qa).length>0&&Object.values(qa).every(v=>['PASS','N_A'].includes(upper(v)));
  });
  let totalCost=0,totalLatency=0,latencyCount=0,regenerationCount=0;
  const referenceUsage=new Map(),modelStats=new Map();
  for(const job of jobs){
    const cost=parseJson(job.cost_json)||{};
    const amount=finiteOrNull(cost.amount);
    if(amount!=null)totalCost+=amount;
    if(job.latency_ms!=null&&Number.isFinite(Number(job.latency_ms))){
      totalLatency+=Number(job.latency_ms);latencyCount++;
    }
    const retry=parseJson(job.retry_json)||{};
    if(Number(retry.currentAttempt||retry.attempt||1)>1)regenerationCount++;
    for(const ref of parseJson(job.reference_bindings_json)||[]){
      const id=ref.referenceId||ref.id;
      if(id)referenceUsage.set(id,(referenceUsage.get(id)||0)+1);
    }
    const key=`${job.provider}::${job.model_tool}::${job.model_tool_version}`;
    const s=modelStats.get(key)||{provider:job.provider,modelTool:job.model_tool,
      modelToolVersion:job.model_tool_version,total:0,pass:0};
    s.total++;if(job.status==='PASS')s.pass++;modelStats.set(key,s);
  }
  const reusedRefs=[...referenceUsage.values()].filter(n=>n>1).length;
  const metrics={
    generationCount:jobs.length,
    candidateCount:candidates.length,
    selectedCurrentCount:selected.length,
    candidateToSelectedRate:ratio(selected.length,candidates.length),
    firstPassQaRate:ratio(firstPassCandidates.length,candidates.length),
    regenerationCount,
    failureBlockedRate:ratio(failedBlocked.length,terminal.length),
    totalGenerationCost:Number(totalCost.toFixed(6)),
    costPerSelectedAsset:selected.length?Number((totalCost/selected.length).toFixed(6)):null,
    averageGenerationLatencyMs:latencyCount?Math.round(totalLatency/latencyCount):null,
    assetReuseRate:ratio(reusedRefs,referenceUsage.size),
    modelToolSuccessRate:[...modelStats.values()].map(x=>({...x,successRate:ratio(x.pass,x.total)}))
  };
  const sourceCounts={
    jobCount:jobs.length,terminalJobCount:terminal.length,passJobCount:passJobs.length,
    failBlockedJobCount:failedBlocked.length,candidateCount:candidates.length,
    selectedCurrentCount:selected.length,uniqueReferenceCount:referenceUsage.size,reusedReferenceCount:reusedRefs
  };
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_production_metric_snapshots
      (id,project_id,snapshot_key,as_of,metrics_json,source_counts_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id,projectId,input.snapshotKey,asOf,asJson(metrics),asJson(sourceCounts),asJson(input.evidence),actorId]
  );
  return {id,projectId,snapshotKey:input.snapshotKey,asOf,metrics,sourceCounts};
};

export const createAigcFeedbackSignal=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'signalKey','feedbackType','subject','signal','source','confidence','severity',
    'recommendedScope','limitation','collectedAt','evidence'
  ],'INVALID_AIGC_FEEDBACK_SIGNAL');
  const feedbackType=upper(input.feedbackType),confidence=upper(input.confidence),
    severity=upper(input.severity),recommendedScope=upper(input.recommendedScope);
  if(!FEEDBACK_TYPES.has(feedbackType))throw errorOf(
    'Feedback type must be QUANTITATIVE or QUALITATIVE','AIGC_FEEDBACK_TYPE_INVALID',409
  );
  if(!CONFIDENCE.has(confidence))throw errorOf(
    'Feedback confidence must be LOW/MEDIUM/HIGH','AIGC_FEEDBACK_CONFIDENCE_INVALID',409
  );
  if(!FEEDBACK_SEVERITIES.has(severity))throw errorOf(
    'Feedback severity invalid','AIGC_FEEDBACK_SEVERITY_INVALID',409
  );
  if(!RECOMMENDED_SCOPES.has(recommendedScope))throw errorOf(
    'Feedback recommended scope invalid','AIGC_FEEDBACK_SCOPE_INVALID',409
  );
  const storyRuleChangeRequested=input.storyRuleChangeRequested===true;
  if(storyRuleChangeRequested&&recommendedScope!=='REVIEW')throw errorOf(
    'Story Rule signals must route to Review','AIGC_STORY_RULE_REVIEW_REQUIRED',409
  );
  const collectedAt=new Date(input.collectedAt);
  if(Number.isNaN(collectedAt.getTime()))throw errorOf('Invalid collectedAt','AIGC_FEEDBACK_COLLECTED_AT_INVALID',409);
  if(containsSecret(input.source))throw errorOf(
    'Feedback source metadata must not contain credentials','AIGC_FEEDBACK_SOURCE_CREDENTIAL_FORBIDDEN',409
  );
  const db=getRuntimePool();
  if(input.performanceSnapshotId){
    const [rows]=await db.execute(
      'SELECT id FROM aigc_performance_snapshots WHERE id=? AND project_id=?',
      [input.performanceSnapshotId,projectId]
    );
    if(!rows.length)throw errorOf('Feedback performance snapshot scope invalid',
      'AIGC_FEEDBACK_PERFORMANCE_SCOPE_INVALID',409);
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_feedback_signals
      (id,project_id,performance_snapshot_id,signal_key,feedback_type,subject,signal_json,
       source_json,confidence,severity,recommended_scope,story_rule_change_requested,status,
       limitation_json,evidence_json,collected_at,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.performanceSnapshotId||null,input.signalKey,feedbackType,input.subject,
     asJson(input.signal),asJson(input.source),confidence,severity,recommendedScope,storyRuleChangeRequested?1:0,
     storyRuleChangeRequested?'REVIEW_REQUIRED':'COLLECTED',asJson(input.limitation),asJson(input.evidence),
     collectedAt,actorId]
  );
  return {id,projectId,performanceSnapshotId:input.performanceSnapshotId||null,
    signalKey:input.signalKey,feedbackType,subject:input.subject,confidence,severity,recommendedScope,
    storyRuleChangeRequested,status:storyRuleChangeRequested?'REVIEW_REQUIRED':'COLLECTED'};
};

const validateSourceIds=async(db,projectId,table,ids,code)=>{
  if(!ids.length)return;
  const [rows]=await db.query(
    `SELECT id FROM ${table} WHERE project_id=? AND id IN (${ids.map(()=>'?').join(',')})`,
    [projectId,...ids]
  );
  if(rows.length!==new Set(ids).size)throw errorOf('Experiment source scope invalid',code,409);
};

export const createAigcExperimentCandidate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'experimentKey','experimentType','hypothesis','target','variant','successMetrics','guardrails','evidence'
  ],'INVALID_AIGC_EXPERIMENT_CANDIDATE');
  const experimentType=upper(input.experimentType);
  if(!EXPERIMENT_TYPES.has(experimentType))throw errorOf(
    'Experiment type must be DISTRIBUTION/PRODUCTION/CREATIVE',
    'AIGC_EXPERIMENT_TYPE_INVALID',409,{experimentType}
  );
  const perfIds=[...new Set(input.sourcePerformanceSnapshotIds||[])];
  const prodIds=[...new Set(input.sourceProductionMetricSnapshotIds||[])];
  const feedbackIds=[...new Set(input.sourceFeedbackSignalIds||[])];
  if(!perfIds.length&&!prodIds.length&&!feedbackIds.length)throw errorOf(
    'Experiment candidate requires at least one evidence source',
    'AIGC_EXPERIMENT_SOURCE_REQUIRED',409
  );
  const escalation=input.storyRuleEscalation||{requested:false};
  if(escalation.applied===true||escalation.autoApply===true)
    throw errorOf('Stage 13 cannot apply Story Rule changes',
      'AIGC_STORY_RULE_AUTO_APPLY_FORBIDDEN',409);
  if(escalation.requested===true&&(
      !nonEmpty(escalation.reason)||!nonEmpty(escalation.reviewGate)||escalation.humanGateRequired!==true
    ))
    throw errorOf('Story Rule escalation requires explicit Review + Human Gate metadata',
      'AIGC_STORY_RULE_REVIEW_REQUIRED',409);
  const status=escalation.requested===true?'REVIEW_REQUIRED':'CANDIDATE';

  const db=getRuntimePool();
  await validateSourceIds(db,projectId,'aigc_performance_snapshots',perfIds,'AIGC_EXPERIMENT_PERFORMANCE_SCOPE_INVALID');
  await validateSourceIds(db,projectId,'aigc_production_metric_snapshots',prodIds,'AIGC_EXPERIMENT_PRODUCTION_SCOPE_INVALID');
  await validateSourceIds(db,projectId,'aigc_feedback_signals',feedbackIds,'AIGC_EXPERIMENT_FEEDBACK_SCOPE_INVALID');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_experiment_candidates
      (id,project_id,experiment_key,experiment_type,hypothesis,
       source_performance_snapshot_ids_json,source_production_metric_snapshot_ids_json,
       source_feedback_signal_ids_json,target_json,variant_json,success_metrics_json,guardrails_json,
       story_rule_escalation_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.experimentKey,experimentType,input.hypothesis,asJson(perfIds),asJson(prodIds),
     asJson(feedbackIds),asJson(input.target),asJson(input.variant),asJson(input.successMetrics),
     asJson(input.guardrails),asJson({...escalation,applied:false}),status,asJson(input.evidence),actorId]
  );
  return {id,projectId,experimentKey:input.experimentKey,experimentType,status,
    storyRuleEscalationRequested:escalation.requested===true};
};

export const evaluateAigcPerformanceGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[];
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const maxAgeHours=Math.max(1,Math.min(720,Number(input.maxAgeHours)||168));
  const cutoff=new Date(asOf.getTime()-maxAgeHours*3600000);

  const [verifiedPubs,performance,production,experiments,feedback]=await Promise.all([
    listRows(db,
      `SELECT DISTINCT r.id FROM aigc_publication_records r
        JOIN aigc_post_publish_verifications v ON v.publication_record_id=r.id AND v.status='PASS'
       WHERE r.project_id=? AND r.status='PUBLISHED'`,[projectId]),
    listRows(db,'SELECT * FROM aigc_performance_snapshots WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_metric_snapshots WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM aigc_experiment_candidates WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM aigc_feedback_signals WHERE project_id=?',[projectId])
  ]);
  if(!verifiedPubs.length)reasons.push('AIGC_PERFORMANCE_VERIFIED_PUBLICATION_REQUIRED');
  if(!performance.length)reasons.push('AIGC_PERFORMANCE_SNAPSHOT_REQUIRED');
  if(!production.length)reasons.push('AIGC_PRODUCTION_METRIC_SNAPSHOT_REQUIRED');
  if(!experiments.length)reasons.push('AIGC_EXPERIMENT_CANDIDATE_REQUIRED');

  const verifiedIds=new Set(verifiedPubs.map(x=>x.id));
  const invalidPerformance=performance.filter(x=>!verifiedIds.has(x.publication_record_id));
  if(invalidPerformance.length)reasons.push('AIGC_PERFORMANCE_PUBLICATION_LINEAGE_INVALID');
  const coveredIds=new Set(performance.filter(x=>verifiedIds.has(x.publication_record_id)).map(x=>x.publication_record_id));
  const missingPublicationIds=verifiedPubs.filter(x=>!coveredIds.has(x.id)).map(x=>x.id);
  if(missingPublicationIds.length)reasons.push('AIGC_PERFORMANCE_PUBLICATION_COVERAGE_INCOMPLETE');
  const qualityFail=performance.filter(x=>x.data_quality_status==='FAIL');
  if(qualityFail.length)reasons.push('AIGC_PERFORMANCE_DATA_QUALITY_FAIL');
  const stalePerformance=performance.filter(x=>new Date(x.observed_at)<cutoff);
  if(performance.length&&stalePerformance.length===performance.length)
    reasons.push('AIGC_PERFORMANCE_SNAPSHOT_STALE');
  const latestProduction=production.slice().sort((a,b)=>new Date(a.as_of)-new Date(b.as_of)).at(-1)||null;
  if(latestProduction&&new Date(latestProduction.as_of)<cutoff)
    reasons.push('AIGC_PRODUCTION_METRIC_SNAPSHOT_STALE');

  const invalidExperimentType=experiments.filter(x=>!EXPERIMENT_TYPES.has(x.experiment_type));
  if(invalidExperimentType.length)reasons.push('AIGC_EXPERIMENT_TYPE_INVALID');
  const storyApplied=experiments.filter(x=>(parseJson(x.story_rule_escalation_json)||{}).applied===true);
  if(storyApplied.length)reasons.push('AIGC_STORY_RULE_AUTO_APPLY_FORBIDDEN');
  const unsafeStory=experiments.filter(x=>{
    const e=parseJson(x.story_rule_escalation_json)||{};
    return e.requested===true&&(x.status!=='REVIEW_REQUIRED'||e.humanGateRequired!==true||!nonEmpty(e.reviewGate));
  });
  if(unsafeStory.length)reasons.push('AIGC_STORY_RULE_REVIEW_REQUIRED');
  const reviewRequiredStory=experiments.filter(x=>{
    const e=parseJson(x.story_rule_escalation_json)||{};
    return e.requested===true&&x.status==='REVIEW_REQUIRED'&&e.applied!==true&&e.humanGateRequired===true;
  });

  const evidence={
    verifiedPublicationCount:verifiedPubs.length,
    performanceSnapshotCount:performance.length,
    coveredPublicationCount:coveredIds.size,
    missingPublicationIds,
    dataQualityFailSnapshotIds:qualityFail.map(x=>x.id),
    stalePerformanceSnapshotIds:stalePerformance.map(x=>x.id),
    productionMetricSnapshotCount:production.length,
    latestProductionMetricSnapshotId:latestProduction?.id||null,
    feedbackSignalCount:feedback.length,
    experimentCandidateCount:experiments.length,
    distributionExperimentCount:experiments.filter(x=>x.experiment_type==='DISTRIBUTION').length,
    productionExperimentCount:experiments.filter(x=>x.experiment_type==='PRODUCTION').length,
    creativeExperimentCount:experiments.filter(x=>x.experiment_type==='CREATIVE').length,
    reviewRequiredStoryEscalationCount:reviewRequiredStory.length,
    storyRuleAppliedCount:storyApplied.length,
    storyRuleAutoMutationExecuted:false,
    readyForReviewAndKnowledge:reasons.length===0
  };
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m2815_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};
export const getAigcPerformanceFeedbackState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [performance,production,feedback,experiments,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_performance_snapshots WHERE project_id=? ORDER BY observed_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_metric_snapshots WHERE project_id=? ORDER BY as_of,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_feedback_signals WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_experiment_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m2815_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['表现数据快照','生产效率指标','实验候选','反馈信号'],
      gateName:'表现 / 实验 / 反馈门禁',
      storyRulePolicy:'数据只能生成实验候选；Story Rule 升级必须进入复盘并经过人工门禁'
    },
    performanceSnapshots:performance.map(x=>({
      id:x.id,publicationRecordId:x.publication_record_id,snapshotKey:x.snapshot_key,
      platformKey:x.platform_key,region:x.region,language:x.language,windowStart:x.window_start,
      windowEnd:x.window_end,metrics:parseJson(x.metrics_json),sampleSize:Number(x.sample_size),
      dataQualityStatus:x.data_quality_status,dataQuality:parseJson(x.data_quality_json),
      source:parseJson(x.source_json),confidence:x.confidence,
      limitations:parseJson(x.limitations_json),observedAt:x.observed_at
    })),
    productionMetricSnapshots:production.map(x=>({
      id:x.id,snapshotKey:x.snapshot_key,asOf:x.as_of,metrics:parseJson(x.metrics_json),
      sourceCounts:parseJson(x.source_counts_json)
    })),
    feedbackSignals:feedback.map(x=>({
      id:x.id,performanceSnapshotId:x.performance_snapshot_id||null,signalKey:x.signal_key,
      feedbackType:x.feedback_type,subject:x.subject,signal:parseJson(x.signal_json),
      source:parseJson(x.source_json),confidence:x.confidence,limitation:parseJson(x.limitation_json)
    })),
    experimentCandidates:experiments.map(x=>({
      id:x.id,experimentKey:x.experiment_key,experimentType:x.experiment_type,hypothesis:x.hypothesis,
      sourcePerformanceSnapshotIds:parseJson(x.source_performance_snapshot_ids_json),
      sourceProductionMetricSnapshotIds:parseJson(x.source_production_metric_snapshot_ids_json),
      sourceFeedbackSignalIds:parseJson(x.source_feedback_signal_ids_json),
      target:parseJson(x.target_json),variant:parseJson(x.variant_json),
      successMetrics:parseJson(x.success_metrics_json),guardrails:parseJson(x.guardrails_json),
      storyRuleEscalation:parseJson(x.story_rule_escalation_json),status:x.status
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
