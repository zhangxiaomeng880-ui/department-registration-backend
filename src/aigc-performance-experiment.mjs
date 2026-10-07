import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AIGC-PERFORMANCE';
const DATA_QUALITY=new Set(['PASS','WARN','FAIL']);
const EXPERIMENT_SCOPES=new Set(['DISTRIBUTION','PRODUCTION','CREATIVE']);
const FEEDBACK_SOURCES=new Set(['PERFORMANCE','PLATFORM','OPERATIONS','QUALITY','COST']);
const FEEDBACK_SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const RATE_METRICS=new Set([
  'entryRate','retention3s','retention5s','completionRate','likeRate','commentRate',
  'saveRate','shareRate','followRate','profileRate','ctaConversionRate',
  'nextEpisodeRate','continuousWatchRate','ostJumpRate','fullContentJumpRate'
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

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Performance requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const publicationWithVerification=async(projectId,publicationId,db)=>{
  const [rows]=await db.execute(
    `SELECT p.*,v.status AS verification_status,v.verified_at
       FROM aigc_publication_records p
       LEFT JOIN aigc_post_publish_verifications v
         ON v.publication_record_id=p.id
      WHERE p.id=? AND p.project_id=?
      ORDER BY v.verified_at DESC LIMIT 1`,
    [publicationId,projectId]
  );
  return rows[0]||null;
};
const validateMetrics=metrics=>{
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||!Object.keys(metrics).length)
    throw errorOf('Performance metrics are required','AIGC_PERFORMANCE_METRICS_REQUIRED',409);
  for(const [key,value] of Object.entries(metrics)){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)
      throw errorOf('Performance metric must be non-negative number',
        'AIGC_PERFORMANCE_METRIC_INVALID',409,{metricKey:key,value});
    if(RATE_METRICS.has(key)&&value>1)
      throw errorOf('Rate metric must be between 0 and 1',
        'AIGC_PERFORMANCE_RATE_INVALID',409,{metricKey:key,value});
  }
};
const validateWindow=(startValue,endValue)=>{
  const start=new Date(startValue),end=new Date(endValue);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)
    throw errorOf('Performance window must be valid and increasing','AIGC_PERFORMANCE_WINDOW_INVALID',409);
  return {start,end};
};
const qaPass=row=>{
  const qa=parseJson(row.qa_json)||{};
  const values=Object.values(qa).map(upper);
  return values.length>0&&values.every(x=>['PASS','N_A'].includes(x));
};

export const resolveAigcPerformanceProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const createAigcPerformanceObservation=async(projectId,input={})=>{
  await loadProject(projectId);
  requireFields(input,[
    'publicationRecordId','observationKey','windowStart','windowEnd','metrics','dimensions',
    'sampleSize','dataQualityStatus','dataQuality','source','evidence'
  ],'INVALID_AIGC_PERFORMANCE_OBSERVATION');
  const {start,end}=validateWindow(input.windowStart,input.windowEnd);
  validateMetrics(input.metrics);
  const sampleSize=Number(input.sampleSize);
  if(!Number.isInteger(sampleSize)||sampleSize<=0)
    throw errorOf('sampleSize must be positive integer','AIGC_PERFORMANCE_SAMPLE_INVALID',409);
  const quality=upper(input.dataQualityStatus);
  if(!DATA_QUALITY.has(quality))throw errorOf(
    'Unsupported data quality status','AIGC_DATA_QUALITY_INVALID',409,{quality}
  );
  if(quality!=='PASS'&&!nonEmpty(input.dataQuality?.rationale))
    throw errorOf('WARN/FAIL data quality requires rationale','AIGC_DATA_QUALITY_RATIONALE_REQUIRED',409);

  const db=getRuntimePool();
  const pub=await publicationWithVerification(projectId,input.publicationRecordId,db);
  if(!pub||pub.status!=='PUBLISHED')throw errorOf(
    'Performance observation requires PUBLISHED publication receipt',
    'AIGC_PERFORMANCE_PUBLISHED_PUBLICATION_REQUIRED',409
  );
  if(pub.verification_status!=='PASS')throw errorOf(
    'Performance observation requires PASS post-publish verification',
    'AIGC_PERFORMANCE_VERIFICATION_REQUIRED',409
  );

  const id=randomUUID(),observedAt=input.observedAt?new Date(input.observedAt):new Date();
  if(Number.isNaN(observedAt.getTime()))throw errorOf('observedAt invalid','INVALID_DATE');
  await db.execute(
    `INSERT INTO aigc_performance_observations
      (id,project_id,publication_record_id,observation_key,window_start,window_end,metrics_json,
       dimensions_json,sample_size,data_quality_status,data_quality_json,source_json,evidence_json,observed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,pub.id,input.observationKey,start,end,asJson(input.metrics),asJson(input.dimensions),
      sampleSize,quality,asJson(input.dataQuality),asJson(input.source),asJson(input.evidence),observedAt
    ]
  );
  return {id,projectId,publicationRecordId:pub.id,observationKey:input.observationKey,
    dataQualityStatus:quality,sampleSize,windowStart:start,windowEnd:end};
};

export const createAigcProductionMetricSnapshot=async(projectId,input={})=>{
  await loadProject(projectId);
  requireFields(input,['snapshotKey','windowStart','windowEnd','evidence'],
    'INVALID_AIGC_PRODUCTION_METRIC_SNAPSHOT');
  const {start,end}=validateWindow(input.windowStart,input.windowEnd);
  const db=getRuntimePool();
  const [jobs,candidates]=await Promise.all([
    listRows(db,
      `SELECT * FROM aigc_generation_jobs
        WHERE project_id=? AND created_at>=? AND created_at<? ORDER BY created_at,id`,
      [projectId,start,end]),
    listRows(db,
      `SELECT c.*,j.generation_kind,j.model_tool,j.status AS job_status
         FROM aigc_generation_candidates c
         JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
        WHERE c.project_id=? AND c.created_at>=? AND c.created_at<? ORDER BY c.created_at,c.id`,
      [projectId,start,end])
  ]);
  const generationCount=jobs.length,candidateCount=candidates.length;
  const selected=candidates.filter(x=>x.is_current&&['SELECTED','LOCKED'].includes(x.selection_status));
  const selectedCount=selected.length;
  const firstPassCount=candidates.filter(qaPass).length;
  const failedBlockedCount=jobs.filter(x=>['FAIL','BLOCKED'].includes(x.status)).length;
  const shotKindKeys=new Set(jobs.map(x=>x.shot_id+':'+x.generation_kind));
  const regenerationCount=Math.max(0,generationCount-shotKindKeys.size);
  let totalCost=0,latencyTotal=0,latencyCount=0;
  const modelStats=new Map(),referenceUse=new Map();
  for(const job of jobs){
    const cost=parseJson(job.cost_json)||{};
    if(Number.isFinite(Number(cost.amount)))totalCost+=Number(cost.amount);
    if(job.latency_ms!=null&&Number.isFinite(Number(job.latency_ms))){
      latencyTotal+=Number(job.latency_ms);latencyCount++;
    }
    const key=job.model_tool||'UNKNOWN';
    const stat=modelStats.get(key)||{total:0,pass:0};
    stat.total++;if(job.status==='PASS')stat.pass++;modelStats.set(key,stat);
    for(const ref of parseJson(job.reference_bindings_json)||[]){
      if(ref?.referenceId)referenceUse.set(ref.referenceId,(referenceUse.get(ref.referenceId)||0)+1);
    }
  }
  const repeatedReferenceUses=[...referenceUse.values()].filter(x=>x>1).reduce((a,b)=>a+b-1,0);
  const totalReferenceUses=[...referenceUse.values()].reduce((a,b)=>a+b,0);
  const metrics={
    generationCount,candidateCount,selectedCount,
    candidateToSelectedRate:candidateCount?selectedCount/candidateCount:0,
    firstPassQaRate:candidateCount?firstPassCount/candidateCount:0,
    regenerationCount,
    failureBlockedRate:generationCount?failedBlockedCount/generationCount:0,
    totalGenerationCost:totalCost,
    costPerSelectedAsset:selectedCount?totalCost/selectedCount:null,
    averageGenerationLatencyMs:latencyCount?latencyTotal/latencyCount:null,
    assetReuseRate:totalReferenceUses?repeatedReferenceUses/totalReferenceUses:0,
    modelToolSuccessRate:Object.fromEntries([...modelStats].map(([key,v])=>[
      key,v.total?v.pass/v.total:0
    ]))
  };
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_production_metric_snapshots
      (id,project_id,snapshot_key,window_start,window_end,metrics_json,evidence_json)
     VALUES (?,?,?,?,?,?,?)`,
    [id,projectId,input.snapshotKey,start,end,asJson(metrics),asJson(input.evidence)]
  );
  return {id,projectId,snapshotKey:input.snapshotKey,windowStart:start,windowEnd:end,metrics};
};

export const createAigcExperimentCandidate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'candidateKey','experimentScope','hypothesis','control','treatment','targetMetrics',
    'guardrails','expectedLearning','risk','evidence'
  ],'INVALID_AIGC_EXPERIMENT_CANDIDATE');
  const scope=upper(input.experimentScope);
  if(!EXPERIMENT_SCOPES.has(scope))throw errorOf(
    'Experiment scope must be DISTRIBUTION/PRODUCTION/CREATIVE',
    'AIGC_EXPERIMENT_SCOPE_INVALID',409,{scope}
  );
  if(input.storyRuleChange===true||upper(input.requestedPromotion)==='STORY_RULE')
    throw errorOf(
      'Stage 13 cannot promote Story Rule; Stage 14 Review + Human Gate is required',
      'AIGC_STORY_RULE_REVIEW_HUMAN_GATE_REQUIRED',409
    );
  const observationIds=[...new Set(input.sourceObservationIds||[])];
  const snapshotIds=[...new Set(input.sourceSnapshotIds||[])];
  if(!observationIds.length&&!snapshotIds.length)throw errorOf(
    'Experiment candidate needs observation or production snapshot evidence',
    'AIGC_EXPERIMENT_SOURCE_REQUIRED',409
  );
  const db=getRuntimePool();
  if(observationIds.length){
    const [rows]=await db.query(
      `SELECT id FROM aigc_performance_observations
        WHERE project_id=? AND id IN (${observationIds.map(()=>'?').join(',')})`,
      [projectId,...observationIds]
    );
    if(rows.length!==observationIds.length)throw errorOf(
      'Experiment observation source scope invalid','AIGC_EXPERIMENT_OBSERVATION_SCOPE_INVALID',409
    );
  }
  if(snapshotIds.length){
    const [rows]=await db.query(
      `SELECT id FROM aigc_production_metric_snapshots
        WHERE project_id=? AND id IN (${snapshotIds.map(()=>'?').join(',')})`,
      [projectId,...snapshotIds]
    );
    if(rows.length!==snapshotIds.length)throw errorOf(
      'Experiment snapshot source scope invalid','AIGC_EXPERIMENT_SNAPSHOT_SCOPE_INVALID',409
    );
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_experiment_candidates
      (id,project_id,candidate_key,experiment_scope,source_observation_ids_json,source_snapshot_ids_json,
       hypothesis_json,control_json,treatment_json,target_metrics_json,guardrails_json,
       expected_learning_json,risk_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CANDIDATE',?,?)`,
    [
      id,projectId,input.candidateKey,scope,asJson(observationIds),asJson(snapshotIds),
      asJson(input.hypothesis),asJson(input.control),asJson(input.treatment),asJson(input.targetMetrics),
      asJson(input.guardrails),asJson(input.expectedLearning),asJson(input.risk),asJson(input.evidence),actorId
    ]
  );
  return {id,projectId,candidateKey:input.candidateKey,experimentScope:scope,status:'CANDIDATE',
    storyRulePromotionAllowed:false};
};

export const createAigcFeedbackSignal=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'feedbackKey','sourceType','sourceRef','summary','severity','classification','evidence'
  ],'INVALID_AIGC_FEEDBACK_SIGNAL');
  const sourceType=upper(input.sourceType),severity=upper(input.severity);
  if(!FEEDBACK_SOURCES.has(sourceType))throw errorOf(
    'Unsupported feedback source','AIGC_FEEDBACK_SOURCE_INVALID',409,{sourceType}
  );
  if(!FEEDBACK_SEVERITIES.has(severity))throw errorOf(
    'Unsupported feedback severity','AIGC_FEEDBACK_SEVERITY_INVALID',409,{severity}
  );
  const requestedStoryChange=input.storyRuleChangeRequested===true;
  const recommendedScope=input.recommendedScope?upper(input.recommendedScope):null;
  if(recommendedScope&&![...EXPERIMENT_SCOPES,'STORY_REVIEW'].includes(recommendedScope))
    throw errorOf('Unsupported recommended scope','AIGC_FEEDBACK_RECOMMENDED_SCOPE_INVALID',409);
  const normalizedScope=requestedStoryChange?'STORY_REVIEW':recommendedScope;
  const id=randomUUID(),collectedAt=input.collectedAt?new Date(input.collectedAt):new Date();
  if(Number.isNaN(collectedAt.getTime()))throw errorOf('collectedAt invalid','INVALID_DATE');
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO aigc_feedback_signals
      (id,project_id,feedback_key,source_type,source_ref_json,summary,severity,classification_json,
       recommended_scope,story_rule_change_requested,status,evidence_json,created_by_identity_id,collected_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'COLLECTED',?,?,?)`,
    [
      id,projectId,input.feedbackKey,sourceType,asJson(input.sourceRef),input.summary,severity,
      asJson(input.classification),normalizedScope,requestedStoryChange?1:0,asJson(input.evidence),actorId,collectedAt
    ]
  );
  return {id,projectId,feedbackKey:input.feedbackKey,sourceType,severity,status:'COLLECTED',
    recommendedScope:normalizedScope,requiresStage14HumanGate:requestedStoryChange};
};

export const evaluateAigcPerformanceGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[],evidence={};
  const [publications,observations,snapshots,candidates,feedback]=await Promise.all([
    listRows(db,
      `SELECT p.id,p.status,MAX(v.status='PASS') verified
         FROM aigc_publication_records p
         LEFT JOIN aigc_post_publish_verifications v ON v.publication_record_id=p.id
        WHERE p.project_id=? GROUP BY p.id,p.status`,[projectId]),
    listRows(db,'SELECT * FROM aigc_performance_observations WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_metric_snapshots WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM aigc_experiment_candidates WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM aigc_feedback_signals WHERE project_id=?',[projectId])
  ]);
  const verifiedPublications=publications.filter(x=>x.status==='PUBLISHED'&&Number(x.verified)===1);
  if(!verifiedPublications.length)reasons.push('AIGC_PERFORMANCE_VERIFIED_PUBLICATION_REQUIRED');
  const observedPublicationIds=new Set(observations.map(x=>x.publication_record_id));
  const missingObserved=verifiedPublications.filter(x=>!observedPublicationIds.has(x.id));
  if(missingObserved.length)reasons.push('AIGC_PERFORMANCE_OBSERVATION_COVERAGE_INCOMPLETE');
  if(!snapshots.length)reasons.push('AIGC_PRODUCTION_METRIC_SNAPSHOT_REQUIRED');
  const failedQuality=observations.filter(x=>x.data_quality_status==='FAIL');
  if(failedQuality.length)reasons.push('AIGC_PERFORMANCE_DATA_QUALITY_FAIL');
  const storyPromotionCandidates=candidates.filter(x=>x.experiment_scope==='STORY_RULE');
  if(storyPromotionCandidates.length)reasons.push('AIGC_STORY_RULE_AUTO_PROMOTION_FORBIDDEN');

  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  evidence.publicationCount=publications.length;
  evidence.verifiedPublicationCount=verifiedPublications.length;
  evidence.observationCount=observations.length;
  evidence.observedVerifiedPublicationCount=verifiedPublications.length-missingObserved.length;
  evidence.productionSnapshotCount=snapshots.length;
  evidence.experimentCandidateCount=candidates.length;
  evidence.feedbackSignalCount=feedback.length;
  evidence.dataQualityFailObservationIds=failedQuality.map(x=>x.id);
  evidence.storyRuleChangeFeedbackCount=feedback.filter(x=>Boolean(x.story_rule_change_requested)).length;
  evidence.storyRuleChangesRequireStage14HumanGate=true;
  evidence.readyForReview=reasons.length===0;

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

export const getAigcPerformanceState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [observations,snapshots,candidates,feedback,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_performance_observations WHERE project_id=? ORDER BY window_end,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_metric_snapshots WHERE project_id=? ORDER BY window_end,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_experiment_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_feedback_signals WHERE project_id=? ORDER BY collected_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m2815_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['表现数据观测','生产指标快照','实验候选','反馈信号'],
      gateName:'表现 / 实验 / 反馈门禁',
      storyRulePolicy:'Story Rule 升级必须进入复盘 / 知识 / 下一版本，并经过人工门禁'
    },
    observations:observations.map(x=>({
      id:x.id,publicationRecordId:x.publication_record_id,observationKey:x.observation_key,
      windowStart:x.window_start,windowEnd:x.window_end,metrics:parseJson(x.metrics_json),
      dimensions:parseJson(x.dimensions_json),sampleSize:Number(x.sample_size),
      dataQualityStatus:x.data_quality_status,dataQuality:parseJson(x.data_quality_json),
      source:parseJson(x.source_json),observedAt:x.observed_at
    })),
    productionSnapshots:snapshots.map(x=>({
      id:x.id,snapshotKey:x.snapshot_key,windowStart:x.window_start,windowEnd:x.window_end,
      metrics:parseJson(x.metrics_json)
    })),
    experimentCandidates:candidates.map(x=>({
      id:x.id,candidateKey:x.candidate_key,experimentScope:x.experiment_scope,
      sourceObservationIds:parseJson(x.source_observation_ids_json),
      sourceSnapshotIds:parseJson(x.source_snapshot_ids_json),
      hypothesis:parseJson(x.hypothesis_json),control:parseJson(x.control_json),
      treatment:parseJson(x.treatment_json),targetMetrics:parseJson(x.target_metrics_json),
      guardrails:parseJson(x.guardrails_json),expectedLearning:parseJson(x.expected_learning_json),
      risk:parseJson(x.risk_json),status:x.status
    })),
    feedbackSignals:feedback.map(x=>({
      id:x.id,feedbackKey:x.feedback_key,sourceType:x.source_type,sourceRef:parseJson(x.source_ref_json),
      summary:x.summary,severity:x.severity,classification:parseJson(x.classification_json),
      recommendedScope:x.recommended_scope||null,storyRuleChangeRequested:Boolean(x.story_rule_change_requested),
      status:x.status,collectedAt:x.collected_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
